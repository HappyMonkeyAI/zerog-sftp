import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { readFile, readdir, mkdir, writeFile, stat, rename as renameFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseSshConfig, validateTarget, type SshProfile } from '../shared/ssh.js';
const require=createRequire(import.meta.url); const pty=require('node-pty');
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
let mainWindow: BrowserWindow | undefined; let activePty: any; let activePromptKind: string | undefined; let activeOperation = '';
// Thumbnail fetches are background work: remembering their scope lets a pane that
// navigates away kill the SFTP sessions it no longer needs.
const thumbSessions = new Map<string, Set<any>>();
type Kind='file'|'directory'|'symlink'; type Entry={name:string;kind:Kind;size:number;modified?:string}; type Listing={path:string;entries:Entry[]};
const unsafePath=/[\0\r\n"'\\*?[\]]/;
function safePath(path:unknown,label:string):string{if(typeof path!=='string'||!path||path.length>4096||unsafePath.test(path))throw new Error(`${label} contains unsupported characters.`);return path;}
function safeLocalPath(path:unknown,label:string):string{if(typeof path!=='string'||!path||path.length>4096||/[\0\r\n"'*?[\]]/.test(path))throw new Error(`${label} contains unsupported characters.`);return path.replaceAll('\\','/');}
function quote(path:unknown,label:string):string{return `"${safePath(path,label)}"`;} function quoteLocal(path:unknown,label:string):string{return `"${safeLocalPath(path,label)}"`;}
async function profiles():Promise<SshProfile[]>{try{return parseSshConfig(await readFile(join(homedir(),'.ssh','config'),'utf8'));}catch{return[];}}
async function localList(path?:string):Promise<Listing>{const directory=path||homedir();const names=await readdir(directory,{withFileTypes:true});const entries=await Promise.all(names.map(async item=>{const full=join(directory,item.name);const stat=await import('node:fs/promises').then(fs=>fs.stat(full));return{name:item.name,kind:item.isDirectory()?'directory':item.isSymbolicLink()?'symlink':'file',size:stat.size,modified:stat.mtime.toISOString()}as Entry;}));return{path:directory,entries:entries.sort((a,b)=>Number(b.kind==='directory')-Number(a.kind==='directory')||a.name.localeCompare(b.name,undefined,{sensitivity:'base'}))};}
function sftpExecutable():string { if(process.platform!=='win32')return 'sftp'; const candidates=[join(process.env.SystemRoot??'C:\\Windows','System32','OpenSSH','sftp.exe'),join(process.env.ProgramFiles??'C:\\Program Files','OpenSSH','sftp.exe')]; return candidates.find(existsSync)||'sftp.exe'; }
// Only pass what OpenSSH/Windows need. Forwarding process.env would leak shell/CI secrets into the PTY child.
// PROGRAMDATA is required on Windows OpenSSH; without it the child exits with only PTY mode noise.
const SFTP_ENV_ALLOW = new Set(['path','pathext','home','userprofile','homedrive','homepath','username','user','logname','ssh_auth_sock','ssh_agent_pid','term','systemroot','windir','systemdrive','comspec','os','temp','tmp','appdata','localappdata','programdata','lang','lc_all','lc_ctype']);
function sftpEnv():Record<string,string>{
  const env:Record<string,string>={};
  for(const [key,value] of Object.entries(process.env)){
    if(value!==undefined&&SFTP_ENV_ALLOW.has(key.toLowerCase()))env[key]=value;
  }
  if(!Object.keys(env).some(key=>key.toLowerCase()==='term'))env.TERM='xterm-256color';
  return env;
}
function stripAnsi(text:string):string{
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b\][^\x07\x1b]*[\x07\x1b]/g,'').replace(/\x1b./g,'');
}
function sftpFailureMessage(out:string,exitCode:number):string{
  const lines=stripAnsi(out).replace(/\r/g,'\n').split('\n').map(line=>line.trim()).filter(Boolean);
  return lines.at(-1)||`sftp exited with code ${exitCode}`;
}
function runSftp(target:string,commands:string[],operation='',scope=''):Promise<string>{
  const destination=validateTarget(target);
  return new Promise((resolve,reject)=>{
    const child=pty.spawn(sftpExecutable(),['-o','ConnectTimeout=20',destination],{name:'xterm-256color',cols:512,rows:24,cwd:homedir(),env:sftpEnv()});
    activePty=child;activeOperation=operation;
    if(scope){let tracked=thumbSessions.get(scope);if(!tracked){tracked=new Set();thumbSessions.set(scope,tracked);}tracked.add(child);child.__thumbScope=scope;}
    // Keep command/prompt state per session so concurrent SFTP runs cannot cross-wire.
    let out='';let settled=false;let commandsSent=false;let timeout:ReturnType<typeof setTimeout>|undefined;
    const finish=(fn:(value:any)=>void,value:any)=>{if(settled)return;settled=true;clearTimeout(timeout);fn(value);};
    const sendCommands=()=>{if(commandsSent)return;commandsSent=true;clearTimeout(timeout);
      // Thumbnails are small, so bound them. Otherwise a killed PTY that never emits
      // exit would leave the renderer's concurrency slot occupied forever.
      if(operation==='thumbnail')timeout=setTimeout(()=>{try{child.kill();}catch{/* already gone */}finish(reject,new Error('Thumbnail fetch timed out.'));},60000);
      child.write(`${commands.join('\r')}\rbye\r`);};
    const onData=(chunk:string)=>{
      out+=chunk;
      const clean=chunk.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
      const progress=clean.match(/(\d{1,3})%\s+([^\r\n]*)/);
      if(progress&&operation)mainWindow?.webContents.send('sftp:progress',{operation,percent:Math.min(100,Number(progress[1])),detail:progress[2].trim()});
      if(!child.__promptKind&&/Are you sure you want to continue connecting/i.test(clean)){
        child.__promptKind='host-key';activePty=child;activePromptKind='host-key';clearTimeout(timeout);
        mainWindow?.webContents.send('sftp:prompt',{kind:'host-key',message:clean.slice(-500)});
      }else if(!child.__promptKind&&/(password:|passphrase for key)/i.test(clean)){
        child.__promptKind='secret';activePty=child;activePromptKind='secret';clearTimeout(timeout);
        mainWindow?.webContents.send('sftp:prompt',{kind:'secret',message:clean.slice(-300)});
      }else if(!child.__promptKind&&/sftp>\s*/.test(clean)){
        sendCommands();
      }
    };
    child.onData(onData);
    child.onExit(({exitCode}:{exitCode:number})=>{
      if(child.__thumbScope){const tracked=thumbSessions.get(child.__thumbScope);tracked?.delete(child);if(tracked&&tracked.size===0)thumbSessions.delete(child.__thumbScope);}
      if(activePty===child){activePty=undefined;activeOperation='';activePromptKind=undefined;}
      mainWindow?.webContents.send('sftp:progress',null);
      if(exitCode===0)finish(resolve,out);
      else finish(reject,new Error(sftpFailureMessage(out,exitCode)));
    });
    timeout=setTimeout(()=>{
      if(activePty===child){child.kill();activePty=undefined;}
      finish(reject,new Error(`SFTP connection timed out while connecting to ${destination}. Check the SSH username, host, port, and authentication prompt. Last SSH output: ${out.replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim().slice(-400)}`));
    },30000);
  });
}
function parseListing(stdout:string,fallback:string):Listing{const lines=stdout.replaceAll('\r','').split('\n');const pwd=lines.find(line=>line.startsWith('Remote working directory:'));const entries=lines.flatMap(line=>{const m=line.trimEnd().match(/^([dl-][^\s]*)\s+\S+\s+\S+\s+\S+\s+(\d+)\s+(.{3}\s+\d{1,2}\s+(?:\d{4}|\d{1,2}:\d{2}))\s+(.+)$/);if(!m)return[];return[{name:m[4].replace(/\s+->.*$/,''),kind:m[1].startsWith('d')?'directory':m[1].startsWith('l')?'symlink':'file',size:Number(m[2]),modified:m[3]}as Entry];}).filter(entry=>entry.name!=='.'&&entry.name!=='..');return{path:pwd?.replace('Remote working directory:','').trim()||fallback,entries};}
async function remoteList(target:string,path?:string):Promise<Listing>{const commands=[];if(path)commands.push(`cd ${quote(path,'Remote path')}`);commands.push('ls -lan','pwd');return parseListing(await runSftp(target,commands),path||'~');}
async function remoteMutation(target:string,command:string){await runSftp(target,[command]);} async function upload(target:string,localPath:string,remoteDir:string,kind:Kind){await runSftp(target,[`put${kind==='directory'?' -r':''} ${quoteLocal(localPath,'Local path')} ${quote(remoteDir,'Remote path')}`],'upload');} async function download(target:string,remotePath:string,localDir:string,kind:Kind){await runSftp(target,[`get${kind==='directory'?' -r':''} ${quote(remotePath,'Remote path')} ${quoteLocal(localDir,'Local path')}`],'download');}
const THUMB_EXTENSIONS = new Set(['jpg','jpeg','png','gif','webp','bmp','ico']);
function fileExtension(name: string): string { const base = name.split(/[\\/]/).pop() ?? name; const dot = base.lastIndexOf('.'); if (dot <= 0 || dot === base.length - 1) return ''; return base.slice(dot + 1).toLowerCase(); }
function isThumbnailCandidate(name: string, size: number, kind: 'file'|'directory'|'symlink'): boolean { if (kind !== 'file') return false; if (size <= 0 || size > 8 * 1024 * 1024) return false; return THUMB_EXTENSIONS.has(fileExtension(name)); }
const THUMB_MIME: Record<string,string> = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', bmp:'image/bmp', ico:'image/x-icon' };
function thumbnailMime(name: string): string { return THUMB_MIME[fileExtension(name)] ?? 'application/octet-stream'; }
function toDataUrl(name: string, data: Buffer): string { return `data:${thumbnailMime(name)};base64,${data.toString('base64')}`; }
function thumbnailCacheDir(cacheDir: string): string { return /^[A-Za-z0-9._-]{1,64}$/.test(cacheDir) ? cacheDir : 'default'; }
async function readThumbnailFile(file: string, name: string): Promise<{dataUrl:string|null}> {
  const info = await stat(file);
  if (!info.isFile() || info.size <= 0 || info.size > 8 * 1024 * 1024) return { dataUrl: null };
  return { dataUrl: toDataUrl(name, await readFile(file)) };
}
async function localThumbnail(localPath: string): Promise<{dataUrl:string|null}> {
  try {
    const file = safeLocalPath(localPath, 'Local path');
    if (!THUMB_EXTENSIONS.has(fileExtension(file))) return { dataUrl: null };
    return await readThumbnailFile(file, file);
  } catch { return { dataUrl: null }; }
}
async function downloadThumbnail(target:string,remotePath:string,cacheDir:string,scope=''):Promise<{dataUrl:string|null}>{
  try {
    const remote = safePath(remotePath, 'Remote path');
    const ext = fileExtension(remote);
    if (!THUMB_EXTENSIONS.has(ext)) return { dataUrl: null };
    const cacheRoot = join(homedir(), '.zerog-sftp-thumb-cache', thumbnailCacheDir(cacheDir));
    await mkdir(cacheRoot, { recursive: true });
    const cacheFile = join(cacheRoot, `${Buffer.from(remote).toString('base64url')}.${ext}`);
    try { return await readThumbnailFile(cacheFile, remote); } catch { /* cache miss */ }
    const slash = remote.lastIndexOf('/');
    const dir = slash > 0 ? remote.slice(0, slash) : (slash === 0 ? '/' : '.');
    const fileName = remote.slice(slash + 1);
    // Download beside the cache entry and promote it only once the transfer finishes,
    // so a fetch aborted by navigation cannot leave a truncated file behind as a hit.
    const partial = `${cacheFile}.part`;
    try {
      await runSftp(target, [`cd ${quote(dir, 'Remote path')}`, `get ${quote(fileName, 'Remote path')} ${quoteLocal(partial, 'Cache path')}`], 'thumbnail', scope);
      await renameFile(partial, cacheFile);
    } catch {
      await rm(partial, { force: true }).catch(() => {});
      return { dataUrl: null };
    }
    return await readThumbnailFile(cacheFile, remote);
  } catch { return { dataUrl: null }; }
}
function createWindow(){// Disable Electron's default File/Edit/View/etc. menu.
    Menu.setApplicationMenu(null);
    mainWindow=new BrowserWindow({width:1220,height:760,minWidth:900,minHeight:560,webPreferences:{preload:join(root,'dist','main','preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});void mainWindow.loadFile(join(root,'dist','renderer','index.html'));}
ipcMain.handle('profiles:list',profiles);ipcMain.handle('local:list',(_e,path?:unknown)=>localList(typeof path==='string'?path:undefined));ipcMain.handle('remote:list',(_e,target:unknown,path?:unknown)=>remoteList(validateTarget(target),typeof path==='string'?path:undefined));ipcMain.handle('sftp:answer',(_e,answer:unknown)=>{if(typeof answer!=='string'||!activePty)throw new Error('No SFTP prompt is waiting.');activePty.write(answer.replace(/[\r\n]/g,'')+'\r');activePty.__promptKind=undefined;activePromptKind=undefined;});ipcMain.handle('sftp:cancel',()=>{if(!activePty)return false;activePty.kill();return true;});ipcMain.handle('remote:mkdir',(_e,target:unknown,path:unknown)=>remoteMutation(validateTarget(target),`mkdir ${quote(path,'Remote path')}`));ipcMain.handle('remote:rename',(_e,target:unknown,from:unknown,to:unknown)=>remoteMutation(validateTarget(target),`rename ${quote(from,'Remote path')} ${quote(to,'Remote path')}`));
ipcMain.handle('remote:remove',(_e,target:unknown,path:unknown,kind:unknown)=>remoteMutation(validateTarget(target),`${kind==='directory'?'rmdir':'rm'} ${quote(path,'Remote path')}`));ipcMain.handle('remote:upload',(_e,target:unknown,localPath:unknown,remoteDir:unknown,kind:unknown)=>upload(validateTarget(target),safeLocalPath(localPath,'Local path'),safePath(remoteDir,'Remote path'),kind==='directory'?'directory':'file'));ipcMain.handle('remote:download',(_e,target:unknown,remotePath:unknown,localDir:unknown,kind:unknown)=>download(validateTarget(target),safePath(remotePath,'Remote path'),safeLocalPath(localDir,'Local path'),kind==='directory'?'directory':'file'));ipcMain.handle('sftp:downloadThumbnail',(_e,target:unknown,remotePath:unknown,cacheDir:unknown,scope:unknown)=>downloadThumbnail(validateTarget(target),typeof remotePath==='string'?remotePath:'',typeof cacheDir==='string'?cacheDir:'',typeof scope==='string'?scope:''));ipcMain.handle('sftp:cancelThumbnails',(_e,scope:unknown)=>{if(typeof scope!=='string'||!scope||scope.length>4096)return false;const tracked=thumbSessions.get(scope);if(!tracked||tracked.size===0)return false;for(const child of tracked){try{child.kill();}catch{/* already gone */}}tracked.clear();return true;});ipcMain.handle('local:thumbnail',(_e,localPath:unknown)=>localThumbnail(typeof localPath==='string'?localPath:''));
app.whenReady().then(createWindow);app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
