import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from "electron";
import path from "path";
import url from "url";

const DEFAULT_EVENTS = "https://ringstreak-rc.onrender.com/events";

const EVENTS_URL = process.env.RS_EVENTS_URL || process.env.RC_EVENTS_URL || DEFAULT_EVENTS;

const SIGN_IN_URL = (() => {
  if (process.env.RC_SIGN_IN_URL) return process.env.RC_SIGN_IN_URL;
  try {
    const events = new URL(EVENTS_URL);
    events.pathname = "/rc/auth/start";
    events.search = "";
    events.hash = "";
    return events.toString();
  } catch {
    return "http://localhost:8082/rc/auth/start";
  }
})();

const AUTO_SIGN_IN = String(process.env.POPUP_AUTO_SIGNIN || "") === "1";

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
      label: "Sign in to RingCentral",
      click: () => shell.openExternal(SIGN_IN_URL),
    },
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
  console.log(`[popup] events: ${EVENTS_URL}`);
  console.log(`[popup] sign-in: ${SIGN_IN_URL}`);
  createWindow();
  createTray();
  if (AUTO_SIGN_IN) {
    setTimeout(() => {
      Promise.resolve(shell.openExternal(SIGN_IN_URL)).catch(() => {});
    }, 400);
  }
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({ openAtLogin: true });
    } catch (e) {
      console.warn("setLoginItemSettings failed:", (e as Error).message);
    }
  }
});

app.on("window-all-closed", () => {});
