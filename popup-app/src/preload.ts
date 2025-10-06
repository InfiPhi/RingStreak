import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ringstreak", {
  show: () => ipcRenderer.send("ringstreak:show"),
  onTest: (fn: () => void) => ipcRenderer.on("ringstreak:test", fn)
});
