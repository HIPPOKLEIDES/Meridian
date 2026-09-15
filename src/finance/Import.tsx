import { useMemo, useState } from 'react';
import type { DateKey, ID } from '../types';
import type { Cents, ImportMapping, Transaction } from './types';
import { matchRule, newTransaction, useFinance } from './store';
import { cleanPayee, detectBank, findHeaderRow, hintCategory, normalize, parseCsv, readRow, suggestMapping, type DateFormat, type HintSource } from './csv';
import { fmtMoney } from './money';
import { AccountSelect, Amount, CategorySelect, categoryPatch } from './shared';
import { Empty, Field, Icon, Segmented } from '../components/common';
import { fmtDateShort } from '../lib/dates';
import { navigate } from '../lib/hooks';
import { useUI } from '../ui';

type MatchSource = 'rule' | 'payee' | HintSource;

const MATCH_LABELS: Record<MatchSource, string> = {
  rule: 'by rule',
  payee: 'payee default',
  'card-payment': 'looks like a card payment',
  transfer: 'looks like a transfer',
  'tax-payment': 'looks like an estimated tax payment',
  'bank-category': "from the bank's category",
  interest: 'interest',
  refund: 'refund',
};

interface Draft {
  key: string;
  include: boolean;
  duplicate: boolean;
  date: DateKey;
  description: string;
  /** Signed: + money in, − money out. */
  signed: Cents;
  payee: string;
  categoryId: ID | null;
  matchedBy: MatchSource | null;
}

export function ImportTab() {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [paste, setPaste] = useState('');

  const load = (text: string, name: string) => {
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      alert('That file has no rows to import.');
      return;
    }
    setRows(parsed);
    setFileName(name);
  };

  if (!rows) {
    return (
      <section className="card stack">
        <h3 className="card-title">
          <Icon name="upload" /> Import a bank or card statement
        </h3>
        <p className="small">
          Download activity as CSV from your bank's website, then choose the file here. Meridian recognizes exports from Bank of America (checking,
          savings and credit cards), Chase cards including Amazon Prime Visa, and Capital One 360. Other banks work too after you map the
          columns once. Re-importing an overlapping date range is safe, because transactions already imported are skipped.
        </p>
        <ul className="bank-tips small">
          <li>
            <b>Bank of America:</b> on the desktop site open the account's activity, choose <i>Download</i>, pick a date range and the comma-delimited
            (CSV) file type.
          </li>
          <li>
            <b>Chase / Amazon Prime Visa:</b> on chase.com open the card's activity, click the download icon and choose CSV.
          </li>
          <li>
            <b>Capital One 360:</b> open the savings account, choose <i>Download Transactions</i> and CSV. Downloads may only reach back about 90
            days, so import every month or two.
          </li>
        </ul>
        <label className="dropzone">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) load(await f.text(), f.name);
              e.target.value = '';
            }}
          />
          <Icon name="upload" size={22} />
          <span>Choose a CSV file</span>
        </label>
        <details>
          <summary className="small">…or paste CSV text</summary>
          <textarea className="input mono" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Date,Description,Amount\n09/12/2026,WHOLEFDS MKT #10234,-84.12'} />
          <button className="btn" disabled={!paste.trim()} onClick={() => load(paste, 'Pasted text')}>
            Use pasted text
          </button>
        </details>
      </section>
    );
  }
  return <MapAndReview rows={rows} fileName={fileName} onReset={() => setRows(null)} />;
}

