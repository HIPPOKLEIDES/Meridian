import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './sections.css';
import './notes.css';
import './personal.css';
import './cloud.css';
import { installUiSounds } from './lib/sound';
import { startCloud } from './cloud/controller';

installUiSounds();
void startCloud();

// Installable, offline-capable app in production builds (the dev server stays uncached).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
