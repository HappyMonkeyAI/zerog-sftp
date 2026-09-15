import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { FileEntry, Listing } from '../shared/types.js';
import { profileTarget, type SshProfile } from '../shared/ssh.js';
import './styles.css';

function Panel({ title, listing, onNavigate }: { title:string; listing:Listing|null; onNavigate:(entry:FileEntry)=>void }) {
  return <section className="panel"><header><strong>{title}</strong><span>{listing?.path ?? 'Loading…'}</span></header><div className="entries">{listing?.entries.map((entry)=><button className="entry" key={entry.name} onDoubleClick={()=>entry.kind==='directory'&&onNavigate(entry)}><span className="kind">{entry.kind==='directory'?'▣':entry.kind==='symlink'?'↗':'·'}</span><span>{entry.name}</span><small>{entry.kind==='directory'?'folder':entry.size.toLocaleString()+' B'}</small></button>)}</div></section>;
}
function App() {
  const [profiles,setProfiles]=useState<SshProfile[]>([]); const [selected,setSelected]=useState(''); const [manual,setManual]=useState(''); const [target,setTarget]=useState('');
  const [local,setLocal]=useState<Listing|null>(null); const [remote,setRemote]=useState<Listing|null>(null); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  useEffect(()=>{void window.sftp.listProfiles().then((items)=>{setProfiles(items); if(items[0])setSelected(items[0].alias);}); void window.sftp.listLocal().then(setLocal).catch((e)=>setError(String(e.message??e)));},[]);
  const profile=useMemo(()=>profiles.find((item)=>item.alias===selected),[profiles,selected]);
  const connectTarget=profile ? profileTarget(profile) : manual.trim();
  async function connect(){setError(''); setBusy(true); try {setTarget(connectTarget); setRemote(await window.sftp.listRemote(connectTarget));} catch(e) {setError(String((e as Error).message??e));} finally {setBusy(false);} }
  async function localNav(entry:FileEntry){if(!local)return; try{setLocal(await window.sftp.listLocal(local.path.replace(/[\\/]$/,'')+'\\'+entry.name));}catch(e){setError(String((e as Error).message??e));}}
  async function remoteNav(entry:FileEntry){if(!remote||!target)return; try{setRemote(await window.sftp.listRemote(target, remote.path.replace(/\/$/,'')+'/'+entry.name));}catch(e){setError(String((e as Error).message??e));}}
  return <main><div className="topbar"><div><h1>ZeroG SFTP</h1><p>OpenSSH-powered file transfer</p></div><div className="connect"><select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Manual connection</option>{profiles.map(p=><option key={p.alias} value={p.alias}>{p.alias}{p.hostName?` — ${p.user?`${p.user}@`:''}${p.hostName}`:''}</option>)}</select><input value={manual} onChange={e=>setManual(e.target.value)} placeholder="user@host or SSH alias" disabled={!!profile}/><button onClick={()=>void connect()} disabled={busy||!connectTarget}>{busy?'Connecting…':'Connect'}</button></div></div><div className="notice">{error ? <span className="error">{error}</span> : target ? `Connected to ${target}` : 'Choose an SSH profile or enter a target to begin.'}</div><div className="panes"><Panel title="Local" listing={local} onNavigate={(e)=>void localNav(e)}/><Panel title="Remote" listing={remote} onNavigate={(e)=>void remoteNav(e)}/></div><footer>Double-click folders to navigate. Authentication currently uses OpenSSH agent/key configuration with BatchMode enabled.</footer></main>;
}

createRoot(document.getElementById('root')!).render(<App />);