function MapAndReview({ rows, fileName, onReset }: { rows: string[][]; fileName: string; onReset: () => void }) {
  const store = useFinance();
  const toast = useUI((s) => s.toast);
  const headerIndex = useMemo(() => findHeaderRow(rows), [rows]);
  const header = rows[headerIndex];
  const signature = header.join(',');
  const bank = detectBank(header);
  const openAccounts = store.accounts.filter((a) => !a.archived);

  const mappingFor = (id: ID | null): ImportMapping => {
    const saved = id ? store.importMappings[id] : undefined;
    return saved && saved.signature === signature ? saved : suggestMapping(header, rows.slice(headerIndex + 1));
  };
  // Start with the account that last imported this exact file format, when there's only one.
  const [accountId, setAccountIdState] = useState<ID | null>(() => {
    const remembered = openAccounts.filter((a) => store.importMappings[a.id]?.signature === signature);
    return remembered.length === 1 ? remembered[0].id : openAccounts[0]?.id ?? null;
  });
  const [m, setM] = useState<ImportMapping>(() => mappingFor(accountId));
  const [hasHeader, setHasHeader] = useState(true);
  const [step, setStep] = useState<'map' | 'review'>('map');
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const setAccountId = (id: ID | null) => {
    setAccountIdState(id);
    setM(mappingFor(id));
  };
  const set = (p: Partial<ImportMapping>) => setM((prev) => ({ ...prev, ...p }));
  const account = store.accounts.find((a) => a.id === accountId);
  const usingSaved = !!accountId && store.importMappings[accountId]?.signature === signature;
  const columns = hasHeader ? header : header.map((_, i) => `Column ${i + 1}`);
  const body = useMemo(() => (hasHeader ? rows.slice(headerIndex + 1) : rows.slice(headerIndex)), [rows, headerIndex, hasHeader]);

  const parsed = useMemo(() => body.map((r) => readRow(r, m)), [body, m]);
  const readable = parsed.filter((p) => p.date && p.signed);
  const inShare = readable.length ? readable.filter((p) => (p.signed ?? 0) > 0).length / readable.length : 0;
  // Card statements are mostly purchases; if most rows read as money in, the sign is probably backwards.
  const signLooksFlipped = account?.type === 'credit' && m.mode === 'signed' && readable.length >= 4 && inShare > 0.6;

  const buildDrafts = () => {
    if (!accountId || !account) return;
    const existingKeys = new Set(store.transactions.map((t) => t.importKey).filter(Boolean));
    const loose = new Set(
      store.transactions.filter((t) => t.accountId === accountId || t.toAccountId === accountId).map((t) => `${t.date}|${t.amount}`),
    );
    const cps = store.counterparties.map((c) => ({ c, n: normalize(c.name) })).filter((x) => x.n.length >= 3);
    const categoryIds = new Set(store.categories.map((c) => c.id));
    const seen = new Map<string, number>();
    const out: Draft[] = [];
    for (const p of parsed) {
      if (!p.date || p.signed === null || p.signed === 0) continue;
      const base = `${accountId}|${p.date}|${p.signed}|${normalize(p.description)}`;
      // Identical rows on the same day are legitimate (two coffees): number them.
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const key = `${base}|${n}`;
      const rule = matchRule(store.rules, p.description);
      const known = rule?.counterpartyId
        ? store.counterparties.find((c) => c.id === rule.counterpartyId)
        : cps.find((x) => normalize(p.description).includes(x.n))?.c;
      const hint = hintCategory(p, account.type);
      let categoryId: ID | null = null;
      let matchedBy: MatchSource | null = null;
      if (rule?.categoryId) [categoryId, matchedBy] = [rule.categoryId, 'rule'];
      else if (known?.defaultCategoryId) [categoryId, matchedBy] = [known.defaultCategoryId, 'payee'];
      else if (hint && categoryIds.has(hint.categoryId)) [categoryId, matchedBy] = [hint.categoryId, hint.source];
      const duplicate = existingKeys.has(key) || loose.has(`${p.date}|${Math.abs(p.signed)}`);
      out.push({
        key,
        include: !duplicate,
        duplicate,
        date: p.date,
        description: p.description,
        signed: p.signed,
        payee: known?.name ?? cleanPayee(p.description),
        categoryId,
        matchedBy,
      });
    }
    setDrafts(out.sort((a, b) => (a.date < b.date ? 1 : -1)));
    setStep('review');
  };

  if (step === 'review') {
    return (
      <ReviewStep
        drafts={drafts}
        setDrafts={setDrafts}
        onBack={() => setStep('map')}
        onImport={() => {
          const chosen = drafts.filter((d) => d.include);
          const cats = new Map(store.categories.map((c) => [c.id, c]));
          const txns: Transaction[] = chosen.map((d) => {
            const base = newTransaction({
              date: d.date,
              amount: Math.abs(d.signed),
              kind: d.signed > 0 ? 'income' : 'expense',
              accountId: accountId!,
              description: d.description,
              importKey: d.key,
            });
            const category = d.categoryId ? cats.get(d.categoryId) : undefined;
            const patched = { ...base, ...categoryPatch(base, category) };
            const isTransfer = patched.kind === 'transfer';
            return { ...patched, counterpartyId: !isTransfer && d.payee.trim() ? store.ensureCounterparty(d.payee) : null };
          });
          store.addTransactions(txns);
          if (hasHeader) store.saveImportMapping(accountId!, { ...m, signature });
          toast(`Imported ${txns.length} transactions into ${account?.name ?? 'the account'}`);
          navigate('finance/transactions');
        }}
      />
    );
  }

  const columnSelect = (value: number, onChange: (i: number) => void, allowNone = false) => (
    <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {allowNone && <option value={-1}>—</option>}
      {columns.map((h, i) => (
        <option key={i} value={i}>
          {h || `Column ${i + 1}`}
        </option>
      ))}
    </select>
  );

  return (
    <section className="card stack">
      <header className="card-head">
        <h3 className="card-title">Map columns · {fileName}</h3>
        <button className="btn sm ghost" onClick={onReset}>
          Choose another file
        </button>
      </header>
      {(bank || usingSaved || headerIndex > 0) && (
        <div className="notice">
          <Icon name="check" size={14} />
          <span>
            {bank ? `Recognized a ${bank} export.` : 'Found the transaction table.'}
            {headerIndex > 0 && ` Skipped ${headerIndex} summary row${headerIndex === 1 ? '' : 's'} at the top.`}
            {usingSaved && ' Using the column mapping from your last import into this account.'}
          </span>
        </div>
      )}
      <div className="row wrap">
        <Field label="Import into account">
          <AccountSelect value={accountId} onChange={setAccountId} />
        </Field>
        <Field label="Date column">{columnSelect(m.date, (date) => set({ date }))}</Field>
        <Field label="Date format">
          <select className="input" value={m.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as DateFormat })}>
            <option value="auto">Detect</option>
            <option value="mdy">MM/DD/YYYY</option>
            <option value="dmy">DD/MM/YYYY</option>
            <option value="ymd">YYYY-MM-DD</option>
          </select>
        </Field>
        <Field label="Description column">{columnSelect(m.description, (description) => set({ description }))}</Field>
      </div>
      <label className="toggle small">
        <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> The file has a header row
      </label>
      <Field label="Amounts">
        <Segmented
          value={m.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'signed', label: 'One signed amount column' },
            { value: 'split', label: 'Separate debit & credit columns' },
            { value: 'type', label: 'Amount + Credit/Debit column' },
          ]}
        />
      </Field>
      <div className="row wrap">
        {m.mode === 'split' ? (
          <>
            <Field label="Money out (debit) column">{columnSelect(m.debit, (debit) => set({ debit }), true)}</Field>
            <Field label="Money in (credit) column">{columnSelect(m.credit, (credit) => set({ credit }), true)}</Field>
          </>
        ) : (
          <Field label="Amount column">{columnSelect(m.amount, (amount) => set({ amount }))}</Field>
        )}
        {m.mode === 'signed' && (
          <Field label="Positive amounts are" hint="Bank of America and Chase show spending as negative on both bank accounts and cards.">
            <Segmented
              value={m.positiveIs}
              onChange={(positiveIs) => set({ positiveIs })}
              options={[
                { value: 'in', label: 'Money in' },
                { value: 'out', label: 'Money out' },
              ]}
            />
          </Field>
        )}
        {m.mode === 'type' && (
          <Field label="Credit/Debit column" hint="Rows saying Credit or Deposit count as money in.">
            {columnSelect(m.typeColumn, (typeColumn) => set({ typeColumn }), true)}
          </Field>
        )}
        <Field label="Bank's category column (optional)" hint="Used as a hint when no rule matches.">
          {columnSelect(m.categoryColumn, (categoryColumn) => set({ categoryColumn }), true)}
        </Field>
      </div>
      {signLooksFlipped && (
        <div className="notice is-error">
          {Math.round(inShare * 100)}% of rows read as money in, which is unusual for a credit card.{' '}
          <button className="link" onClick={() => set({ positiveIs: m.positiveIs === 'in' ? 'out' : 'in' })}>
            Flip the sign
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table className="table align-left">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {parsed.slice(0, 8).map((p, i) => (
              <tr key={i} className={p.signed === null ? 'is-muted' : ''}>
                <td className={p.date ? '' : 'is-error'}>{p.date ? fmtDateShort(p.date) : `Can't read “${body[i][m.date] ?? ''}”`}</td>
                <td>{p.description}</td>
                <td className="num">{p.signed === null ? <span className="muted">skipped</span> : <Amount cents={p.signed} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row tight">
        <span className="small muted">
          {readable.length} of {body.length} rows readable
        </span>
        <span className="spacer" />
        <button className="btn primary" disabled={!accountId || readable.length === 0} onClick={buildDrafts}>
          Review {readable.length} transactions <Icon name="right" />
        </button>
      </div>
    </section>
  );
}

function ReviewStep({
  drafts,
  setDrafts,
  onBack,
  onImport,
}: {
  drafts: Draft[];
  setDrafts: (d: Draft[]) => void;
  onBack: () => void;
  onImport: () => void;
}) {
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const patch = (key: string, p: Partial<Draft>) => setDrafts(drafts.map((d) => (d.key === key ? { ...d, ...p } : d)));
  const included = drafts.filter((d) => d.include);
  const dupes = drafts.filter((d) => d.duplicate).length;
  const categorized = included.filter((d) => d.categoryId).length;
  const shown = useMemo(() => (onlyUnmatched ? drafts.filter((d) => !d.categoryId) : drafts), [drafts, onlyUnmatched]);
  const net = included.reduce((s, d) => s + d.signed, 0);

  return (
    <section className="card stack">
      <header className="card-head">
        <h3 className="card-title">Review before importing</h3>
        <button className="btn sm ghost" onClick={onBack}>
          <Icon name="left" size={14} /> Back to mapping
        </button>
      </header>
      <div className="import-summary">
        <span>
          <b>{included.length}</b> to import ({fmtMoney(net, { sign: true })} net)
        </span>
        <span>
          <b>{categorized}</b> categorized automatically
        </span>
        {dupes > 0 && (
          <span>
            <b>{dupes}</b> look like duplicates and are unchecked
          </span>
        )}
        <label className="toggle small">
          <input type="checkbox" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} /> Only show uncategorized
        </label>
      </div>
      {shown.length === 0 ? (
        <Empty>Everything is categorized.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table txn-table">
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    aria-label="Include all"
                    checked={drafts.every((d) => d.include)}
                    onChange={(e) => setDrafts(drafts.map((d) => ({ ...d, include: e.target.checked })))}
                  />
                </th>
                <th>Date</th>
                <th>Payee / payer</th>
                <th>Category</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.key} className={d.include ? '' : 'is-muted'}>
                  <td className="col-check">
                    <input type="checkbox" aria-label="Include" checked={d.include} onChange={(e) => patch(d.key, { include: e.target.checked })} />
                  </td>
                  <td className="nowrap">
                    {fmtDateShort(d.date)}
                    {d.duplicate && <span className="badge">duplicate?</span>}
                  </td>
                  <td className="cell-flow">
                    <input className="input sm" value={d.payee} onChange={(e) => patch(d.key, { payee: e.target.value })} aria-label="Payee or payer" />
                    <div className="cell-sub">{d.description}</div>
                  </td>
                  <td>
                    <CategorySelect className={`input sm cat-select${d.categoryId ? '' : ' is-empty'}`} value={d.categoryId} onChange={(categoryId) => patch(d.key, { categoryId, matchedBy: null })} />
                    {d.matchedBy && <div className="cell-sub">{MATCH_LABELS[d.matchedBy]}</div>}
                  </td>
                  <td className="num">
                    <Amount cents={d.signed} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row tight">
        <span className="small muted">Tip: after importing, use the tag button on a transaction to turn it into a rule for next time.</span>
        <span className="spacer" />
        <button className="btn primary" disabled={included.length === 0} onClick={onImport}>
          Import {included.length} transactions
        </button>
      </div>
    </section>
  );
}
