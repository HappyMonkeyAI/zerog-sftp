import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const renderer = read('src/renderer/main.tsx');
const preload = read('src/main/preload.cjs');
const main = read('src/main/main.ts');

// Navigating away from a directory must stop its thumbnail downloads. That needs
// three things wired together: the renderer cancels the directory's scope, the
// scope reaches the main process, and the main process can kill those sessions.
describe('thumbnail cancellation', () => {
  it('cancels a directory scope when the pane leaves it', () => {
    expect(renderer).toContain('return () => cancelThumbScope(scope);');
  });

  it('tags every thumbnail request with its scope', () => {
    expect(renderer).toContain('api.downloadThumbnail(target || \'\', fullPath, cacheDir, scope)');
    expect(preload).toContain("ipcRenderer.invoke('sftp:downloadThumbnail', target, remotePath, cacheDir, scope)");
  });

  it('exposes a cancellation channel the renderer can call', () => {
    expect(preload).toContain("cancelThumbnails: (scope) => ipcRenderer.invoke('sftp:cancelThumbnails', scope)");
    expect(main).toContain("ipcMain.handle('sftp:cancelThumbnails'");
  });

  it('kills the SFTP sessions registered for the scope', () => {
    const handler = main.slice(main.indexOf("ipcMain.handle('sftp:cancelThumbnails'"));
    expect(handler.slice(0, 400)).toContain('child.kill()');
  });

  it('does not cache an abandoned fetch as a permanent failure', () => {
    expect(renderer).toContain('if (next !== null || !abandoned) thumbCache.set(cacheKey, next);');
  });

  it('stages downloads so an aborted transfer cannot leave a truncated cache hit', () => {
    expect(main).toContain('const partial = `${cacheFile}.part`;');
    expect(main).toContain('await renameFile(partial, cacheFile);');
    expect(main).toContain('await rm(partial, { force: true })');
  });
});
