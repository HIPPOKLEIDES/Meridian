import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VaultInfo } from './vault';

/**
 * The journal's encryption setting for the whole account, synced between devices.
 * - null: not known yet (never synced, or not signed in)
 * - { off: true }: the account's journal is not encrypted
 * - VaultInfo: encrypted; devices must unlock with the account's passphrase
 */
export type AccountVault = VaultInfo | { off: true } | null;

export const isEncryptedVault = (v: AccountVault): v is VaultInfo => !!v && 'salt' in v;

export const useAccountVault = create<{ vault: AccountVault; setVault(vault: AccountVault): void }>()(
  persist((set) => ({ vault: null, setVault: (vault) => set({ vault }) }), {
    name: 'meridian:journal-vault',
    partialize: (s) => ({ vault: s.vault }),
  }),
);
