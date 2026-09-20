import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useUI } from '../ui';
import { Icon, Segmented } from '../components/common';
import { eraseAll, exportAll, importAll, loadAllSamples } from '../lib/backup';
import { todayKey } from '../lib/dates';
import { useHealth } from '../health/store';
import { useFinance } from '../finance/store';
import { useNotes } from '../notes/store';
import { useJournal } from '../journal/store';
import { useJournalLock } from '../journal/vault';
import { useGoals } from '../goals/store';
import { sound, useSoundPrefs } from '../lib/sound';
import { LEAD_OPTIONS, deliver, enableSystemNotifications, notificationPermission, useReminderPrefs } from '../lib/reminders';
import { AccountCard } from '../cloud/ui/AccountCard';
import { InstallCard } from '../components/install';
import { withSyncPaused } from '../cloud/controller';
import { useSession } from '../cloud/session';

export function SettingsView() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const toast = useUI((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const tasks = useStore((s) => s.tasks);
  const habits = useStore((s) => s.habits);
  const projects = useStore((s) => s.projects);
  const entries = useStore((s) => s.entries);
  const measurements = useHealth((s) => s.measurements);
  const transactions = useFinance((s) => s.transactions);
  const noteCount = useNotes((s) => s.notes.filter((n) => n.kind === 'page' || n.kind === 'board').length);
  const journalLocked = useJournalLock((s) => s.status === 'locked');
  const journalCount = useJournal((s) => s.entries.length);
  const goalCount = useGoals((s) => s.goals.length);
  const counts = { tasks: tasks.length, habits: habits.length, projects: projects.length, entries: entries.length };
  const [usage, setUsage] = useState<string | null>(null);
  const signedIn = useSession((s) => s.status === 'signedIn');

  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((e) => e.usage !== undefined && setUsage(`${(e.usage / 1_048_576).toFixed(1)} MB`))
      .catch(() => undefined);
  }, [noteCount]);

  const download = async () => {
    const blob = new Blob([JSON.stringify(await exportAll(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meridian-backup-${todayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importFile = async (file: File) => {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast('That file is not a Meridian backup');
      return;
    }
    if (!confirm('Replace all current data with this backup?')) return;
    try {
      // While signed in, sync pauses so the import is compared with your account as a whole afterwards.
      await withSyncPaused(() => importAll(data));
      toast('Backup imported');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Import failed');
    }
  };

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">Everything is stored in this browser.</p>
        </div>
      </header>

      <AccountCard />

      <section className="card stack">
        <h3 className="card-title">Appearance</h3>
        <div className="setting-row">
          <span>Theme</span>
          <Segmented
            value={settings.theme}
            onChange={(theme) => updateSettings({ theme })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <div className="setting-row">
          <span>Week starts on</span>
          <Segmented
            value={settings.weekStartsOn}
            onChange={(weekStartsOn) => updateSettings({ weekStartsOn })}
            options={[
              { value: 1, label: 'Monday' },
              { value: 0, label: 'Sunday' },
            ]}
          />
        </div>
      </section>

      <SoundSettings />

      <ReminderSettings />

      <InstallCard />

      <section className="card stack">
        <h3 className="card-title">Your data</h3>
        <p className="small muted">
          {counts.projects} projects · {counts.tasks} tasks · {counts.habits} habits · {counts.entries} time entries · {measurements.length}{' '}
          health readings · {transactions.length} transactions · {noteCount} notes · {journalLocked ? 'journal locked' : `${journalCount} journal entries`} · {goalCount} goals. Everything lives in this
          browser{usage ? ` (${usage} used)` : ''}, so export a backup now and then. Backups include everything (journal, goals, notes and their images too; an encrypted journal stays encrypted) but never
          sign-in tokens or API keys.
        </p>
        <div className="row tight wrap">
          <button className="btn" onClick={download}>
            Export backup
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Import backup…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </section>

      <section className="card stack">
        <h3 className="card-title">Start over</h3>
        <div className="row tight wrap">
          <button
            className="btn"
            disabled={signedIn}
            title={signedIn ? 'Sample data is for trying Meridian out; sign out to load it' : undefined}
            onClick={async () => {
              if (!confirm('Replace all current data (including health, finance, notes, journal and goals) with sample data?')) return;
              await loadAllSamples();
              toast('Sample data loaded');
            }}
          >
            Load sample data
          </button>
          <button
            className="btn danger"
            disabled={signedIn}
            title={signedIn ? 'While signed in, use Sign out → remove data from this device' : undefined}
            onClick={() => confirm('Erase everything, including health, finance, notes, journal and goals? This cannot be undone unless you exported a backup.') && eraseAll()}
          >
            <Icon name="trash" /> Erase all data
          </button>
        </div>
      </section>
    </div>
  );
}

function ReminderSettings() {
  const { enabled, leadMinutes, system, setEnabled, setLead, setSystem } = useReminderPrefs();
  const toast = useUI((s) => s.toast);
  const [permission, setPermission] = useState(notificationPermission);

  const ask = async () => {
    const result = await enableSystemNotifications();
    setPermission(result);
    if (result === 'granted') toast('Notifications on', 'complete');
    else if (result === 'denied') toast('Your browser is blocking notifications');
  };

  return (
    <section className="card stack">
      <h3 className="card-title">Reminders</h3>
      <div className="setting-row">
        <span>Remind me before something starts</span>
        <Segmented
          value={enabled ? 'on' : 'off'}
          onChange={(v) => setEnabled(v === 'on')}
          options={[
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
        />
      </div>
      <div className="setting-row">
        <span>How far ahead</span>
        <Segmented
          value={leadMinutes}
          onChange={setLead}
          options={LEAD_OPTIONS.map((m) => ({ value: m, label: `${m} min`, disabled: !enabled }))}
        />
      </div>
      <div className="setting-row">
        <span>
          Desktop notifications
          <span className="muted small"> · outside the app window</span>
        </span>
        {permission === 'unsupported' ? (
          <span className="muted small">Not available in this browser</span>
        ) : permission === 'denied' ? (
          <span className="muted small">Blocked in your browser settings</span>
        ) : permission === 'granted' ? (
          <Segmented
            value={system ? 'on' : 'off'}
            onChange={(v) => setSystem(v === 'on')}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
        ) : (
          <button className="btn sm" disabled={!enabled} onClick={ask}>
            Allow notifications
          </button>
        )}
      </div>
      <div className="row tight wrap">
        <button
          className="btn sm"
          disabled={!enabled}
          onClick={() =>
            deliver({ key: `test:${Date.now()}`, title: 'Morning run', body: `In ${leadMinutes} min · 07:00–07:30`, start: 7 * 60, minutesAway: leadMinutes })
          }
        >
          Send a test reminder
        </button>
      </div>
      <p className="small muted">
        Habits, timed habit steps, planned blocks and task timeframes (including a single subtask) all count. Reminders are checked while Meridian is open — a tab, or the installed app left
        running — so nothing is sent from a server and nothing leaves this device.
      </p>
    </section>
  );
}

function SoundSettings() {
  const enabled = useSoundPrefs((s) => s.enabled);
  const volume = useSoundPrefs((s) => s.volume);
  const setEnabled = useSoundPrefs((s) => s.setEnabled);
  const setVolume = useSoundPrefs((s) => s.setVolume);
  return (
    <section className="card stack">
      <h3 className="card-title">Sounds</h3>
      <div className="setting-row">
        <span>Interface sounds</span>
        <Segmented
          value={enabled ? 'on' : 'off'}
          onChange={(v) => setEnabled(v === 'on')}
          options={[
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
        />
      </div>
      <div className="setting-row">
        <span>Volume</span>
        <div className="row tight sound-volume">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(volume * 100)}
            disabled={!enabled}
            aria-label="Sound volume"
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
            onPointerUp={() => sound('tick')}
            onKeyUp={() => sound('tick')}
          />
          <button className="btn sm" disabled={!enabled} onClick={() => sound('complete')} data-sound="off">
            Preview
          </button>
        </div>
      </div>
      <p className="small muted">Soft taps on buttons, a chime when you check something off, and gentle cues for dialogs, timers and notifications. Saved for this device only.</p>
    </section>
  );
}
