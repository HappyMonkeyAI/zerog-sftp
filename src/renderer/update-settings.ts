import { parseVersion } from '../shared/update.js';

export interface UpdateSettings {
  checkOnStartup: boolean;
  skippedVersion: string;
}

export const UPDATE_SETTINGS_KEY = 'zerogsftp.updates';
export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = { checkOnStartup: true, skippedVersion: '' };

export function parseUpdateSettings(value: unknown): UpdateSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_UPDATE_SETTINGS };
  const source = value as Partial<UpdateSettings>;
  return {
    checkOnStartup: typeof source.checkOnStartup === 'boolean' ? source.checkOnStartup : DEFAULT_UPDATE_SETTINGS.checkOnStartup,
    skippedVersion: parseVersion(source.skippedVersion) ?? ''
  };
}

export function loadStoredUpdateSettings(): UpdateSettings {
  try {
    return parseUpdateSettings(JSON.parse(localStorage.getItem(UPDATE_SETTINGS_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_UPDATE_SETTINGS };
  }
}

export function storeUpdateSettings(settings: UpdateSettings): void {
  try {
    localStorage.setItem(UPDATE_SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* private mode or full storage */ }
}
