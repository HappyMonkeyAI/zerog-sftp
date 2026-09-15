import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('sftp', {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  listLocal: (path?: string) => ipcRenderer.invoke('local:list', path),
  listRemote: (target: string, path?: string) => ipcRenderer.invoke('remote:list', target, path)
});
