import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FavouriteStore, defaultFavouritePath } from '../src/main/favourite-store';
import {
  EMPTY_FAVOURITES,
  MAX_FAVOURITES,
  canOpenFavourite,
  favouriteLabel,
  normalizeFavouriteFile,
  removeFavourite,
  toggleFavourite,
  type StoredFavouriteFile,
} from '../src/shared/favourites';

const local = { kind: 'local' } as const;
const serverA = { kind: 'remote', target: 'user@example.com' } as const;
const serverB = { kind: 'remote', target: 'other@example.com' } as const;
const now = new Date('2026-01-01T00:00:00.000Z');

function options(id: string) {
  return { id, now };
}

describe('favourites model', () => {
  it('normalizes and deduplicates entries', () => {
    expect(normalizeFavouriteFile({
      version: 1,
      favourites: [
        { id: 'a', path: 'C:\\Work\\Site\\', place: 'local', added: now.toISOString() },
        { id: 'b', path: 'c:/work/site', place: 'local', added: now.toISOString() },
        { id: 'c', path: '/var/www/', place: 'remote', target: 'user@example.com', added: now.toISOString() },
        { id: 'd', path: '/var/www', place: 'remote', target: 'other@example.com', added: now.toISOString() },
        { id: 'e', path: '/etc', place: 'remote' },
        { id: '', path: '/tmp', place: 'local', added: now.toISOString() },
        { id: 'g', path: '   ', place: 'local', added: now.toISOString() },
        { id: 'h', path: '/tmp', place: 'local', added: now.toISOString() },
        { id: 'a', path: '/other', place: 'local', added: now.toISOString() },
      ],
    })).toEqual({
      version: 1,
      favourites: [
        { id: 'a', path: 'C:\\Work\\Site', place: 'local', added: now.toISOString() },
        { id: 'c', path: '/var/www', place: 'remote', target: 'user@example.com', added: now.toISOString() },
        { id: 'd', path: '/var/www', place: 'remote', target: 'other@example.com', added: now.toISOString() },
        { id: 'h', path: '\\tmp', place: 'local', added: now.toISOString() },
      ],
    });
  });

  it('caps the saved list', () => {
    let file = EMPTY_FAVOURITES;
    for (let index = 0; index < MAX_FAVOURITES + 5; index++) {
      file = toggleFavourite(file, local, `C:\\Work\\Folder${index}`, options(`id-${index}`));
    }
    expect(file.favourites).toHaveLength(MAX_FAVOURITES);
  });

  it('keeps same remote paths on different targets separate', () => {
    const file = toggleFavourite(EMPTY_FAVOURITES, serverA, '/srv/app', options('a'));
    const next = toggleFavourite(file, serverB, '/srv/app', options('b'));
    expect(next.favourites).toHaveLength(2);
    expect(removeFavourite(next, 'a').favourites).toHaveLength(1);
  });

  it('toggles case-insensitively on local drives and exactly on remote targets', () => {
    const localFile = toggleFavourite(EMPTY_FAVOURITES, local, 'C:\\Work\\Api', options('local'));
    expect(localFile.favourites).toHaveLength(1);
    expect(toggleFavourite(localFile, local, 'c:/work/api', options('x'))).toEqual(EMPTY_FAVOURITES);

    const remoteFile = toggleFavourite(EMPTY_FAVOURITES, serverA, '/Var/WWW', options('remote'));
    expect(toggleFavourite(remoteFile, serverA, '/var/www', options('x')).favourites).toHaveLength(2);
  });

  it('only opens local favourites and favourites on the connected target', () => {
    let file: StoredFavouriteFile = EMPTY_FAVOURITES;
    file = toggleFavourite(file, local, 'C:\\Work', options('local'));
    file = toggleFavourite(file, serverA, '/srv', options('a'));
    file = toggleFavourite(file, serverB, '/srv', options('b'));
    expect(file.favourites.map(favourite => canOpenFavourite(favourite, serverA.target))).toEqual([true, true, false]);
  });

  it('derives a display label from the last path segment', () => {
    expect(favouriteLabel({ id: '1', path: 'C:\\Work\\Site', added: now.toISOString(), place: 'local' })).toBe('Site');
    expect(favouriteLabel({ id: '2', path: '/', added: now.toISOString(), place: 'remote', target: serverA.target })).toBe('/');
    expect(favouriteLabel({ id: '3', path: 'C:\\', added: now.toISOString(), place: 'local' })).toBe('C:\\');
  });
});

describe('favourite store', () => {
  let filePath = '';

  beforeEach(async () => {
    filePath = defaultFavouritePath(await mkdtemp(join(tmpdir(), 'zerog-sftp-favourites-')));
  });

  it('returns the empty file before one exists', async () => {
    expect(await new FavouriteStore(filePath).load()).toEqual(EMPTY_FAVOURITES);
  });

  it('persists normalized favourites', async () => {
    const store = new FavouriteStore(filePath);
    const saved = await store.save({
      version: 1,
      favourites: [{ id: 'a', path: 'C:\\Work\\', place: 'local', added: now.toISOString() }],
    });
    expect(saved).toEqual({
      version: 1,
      favourites: [{ id: 'a', path: 'C:\\Work', place: 'local', added: now.toISOString() }],
    });
    expect(await store.load()).toEqual(saved);
  });

  it('returns the empty file for corrupt data and rejects invalid saves', async () => {
    const store = new FavouriteStore(filePath);
    await writeFile(filePath, '{ invalid json', 'utf8');
    expect(await store.load()).toEqual(EMPTY_FAVOURITES);
    await expect(store.save({ version: 2, favourites: [] })).rejects.toThrow('Invalid favourite directory list.');
  });
});
