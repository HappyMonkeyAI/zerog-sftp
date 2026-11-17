export type FavouritePlace =
  | { kind: 'local' }
  | { kind: 'remote'; target: string };

export type FavouriteDirectory = {
  id: string;
  path: string;
  added: string;
  place: 'local' | 'remote';
  target?: string;
};

export type StoredFavouriteFile = {
  version: 1;
  favourites: FavouriteDirectory[];
};

export const MAX_FAVOURITES = 100;
export const EMPTY_FAVOURITES: StoredFavouriteFile = { version: 1, favourites: [] };

function cleanPath(path: unknown, place: 'local' | 'remote'): string {
  if (typeof path !== 'string') return '';
  const value = path.trim();
  if (!value || value.length > 4096 || /[\0\r\n]/.test(value)) return '';
  if (place === 'remote') return value.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  const collapsed = value.replace(/[\\/]+/g, '\\');
  if (/^[A-Za-z]:\\?$/.test(collapsed)) return `${collapsed.slice(0, 1)}:\\`;
  return collapsed.replace(/\\+$/, '') || collapsed;
}

function samePath(left: string, right: string, place: 'local' | 'remote'): boolean {
  return place === 'local' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function normalizeEntry(value: unknown): FavouriteDirectory | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  if (item.place !== 'local' && item.place !== 'remote') return undefined;
  if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 128) return undefined;
  const path = cleanPath(item.path, item.place);
  if (!path) return undefined;
  const target = item.place === 'remote' && typeof item.target === 'string' ? item.target.trim() : '';
  if (item.place === 'remote' && (!target || target.length > 512 || /[\0\r\n]/.test(target))) return undefined;
  const added = typeof item.added === 'string' && !Number.isNaN(Date.parse(item.added)) ? item.added : new Date(0).toISOString();
  return {
    id: item.id.trim(),
    path,
    added,
    place: item.place,
    ...(item.place === 'remote' ? { target } : {}),
  };
}

export function normalizeFavouriteFile(value: unknown): StoredFavouriteFile | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || !Array.isArray(item.favourites)) return undefined;
  const favourites: FavouriteDirectory[] = [];
  const ids = new Set<string>();
  for (const raw of item.favourites) {
    const entry = normalizeEntry(raw);
    if (!entry || ids.has(entry.id)) continue;
    if (favourites.some(existing => existing.place === entry.place && existing.target === entry.target && samePath(existing.path, entry.path, entry.place))) continue;
    ids.add(entry.id);
    favourites.push(entry);
    if (favourites.length >= MAX_FAVOURITES) break;
  }
  return { version: 1, favourites };
}

export function findFavourite(file: StoredFavouriteFile, place: FavouritePlace, path: string): FavouriteDirectory | undefined {
  const cleaned = cleanPath(path, place.kind);
  if (!cleaned || place.kind === 'remote' && !place.target) return undefined;
  return file.favourites.find(favourite =>
    favourite.place === place.kind
    && (place.kind === 'local' || favourite.target === place.target)
    && samePath(favourite.path, cleaned, place.kind)
  );
}

export function toggleFavourite(
  file: StoredFavouriteFile,
  place: FavouritePlace,
  path: string,
  options: { id: string; now: Date },
): StoredFavouriteFile {
  const existing = findFavourite(file, place, path);
  if (existing) return removeFavourite(file, existing.id);
  const cleaned = cleanPath(path, place.kind);
  if (!cleaned || place.kind === 'remote' && !place.target.trim()) return file;
  const favourite: FavouriteDirectory = {
    id: options.id,
    path: cleaned,
    added: options.now.toISOString(),
    place: place.kind,
    ...(place.kind === 'remote' ? { target: place.target.trim() } : {}),
  };
  return { version: 1, favourites: [...file.favourites, favourite].slice(-MAX_FAVOURITES) };
}

export function removeFavourite(file: StoredFavouriteFile, id: string): StoredFavouriteFile {
  return { version: 1, favourites: file.favourites.filter(favourite => favourite.id !== id) };
}

export function canOpenFavourite(favourite: FavouriteDirectory, remoteTarget: string): boolean {
  return favourite.place === 'local' || favourite.target === remoteTarget;
}

export function favouriteLabel(favourite: FavouriteDirectory): string {
  if (favourite.path === '/' || /^[A-Za-z]:\\$/.test(favourite.path)) return favourite.path;
  return favourite.path.split(/[\\/]/).filter(Boolean).at(-1) ?? favourite.path;
}

export function favouritePlaceLabel(favourite: FavouriteDirectory): string {
  return favourite.place === 'local' ? 'This computer' : favourite.target ?? 'Remote';
}
