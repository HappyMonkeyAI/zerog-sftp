import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('sftp', {
  listProfiles: () => ipcRenderer.invoke('profiles:list'), listLocal: (path?:string) => ipcRenderer.invoke('local:list',path), listRemote: (target:string,path?:string) => ipcRenderer.invoke('remote:list',target,path),
  mkdir: (target:string,path:string) => ipcRenderer.invoke('remote:mkdir',target,path), rename: (target:string,from:string,to:string) => ipcRenderer.invoke('remote:rename',target,from,to), remove: (target:string,path:string,kind:string) => ipcRenderer.invoke('remote:remove',target,path,kind), upload: (target:string,localPath:string,remoteDir:string,kind:string) => ipcRenderer.invoke('remote:upload',target,localPath,remoteDir,kind), download: (target:string,remotePath:string,localDir:string,kind:string) => ipcRenderer.invoke('remote:download',target,remotePath,localDir,kind)
});
