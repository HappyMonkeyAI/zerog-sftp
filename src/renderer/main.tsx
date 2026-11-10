import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { FileEntry, Listing, ListingViewMode } from '../shared/types.js';
import { profileTarget, type SshProfile } from '../shared/ssh.js';
import './styles.css';

const THUMB_EXTENSIONS = new Set(['jpg','jpeg','png','gif','webp','bmp','ico']);
function fileExtension(name: string): string { const base = name.split(/[\/]/).pop() ?? name; const dot = base.lastIndexOf('.'); if (dot <= 0 || dot === base.length - 1) return ''; return base.slice(dot + 1).toLowerCase(); }
function isThumbnailCandidate(name: string, size: number, kind: 'file'|'directory'|'symlink'): boolean { if (kind !== 'file') return false; if (size <= 0 || size > 8 * 1024 * 1024) return false; return THUMB_EXTENSIONS.has(fileExtension(name)); }

const MIN_VIEW_SCALE = 0.5;
const MAX_VIEW_SCALE = 2.5;
function clampViewScale(value: number): number { return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, value)); }

// React registers wheel listeners as passive, so preventDefault() must come from a native listener.
function useCtrlWheelZoom(scale: number, onChange: (next: number) => void, enabled = true) {
  const ref = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      if (!enabled || !event.ctrlKey) return;
      event.preventDefault();
      const next = clampViewScale(scaleRef.current * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
      scaleRef.current = next;
      onChange(next);
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [onChange, enabled]);
  return ref;
}

const thumbCache = new Map<string, string | null>();
// Each remote thumbnail costs a fresh SFTP session, so cap how many run at once.
const THUMB_CONCURRENCY = 3;
let activeThumbLoads = 0;
interface ThumbWaiter { scope: string; epoch: number; resolve: (granted: boolean) => void }
const thumbQueue: ThumbWaiter[] = [];
// A scope identifies the directory a thumbnail belongs to. Bumping its epoch when
// the pane leaves that directory abandons queued and in-flight fetches for it.
const thumbEpochs = new Map<string, number>();

function thumbScopeKey(isLocal: boolean, target: string, path: string): string {
  return isLocal ? `local:${path}` : `remote:${target}:${path}`;
}

function thumbEpoch(scope: string): number { return thumbEpochs.get(scope) ?? 0; }

function acquireThumbSlot(scope: string, epoch: number): Promise<boolean> {
  if (epoch !== thumbEpoch(scope)) return Promise.resolve(false);
  if (activeThumbLoads < THUMB_CONCURRENCY) {
    activeThumbLoads += 1;
    return Promise.resolve(true);
  }
  return new Promise(resolve => { thumbQueue.push({ scope, epoch, resolve }); });
}

function releaseThumbSlot(): void {
  activeThumbLoads = Math.max(0, activeThumbLoads - 1);
  while (thumbQueue.length) {
    const waiter = thumbQueue.shift() as ThumbWaiter;
    if (waiter.epoch !== thumbEpoch(waiter.scope)) { waiter.resolve(false); continue; }
    activeThumbLoads += 1;
    waiter.resolve(true);
    return;
  }
}

function cancelThumbScope(scope: string): void {
  thumbEpochs.set(scope, thumbEpoch(scope) + 1);
  for (let i = thumbQueue.length - 1; i >= 0; i -= 1) {
    const waiter = thumbQueue[i];
    if (waiter.scope !== scope) continue;
    thumbQueue.splice(i, 1);
    waiter.resolve(false);
  }
  void window.sftp?.cancelThumbnails?.(scope);
}

function listingChildPath(base: string, name: string): string {
  if (!base) return name;
  return `${base.replace(/[\\/]+$/, '')}/${name}`;
}

function EntryThumbnail(props: {
  entry: FileEntry;
  path: string;
  isLocal: boolean;
  target?: string;
  cacheDir: string;
  scope: string;
  edge: number;
  fallbackIcon: string;
}) {
  const { entry, path, isLocal, target, cacheDir, scope, edge } = props;
  const eligible = isThumbnailCandidate(entry.name, entry.size, entry.kind);
  const fullPath = listingChildPath(path, entry.name);
  const cacheKey = isLocal ? `local:${fullPath}` : `${target || 'remote'}:${fullPath}`;
  const [src, setSrc] = useState<string | null>(() => eligible ? (thumbCache.get(cacheKey) ?? null) : null);
  const [failed, setFailed] = useState(() => eligible && thumbCache.get(cacheKey) === null);

  useEffect(() => {
    if (!eligible || failed) return;
    const cached = thumbCache.get(cacheKey);
    if (cached !== undefined) {
      setSrc(cached);
      setFailed(cached === null);
      return;
    }
    let cancelled = false;
    const epoch = thumbEpoch(scope);
    const load = async (): Promise<string | null> => {
      if (!(await acquireThumbSlot(scope, epoch))) return null;
      try {
        const api = window.sftp;
        if (isLocal) {
          if (typeof api.localThumbnail !== 'function') return null;
          return (await api.localThumbnail(fullPath))?.dataUrl ?? null;
        }
        if (typeof api.downloadThumbnail !== 'function') return null;
        return (await api.downloadThumbnail(target || '', fullPath, cacheDir, scope))?.dataUrl ?? null;
      } catch {
        return null;
      } finally {
        releaseThumbSlot();
      }
    };
    void load().then((next) => {
      // An abandoned fetch reports null because its SFTP session was killed, so
      // never remember that as a permanent failure for this file.
      const abandoned = cancelled || epoch !== thumbEpoch(scope);
      if (next !== null || !abandoned) thumbCache.set(cacheKey, next);
      if (abandoned) return;
      setSrc(next);
      setFailed(next === null);
    });
    return () => { cancelled = true; };
  }, [eligible, failed, isLocal, cacheKey, target, fullPath, cacheDir, scope]);

  if (src) {
    return <img className="tile-thumb" src={src} alt="" width={edge} height={edge} draggable={false} />;
  }
  return (
    <span className="tile-fallback" style={{ width: edge, height: edge }}>
      <svg className="w-full h-full text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
    </span>
  );
}

const isHidden = (name: string) => name.startsWith('.');

