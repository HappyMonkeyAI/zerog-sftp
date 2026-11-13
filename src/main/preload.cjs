const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sftp', {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  listLocal: (path) => ipcRenderer.invoke('local:list', path),
  listDrives: () => ipcRenderer.invoke('local:drives'),
  listRemote: (target, path) => ipcRenderer.invoke('remote:list', target, path),
  answerPrompt: (answer) => ipcRenderer.invoke('sftp:answer', answer),
  cancel: () => ipcRenderer.invoke('sftp:cancel'),
  onPrompt: (callback) => {
    const handler = (_event, prompt) => callback(prompt);
    ipcRenderer.on('sftp:prompt', handler);
    return () => ipcRenderer.removeListener('sftp:prompt', handler);
  },
  onProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('sftp:progress', handler);
    return () => ipcRenderer.removeListener('sftp:progress', handler);
  },
  mkdir: (target, path) => ipcRenderer.invoke('remote:mkdir', target, path),
  rename: (target, from, to) => ipcRenderer.invoke('remote:rename', target, from, to),
  remove: (target, path, kind) => ipcRenderer.invoke('remote:remove', target, path, kind),
  upload: (target, localPath, remoteDir, kind) => ipcRenderer.invoke('remote:upload', target, localPath, remoteDir, kind),
  download: (target, remotePath, localDir, kind) => ipcRenderer.invoke('remote:download', target, remotePath, localDir, kind),
  downloadThumbnail: (target, remotePath, cacheDir, scope) => ipcRenderer.invoke('sftp:downloadThumbnail', target, remotePath, cacheDir, scope),
  cancelThumbnails: (scope) => ipcRenderer.invoke('sftp:cancelThumbnails', scope),
  localThumbnail: (localPath) => ipcRenderer.invoke('local:thumbnail', localPath),
});
