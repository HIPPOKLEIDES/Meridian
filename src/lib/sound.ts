import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Gentle UI sounds, synthesized with the Web Audio API (no audio files).
 * Everything is soft sine/triangle tones through a low-pass filter with quick attacks and smooth decays,
 * tuned to a pentatonic scale so overlapping sounds never clash.
 */

export type SoundName =
  | 'tap' // any button
  | 'select' // segmented control, tabs, choices
  | 'check' // checking off a task, habit or milestone
  | 'tick' // checking a subtask or step
  | 'uncheck'
  | 'complete' // something finished: all steps done, review done, saved check-in
  | 'unlock' // tasks unlocked, journal unlocked
  | 'lock'
  | 'open' // dialog opens
  | 'notify' // toast
  | 'start' // timer start
  | 'stop'
  | 'connect' // flow map link
  | 'error';

interface SoundPrefs {
  enabled: boolean;
  /** 0–1 */
  volume: number;
  setEnabled(enabled: boolean): void;
  setVolume(volume: number): void;
}

/** Per-device preference, so it isn't part of backups. */
export const useSoundPrefs = create<SoundPrefs>()(
  persist(
    (set) => ({
      enabled: true,
      volume: 0.5,
      setEnabled: (enabled) => set({ enabled }),
      setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)) }),
    }),
    { name: 'meridian:sound', partialize: (s) => ({ enabled: s.enabled, volume: s.volume }) },
  ),
);

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let echo: GainNode | null = null;

