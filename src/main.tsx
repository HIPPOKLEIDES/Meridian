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
import { registerServiceWorker, watchInstall } from './lib/install';
import { startReminders } from './lib/reminders';

installUiSounds();
void startCloud();

// Listen for the install offer before anything renders: the browser fires it at load.
watchInstall();
// Warn about anything on the day clock that is about to start.
startReminders();
// Installable, offline-capable app in production builds (the dev server stays uncached).
if (import.meta.env.PROD) registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
