import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DateKey, Minutes } from '../types';
import { planForDate, type PlanItem } from './plan';
import { fmtClock, nowMinutes, toKey } from './dates';
import { useStore } from '../store';
import { useUI } from '../ui';

/**
 * Reminders for what's coming up: habits, timed habit steps, planned blocks and task
 * timeframes (whole task or a single subtask).
 *
 * They are checked in the page, so they arrive while Meridian is open — in a tab, or in the
 * installed app left running in the background. There is no server pushing them.
 */

export const LEAD_OPTIONS: Minutes[] = [5, 10, 15, 30];
const TICK_MS = 30_000;
const FIRED_KEY = 'meridian:reminders-fired';

export interface Reminder {
  /** Stable per day, so a reminder is delivered once. */
  key: string;
  title: string;
  body: string;
  start: Minutes;
  /** Whole minutes until it starts; 0 means "now". */
  minutesAway: number;
}

/** Everything starting within the lead time that hasn't been announced yet, soonest first. */
export function dueReminders(items: PlanItem[], date: DateKey, nowMin: Minutes, leadMinutes: Minutes, fired: ReadonlySet<string>): Reminder[] {
  const out: Reminder[] = [];
  for (const item of items) {
    if (item.done) continue;
    const minutesAway = Math.round(item.start - nowMin);
    if (minutesAway < 0 || minutesAway > leadMinutes) continue;
    const key = `${date}:${item.key}:${item.start}`;
    if (fired.has(key)) continue;
    const when = minutesAway <= 0 ? 'Starting now' : `In ${minutesAway} min`;
    const span = `${fmtClock(item.start)}–${fmtClock(item.end)}`;
    out.push({
      key,
      title: item.title || (item.kind === 'habit' ? 'Habit' : 'Planned time'),
      body: [when, span, item.parentTitle].filter(Boolean).join(' · '),
      start: item.start,
      minutesAway,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

interface Prefs {
  /** Master switch for reminders. */
  enabled: boolean;
  /** How far ahead to warn. */
  leadMinutes: Minutes;
  /** Also raise a desktop/phone notification, not just an in-app one. */
  system: boolean;
  setEnabled(v: boolean): void;
  setLead(m: Minutes): void;
  setSystem(v: boolean): void;
}

export const useReminderPrefs = create<Prefs>()(
  persist(
    (set) => ({
      enabled: true,
      leadMinutes: 10,
      system: false,
      setEnabled: (enabled) => set({ enabled }),
      setLead: (leadMinutes) => set({ leadMinutes }),
      setSystem: (system) => set({ system }),
    }),
    { name: 'meridian:reminders' },
  ),
);

/** Reminders already delivered today, so a reload doesn't repeat them. */
function loadFired(date: DateKey): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(FIRED_KEY) ?? 'null');
    if (raw?.date === date && Array.isArray(raw.keys)) return new Set<string>(raw.keys);
  } catch {
    /* unreadable storage */
  }
  return new Set();
}

let fired: Set<string> | null = null;
let firedDate = '';

function remember(date: DateKey, keys: string[]) {
  if (firedDate !== date || !fired) {
    fired = loadFired(date);
    firedDate = date;
  }
  for (const k of keys) fired.add(k);
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify({ date, keys: [...fired] }));
  } catch {
    /* private browsing */
  }
}

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export const notificationPermission = (): NotificationPermission | 'unsupported' => (notificationsSupported() ? Notification.permission : 'unsupported');

/** Asks the browser for permission, and turns system notifications on if it's granted. */
export async function enableSystemNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  useReminderPrefs.getState().setSystem(permission === 'granted');
  return permission;
}

async function systemNotify(r: Reminder) {
  const options: NotificationOptions = {
    body: r.body,
    tag: r.key,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: './#/today' },
  };
  try {
    // The installed app needs the service worker to show notifications; a tab can do it directly.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(r.title, options);
    else new Notification(r.title, options);
  } catch {
    /* the browser refused; the in-app reminder still showed */
  }
}

export function deliver(r: Reminder) {
  const { system } = useReminderPrefs.getState();
  useUI.getState().toast(`${r.title} · ${r.body}`, 'notify');
  if (system && notificationPermission() === 'granted') void systemNotify(r);
}

/** Checks every half minute for anything about to start. Call once at startup. */
export function startReminders() {
  if (typeof window === 'undefined') return;
  const tick = () => {
    const { enabled, leadMinutes } = useReminderPrefs.getState();
    // Hidden windows keep checking — that is the point of a reminder — though the browser
    // throttles background timers to about a minute, which is fine for a 10-minute warning.
    if (!enabled) return;
    const now = new Date();
    const date = toKey(now);
    if (firedDate !== date || !fired) {
      fired = loadFired(date);
      firedDate = date;
    }
    const { blocks, habits, tasks, projects } = useStore.getState();
    const due = dueReminders(planForDate({ blocks, habits, tasks, projects }, date), date, nowMinutes(now), leadMinutes, fired);
    if (!due.length) return;
    remember(date, due.map((r) => r.key));
    for (const r of due) deliver(r);
  };
  setInterval(tick, TICK_MS);
  // A phone or laptop that was asleep catches up as soon as you look at it again.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());
  setTimeout(tick, 2000);
}
