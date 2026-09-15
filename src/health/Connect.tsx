import { useEffect, useState } from 'react';
import type { SyncedMetric } from './types';
import { useHealth } from './store';
import { fetchMetric, isSignedIn, preloadGoogleSignIn, signIn, signOut, SYNC_LABELS } from './google';
import { Field, Icon } from '../components/common';
import { addDays, todayKey } from '../lib/dates';

const SOURCES = Object.keys(SYNC_LABELS) as SyncedMetric[];
const ORIGIN = window.location.origin;

interface SyncResult {
  source: SyncedMetric;
  count: number;
  error?: string;
}

export function ConnectTab() {
  const google = useHealth((s) => s.google);
  const metrics = useHealth((s) => s.metrics);
  const updateGoogle = useHealth((s) => s.updateGoogle);
  const updateMetric = useHealth((s) => s.updateMetric);
  const applySynced = useHealth((s) => s.applySynced);
  const [clientId, setClientId] = useState(google.clientId);
  const [signedIn, setSignedIn] = useState(isSignedIn());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SyncResult[] | null>(null);

  useEffect(() => {
    if (google.clientId) preloadGoogleSignIn().catch((e: Error) => setError(e.message));
  }, [google.clientId]);

  const sync = async () => {
    setBusy(true);
    setError(null);
    const today = todayKey();
    const start = addDays(today, -(google.syncDays - 1));
    const out: SyncResult[] = [];
    for (const source of SOURCES) {
      const metric = metrics.find((m) => m.source === source);
      if (!metric) continue;
      try {
        const points = await fetchMetric(source, metric, start, today);
        out.push({ source, count: applySynced(source, points) });
      } catch (e) {
        out.push({ source, count: 0, error: e instanceof Error ? e.message : String(e) });
      }
    }
    setResults(out);
    const ok = out.filter((r) => !r.error);
    updateGoogle({
      lastSync: Date.now(),
      lastResult: `${ok.reduce((s, r) => s + r.count, 0)} daily values from ${ok.length} of ${out.length} data types`,
    });
    setBusy(false);
  };

  const connect = (thenSync: boolean) => {
    setError(null);
    // signIn must start synchronously inside the click so the popup isn't blocked.
    signIn(google.clientId)
      .then(() => {
        setSignedIn(true);
        if (thenSync) return sync();
      })
      .catch((e: Error) => setError(e.message));
  };

  const mapSource = (source: SyncedMetric, metricId: string) => {
    for (const m of metrics) {
      if (m.source === source && m.id !== metricId) updateMetric(m.id, { source: null });
    }
    if (metricId) updateMetric(metricId, { source });
  };

  return (
    <>
      <section className="card stack">
        <header className="card-head">
          <h3 className="card-title">
            <Icon name="heart" /> Fitbit via Google Health
          </h3>
          <span className={`tone ${signedIn ? 'tone-good' : 'tone-neutral'}`}>{signedIn ? 'Connected for this session' : 'Not connected'}</span>
        </header>
        <p className="small">
          Google is retiring the old Fitbit Web API in September 2026. Fitbit, Pixel Watch and other Google-connected data now come
          through the <b>Google Health API</b>, so Meridian connects there. Your Fitbit account needs to be moved to a Google account (the
          Fitbit app walks you through it).
        </p>

        {google.clientId ? (
          <div className="row tight wrap">
            {signedIn ? (
              <>
                <button className="btn primary" onClick={sync} disabled={busy}>
                  <Icon name="refresh" /> {busy ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    signOut();
                    setSignedIn(false);
                  }}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button className="btn primary" onClick={() => connect(true)} disabled={busy}>
                <Icon name="refresh" /> Connect &amp; sync
              </button>
            )}
            <label className="inline-label">
              Sync the last
              <select className="input sm" value={google.syncDays} onChange={(e) => updateGoogle({ syncDays: Number(e.target.value) })}>
                {[14, 30, 60, 90, 180, 365].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </label>
            {google.lastSync && (
              <span className="small muted">
                Last sync {new Date(google.lastSync).toLocaleString()} · {google.lastResult}
              </span>
            )}
          </div>
        ) : (
          <p className="small muted">Finish the one-time setup below, then connect.</p>
        )}
        {error && <div className="notice is-error">{error}</div>}
        {results && (
          <ul className="sync-results">
            {results.map((r) => (
              <li key={r.source}>
                <Icon name={r.error ? 'x' : 'check'} size={14} /> {SYNC_LABELS[r.source]}: {r.error ? <span className="muted">{r.error}</span> : `${r.count} days`}
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">
          Sign-in happens in a Google popup. The access token stays in this tab's memory for about an hour and is never saved or
          included in backups. Readings you log by hand are never overwritten.
        </p>
      </section>

      <section className="card stack">
        <h3 className="card-title">What syncs where</h3>
        <div className="table-wrap">
          <table className="table align-left">
            <thead>
              <tr>
                <th>Google Health data</th>
                <th>Meridian measurement</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((source) => (
                <tr key={source}>
                  <td>{SYNC_LABELS[source]}</td>
                  <td>
                    <select className="input sm" value={metrics.find((m) => m.source === source)?.id ?? ''} onChange={(e) => mapSource(source, e.target.value)}>
                      <option value="">Don't sync</option>
                      {metrics.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.unit ? ` (${m.unit})` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Weight converts to pounds when the measurement's unit is lb, and stays in kilograms otherwise.</p>
      </section>

      <section className="card stack">
        <h3 className="card-title">One-time setup (about 10 minutes)</h3>
        <p className="small">
          Google only lets personal apps read health data through your own Google Cloud project. It's free, and as long as the app stays
          in <i>Testing</i> mode with you as the only test user, no review is needed.
        </p>
        <ol className="setup-steps">
          <li>
            Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud Console</a> and create a project
            (e.g. “Meridian”).
          </li>
          <li>
            In <b>APIs &amp; Services → Library</b>, find <b>Google Health API</b> and click <b>Enable</b>.
          </li>
          <li>
            In <b>Google Auth Platform → Branding / Audience</b>, set up the consent screen as <b>External</b>, leave it in <b>Testing</b>,
            and add your own Google account under <b>Test users</b>.
          </li>
          <li>
            In <b>Data access</b>, add these read-only scopes: <code>googlehealth.activity_and_fitness.readonly</code>,{' '}
            <code>googlehealth.health_metrics_and_measurements.readonly</code>, <code>googlehealth.sleep.readonly</code>.
          </li>
          <li>
            In <b>Clients</b>, create an OAuth client of type <b>Web application</b> and add <code>{ORIGIN}</code> under{' '}
            <b>Authorized JavaScript origins</b>.
          </li>
          <li>Copy the client ID (it ends in <code>.apps.googleusercontent.com</code>) and paste it here. It identifies your app and isn't a password.</li>
        </ol>
        <div className="row tight wrap">
          <Field label="OAuth client ID">
            <input className="input client-id" placeholder="1234…apps.googleusercontent.com" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </Field>
          <button
            className="btn"
            disabled={clientId.trim() === google.clientId}
            onClick={() => {
              updateGoogle({ clientId: clientId.trim() });
              signOut();
              setSignedIn(false);
            }}
          >
            Save
          </button>
        </div>
        <p className="small muted">
          While the app is in Testing mode Google shows an “unverified app” warning at sign-in. That's expected for a personal project.
        </p>
      </section>
    </>
  );
}
