import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSshConfig, validateTarget, type SshProfile } from '../shared/ssh.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
type Kind = 'file'|'directory'|'symlink';
type Entry = { name: string; kind: Kind; size: number; modified?: string };
type Listing = { path:string; entries:Entry[] };
const unsafePath = /[\0\r\n"'\\*?[\]]/;
function safePath(path: unknown, label: string): string { if (typeof path !== 'string' || !path || path.length > 4096 || unsafePath.test(path)) throw new Error(`${label} contains unsupported characters.`); return path; }
function safeLocalPath(path: unknown, label: string): string { if (typeof path !== 'string' || !path || path.length > 4096 || /[\0\r\n"'*?[\]]/.test(path)) throw new Error(`${label} contains unsupported characters.`); return path.replaceAll('\\\\','/'); }
function quote(path: unknown, label: string): string { return `"${safePath(path,label)}"`; }
function quoteLocal(path: unknown, label: string): string { return `"${safeLocalPath(path,label)}"`; }

async function profiles(): Promise<SshProfile[]> { try { return parseSshConfig(await readFile(join(homedir(), '.ssh', 'config'), 'utf8')); } catch { return []; } }
async function localList(path?: string): Promise<Listing> {
  const directory = path || homedir(); const names = await readdir(directory, { withFileTypes: true });
  const entries = await Promise.all(names.map(async (item) => { const full=join(directory,item.name); const stat=await import('node:fs/promises').then((fs)=>fs.stat(full)); return {name:item.name,kind:item.isDirectory()?'directory':item.isSymbolicLink()?'symlink':'file',size:stat.size,modified:stat.mtime.toISOString()} as Entry; }));
  return {path:directory, entries:entries.sort((a,b)=>Number(b.kind==='directory')-Number(a.kind==='directory')||a.name.localeCompare(b.name,undefined,{sensitivity:'base'}))};
}
function runSftp(target: string, commands: string[]): Promise<string> {
  const destination=validateTarget(target);
  return new Promise((resolve,reject)=>{ const child=spawn('sftp',['-o','BatchMode=yes','-o','ConnectTimeout=20',destination],{windowsHide:true}); let out='',err=''; child.stdout.on('data',(c)=>{out+=c.toString();}); child.stderr.on('data',(c)=>{err+=c.toString();}); child.on('error',(e)=>reject(new Error(`Unable to start OpenSSH sftp: ${e.message}`))); child.on('close',(code)=>code===0?resolve(out):reject(new Error(err.trim()||`sftp exited with code ${code}`))); child.stdin.end(`${commands.join('\n')}\nbye\n`); });
}
function parseListing(stdout:string, fallback:string): Listing { const lines=stdout.replaceAll('\r','').split('\n'); const pwd=lines.find((line)=>line.startsWith('Remote working directory:')); const entries=lines.flatMap((line)=>{const m=line.trimEnd().match(/^([dl-][^\s]*)\s+\S+\s+\S+\s+\S+\s+(\d+)\s+(.{3}\s+\d{1,2}\s+(?:\d{4}|\d{1,2}:\d{2}))\s+(.+)$/); if(!m)return[]; return[{name:m[4].replace(/\s+->.*$/,''),kind:m[1].startsWith('d')?'directory':m[1].startsWith('l')?'symlink':'file',size:Number(m[2]),modified:m[3]} as Entry];}).filter((entry)=>entry.name!=='.'&&entry.name!=='..'); return {path:pwd?.replace('Remote working directory:','').trim()||fallback,entries}; }
async function remoteList(target:string,path?:string):Promise<Listing>{const commands=[];if(path)commands.push(`cd ${quote(path,'Remote path')}`);commands.push('ls -lan','pwd');return parseListing(await runSftp(target,commands),path||'~');}
async function remoteMutation(target:string, command:string):Promise<void>{await runSftp(target,[command]);}
async function upload(target:string, localPath:string, remoteDir:string, kind:Kind):Promise<void>{await runSftp(target,[`put${kind==='directory'?' -r':''} ${quoteLocal(localPath,'Local path')} ${quote(remoteDir,'Remote path')}`]);}
async function download(target:string, remotePath:string, localDir:string, kind:Kind):Promise<void>{await runSftp(target,[`get${kind==='directory'?' -r':''} ${quote(remotePath,'Remote path')} ${quoteLocal(localDir,'Local path')}`]);}
function createWindow(){const win=new BrowserWindow({width:1220,height:760,minWidth:900,minHeight:560,webPreferences:{preload:join(root,'dist','main','preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});void win.loadFile(join(root,'dist','renderer','index.html'));}
ipcMain.handle('profiles:list',profiles);
ipcMain.handle('local:list',(_e,path?:unknown)=>localList(typeof path==='string'?path:undefined));
ipcMain.handle('remote:list',(_e,target:unknown,path?:unknown)=>remoteList(validateTarget(target),typeof path==='string'?path:undefined));
ipcMain.handle('remote:mkdir',(_e,target:unknown,path:unknown)=>remoteMutation(validateTarget(target),`mkdir ${quote(path,'Remote path')}`));
ipcMain.handle('remote:rename',(_e,target:unknown,from:unknown,to:unknown)=>remoteMutation(validateTarget(target),`rename ${quote(from,'Remote path')} ${quote(to,'Remote path')}`));
ipcMain.handle('remote:remove',(_e,target:unknown,path:unknown,kind:unknown)=>remoteMutation(validateTarget(target),`${kind==='directory'?'rmdir':'rm'} ${quote(path,'Remote path')}`));
ipcMain.handle('remote:upload',(_e,target:unknown,localPath:unknown,remoteDir:unknown,kind:unknown)=>upload(validateTarget(target),safePath(localPath,'Local path'),safePath(remoteDir,'Remote path'),kind==='directory'?'directory':'file'));
ipcMain.handle('remote:download',(_e,target:unknown,remotePath:unknown,localDir:unknown,kind:unknown)=>download(validateTarget(target),safePath(remotePath,'Remote path'),safePath(localDir,'Local path'),kind==='directory'?'directory':'file'));
app.whenReady().then(createWindow); app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
