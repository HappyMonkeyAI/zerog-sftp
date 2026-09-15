import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSshConfig, validateTarget, type SshProfile } from '../shared/ssh.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

type Entry = { name: string; kind: 'file'|'directory'|'symlink'; size: number; modified?: string };

async function profiles(): Promise<SshProfile[]> {
  try { return parseSshConfig(await readFile(join(homedir(), '.ssh', 'config'), 'utf8')); }
  catch { return []; }
}

async function localList(path?: string): Promise<{path:string; entries:Entry[]}> {
  const directory = path || homedir();
  const names = await readdir(directory, { withFileTypes: true });
  const entries = await Promise.all(names.map(async (item) => {
    const full = join(directory, item.name);
    const stat = await import('node:fs/promises').then((fs) => fs.stat(full));
    return { name:item.name, kind:item.isDirectory()?'directory':item.isSymbolicLink()?'symlink':'file', size:stat.size, modified:stat.mtime.toISOString() } as Entry;
  }));
  return { path: directory, entries: entries.sort((a,b) => Number(b.kind==='directory')-Number(a.kind==='directory') || a.name.localeCompare(b.name, undefined, {sensitivity:'base'})) };
}

function remoteList(target: string, path?: string): Promise<{path:string; entries:Entry[]}> {
  const destination = validateTarget(target);
  const command = path ? `cd "${path.replaceAll('"','')}"\nls -lan\npwd\nbye\n` : 'ls -lan\npwd\nbye\n';
  return new Promise((resolve, reject) => {
    const child = spawn('sftp', ['-o','BatchMode=yes','-o','ConnectTimeout=20',destination], { windowsHide:true });
    let stdout=''; let stderr='';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => reject(new Error(`Unable to start OpenSSH sftp: ${error.message}`)));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `sftp exited with code ${code}`));
      const lines=stdout.replaceAll('\r','').split('\n');
      const pwdLine=lines.find((line) => line.startsWith('Remote working directory:'));
      const entries=lines.flatMap((line) => {
        const m=line.trimEnd().match(/^([dl-][^\s]*)\s+\S+\s+\S+\s+\S+\s+(\d+)\s+(.{3}\s+\d{1,2}\s+(?:\d{4}|\d{1,2}:\d{2}))\s+(.+)$/);
        if (!m) return [];
        return [{name:m[4].replace(/\s+->.*$/,''), kind:m[1].startsWith('d')?'directory':m[1].startsWith('l')?'symlink':'file', size:Number(m[2]), modified:m[3]} as Entry];
      }).filter((entry) => entry.name !== '.' && entry.name !== '..');
      resolve({path:pwdLine?.replace('Remote working directory:','').trim() || path || '~', entries});
    });
    child.stdin.end(command);
  });
}

function createWindow() {
  const win = new BrowserWindow({ width: 1220, height: 760, minWidth: 900, minHeight: 560, webPreferences: { preload: join(root,'dist','main','preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:true } });
  void win.loadFile(join(root,'dist','renderer','index.html'));
}

ipcMain.handle('profiles:list', profiles);
ipcMain.handle('local:list', (_event, path?: unknown) => localList(typeof path === 'string' ? path : undefined));
ipcMain.handle('remote:list', (_event, target: unknown, path?: unknown) => remoteList(validateTarget(target), typeof path === 'string' ? path : undefined));
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
