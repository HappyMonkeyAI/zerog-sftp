export type FileEntry = { name:string; kind:'file'|'directory'|'symlink'; size:number; modified?:string; mode?:string };
export type Listing = { path:string; entries:FileEntry[] };
export type ListingViewMode = 'details' | 'icons' | 'thumbnails';
export const LISTING_VIEW_MODES: ListingViewMode[] = ['details', 'icons', 'thumbnails'];
export const THUMBNAIL_MAX_BYTES = 8 * 1024 * 1024;
export const THUMB_EXTENSIONS = new Set(['jpg','jpeg','png','gif','webp','bmp','ico']);
export function fileExtension(name: string): string;
export function isThumbnailCandidate(name: string, size: number, kind: 'file'|'directory'|'symlink'): boolean;
import type { UpdateState } from './update.js';

declare global { interface Window { sftp: { loadFavourites:()=>Promise<import('../shared/favourites.js').StoredFavouriteFile>; saveFavourites:(file:import('../shared/favourites.js').StoredFavouriteFile)=>Promise<import('../shared/favourites.js').StoredFavouriteFile>; listProfiles:()=>Promise<import('../shared/ssh.js').SshProfile[]>; listLocal:(path?:string)=>Promise<Listing>; listDrives:()=>Promise<string[]>; listRemote:(target:string,path?:string)=>Promise<Listing>; answerPrompt:(answer:string)=>Promise<void>; cancel:()=>Promise<boolean>; onPrompt:(callback:(prompt:{kind:string;message:string})=>void)=>()=>void; onProgress:(callback:(progress:{operation:string;percent:number;detail:string}|null)=>void)=>()=>void; mkdir:(target:string,path:string)=>Promise<void>; rename:(target:string,from:string,to:string)=>Promise<void>; remove:(target:string,path:string,kind:string)=>Promise<void>; upload:(target:string,localPath:string,remoteDir:string,kind:string)=>Promise<void>; download:(target:string,remotePath:string,localDir:string,kind:string)=>Promise<void>; downloadThumbnail:(target:string,remotePath:string,cacheDir:string,scope:string)=>Promise<{dataUrl:string|null}>; cancelThumbnails:(scope:string)=>Promise<boolean>; localThumbnail:(localPath:string)=>Promise<{dataUrl:string|null}>; updateState:()=>Promise<UpdateState>; checkForUpdates:()=>Promise<UpdateState>; openReleasePage:()=>Promise<void>; onUpdateState:(callback:(state:UpdateState)=>void)=>()=>void } } }
export {};
