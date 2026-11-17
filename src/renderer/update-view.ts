import type { UpdateState } from '../shared/update.js';

export function updateSummary(state: UpdateState | null): string {
  if (!state || state.status === 'idle') return state?.mode === 'disabled' ? 'Checks are off in development and npm builds.' : 'Not checked yet.';
  if (state.status === 'checking') return 'Checking for updates…';
  if (state.status === 'current') return 'You are up to date.';
  if (state.status === 'available') return `Version ${state.version} is available.`;
  return `Update check failed: ${state.message}`;
}

export function updatePromptBody(state: UpdateState & { status: 'available' }): string {
  return `ZeroG SFTP ${state.version} is available. This build only opens the official download page; it never downloads or replaces itself. You are using ${state.currentVersion}.`;
}
