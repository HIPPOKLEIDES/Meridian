import { useCallback, useSyncExternalStore } from 'react';

/**
 * Installing Meridian as an app (Windows taskbar, macOS dock, phone home screen).
 *
 * Chromium browsers hand us a `beforeinstallprompt` event we can fire later from our own
 * button; everyone else installs from a browser menu, so we explain where it is instead.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Remembered because a browser tab cannot ask whether the app is already installed. */
const INSTALLED_KEY = 'meridian:installed';
const DISMISSED_KEY = 'meridian:install-hidden';

const read = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const write = (key: string, value: boolean) => {
  try {
    if (value) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    /* private browsing */
  }
};

export interface InstallState {
  /** True while running in the installed app window rather than a browser tab. */
  standalone: boolean;
  /** True when we can show our own Install button. */
  promptable: boolean;
  /** True once this device has installed Meridian at some point. */
  installedBefore: boolean;
  /** True when the user hid the sidebar install nudge. */
  hidden: boolean;
  /** True when a newer version has downloaded and is waiting to take over. */
  updateReady: boolean;
}

let prompt: BeforeInstallPromptEvent | null = null;
let waiting: ServiceWorker | null = null;
let state: InstallState = {
  standalone: false,
  promptable: false,
  installedBefore: false,
  hidden: false,
  updateReady: false,
};

const listeners = new Set<() => void>();
const set = (patch: Partial<InstallState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)').matches ||
    // iOS Safari predates display-mode.
    (navigator as { standalone?: boolean }).standalone === true);

/** Starts listening for install events. Call once, as early as possible: the event fires at load. */
export function watchInstall() {
  if (typeof window === 'undefined') return;
  set({ standalone: isStandalone(), installedBefore: read(INSTALLED_KEY), hidden: read(DISMISSED_KEY) });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // Keep the browser's own banner away; we have our own button.
    prompt = e as BeforeInstallPromptEvent;
    set({ promptable: true });
  });

  window.addEventListener('appinstalled', () => {
    prompt = null;
    write(INSTALLED_KEY, true);
    set({ promptable: false, installedBefore: true });
  });

  const display = window.matchMedia?.('(display-mode: standalone)');
  display?.addEventListener('change', () => set({ standalone: isStandalone() }));
  if (isStandalone()) write(INSTALLED_KEY, true);
}

/** Shows the browser's install dialog. Resolves to whether the app was installed. */
export async function promptInstall(): Promise<boolean> {
  const event = prompt;
  if (!event) return false;
  prompt = null;
  set({ promptable: false });
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'accepted') {
      write(INSTALLED_KEY, true);
      set({ installedBefore: true });
      return true;
    }
  } catch {
    /* the dialog was closed */
  }
  return false;
}

export const hideInstallNudge = () => {
  write(DISMISSED_KEY, true);
  set({ hidden: true });
};

export function useInstall(): InstallState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

export interface InstallHowTo {
  /** Where the app ends up on this platform. */
  where: string;
  steps: string[];
}

/** Manual instructions for browsers that never offer us a prompt (Safari, Firefox). */
export function installHowTo(ua = navigator.userAgent): InstallHowTo {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (globalThis.navigator?.maxTouchPoints ?? 0) > 1);
  const android = /Android/.test(ua);
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);
  const firefox = /Firefox/.test(ua);
  if (ios) return { where: 'your home screen', steps: ['Tap the Share button', 'Choose “Add to Home Screen”', 'Tap Add'] };
  if (android) return { where: 'your home screen', steps: ['Open the browser menu (⋮)', 'Choose “Install app” or “Add to Home screen”'] };
  if (safari) return { where: 'your Dock', steps: ['Open the File menu', 'Choose “Add to Dock”'] };
  if (firefox)
    return {
      where: 'your taskbar',
      steps: ['Firefox cannot install web apps yet', 'Open this page in Edge or Chrome, then use the install button there'],
    };
  return {
    where: 'your taskbar',
    steps: ['Click the install icon at the right of the address bar', 'Or open the browser menu (⋮) and choose “Install Meridian”'],
  };
}

/**
 * Registers the service worker that makes the app work offline, and watches for new versions.
 * An installed app is rarely reloaded by hand, so we offer the update instead of forcing it.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    let reg: ServiceWorkerRegistration;
    try {
      reg = await navigator.serviceWorker.register('./sw.js');
    } catch {
      return;
    }

    const offer = (sw: ServiceWorker | null) => {
      // Only an update: with no controller this is the first install, which needs no reload.
      if (!sw || !navigator.serviceWorker.controller) return;
      waiting = sw;
      set({ updateReady: true });
    };
    offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => sw.state === 'installed' && offer(sw));
    });

    const check = () => void reg.update().catch(() => undefined);
    setInterval(check, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  });
}

let reloading = false;
/** Swaps in the waiting version and reloads. */
export function applyUpdate() {
  if (!waiting || reloading) return;
  reloading = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  waiting.postMessage({ type: 'skip-waiting' });
  // If the new worker takes over without telling us, reload anyway.
  setTimeout(() => window.location.reload(), 2500);
}

export function useAppUpdate() {
  const ready = useInstall().updateReady;
  return { ready, apply: useCallback(applyUpdate, []) };
}
