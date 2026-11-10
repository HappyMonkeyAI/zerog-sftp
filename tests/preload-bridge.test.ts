import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

// The renderer calls these through window.sftp, so the preload bridge and the
// main-process IPC handlers must stay in sync with the declared contract.
const contract = read('src/shared/types.d.ts');
const preload = read('src/main/preload.cjs');
const main = read('src/main/main.ts');

const windowContract = contract.slice(contract.indexOf('interface Window'));
const declaredMethods = [...windowContract.matchAll(/[;{]\s*([A-Za-z0-9_]+):\(/g)].map(match => match[1]);
const exposedMethods = new Set([...preload.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map(match => match[1]));
const invokedChannels = new Set([...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(match => match[1]));
const handledChannels = new Set([...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(match => match[1]));

describe('preload bridge', () => {
  it('declares at least one Window.sftp method', () => {
    expect(declaredMethods.length).toBeGreaterThan(0);
  });

  it('exposes every method declared on Window.sftp', () => {
    const missing = declaredMethods.filter(name => !exposedMethods.has(name));
    expect(missing).toEqual([]);
  });

  it('registers a main-process handler for every invoked channel', () => {
    const missing = [...invokedChannels].filter(channel => !handledChannels.has(channel));
    expect(missing).toEqual([]);
  });
});
