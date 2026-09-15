import type { AppData } from '../types';
import type { HealthData } from '../health/types';
import type { FinanceData } from '../finance/types';
import type { NotesData } from '../notes/types';
import type { JournalData } from '../journal/types';
import type { GoalsData } from '../goals/types';
import { emptyData, exportData, useStore } from '../store';
import { emptyHealth, exportHealth, useHealth } from '../health/store';
import { emptyFinance, exportFinance, useFinance } from '../finance/store';
import { exportNotes, useNotes } from '../notes/store';
import { exportJournalForBackup, importJournalFromBackup, resetJournal } from '../journal/store';
import { emptyGoals, exportGoals, useGoals } from '../goals/store';
import { flushIdb } from './idb';
import { clearAssets, exportAssets, importAssets, type ExportedAsset } from '../notes/assets';
import { sampleData } from './sample';
import { sampleHealth } from '../health/sample';
import { sampleFinance } from '../finance/sample';
import { sampleNotes } from '../notes/sample';
import { sampleJournal } from '../journal/sample';
import { sampleGoals } from '../goals/sample';

/**
 * A full backup: planner data plus health, finance, project notes and their images, journals and goals.
 * An encrypted journal is exported as its encrypted envelope (`journalEncrypted`) instead of `journal`.
 */
export type Backup = AppData & {
  version: 4;
  health: HealthData;
  finance: FinanceData;
  notes: NotesData;
  assets: ExportedAsset[];
  journal?: JournalData;
  journalEncrypted?: string;
  goals: GoalsData;
};

export async function exportAll(): Promise<Backup> {
  flushIdb();
  return {
    version: 4,
    ...exportData(),
    health: exportHealth(),
    finance: exportFinance(),
    notes: exportNotes(),
    assets: await exportAssets(),
    ...(await exportJournalForBackup()),
    goals: exportGoals(),
  };
}

/**
 * Accepts v1 (core only), v2 (+ health & finance), v3 (+ notes & images) and v4 (+ journal & goals) backups.
 * Sections missing from an older backup are left as they are. Throws if the shape isn't recognizable.
 */
export async function importAll(raw: unknown) {
  const data = raw as Partial<Backup>;
  const lists = ['areas', 'projects', 'tasks', 'habits', 'blocks', 'entries'] as const;
  if (!data || typeof data !== 'object' || !lists.every((k) => data[k] === undefined || Array.isArray(data[k]))) {
    throw new Error('Not a Meridian backup');
  }
  const { health, finance, notes, assets, journal, journalEncrypted, goals, version: _version, ...core } = data;
  useStore.getState().replaceAll({ ...emptyData(), ...core } as AppData);
  if (health) useHealth.getState().replaceAll({ ...emptyHealth(), ...health });
  if (finance) useFinance.getState().replaceAll({ ...emptyFinance(), ...finance });
  if (assets) await importAssets(assets);
  if (notes) useNotes.getState().replaceAll(notes);
  if (journal || journalEncrypted) await importJournalFromBackup({ journal, journalEncrypted });
  if (goals) useGoals.getState().replaceAll(goals);
}

export async function loadAllSamples() {
  const settings = useStore.getState().settings;
  useStore.getState().replaceAll({ ...sampleData(), settings });
  // Keep the user's own API identifiers when swapping in sample data.
  const { google, nutrition } = useHealth.getState();
  const health = sampleHealth();
  useHealth.getState().replaceAll({
    ...health,
    google: { ...health.google, clientId: google.clientId },
    nutrition: { ...health.nutrition, fdcApiKey: nutrition.fdcApiKey },
  });
  useFinance.getState().replaceAll(sampleFinance());
  await clearAssets();
  useNotes.getState().replaceAll(await sampleNotes());
  resetJournal(sampleJournal());
  useGoals.getState().replaceAll(sampleGoals());
}

export async function eraseAll() {
  const settings = useStore.getState().settings;
  useStore.getState().replaceAll({ ...emptyData(), settings });
  useHealth.getState().replaceAll(emptyHealth());
  useFinance.getState().replaceAll(emptyFinance());
  useNotes.getState().replaceAll({ notes: [] });
  resetJournal();
  useGoals.getState().replaceAll(emptyGoals());
  await clearAssets();
}
