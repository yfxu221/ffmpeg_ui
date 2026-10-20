import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopAPI, JobProgress } from '../shared/types';
const api: DesktopAPI = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  engineStatus: () => ipcRenderer.invoke('engine:status'),
  selectFile: () => ipcRenderer.invoke('dialog:file'),
  selectDirectory: () => ipcRenderer.invoke('dialog:directory'),
  selectExecutable: () => ipcRenderer.invoke('dialog:executable'),
  inspect: input => ipcRenderer.invoke('media:inspect', input),
  preview: input => ipcRenderer.invoke('media:preview', input),
  start: options => ipcRenderer.invoke('job:start', options),
  command: options => ipcRenderer.invoke('job:command', options),
  cancel: () => ipcRenderer.invoke('job:cancel'),
  reveal: input => ipcRenderer.invoke('file:reveal', input),
  open: input => ipcRenderer.invoke('file:open', input),
  window: action => ipcRenderer.send('window:action', action),
  droppedPath: file => webUtils.getPathForFile(file),
  onProgress: callback => {
    const listener = (_event: Electron.IpcRendererEvent, progress: JobProgress) => callback(progress);
    ipcRenderer.on('job:progress', listener);
    return () => ipcRenderer.removeListener('job:progress', listener);
  },
};
contextBridge.exposeInMainWorld('desktop', api);
