import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const renderer = read('src/renderer/main.tsx');
const main = read('src/main/main.ts');

// Remote thumbnails used to flash the transfer banner once per file (0→100 then
// null), mounting/unmounting it and wobbling the grid. The fix is a single batch
// banner that stays visible until every image in the directory is processed.
describe('thumbnail batch progress', () => {
  it('registers each remote thumbnail into a shared batch', () => {
    expect(renderer).toContain('const batched = !isLocal;');
    expect(renderer).toContain('if (batched) beginThumbBatch(scope, epoch);');
    expect(renderer).toContain('if (batched) endThumbBatch(scope, epoch);');
  });

  it('keys the batch by scope+epoch so abandoned fetches cannot corrupt the next directory', () => {
    expect(renderer).toContain('!== thumbBatchKey) return;');
    expect(renderer).toContain('if (key !== thumbBatchKey) { thumbBatchKey = key; thumbBatchPending = 0; thumbBatchDone = 0; }');
  });

  it('renders one banner from the batch store, visible only while the batch is active', () => {
    expect(renderer).toContain('useSyncExternalStore(subscribeThumbBatch, getThumbBatch)');
    expect(renderer).toContain('{thumbBatch.active && (');
    expect(renderer).toContain('data-purpose="thumbnail-batch-progress"');
    expect(renderer).toContain('{thumbBatch.done} / {thumbBatch.total}');
  });

  it('clears the batch when the pane leaves a remote directory', () => {
    expect(renderer).toContain("if (scope.startsWith('remote:')) resetThumbBatch();");
  });

  it('stops emitting per-file thumbnail progress from the main process', () => {
    expect(main).toContain("operation!=='thumbnail'");
    expect(main).toContain("if(operation!=='thumbnail')mainWindow?.webContents.send('sftp:progress',null);");
  });
});
