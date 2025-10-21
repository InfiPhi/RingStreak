import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from "electron";
import path from "path";
import url from "url";

const EVENTS_URL =
  process.env.RS_EVENTS_URL ||
  process.env.RC_EVENTS_URL ||
  "http://localhost:8082/events";

let win: BrowserWindow | null = null;
let tray: Tray | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 420,
    height: 520,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const htmlPath = path.join(__dirname, "../ui.html");
  const loadUrl = url.format({
    pathname: htmlPath,
    protocol: "file:",
    slashes: true,
    query: { events: EVENTS_URL },
  });

  win.loadURL(loadUrl);
  win.on("blur", () => win?.hide());
}

function createTray() {
  const base64Png =
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAABGdBTUEAALGPC/xhBQAAABl0RVh0Q3JlYXRpb24gVGltZQAwOS8yMS8yNVw3bYkAAAA1UExURUdwTVdXV4CAgNd3e3Z2dt/f4N/f4Ht7fYCAgNvb4GZmZnd3d8HBwYCAgN/f38/Pz4CAgP///wAAAE4q6zUAAAAQSURBVBjTY2BgZGBgYGBkAAYYAAWwAAGC3Qk9c6xoTQAAAABJRU5ErkJggg==";
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${base64Png}`);
  tray = new Tray(icon);
  const menu = Menu.buildFromTemplate([
    {
      label: "Show Test Popup",
      click: () => {
        if (!win) return;
        win.show();
        win.focus();
        win.webContents.send("ringstreak:test");
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setToolTip("RingStreak");
  tray.setContextMenu(menu);
}

ipcMain.on("ringstreak:show", () => {
  if (!win) return;
  win.show();
  win.focus();
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({ openAtLogin: true });
    } catch (e) {
      console.warn("setLoginItemSettings failed:", (e as Error).message);
    }
  }
});

app.on("window-all-closed", () => {
  
});
