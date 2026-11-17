import { describe, expect, it } from 'vitest';
import {
  RELEASES_URL,
  compareVersions,
  isNewer,
  parseLatestRelease,
  releaseUrlFor,
  safeReleaseUrl,
  shouldPrompt,
  updateMode,
  type UpdateState
} from '../src/shared/update.js';
import { UpdateService, shortError } from '../src/main/update-service.js';
import { parseUpdateSettings } from '../src/renderer/update-settings.js';
import { updatePromptBody, updateSummary } from '../src/renderer/update-view.js';

describe('SFTP update availability', () => {
  it('is notify-only for every packaged build', () => {
    expect(updateMode(true)).toBe('notify');
  });

  it('does nothing in development or npm builds', () => {
    expect(updateMode(false)).toBe('disabled');
  });
});

describe('version comparison', () => {
  it('compares numeric versions and prereleases', () => {
    expect(isNewer('1.10.0', '1.9.9')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(isNewer('1.1.0', '1.1.0-beta.2')).toBe(true);
    expect(isNewer('1.1.0-beta.2', '1.1.0')).toBe(false);
    expect(isNewer('1.1.0-beta.10', '1.1.0-beta.2')).toBe(true);
  });

  it('rejects junk and command-shaped strings', () => {
    expect(isNewer('latest', '1.0.0')).toBe(false);
    expect(isNewer('9.9.9; rm -rf', '1.0.0')).toBe(false);
    expect(isNewer('', '1.0.0')).toBe(false);
  });
});

describe('safe release links', () => {
  it('allows only this repository releases over https', () => {
    expect(safeReleaseUrl(`${RELEASES_URL}/tag/v1.1.0?x=1#notes`)).toBe(`${RELEASES_URL}/tag/v1.1.0`);
    expect(safeReleaseUrl('https://evil.example/HappyMonkeyAI/ZeroG-SFTP/releases')).toBe(RELEASES_URL);
    expect(safeReleaseUrl('http://github.com/HappyMonkeyAI/ZeroG-SFTP/releases')).toBe(RELEASES_URL);
    expect(safeReleaseUrl('file:///etc/passwd')).toBe(RELEASES_URL);
    expect(releaseUrlFor('1.2.0')).toBe(`${RELEASES_URL}/tag/v1.2.0`);
    expect(releaseUrlFor('../../x')).toBe(RELEASES_URL);
  });
});

describe('latest release parsing', () => {
  it('uses the tag and sanitizes the page', () => {
    expect(parseLatestRelease({ tag_name: 'v1.2.0', html_url: 'https://evil.example/' })).toEqual({ version: '1.2.0', releaseUrl: RELEASES_URL });
  });

  it('ignores drafts, prereleases and malformed payloads', () => {
    expect(parseLatestRelease({ tag_name: 'v1.2.0', draft: true })).toBeNull();
    expect(parseLatestRelease({ tag_name: 'v1.2.0', prerelease: true })).toBeNull();
    expect(parseLatestRelease({ tag_name: 'nightly' })).toBeNull();
    expect(parseLatestRelease(null)).toBeNull();
  });
});

describe('update prompt policy', () => {
  const available: UpdateState = { status: 'available', mode: 'notify', currentVersion: '0.2.2', version: '0.3.0', releaseUrl: RELEASES_URL };

  it('honors skip and later but answers manual checks', () => {
    expect(shouldPrompt(available, '', null)).toBe(true);
    expect(shouldPrompt(available, '0.3.0', null)).toBe(false);
    expect(shouldPrompt(available, '', '0.3.0')).toBe(false);
    expect(shouldPrompt(available, '0.3.0', '0.3.0', true)).toBe(true);
  });

  it('does not show errors unless the user asked', () => {
    const error: UpdateState = { status: 'error', mode: 'notify', currentVersion: '0.2.2', message: 'offline' };
    expect(shouldPrompt(error, '', null)).toBe(false);
    expect(shouldPrompt(error, '', null, true)).toBe(true);
  });
});

describe('notify-only update service', () => {
  it('never fetches in disabled mode', async () => {
    let fetched = false;
    const service = new UpdateService({ mode: 'disabled', currentVersion: '0.2.2', fetchLatest: async () => { fetched = true; return null; }, onChange: () => undefined });
    expect((await service.check()).status).toBe('idle');
    expect(fetched).toBe(false);
  });

  it('reports a newer release without downloading it', async () => {
    const states: string[] = [];
    const service = new UpdateService({ mode: 'notify', currentVersion: '0.2.2', fetchLatest: async () => ({ tag_name: 'v0.3.0', html_url: `${RELEASES_URL}/tag/v0.3.0` }), onChange: state => states.push(state.status) });
    expect(await service.check()).toMatchObject({ status: 'available', mode: 'notify', version: '0.3.0' });
    expect(states).toEqual(['checking', 'available']);
    expect('download' in service).toBe(false);
  });

  it('reports current releases and coalesces simultaneous checks', async () => {
    let count = 0;
    const service = new UpdateService({ mode: 'notify', currentVersion: '0.2.2', fetchLatest: async () => { count += 1; return { tag_name: 'v0.2.2' }; }, onChange: () => undefined });
    await Promise.all([service.check(), service.check()]);
    expect(count).toBe(1);
    expect(service.current().status).toBe('current');
  });

  it('converts network errors to a bounded error state', async () => {
    const service = new UpdateService({ mode: 'notify', currentVersion: '0.2.2', fetchLatest: async () => { throw new Error('offline\n<html>'); }, onChange: () => undefined });
    expect(await service.check()).toMatchObject({ status: 'error', message: 'offline <html>' });
    expect(shortError(new Error('x'.repeat(500)))).toHaveLength(197);
    expect(shortError('')).toBe('The update check failed.');
  });
});

describe('SFTP update wording and policy', () => {
  it('states that the app never replaces itself', () => {
    const state: UpdateState = { status: 'available', mode: 'notify', currentVersion: '0.2.2', version: '0.3.0', releaseUrl: RELEASES_URL };
    expect(updatePromptBody(state)).toMatch(/never downloads or replaces itself/);
    expect(updatePromptBody(state)).not.toMatch(/Install and restart/);
    expect(updateSummary(state)).toBe('Version 0.3.0 is available.');
    expect(updateSummary({ status: 'idle', mode: 'disabled', currentVersion: '0.2.2' })).toMatch(/off/);
  });

  it('validates stored settings', () => {
    expect(parseUpdateSettings({ checkOnStartup: false, skippedVersion: 'v0.3.0' })).toEqual({ checkOnStartup: false, skippedVersion: '0.3.0' });
    expect(parseUpdateSettings({ checkOnStartup: 'yes', skippedVersion: '../../x' })).toEqual({ checkOnStartup: true, skippedVersion: '' });
    expect(parseUpdateSettings(null)).toEqual({ checkOnStartup: true, skippedVersion: '' });
  });
});
