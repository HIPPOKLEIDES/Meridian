import { useState } from 'react';
import { Icon } from './common';
import { useUI } from '../ui';
import { hideInstallNudge, installHowTo, promptInstall, useAppUpdate, useInstall } from '../lib/install';

/** Settings: install Meridian as an app, and pick up a waiting update. */
export function InstallCard() {
  const { standalone, promptable, installedBefore } = useInstall();
  const toast = useUI((s) => s.toast);
  const [howTo, setHowTo] = useState(false);
  const guide = installHowTo();

  const install = async () => {
    if (await promptInstall()) toast('Meridian installed', 'complete');
  };

  return (
    <section className="card stack">
      <h3 className="card-title">Install Meridian</h3>
      {standalone ? (
        <p className="small muted">
          You’re using the installed app — it runs in its own window, keeps working offline, and your account keeps it in step with your other devices.
        </p>
      ) : (
        <p className="small muted">
          Install Meridian to get it in {guide.where}: its own window with no address bar, a place to pin it, and the same data as here. It still works without a connection.
        </p>
      )}
      <div className="row tight wrap">
        {promptable && (
          <button className="btn primary" onClick={install}>
            <Icon name="install" /> Install Meridian
          </button>
        )}
        {!standalone && !promptable && (
          <button className="btn" onClick={() => setHowTo((v) => !v)} aria-expanded={howTo}>
            <Icon name="install" /> How do I install it?
          </button>
        )}
        <UpdateButton />
      </div>
      {!standalone && !promptable && howTo && (
        <ol className="install-steps small">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {!standalone && installedBefore && (
        <p className="small muted">Meridian is already installed on this device — look for it in your Start menu, and right-click it there to pin it to the taskbar.</p>
      )}
    </section>
  );
}

/** Offers the waiting version. Nothing renders until one has downloaded. */
export function UpdateButton() {
  const { ready, apply } = useAppUpdate();
  if (!ready) return null;
  return (
    <button className="btn" onClick={apply}>
      <Icon name="refresh" /> Update and restart
    </button>
  );
}

/** A quiet sidebar nudge, only in a browser tab and only while the browser offers the prompt. */
export function InstallNudge() {
  const { standalone, promptable, hidden } = useInstall();
  const { ready, apply } = useAppUpdate();
  const toast = useUI((s) => s.toast);

  if (ready)
    return (
      <button className="side-nudge" onClick={apply}>
        <Icon name="refresh" size={14} />
        <span>Update ready · Restart</span>
      </button>
    );

  if (standalone || !promptable || hidden) return null;
  return (
    <div className="side-nudge">
      <button
        className="side-nudge-main"
        onClick={async () => {
          if (await promptInstall()) toast('Meridian installed', 'complete');
        }}
      >
        <Icon name="install" size={14} />
        <span>Install app</span>
      </button>
      <button className="side-nudge-close" aria-label="Not now" title="Not now" onClick={hideInstallNudge}>
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}
