export type FileEntry = { name:string; kind:'file'|'directory'|'symlink'; size:number; modified?:string };
export type Listing = { path:string; entries:FileEntry[] };
declare global { interface Window { sftp: { listProfiles:()=>Promise<import('../shared/ssh.js').SshProfile[]>; listLocal:(path?:string)=>Promise<Listing>; listRemote:(target:string,path?:string)=>Promise<Listing>; mkdir:(target:string,path:string)=>Promise<void>; rename:(target:string,from:string,to:string)=>Promise<void>; remove:(target:string,path:string,kind:string)=>Promise<void>; upload:(target:string,localPath:string,remoteDir:string,kind:string)=>Promise<void>; download:(target:string,remotePath:string,localDir:string,kind:string)=>Promise<void> } } }
export {};
