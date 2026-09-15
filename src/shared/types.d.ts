export type FileEntry = { name:string; kind:'file'|'directory'|'symlink'; size:number; modified?:string };
export type Listing = { path:string; entries:FileEntry[] };
declare global { interface Window { sftp: { listProfiles:()=>Promise<import('../shared/ssh.js').SshProfile[]>; listLocal:(path?:string)=>Promise<Listing>; listRemote:(target:string,path?:string)=>Promise<Listing> } } }
export {};