function ViewModeToggle({ mode, onChange }: { mode: ListingViewMode; onChange: (mode: ListingViewMode) => void }) {
  const options: Array<{ mode: ListingViewMode; label: string; icon: React.ReactNode }> = [
    {
      mode: 'details',
      label: 'Details',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
        </svg>
      ),
    },
    {
      mode: 'icons',
      label: 'Icons',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M5.5 4h3A1.5 1.5 0 0110 5.5v3A1.5 1.5 0 018.5 10h-3A1.5 1.5 0 014 8.5v-3A1.5 1.5 0 015.5 4zM15.5 4h3A1.5 1.5 0 0120 5.5v3a1.5 1.5 0 01-1.5 1.5h-3A1.5 1.5 0 0114 8.5v-3A1.5 1.5 0 0115.5 4zM5.5 14h3A1.5 1.5 0 0110 15.5v3A1.5 1.5 0 018.5 20h-3A1.5 1.5 0 014 18.5v-3A1.5 1.5 0 015.5 14zM15.5 14h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3a1.5 1.5 0 01-1.5-1.5v-3a1.5 1.5 0 011.5-1.5z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
        </svg>
      ),
    },
    {
      mode: 'thumbnails',
      label: 'Thumbnails',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="4" y="4" width="16" height="16" rx="1.5" strokeLinejoin="round" strokeWidth="2"></rect>
          <path d="M4.5 16.5l4.4-4.4a1 1 0 011.4 0l3.9 3.9m0 0l1.5-1.5a1 1 0 011.4 0l2.4 2.4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
          <circle cx="9.25" cy="9.25" r="1.25" strokeWidth="2"></circle>
        </svg>
      ),
    },
  ];

  return (
    <>
      {options.map(option => (
        <button
          key={option.mode}
          className={`p-1 rounded ${mode === option.mode ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
          title={option.label}
          aria-label={option.label}
          aria-pressed={mode === option.mode}
          onClick={() => onChange(option.mode)}
        >
          {option.icon}
        </button>
      ))}
    </>
  );
}

function FileRowLocal({ entry, selected, onSelect, onNavigate, showHidden, viewMode, viewScale }: {
  entry: FileEntry;
  selected: FileEntry[];
  onSelect: (entry: FileEntry, event: React.MouseEvent) => void;
  onNavigate: (entry: FileEntry) => void;
  showHidden: boolean;
  viewMode: ListingViewMode;
  viewScale: number;
}) {
  const isSelected = selected.some(item => item.name === entry.name);
  const handleClick = (e: React.MouseEvent) => onSelect(entry, e);
  const handleDoubleClick = () => {
    if (entry.kind === 'directory' || entry.kind === 'symlink' || entry.name === '..') {
      onNavigate(entry);
    }
  };

  const icon = entry.name === '..' ? (
    <svg className="w-4 h-4 text-blue-400/80 group-hover:text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
  ) : entry.kind === 'directory' ? (
    <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>
  ) : entry.name.endsWith('.json') || entry.name.includes('config') ? (
    <svg className="w-4 h-4 text-yellow-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
  ) : entry.name.endsWith('.pub') || entry.name.includes('ed25519') || entry.name.includes('rsa') ? (
    <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
  ) : (
    <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
  );

  return (
    <div className={`grid grid-cols-12 px-3 py-1.5 items-center hover:bg-app-rowHover cursor-pointer group ${isSelected ? 'bg-blue-900/30 border-l-2 border-blue-500 hover:bg-blue-900/40' : ''}`} onClick={handleClick} onDoubleClick={handleDoubleClick}>
      <div className="col-span-6 flex items-center space-x-2 truncate">
        <input
          className="rounded border-slate-700 bg-slate-900 text-blue-600 w-3 h-3"
          type="checkbox"
          checked={isSelected}
          onChange={(e) => { e.stopPropagation(); onSelect(entry, e as any); }}
          onClick={(e) => e.stopPropagation()}
        />
        {icon}
        <span className={`text-slate-200 group-hover:text-blue-300 font-sans truncate ${isSelected ? 'text-blue-200 font-medium' : ''}`}>{entry.name}</span>
      </div>
      <div className="col-span-2 text-right text-slate-500 text-[11px]">
        {entry.kind === 'directory' || entry.name === '..' ? 'Folder' : (entry as any).size ? `${(entry as any).size} B` : '—'}
      </div>
      <div className="col-span-4 text-right text-slate-400 text-[11px]">
        {entry.modified ? new Date(entry.modified).toLocaleString() : (entry.name === '..' ? 'Parent Directory' : '')}
      </div>
    </div>
  );
}

function FileRowRemote({ entry, selected, onSelect, onNavigate, showHidden, viewMode, viewScale }: {
  entry: FileEntry;
  selected: FileEntry[];
  onSelect: (entry: FileEntry, event: React.MouseEvent) => void;
  onNavigate: (entry: FileEntry) => void;
  showHidden: boolean;
  viewMode: ListingViewMode;
  viewScale: number;
}) {
  const isSelected = selected.some(item => item.name === entry.name);
  const handleClick = (e: React.MouseEvent) => onSelect(entry, e);
  const handleDoubleClick = () => {
    if (entry.kind === 'directory' || entry.kind === 'symlink' || entry.name === '..') {
      onNavigate(entry);
    }
  };

  const icon = entry.name === '..' ? (
    <svg className="w-4 h-4 text-emerald-400/80 group-hover:text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
  ) : entry.kind === 'directory' ? (
    <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>
  ) : entry.name === 'Dockerfile' ? (
    <svg className="w-4 h-4 text-cyan-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
  ) : entry.name.endsWith('.yml') || entry.name.endsWith('.yaml') ? (
    <svg className="w-4 h-4 text-rose-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
  ) : entry.name.endsWith('.js') || entry.name.endsWith('.bundle.js') ? (
    <svg className="w-4 h-4 text-yellow-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
  ) : entry.name.endsWith('.tar.gz') || entry.name.endsWith('.zip') ? (
    <svg className="w-4 h-4 text-purple-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
  ) : entry.name.startsWith('.') ? (
    <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
  ) : (
    <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
  );

  const perms = (entry as any).perms || 'rw-r--r--';

  return (
    <div className={`grid grid-cols-12 px-3 py-1.5 items-center hover:bg-app-rowHover cursor-pointer group ${isSelected ? 'bg-blue-900/30 border-l-2 border-blue-500 hover:bg-blue-900/40' : ''} ${entry.name.startsWith('.') ? 'bg-slate-900/40' : ''}`} onClick={handleClick} onDoubleClick={handleDoubleClick}>
      <div className="col-span-5 flex items-center space-x-2 truncate">
        <input
          className="rounded border-slate-700 bg-slate-900 text-blue-600 w-3 h-3"
          type="checkbox"
          checked={isSelected}
          onChange={(e) => { e.stopPropagation(); onSelect(entry, e as any); }}
          onClick={(e) => e.stopPropagation()}
        />
        {icon}
        <span className={`text-slate-200 group-hover:text-emerald-300 font-sans truncate ${isSelected ? 'text-blue-200 font-medium' : ''}`}>{entry.name}</span>
      </div>
      <div className="col-span-2 text-right text-slate-500 text-[11px]">
        {entry.kind === 'directory' || entry.name === '..' ? 'Folder' : (entry as any).size ? `${(entry as any).size} B` : '—'}
      </div>
      <div className="col-span-2 text-center text-slate-400 text-[11px]">
        {entry.kind === 'directory' || entry.name === '..' ? (perms.startsWith('drwx') ? 'drwxr-xr-x' : 'drwxrwxr-x') : (perms.startsWith('rw-r') ? 'rw-r--r--' : perms)}
      </div>
      <div className="col-span-3 text-right text-slate-400 text-[11px]">
        {entry.modified ? new Date(entry.modified).toLocaleString() : (entry.name === '..' ? 'Parent Directory' : '')}
      </div>
    </div>
  );
}

function PanelLocal({ listing, selected, showHidden, onSelect, onNavigate, onUp, viewMode, viewScale, onViewScaleChange }: {
  listing: Listing | null;
  selected: FileEntry[];
  showHidden: boolean;
  onSelect: (entries: FileEntry[]) => void;
  onNavigate: (e: FileEntry) => void;
  onUp: () => void;
  viewMode: ListingViewMode;
  viewScale: number;
  onViewScaleChange: (scale: number) => void;
}) {
  const [sort, setSort] = useState<{ key: 'name' | 'modified'; direction: 1 | -1 }>({ key: 'name', direction: 1 });
  const [anchor, setAnchor] = useState('');
  // Leaving a directory abandons its thumbnails so they stop downloading in the background.
  useEffect(() => {
    const path = listing?.path ?? '';
    if (!path) return;
    const scope = thumbScopeKey(true, '', path);
    return () => cancelThumbScope(scope);
  }, [listing?.path]);
  const zoomRef = useCtrlWheelZoom(viewScale, onViewScaleChange, viewMode !== 'details');
  const iconEdge = Math.round(32 * viewScale);
  const thumbEdge = Math.round(48 * viewScale);
  const iconTileMin = Math.round(88 * viewScale);
  const thumbTileMin = Math.round(132 * viewScale);
  const labelSize = Math.round(12 * Math.min(viewScale, 1.6));

  const entries = useMemo(() => {
    return listing?.entries.filter(entry => showHidden || !isHidden(entry.name)).slice().sort((a, b) => {
      if (sort.key === 'name') {
        const directoryOrder = (a.kind === 'directory' ? 0 : 1) - (b.kind === 'directory' ? 0 : 1);
        if (directoryOrder) return sort.direction * directoryOrder;
        return sort.direction * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }
      const dateOrder = (a.modified ?? '').localeCompare(b.modified ?? '');
      return dateOrder ? sort.direction * dateOrder : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }, [listing, sort, showHidden]);

  const toggle = (key: 'name' | 'modified') => setSort(current => current.key === key ? { key, direction: current.direction === 1 ? -1 : 1 } : { key, direction: 1 });

  const select = (entry: FileEntry, event: React.MouseEvent) => {
    if (event.shiftKey && entries) {
      const anchorIndex = entries.findIndex(item => item.name === anchor);
      const entryIndex = entries.findIndex(item => item.name === entry.name);
      if (anchorIndex >= 0 && entryIndex >= 0) {
        const start = Math.min(anchorIndex, entryIndex);
        const end = Math.max(anchorIndex, entryIndex);
        onSelect(entries.slice(start, end + 1));
        return;
      }
    }
    setAnchor(entry.name);
    onSelect([entry]);
  };

  const canGoUp = !!listing && listing.path !== '' && listing.path !== '/' && !/^[A-Za-z]:[\\/]*$/.test(listing.path) && listing.path !== '~';

  return (
    <div ref={zoomRef} className="flex-1 flex flex-col bg-app-surface rounded-lg border border-app-border shadow-lg overflow-hidden">
      <div className="bg-app-card px-3 py-2 border-b border-app-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
            Local
          </span>
          <div className="h-3 w-[1px] bg-slate-700"></div>
          <div className="flex items-center space-x-1 text-xs font-mono bg-slate-900/80 px-2 py-1 rounded border border-slate-800/80 text-slate-300 flex-1 max-w-md truncate">
            {listing?.path.split(/[\\/]/).filter(p => p).map((part, index) => {
              return (
                <React.Fragment key={index}>
                  {index > 0 && <span className="text-slate-600">/</span>}
                  <span>{part}</span>
                </React.Fragment>
              );
            })}
          </div>
        </div>
        <div className="flex items-center space-x-2 flex-shrink-0">
          <button className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors" title="Go up to parent folder" onClick={onUp} disabled={!canGoUp}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 10l7-7m0 0l7 7m-7-7v18" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
          </button>
        </div>
      </div>
      {viewMode === 'details' && (
        <>
          <div className="grid grid-cols-12 bg-app-base/70 text-[11px] font-medium text-slate-400 px-3 py-1.5 border-b border-app-border select-none">
            <div className="col-span-6 flex items-center space-x-1 cursor-pointer hover:text-slate-200" onClick={() => toggle('name')}>
              <span>Name</span>
              <svg className={`w-3 h-3 ${sort.key === 'name' && sort.direction === 1 ? 'text-blue-400' : 'text-slate-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 15l7-7 7 7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
              <svg className={`w-3 h-3 ${sort.key === 'name' && sort.direction === -1 ? 'text-blue-400' : 'text-slate-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
            </div>
            <div className="col-span-2 text-right">Size</div>
            <div className="col-span-4 text-right pr-2">Date Modified</div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/30 font-mono text-xs">
            {canGoUp && (
              <FileRowLocal entry={{ name: '..', kind: 'directory', modified: '' } as FileEntry} selected={selected} onSelect={select} onNavigate={onNavigate} showHidden={showHidden} viewMode={viewMode} viewScale={viewScale} />
            )}
            {entries?.map(e => <FileRowLocal key={e.name} entry={e} selected={selected} onSelect={select} onNavigate={onNavigate} showHidden={showHidden} viewMode={viewMode} viewScale={viewScale} />)}
          </div>
        </>
      )}
      {viewMode === 'icons' && (
        <div className="flex-1 overflow-y-auto p-3 grid content-start gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${iconTileMin}px, 1fr))` }}>
          {canGoUp && (
            <div className="flex flex-col items-center p-2 rounded hover:bg-app-rowHover cursor-pointer group" onDoubleClick={() => onNavigate({ name: '..', kind: 'directory', modified: '' } as FileEntry)}>
              <svg className="text-blue-400/80 group-hover:text-blue-300 mb-1" style={{ width: iconEdge, height: iconEdge }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
              <span className="text-slate-200 group-hover:text-blue-300 text-center truncate w-full" style={{ fontSize: labelSize }}>..</span>
            </div>
          )}
          {entries?.map(e => (
            <div key={e.name} className="flex flex-col items-center p-2 rounded hover:bg-app-rowHover cursor-pointer group" onClick={(ev) => select(e, ev as any)} onDoubleClick={() => onNavigate(e)}>
              {e.kind === 'directory' ? (
                <svg className="text-amber-400 mb-1" style={{ width: iconEdge, height: iconEdge }} fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>
              ) : e.kind === 'symlink' ? (
                <svg className="text-cyan-400 mb-1" style={{ width: iconEdge, height: iconEdge }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
              ) : (
                <svg className="text-slate-400 mb-1" style={{ width: iconEdge, height: iconEdge }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
              )}
              <span className={`text-slate-200 group-hover:text-blue-300 text-center truncate w-full ${selected.some(item => item.name === e.name) ? 'text-blue-200 font-medium' : ''}`} style={{ fontSize: labelSize }}>{e.name}</span>
            </div>
          ))}
        </div>
      )}
      {viewMode === 'thumbnails' && (
        <div className="flex-1 overflow-y-auto p-3 grid content-start gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbTileMin}px, 1fr))` }}>
          {canGoUp && (
            <div className="flex flex-col items-center p-2 rounded hover:bg-app-rowHover cursor-pointer group" onDoubleClick={() => onNavigate({ name: '..', kind: 'directory', modified: '' } as FileEntry)}>
              <svg className="text-blue-400/80 group-hover:text-blue-300 mb-1" style={{ width: thumbEdge, height: thumbEdge }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
              <span className="text-slate-200 group-hover:text-blue-300 text-center truncate w-full" style={{ fontSize: labelSize }}>..</span>
            </div>
          )}
          {entries?.map(e => (
            <div key={e.name} className="flex flex-col items-center p-2 rounded hover:bg-app-rowHover cursor-pointer group" onClick={(ev) => select(e, ev as any)} onDoubleClick={() => onNavigate(e)}>
              {isThumbnailCandidate(e.name, e.size, e.kind) ? (
                <EntryThumbnail entry={e} path={listing?.path || ''} isLocal={true} cacheDir=".thumb-cache-local" scope={thumbScopeKey(true, '', listing?.path || '')} edge={thumbEdge} fallbackIcon="file" />
              ) : e.kind === 'directory' ? (
                <svg className="text-amber-400 mb-1" style={{ width: thumbEdge, height: thumbEdge }} fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>
              ) : e.kind === 'symlink' ? (
                <svg className="text-cyan-400 mb-1" style={{ width: thumbEdge, height: thumbEdge }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
              ) : (
                <svg className="text-slate-400 mb-1" style={{ width: thumbEdge, height: thumbEdge }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
              )}
              <span className={`text-slate-200 group-hover:text-blue-300 text-center truncate w-full ${selected.some(item => item.name === e.name) ? 'text-blue-200 font-medium' : ''}`} style={{ fontSize: labelSize }}>{e.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PanelRemote({ listing, selected, showHidden, onSelect, onNavigate, onUp, viewMode, viewScale, onViewScaleChange, target }: {
  listing: Listing | null;
  selected: FileEntry[];
  showHidden: boolean;
  onSelect: (entries: FileEntry[]) => void;
  onNavigate: (e: FileEntry) => void;
  onUp: () => void;
  viewMode: ListingViewMode;
  viewScale: number;
  onViewScaleChange: (scale: number) => void;
  target: string;
}) {
  const [sort, setSort] = useState<{ key: 'name' | 'modified'; direction: 1 | -1 }>({ key: 'name', direction: 1 });
  const [anchor, setAnchor] = useState('');
  // Leaving a directory abandons its thumbnails so they stop downloading in the background.
  useEffect(() => {
    const path = listing?.path ?? '';
    if (!path) return;
    const scope = thumbScopeKey(false, target, path);
    return () => cancelThumbScope(scope);
  }, [listing?.path, target]);
  const zoomRef = useCtrlWheelZoom(viewScale, onViewScaleChange, viewMode !== 'details');
  const iconEdge = Math.round(32 * viewScale);
  const thumbEdge = Math.round(48 * viewScale);
  const iconTileMin = Math.round(88 * viewScale);
  const thumbTileMin = Math.round(132 * viewScale);
  const labelSize = Math.round(12 * Math.min(viewScale, 1.6));

  const entries = useMemo(() => {
    return listing?.entries.filter(entry => showHidden || !isHidden(entry.name)).slice().sort((a, b) => {
      if (sort.key === 'name') {
        const directoryOrder = (a.kind === 'directory' ? 0 : 1) - (b.kind === 'directory' ? 0 : 1);
        if (directoryOrder) return sort.direction * directoryOrder;
        return sort.direction * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }
      const dateOrder = (a.modified ?? '').localeCompare(b.modified ?? '');
      return dateOrder ? sort.direction * dateOrder : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }, [listing, sort, showHidden]);

  const toggle = (key: 'name' | 'modified') => setSort(current => current.key === key ? { key, direction: current.direction === 1 ? -1 : 1 } : { key, direction: 1 });

  const select = (entry: FileEntry, event: React.MouseEvent) => {
    if (event.shiftKey && entries) {
      const anchorIndex = entries.findIndex(item => item.name === anchor);
      const entryIndex = entries.findIndex(item => item.name === entry.name);
      if (anchorIndex >= 0 && entryIndex >= 0) {
        const start = Math.min(anchorIndex, entryIndex);
        const end = Math.max(anchorIndex, entryIndex);
        onSelect(entries.slice(start, end + 1));
        return;
      }
    }
    setAnchor(entry.name);
    onSelect([entry]);
  };

  const canGoUp = !!listing && listing.path !== '' && listing.path !== '/' && listing.path !== '~';

  return (
    <div ref={zoomRef} className="flex-1 flex flex-col bg-app-surface rounded-lg border border-app-border shadow-lg overflow-hidden">
      <div className="bg-app-card px-3 py-2 border-b border-app-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
            Remote
          </span>
          <div className="h-3 w-[1px] bg-slate-700"></div>
          <div className="flex items-center space-x-1 text-xs font-mono bg-slate-900/80 px-2 py-1 rounded border border-slate-800/80 text-slate-300 flex-1 max-w-md truncate">
            {listing?.path.split('/').filter(p => p).map((part, index) => {
              return (
                <React.Fragment key={index}>
                  {index > 0 && <span className="text-slate-600">/</span>}
                  <span>{part}</span>
                </React.Fragment>
              );
            })}
          </div>
        </div>
        <div className="flex items-center space-x-2 flex-shrink-0">
          <button className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors" title="Go up to parent folder" onClick={onUp} disabled={!canGoUp}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 10l7-7m0 0l7 7m-7-7v18" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
          </button>
        </div>
      </div>
      {viewMode === 'details' && (
        <>
          <div className="grid grid-cols-12 bg-app-base/70 text-[11px] font-medium text-slate-400 px-3 py-1.5 border-b border-app-border select-none">
            <div className="col-span-5 flex items-center space-x-1 cursor-pointer hover:text-slate-200" onClick={() => toggle('name')}>
              <span>Name</span>
              <svg className={`w-3 h-3 ${sort.key === 'name' && sort.direction === 1 ? 'text-blue-400' : 'text-slate-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 15l7-7 7 7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
              <svg className={`w-3 h-3 ${sort.key === 'name' && sort.direction === -1 ? 'text-blue-400' : 'text-slate-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
            </div>
            <div className="col-span-2 text-right">Size</div>
            <div className="col-span-2 text-center">Perms</div>
            <div className="col-span-3 text-right pr-2">Date Modified</div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/30 font-mono text-xs">
            {canGoUp && (
              <FileRowRemote entry={{ name: '..', kind: 'directory', modified: '' } as FileEntry} selected={selected} onSelect={select} onNavigate={onNavigate} showHidden={showHidden} viewMode={viewMode} viewScale={viewScale} />
            )}
            {entries?.map(e => <FileRowRemote key={e.name} entry={e} selected={selected} onSelect={select} onNavigate={onNavigate} showHidden={showHidden} viewMode={viewMode} viewScale={viewScale} />)}
          </div>
        </>
      )}
      {viewMode === 'icons' && (
        <div className="flex-1 overflow-y-auto p-3 grid content-start gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${iconTileMin}px, 1fr))` }}>
          {canGoUp && (
            <div className="flex flex-col items-center p-2 rounded hover:bg-app-rowHover cursor-pointer group" onDoubleClick={() => onNavigate({ name: '..', kind: 'directory', modified: '' } as FileEntry)}>
              <svg className="text-blue-400/80 group-hover:text-blue-300 mb-1" style={{ width: iconEdge, height: iconEdge }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
              <span className="text-slate-200 group-hover:text-blue-300 text-center truncate w-full" style={{ fontSize: labelSize }}>..</span>
            </div>
          )}
          {entries?.map(e => (
            <div key={e.name} className="flex flex-col items-center p-2 rounded hover:bg-app-rowHover cursor-pointer group" onClick={(ev) => select(e, ev as any)} onDoubleClick={() => onNavigate(e)}>
              {e.kind === 'directory' ? (
                <svg className="text-amber-400 mb-1" style={{ width: iconEdge, height: iconEdge }} fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>
              ) : e.kind === 'symlink' ? (
                <svg className="text-cyan-400 mb-1" style={{ width: iconEdge, height: iconEdge }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
              ) : (
                <svg className="text-slate-400 mb-1" style={{ width: iconEdge, height: iconEdge }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
              )}
              <span className={`text-slate-200 group-hover:text-blue-300 text-center truncate w-full ${selected.some(item => item.name === e.name) ? 'text-blue-200 font-medium' : ''}`} style={{ fontSize: labelSize }}>{e.name}</span>
            </div>
          ))}
        </div>
      )}
      {viewMode === 'thumbnails' && (
        <div className="flex-1 overflow-y-auto p-3 grid content-start gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbTileMin}px, 1fr))` }}>
          {canGoUp && (
            <div className="flex flex-col items-center p-2 rounded hover:bg-app-rowHover cursor-pointer group" onDoubleClick={() => onNavigate({ name: '..', kind: 'directory', modified: '' } as FileEntry)}>
              <svg className="text-blue-400/80 group-hover:text-blue-300 mb-1" style={{ width: thumbEdge, height: thumbEdge }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
              <span className="text-slate-200 group-hover:text-blue-300 text-center truncate w-full" style={{ fontSize: labelSize }}>..</span>
            </div>
          )}
          {entries?.map(e => (
            <div key={e.name} className="flex flex-col items-center p-2 rounded hover:bg-app-rowHover cursor-pointer group" onClick={(ev) => select(e, ev as any)} onDoubleClick={() => onNavigate(e)}>
              {isThumbnailCandidate(e.name, e.size, e.kind) ? (
                <EntryThumbnail entry={e} path={listing?.path || ''} isLocal={false} target={target} cacheDir=".thumb-cache-remote" scope={thumbScopeKey(false, target, listing?.path || '')} edge={thumbEdge} fallbackIcon="file" />
              ) : e.kind === 'directory' ? (
                <svg className="text-amber-400 mb-1" style={{ width: thumbEdge, height: thumbEdge }} fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>
              ) : e.kind === 'symlink' ? (
                <svg className="text-cyan-400 mb-1" style={{ width: thumbEdge, height: thumbEdge }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
              ) : (
                <svg className="text-slate-400 mb-1" style={{ width: thumbEdge, height: thumbEdge }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
              )}
              <span className={`text-slate-200 group-hover:text-blue-300 text-center truncate w-full ${selected.some(item => item.name === e.name) ? 'text-blue-200 font-medium' : ''}`} style={{ fontSize: labelSize }}>{e.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Renderer error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-app-base text-slate-200 p-6">
          <div className="w-full max-w-lg bg-app-surface border border-app-border rounded-xl p-5 shadow-2xl">
            <h1 className="text-sm font-semibold text-rose-300 mb-2">Something went wrong</h1>
            <pre className="text-xs font-mono whitespace-pre-wrap text-slate-400 bg-app-card p-3 rounded border border-app-border max-h-64 overflow-auto">{this.state.error.message}</pre>
            <div className="flex justify-end gap-2 mt-4">
              <button className="px-3 py-1.5 rounded bg-app-card hover:bg-slate-800 border border-app-border text-xs" onClick={() => this.setState({ error: null })}>Try again</button>
              <button className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium" onClick={() => window.location.reload()}>Reload</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [profiles, setProfiles] = useState<SshProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [manual, setManual] = useState('');
  const [target, setTarget] = useState('');
  const [local, setLocal] = useState<Listing | null>(null);
  const [remote, setRemote] = useState<Listing | null>(null);
  const [localSelected, setLocalSelected] = useState<FileEntry[]>([]);
  const [remoteSelected, setRemoteSelected] = useState<FileEntry[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [authPrompt, setAuthPrompt] = useState<{ kind: string; message: string } | null>(null);
  const [answer, setAnswer] = useState('');
  const [progress, setProgress] = useState<{ operation: string; percent: number; detail: string } | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [localViewMode, setLocalViewMode] = useState<ListingViewMode>('details');
  const [remoteViewMode, setRemoteViewMode] = useState<ListingViewMode>('details');
  const [localViewScale, setLocalViewScale] = useState<number>(1);
  const [remoteViewScale, setRemoteViewScale] = useState<number>(1);
  const [dialog, setDialog] = useState<{ kind: 'rename' | 'remove'; name: string; value: string; kind2: string } | null>(null);

  useEffect(() => {
    void window.sftp.listProfiles().then(items => {
      setProfiles(items);
      if (items[0]) setSelectedProfile(items[0].alias);
    });
    void window.sftp.listLocal().then(setLocal).catch(e => setError(String((e as Error).message ?? e)));
  }, []);

  useEffect(() => window.sftp.onPrompt(p => { setAuthPrompt(p); setAnswer(''); }), []);
  useEffect(() => window.sftp.onProgress(setProgress), []);

  const profile = useMemo(() => profiles.find(p => p.alias === selectedProfile), [profiles, selectedProfile]);
  const connectTarget = profile ? profileTarget(profile) : manual.trim();

  const fail = (e: unknown) => setError(String((e as Error).message ?? e));

  async function connect() {
    setError('');
    setBusy(true);
    try {
      setTarget(connectTarget);
      setRemote(await window.sftp.listRemote(connectTarget));
      setStatus(`Connected to ${connectTarget}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function refreshRemote() {
    if (target && remote) setRemote(await window.sftp.listRemote(target, remote.path));
  }

  async function refreshLocal() {
    if (local) setLocal(await window.sftp.listLocal(local.path));
  }

  function localParent(path: string) {
    const normalized = path.replace(/[\\/]$/, '');
    const root = normalized.match(/^[A-Za-z]:[\\/]?$/) ? normalized.slice(0, 2) + '\\' : normalized.match(/^[\\/]\\?$/) ? normalized : normalized.replace(/[\\/][^\\/]*$/, '') || normalized;
    return root;
  }

  function remoteParent(path: string) {
    const normalized = path.replace(/\/$/, '');
    if (normalized === '~' || normalized === '/') return normalized;
    const parent = normalized.replace(/\/[^/]*$/, '');
    return parent || '/';
  }

  async function localNav(e: FileEntry) {
    if (!local) return;
    try {
      setLocal(await window.sftp.listLocal(local.path.replace(/[\\/]$/, '') + '\\' + e.name));
      setLocalSelected([]);
    } catch (e) {
      fail(e);
    }
  }

  async function localUp() {
    if (!local) return;
    try {
      setLocal(await window.sftp.listLocal(localParent(local.path)));
      setLocalSelected([]);
    } catch (e) {
      fail(e);
    }
  }

  async function remoteNav(e: FileEntry) {
    if (!remote || !target) return;
    try {
      setRemote(await window.sftp.listRemote(target, remote.path.replace(/\/$/, '') + '/' + e.name));
      setRemoteSelected([]);
    } catch (e) {
      fail(e);
    }
  }

  async function remoteUp() {
    if (!remote || !target) return;
    try {
      setRemote(await window.sftp.listRemote(target, remoteParent(remote.path)));
      setRemoteSelected([]);
    } catch (e) {
      fail(e);
    }
  }

  function remoteAction(action: 'mkdir' | 'rename' | 'remove') {
    if (!target || !remote) return;
    const selected = remoteSelected[0];
    if (action === 'mkdir') {
      setDialog({ kind: 'rename', name: '', value: '', kind2: 'mkdir' });
      return;
    }
    if (action === 'rename' && selected) {
      setDialog({ kind: 'rename', name: selected.name, value: selected.name, kind2: 'rename' });
      return;
    }
    if (action === 'remove' && selected) {
      setDialog({ kind: 'remove', name: selected.name, value: '', kind2: selected.kind });
      return;
    }
  }

  async function submitDialog() {
    if (!target || !remote || !dialog) return;
    const current = dialog;
    if (current.kind === 'remove') {
      setDialog(null);
      try {
        await window.sftp.remove(target, remote.path + '/' + current.name, current.kind2);
        setStatus(`Deleted ${current.name}`);
        await refreshRemote();
        setRemoteSelected([]);
      } catch (e) {
        fail(e);
      }
    } else {
      const name = current.value.trim();
      if (!name) return;
      if (current.kind2 === 'rename' && name === current.name) {
        setDialog(null);
        return;
      }
      setDialog(null);
      try {
        if (current.kind2 === 'mkdir') {
          await window.sftp.mkdir(target, remote.path + '/' + name);
          setStatus(`Created ${name}`);
        } else {
          await window.sftp.rename(target, remote.path + '/' + current.name, remote.path + '/' + name);
          setStatus(`Renamed ${current.name}`);
        }
        await refreshRemote();
        setRemoteSelected([]);
      } catch (e) {
        fail(e);
      }
    }
  }

  async function transfer(direction: 'upload' | 'download') {
    if (!target || !local || !remote) return;
    const items = direction === 'upload' ? localSelected : remoteSelected;
    if (!items.length) return;
    setBusy(true);
    setError('');
    try {
      for (const [index, item] of items.entries()) {
        setStatus(`${direction === 'upload' ? 'Uploading' : 'Downloading'} ${index + 1}/${items.length}: ${item.name}`);
        if (direction === 'upload') await window.sftp.upload(target, local.path + '\\' + item.name, remote.path, item.kind);
        else await window.sftp.download(target, remote.path + '/' + item.name, local.path, item.kind);
      }
      setStatus(`${direction === 'upload' ? 'Uploaded' : 'Downloaded'} ${items.length} item${items.length === 1 ? '' : 's'}`);
      await refreshLocal();
      await refreshRemote();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-app-base text-slate-200 font-sans antialiased h-screen flex flex-col overflow-hidden">
      {/* Window Title Bar */}
      <header className="h-9 bg-[#080b12] border-b border-app-border/80 flex items-center justify-between px-3 select-none flex-shrink-0 z-40" data-purpose="desktop-titlebar">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <svg className="w-4 h-4 text-blue-500 fill-current" viewBox="0 0 24 24">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
            </svg>
            <span className="text-xs font-semibold tracking-wider text-slate-100">ZeroG <span className="text-blue-400 font-normal">SFTP</span></span>
          </div>
          <div className="h-3 w-[1px] bg-slate-700/60"></div>
          <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-[11px] text-emerald-400 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>{target ? `Connected: ${target}` : 'Not Connected'}</span>
            <span className="text-emerald-600 font-sans">|</span>
            <span className="text-slate-400">{busy ? 'Connecting...' : 'Ready'}</span>
          </div>
        </div>
        <div className="flex items-center -mr-3 text-slate-400 h-full">
          <button className="h-full px-3.5 hover:bg-slate-800/80 transition-colors flex items-center justify-center" title="Minimize">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M20 12H4" strokeLinecap="round" strokeWidth="2"></path></svg>
          </button>
          <button className="h-full px-3.5 hover:bg-slate-800/80 transition-colors flex items-center justify-center" title="Maximize / Restore">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" strokeLinecap="round" strokeWidth="2"></path></svg>
          </button>
          <button className="h-full px-4 hover:bg-rose-600 hover:text-white transition-colors flex items-center justify-center" title="Close" onClick={() => window.close()}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeWidth="2"></path></svg>
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-app-base">
        {/* Quick Connect Toolbar */}
        <section className="px-4 py-2.5 bg-app-surface/90 border-b border-app-border flex flex-wrap items-center justify-between gap-3 flex-shrink-0" data-purpose="connection-bar">
          <div className="flex items-center space-x-2 flex-1 max-w-4xl">
            <div className="relative w-80">
              <div className="flex items-center bg-app-card border border-app-border rounded-md px-3 py-1.5 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all shadow-inner">
                <svg className="w-4 h-4 text-blue-400 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                </svg>
                <select className="w-full bg-transparent border-0 p-0 text-xs font-mono text-slate-200 focus:ring-0 cursor-pointer" value={selectedProfile} onChange={e => setSelectedProfile(e.target.value)}>
                  <option className="bg-slate-900 text-slate-200" value="">Manual connection</option>
                  {profiles.map(p => <option className="bg-slate-900 text-slate-200" key={p.alias} value={p.alias}>{p.alias}{p.hostName ? ` — ${p.user ? `${p.user}@` : ''}${p.hostName}` : ''}</option>)}
                </select>
              </div>
            </div>
            <div className="relative flex-1">
              <input className="w-full bg-app-card border border-app-border rounded-md px-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-inner" placeholder="user@host:port or ~/.ssh/config alias" type="text" value={manual} onChange={e => setManual(e.target.value)} disabled={!!profile} />
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-medium tracking-wide flex items-center space-x-1.5 transition-all shadow-md hover:shadow-blue-500/20 active:translate-y-px" onClick={() => void connect()} disabled={busy || !connectTarget}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
              <span>{busy ? 'Connecting...' : 'Reconnect'}</span>
            </button>
            <button className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 rounded-md text-xs font-medium transition-colors flex items-center space-x-1" onClick={() => { setTarget(''); setRemote(null); setStatus('Disconnected'); }}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
              <span>Disconnect</span>
            </button>
          </div>
        </section>

        {/* Command Toolbar */}
        <section className="px-4 py-2 bg-app-base border-b border-app-border flex items-center justify-between text-xs flex-shrink-0" data-purpose="app-action-bar">
          <div className="flex items-center space-x-1.5">
            <button className="flex items-center space-x-1 px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 rounded transition-all" onClick={() => void transfer('upload')} disabled={!localSelected.length || !remote || busy || !!progress}>
              <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
              <span>Upload selected →</span>
            </button>
            <button className="flex items-center space-x-1 px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 rounded transition-all" onClick={() => void transfer('download')} disabled={!remoteSelected.length || !local || busy || !!progress}>
              <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
              <span>← Download selected</span>
            </button>
            <div className="h-4 w-[1px] bg-slate-800 mx-1"></div>
            <button className="flex items-center space-x-1 px-2.5 py-1 bg-app-card hover:bg-app-cardActive text-slate-300 border border-app-border rounded transition-colors" onClick={() => void remoteAction('mkdir')} disabled={!remote || busy || !!progress}>
              <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
              <span>New remote folder</span>
            </button>
            <button className="flex items-center space-x-1 px-2.5 py-1 bg-app-card hover:bg-app-cardActive text-slate-300 border border-app-border rounded transition-colors" onClick={() => void remoteAction('rename')} disabled={remoteSelected.length !== 1 || busy || !!progress}>
              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
              <span>Rename</span>
            </button>
            <button className="flex items-center space-x-1 px-2.5 py-1 bg-app-card hover:bg-rose-950/40 text-slate-300 hover:text-rose-300 border border-app-border rounded transition-colors" onClick={() => void remoteAction('remove')} disabled={remoteSelected.length !== 1 || busy || !!progress}>
              <svg className="w-3.5 h-3.5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
              <span>Delete</span>
            </button>
            <div className="h-4 w-[1px] bg-slate-800 mx-1"></div>
            <div className="flex items-center space-x-1 bg-app-card border border-app-border rounded px-2 py-1">
              <span className="text-slate-400 text-[10px]">Local:</span>
              <ViewModeToggle mode={localViewMode} onChange={setLocalViewMode} />
              {localViewMode !== 'details' && (
                <>
                  <div className="h-3 w-[1px] bg-slate-700 mx-0.5"></div>
                  <button className="px-1.5 py-0.5 text-[10px] rounded text-slate-300 hover:bg-slate-700 disabled:opacity-40" title="Zoom out (Ctrl + mouse wheel)" onClick={() => setLocalViewScale(scale => clampViewScale(scale / 1.1))} disabled={localViewScale <= MIN_VIEW_SCALE}>−</button>
                  <span className="text-slate-400 text-[10px] w-8 text-center tabular-nums" title="Ctrl + mouse wheel to zoom">{Math.round(localViewScale * 100)}%</span>
                  <button className="px-1.5 py-0.5 text-[10px] rounded text-slate-300 hover:bg-slate-700 disabled:opacity-40" title="Zoom in (Ctrl + mouse wheel)" onClick={() => setLocalViewScale(scale => clampViewScale(scale * 1.1))} disabled={localViewScale >= MAX_VIEW_SCALE}>+</button>
                </>
              )}
            </div>
            <div className="flex items-center space-x-1 bg-app-card border border-app-border rounded px-2 py-1 ml-2">
              <span className="text-slate-400 text-[10px]">Remote:</span>
              <ViewModeToggle mode={remoteViewMode} onChange={setRemoteViewMode} />
              {remoteViewMode !== 'details' && (
                <>
                  <div className="h-3 w-[1px] bg-slate-700 mx-0.5"></div>
                  <button className="px-1.5 py-0.5 text-[10px] rounded text-slate-300 hover:bg-slate-700 disabled:opacity-40" title="Zoom out (Ctrl + mouse wheel)" onClick={() => setRemoteViewScale(scale => clampViewScale(scale / 1.1))} disabled={remoteViewScale <= MIN_VIEW_SCALE}>−</button>
                  <span className="text-slate-400 text-[10px] w-8 text-center tabular-nums" title="Ctrl + mouse wheel to zoom">{Math.round(remoteViewScale * 100)}%</span>
                  <button className="px-1.5 py-0.5 text-[10px] rounded text-slate-300 hover:bg-slate-700 disabled:opacity-40" title="Zoom in (Ctrl + mouse wheel)" onClick={() => setRemoteViewScale(scale => clampViewScale(scale * 1.1))} disabled={remoteViewScale >= MAX_VIEW_SCALE}>+</button>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2 cursor-pointer text-slate-400 hover:text-slate-200">
              <input checked={showHidden} className="rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5" type="checkbox" onChange={e => setShowHidden(e.target.checked)} />
              <span className="text-xs">Show hidden files</span>
            </label>
            <button className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors" title="Refresh directories" onClick={async () => { await refreshLocal(); await refreshRemote(); }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
            </button>
          </div>
        </section>

        {/* Live Transfer Banner */}
        {progress && (
          <div className="bg-blue-950/40 border-b border-blue-900/60 px-4 py-2 flex items-center justify-between gap-4 text-xs" data-purpose="active-transfer-progress">
            <div className="flex items-center space-x-3 min-w-0 flex-1">
              <div className="p-1 rounded bg-blue-500/20 text-blue-400 animate-spin">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex justify-between items-center text-[11px] mb-1">
                  <span className="text-slate-200 font-mono truncate">{progress.operation}: {progress.detail}</span>
                  <span className="text-slate-400 font-mono">{progress.percent}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-500 to-cyan-400 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress.percent}%` }}></div>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded text-[11px]" onClick={() => void window.sftp.cancel()}>Cancel</button>
            </div>
          </div>
        )}

        {/* Dual Panel Explorer Area */}
        <main className="flex-1 flex min-h-0 overflow-hidden p-3 gap-2" data-purpose="two-panel-explorer">
          <PanelLocal listing={local} selected={localSelected} showHidden={showHidden} onSelect={setLocalSelected} onNavigate={e => void localNav(e)} onUp={() => void localUp()} viewMode={localViewMode} viewScale={localViewScale} onViewScaleChange={setLocalViewScale} />

          <div className="flex flex-col justify-center items-center space-y-2 px-1 flex-shrink-0" data-purpose="center-transfer-arrows">
            <button className="p-2.5 rounded-lg bg-app-card hover:bg-blue-600 text-slate-300 hover:text-white border border-app-border hover:border-blue-500 shadow-md transition-all active:scale-95 group" title="Upload selection to remote server" onClick={() => void transfer('upload')} disabled={!localSelected.length || !remote || busy || !!progress}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M14 5l7 7m0 0l-7 7m7-7H3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path></svg>
            </button>
            <button className="p-2.5 rounded-lg bg-app-card hover:bg-blue-600 text-slate-300 hover:text-white border border-app-border hover:border-blue-500 shadow-md transition-all active:scale-95 group" title="Download selection to local disk" onClick={() => void transfer('download')} disabled={!remoteSelected.length || !local || busy || !!progress}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M10 19l-7-7m0 0l7-7m-7 7h18" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path></svg>
            </button>
          </div>

          <PanelRemote listing={remote} selected={remoteSelected} showHidden={showHidden} onSelect={setRemoteSelected} onNavigate={e => void remoteNav(e)} onUp={() => void remoteUp()} viewMode={remoteViewMode} viewScale={remoteViewScale} onViewScaleChange={setRemoteViewScale} target={target} />
        </main>

        {/* Log Drawer and Status Bar */}
        <section className="flex-shrink-0 bg-app-surface border-t border-app-border" data-purpose="bottom-dock-status">
          <footer className="h-6 px-3 flex items-center justify-between text-[11px] text-slate-400 bg-app-surface select-none">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-1.5">
                <span className={`w-2 h-2 rounded-full ${target ? 'bg-emerald-400' : 'bg-slate-400'}`}></span>
                <span className="text-slate-300 font-medium">{target ? 'Connected' : 'Ready'}</span>
              </div>
              <span>SFTP Protocol v3</span>
              <span className="text-slate-600">|</span>
              <span>Transfers: <strong className="text-blue-400">{progress ? '1 active' : '0 active'}</strong>, <span className="text-slate-400">{localSelected.length + remoteSelected.length} selected</span></span>
            </div>
            <div className="flex items-center space-x-3 font-mono text-[10px]">
              <span className="text-slate-500">UTF-8</span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-400">OpenSSH</span>
            </div>
          </footer>
        </section>
      </div>

      {/* Authentication Prompt */}
      {authPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <form className="bg-app-surface border border-app-border rounded-xl shadow-2xl w-full max-w-md p-5 glow-accent" onSubmit={async e => {
            e.preventDefault();
            try {
              await window.sftp.answerPrompt(authPrompt.kind === 'host-key' ? 'yes' : answer);
              setAuthPrompt(null);
            } catch (err) {
              fail(err);
            }
          }}>
            <div className="flex items-center space-x-3 mb-3">
              <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-100">{authPrompt.kind === 'host-key' ? 'Verify host key' : 'Authentication required'}</h3>
              </div>
            </div>
            <pre className="bg-app-card p-3 rounded-md text-xs font-mono text-slate-300 mb-4 border border-app-border overflow-auto max-h-40">{authPrompt.message}</pre>
            {authPrompt.kind === 'host-key' ? (
              <p className="text-xs text-slate-400 mb-4">Only accept this key if you recognize the host and fingerprint.</p>
            ) : (
              <input autoFocus className="w-full bg-app-card border border-app-border rounded-md px-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-inner mb-4" type="password" value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Password or passphrase" />
            )}
            <div className="flex justify-end space-x-2 text-xs">
              <button type="button" className="px-3.5 py-1.5 rounded-md bg-app-card hover:bg-slate-800 text-slate-300 border border-app-border" onClick={() => { void window.sftp.answerPrompt('no'); setAuthPrompt(null); }}>Cancel</button>
              <button type="submit" className="px-3.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md">{authPrompt.kind === 'host-key' ? 'Accept' : 'Continue'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Action Dialog */}
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <form className="bg-app-surface border border-app-border rounded-xl shadow-2xl w-full max-w-md p-5 glow-accent" onSubmit={e => { e.preventDefault(); void submitDialog(); }}>
            <div className="flex items-center space-x-3 mb-3">
              <div className={`p-2 rounded-lg ${dialog.kind2 === 'mkdir' ? 'bg-amber-500/20 text-amber-400' : dialog.kind2 === 'rename' ? 'bg-blue-500/20 text-blue-400' : 'bg-rose-500/20 text-rose-400'}`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {dialog.kind2 === 'mkdir' && <path d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>}
                  {dialog.kind2 === 'rename' && <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>}
                  {dialog.kind === 'remove' && <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>}
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-100">{dialog.kind2 === 'mkdir' ? 'New remote folder' : dialog.kind2 === 'rename' ? 'Rename' : 'Delete'}</h3>
              </div>
            </div>
            {dialog.kind === 'remove' ? (
              <p className="text-xs text-slate-400 mb-4">Delete {dialog.name}? This cannot be undone.</p>
            ) : (
              <div className="bg-app-card p-3 rounded-md text-xs font-mono text-slate-300 mb-4 border border-app-border">
                <p>{dialog.kind2 === 'mkdir' ? 'Folder name' : 'New name'} for {dialog.kind2 === 'mkdir' ? '' : dialog.name}</p>
                <input autoFocus className="w-full bg-app-base border border-app-border rounded-md px-3 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-inner mt-2" value={dialog.value} onChange={e => setDialog({ ...dialog, value: e.target.value })} onKeyDown={e => { if (e.key === 'Escape') setDialog(null); }} placeholder={dialog.kind2 === 'mkdir' ? 'Folder name' : 'New name'} />
              </div>
            )}
            <div className="flex justify-end space-x-2 text-xs">
              <button type="button" className="px-3.5 py-1.5 rounded-md bg-app-card hover:bg-slate-800 text-slate-300 border border-app-border" onClick={() => setDialog(null)}>Cancel</button>
              <button type="submit" className="px-3.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md">{dialog.kind === 'remove' ? 'Delete' : dialog.kind2 === 'mkdir' ? 'Create' : 'Rename'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