function audio() {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.connect(ctx.destination);
    // A short, quiet echo gives chimes a little air without sounding like an effect.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.18;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.25;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    echo = ctx.createGain();
    echo.gain.value = 0.18;
    echo.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(master);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface Note {
  freq: number;
  /** Seconds after the sound starts. */
  at?: number;
  /** Decay length in seconds. */
  dur?: number;
  gain?: number;
  type?: OscillatorType;
  /** Pitch glide target (Hz). */
  glide?: number;
  /** Send to the echo. */
  airy?: boolean;
}

function play(notes: Note[]) {
  const ac = audio();
  if (!ac || !master) return;
  const now = ac.currentTime + 0.005;
  for (const n of notes) {
    const t = now + (n.at ?? 0);
    const dur = n.dur ?? 0.12;
    const osc = ac.createOscillator();
    osc.type = n.type ?? 'sine';
    osc.frequency.setValueAtTime(n.freq, t);
    if (n.glide) osc.frequency.exponentialRampToValueAtTime(n.glide, t + dur * 0.8);
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(6000, n.freq * 3);
    const env = ac.createGain();
    const peak = n.gain ?? 0.5;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter);
    filter.connect(env);
    env.connect(master);
    if (n.airy && echo) env.connect(echo);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

// Pentatonic pitches (C major pentatonic) in Hz.
const C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5, D6 = 1174.66, E6 = 1318.51, G4 = 392, A4 = 440, E4 = 329.63;

const SOUNDS: Record<SoundName, () => Note[]> = {
  tap: () => [{ freq: 1400, glide: 1100, dur: 0.045, gain: 0.12, type: 'sine' }],
  select: () => [{ freq: E6, dur: 0.07, gain: 0.14, type: 'triangle' }],
  check: () => [
    { freq: E5, dur: 0.14, gain: 0.32, type: 'triangle' },
    { freq: A5, at: 0.06, dur: 0.32, gain: 0.34, airy: true },
  ],
  tick: () => [{ freq: G5, dur: 0.12, gain: 0.24, type: 'triangle' }],
  uncheck: () => [{ freq: D5, glide: C5, dur: 0.12, gain: 0.18, type: 'triangle' }],
  complete: () => [
    { freq: C5, dur: 0.35, gain: 0.26, airy: true },
    { freq: E5, at: 0.08, dur: 0.35, gain: 0.26, airy: true },
    { freq: G5, at: 0.16, dur: 0.45, gain: 0.26, airy: true },
    { freq: C6, at: 0.24, dur: 0.7, gain: 0.24, airy: true },
  ],
  unlock: () => [
    { freq: G5, dur: 0.2, gain: 0.2, airy: true },
    { freq: D6, at: 0.07, dur: 0.25, gain: 0.18, airy: true },
    { freq: E6, at: 0.14, dur: 0.5, gain: 0.16, airy: true },
  ],
  lock: () => [
    { freq: A4, dur: 0.14, gain: 0.24, type: 'triangle' },
    { freq: E4, at: 0.08, dur: 0.24, gain: 0.24, type: 'triangle' },
  ],
  open: () => [{ freq: G4, glide: D5, dur: 0.16, gain: 0.14 }],
  notify: () => [
    { freq: A5, dur: 0.18, gain: 0.16, airy: true },
    { freq: E6, at: 0.09, dur: 0.3, gain: 0.13, airy: true },
  ],
  start: () => [
    { freq: C5, dur: 0.12, gain: 0.24, type: 'triangle' },
    { freq: G5, at: 0.08, dur: 0.28, gain: 0.26, airy: true },
  ],
  stop: () => [
    { freq: G5, dur: 0.12, gain: 0.22, type: 'triangle' },
    { freq: C5, at: 0.08, dur: 0.28, gain: 0.22 },
  ],
  connect: () => [{ freq: D6, glide: G5, dur: 0.1, gain: 0.16, type: 'triangle' }],
  error: () => [
    { freq: E4, dur: 0.16, gain: 0.2, type: 'triangle' },
    { freq: E4 * 0.94, at: 0.12, dur: 0.22, gain: 0.18, type: 'triangle' },
  ],
};

let lastAt = 0;
let lastName: SoundName | null = null;
let pendingTap: ReturnType<typeof setTimeout> | null = null;

/** Plays a UI sound (no-op when muted, hidden, or before the page has had a user gesture). */
export function sound(name: SoundName) {
  if (name !== 'tap' && pendingTap) {
    clearTimeout(pendingTap);
    pendingTap = null;
  }
  const { enabled, volume } = useSoundPrefs.getState();
  if (!enabled || volume <= 0 || document.visibilityState === 'hidden') return;
  const now = performance.now();
  // One sound per interaction: a specific sound from a handler wins over the generic tap that follows it.
  if (now - lastAt < 60 && (name === 'tap' || name === lastName)) return;
  lastAt = now;
  lastName = name;
  const ac = audio();
  if (!ac || !master) return;
  // Perceptual curve so the slider feels even.
  master.gain.setValueAtTime(volume * volume * 0.9, ac.currentTime);
  play(SOUNDS[name]());
}

/** A note from the pentatonic scale, for choices on a scale (e.g. mood 1–5). */
export function scaleSound(step: number) {
  if (pendingTap) clearTimeout(pendingTap);
  pendingTap = null;
  const scale = [C5, D5, E5, G5, A5, C6, D6, E6];
  const { enabled, volume } = useSoundPrefs.getState();
  if (!enabled || volume <= 0) return;
  const ac = audio();
  if (!ac || !master) return;
  lastAt = performance.now();
  lastName = 'select';
  master.gain.setValueAtTime(volume * volume * 0.9, ac.currentTime);
  play([{ freq: scale[Math.max(0, Math.min(scale.length - 1, step))], dur: 0.25, gain: 0.26, type: 'triangle', airy: true }]);
}

const TAPPABLE = 'button, [role="button"], a[href], summary, input[type="checkbox"], input[type="radio"]';

/**
 * Adds a soft tap to every button without touching each one. Runs in the bubbling phase on document,
 * after React's handlers. Any specific sound played by a handler, an effect it triggers, or within 30 ms
 * takes the tap's place.
 * Opt out on an element (or ancestor) with data-sound="off".
 */
export function installUiSounds() {
  document.addEventListener('click', (e) => {
    const el = (e.target as Element | null)?.closest?.(TAPPABLE) as HTMLElement | null;
    if (!el || (el as HTMLButtonElement).disabled || el.closest('[data-sound="off"]')) return;
    const name: SoundName = el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'tab' ? 'select' : 'tap';
    if (name === 'select') return sound(name);
    // Wait a moment: if the click opened a dialog or finished something, that sound replaces the tap.
    if (pendingTap) clearTimeout(pendingTap);
    pendingTap = setTimeout(() => {
      pendingTap = null;
      sound('tap');
    }, 30);
  });
}
