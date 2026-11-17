import React, { useEffect, useRef, useState } from 'react';
import {
  canOpenFavourite,
  favouriteLabel,
  favouritePlaceLabel,
  type FavouriteDirectory,
  type FavouritePlace,
  type StoredFavouriteFile,
} from '../shared/favourites.js';

type FavouritesControlProps = {
  place: FavouritePlace;
  currentPath: string | undefined;
  favourites: StoredFavouriteFile;
  remoteTarget: string;
  isFavourite: boolean;
  onToggle: (place: FavouritePlace, path: string) => void;
  onJump: (favourite: FavouriteDirectory) => void;
  onRemove: (favourite: FavouriteDirectory) => void;
};

export function FavouritesControl({
  place,
  currentPath,
  favourites,
  remoteTarget,
  isFavourite,
  onToggle,
  onJump,
  onRemove,
}: FavouritesControlProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleDocumentClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, [open]);

  const here = favourites.favourites.filter(favourite => canOpenFavourite(favourite, remoteTarget));
  const elsewhere = favourites.favourites.filter(favourite => !canOpenFavourite(favourite, remoteTarget));
  const starred = isFavourite && !!currentPath;

  const row = (favourite: FavouriteDirectory, blocked: string | null) => (
    <li key={favourite.id} className="flex items-center group">
      <button
        type="button"
        className="min-w-0 flex-1 px-3 py-1.5 text-left hover:bg-slate-800 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        disabled={!!blocked}
        title={blocked ?? `${favouritePlaceLabel(favourite)} · ${favourite.path}`}
        onClick={() => { onJump(favourite); setOpen(false); }}
      >
        <span className="block truncate text-xs text-slate-200 group-hover:text-blue-200">{favouriteLabel(favourite)}</span>
        <span className="block truncate font-mono text-[10px] text-slate-500">{favouritePlaceLabel(favourite)} · {favourite.path}</span>
      </button>
      <button
        type="button"
        className="mx-1 rounded p-1 text-slate-500 opacity-0 transition-opacity hover:bg-rose-900/40 hover:text-rose-300 group-hover:opacity-100"
        title={`Remove ${favourite.path} from favourites`}
        aria-label={`Remove ${favourite.path} from favourites`}
        onClick={() => onRemove(favourite)}
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
      </button>
    </li>
  );

  return (
    <div className="relative inline-flex" ref={rootRef}>
      <button
        type="button"
        className={`rounded border transition-colors ${starred ? 'border-amber-500/50 bg-amber-900/20 text-amber-300' : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-amber-300'} p-1 disabled:cursor-not-allowed disabled:opacity-40`}
        title={starred ? 'Remove this folder from favourites' : 'Add this folder to favourites'}
        aria-label={starred ? 'Remove this folder from favourites' : 'Add this folder to favourites'}
        aria-pressed={starred}
        disabled={!currentPath || place.kind === 'remote' && !place.target}
        onClick={() => currentPath && onToggle(place, currentPath)}
      >
        <svg className="h-3.5 w-3.5" fill={starred ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
      </button>
      <button
        type="button"
        className={`ml-1 rounded border transition-colors ${open ? 'border-blue-500/60 bg-blue-900/30 text-blue-200' : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-blue-300'} p-1`}
        title={`Favourite directories (${favourites.favourites.length})`}
        aria-label="Favourite directories"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-md border border-app-border bg-app-card py-1 shadow-xl" role="menu" aria-label="Favourite directories">
          {!favourites.favourites.length && (
            <p className="px-3 py-2 text-xs text-slate-500">No favourites yet. Use the star beside a directory path.</p>
          )}
          {here.length > 0 && <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Open now</p>}
          {here.map(favourite => row(favourite, null))}
          {elsewhere.length > 0 && <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Not connected</p>}
          {elsewhere.map(favourite => row(favourite, `Connect to ${favourite.target} before opening this favourite.`))}
        </div>
      )}
    </div>
  );
}
