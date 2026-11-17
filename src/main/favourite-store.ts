import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EMPTY_FAVOURITES, normalizeFavouriteFile, type StoredFavouriteFile } from '../shared/favourites.js';

export function defaultFavouritePath(userDataPath: string): string {
  return join(userDataPath, 'favourite-directories.json');
}

export class FavouriteStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<StoredFavouriteFile> {
    try {
      return normalizeFavouriteFile(JSON.parse(await readFile(this.filePath, 'utf8'))) ?? EMPTY_FAVOURITES;
    } catch {
      return EMPTY_FAVOURITES;
    }
  }

  async save(value: unknown): Promise<StoredFavouriteFile> {
    const file = normalizeFavouriteFile(value);
    if (!file) throw new Error('Invalid favourite directory list.');
    const directory = join(this.filePath, '..');
    await mkdir(directory, { recursive: true });
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, JSON.stringify(file, null, 2), 'utf8');
    await rename(temporary, this.filePath);
    return file;
  }
}
