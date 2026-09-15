import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

/** Current time, refreshed on an interval. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Observed content-box size of an element. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Hash route segments: `#/projects/abc` → ['projects', 'abc']. */
export function useRoute(): string[] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}

export const navigate = (path: string) => {
  window.location.hash = '#/' + path.replace(/^\//, '');
};

/** The theme actually in effect, after resolving "system". */
export function useResolvedTheme(): 'light' | 'dark' {
  const setting = useStore((s) => s.settings.theme);
  const query = '(prefers-color-scheme: dark)';
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return setting === 'system' ? (systemDark ? 'dark' : 'light') : setting;
}
