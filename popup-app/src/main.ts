import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from "electron";
import path from "path";
import url from "url";

const EVENTS_URL = process.env.RS_EVENTS_URL || "http://localhost:8082/events";

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
      nodeIntegration: false
    }
  });

  const htmlPath = path.join(__dirname, "../ui.html");
  const loadUrl = url.format({
    pathname: htmlPath,
    protocol: "file:",
    slashes: true,
    query: { events: EVENTS_URL }
  });

  win.loadURL(loadUrl);
  win.on("blur", () => win?.hide());
}

function createTray() {
  const icon = nativeImage.createEmpty(); 
  tray = new Tray(icon);
  const menu = Menu.buildFromTemplate([
    {
      label: "Show Test Popup",
      click: () => {
        if (!win) return;
        win.webContents.send("ringstreak:test");
        win.show();
        win.focus();
      }
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
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
  app.setLoginItemSettings({ openAtLogin: true });
});

app.on("window-all-closed", () => {
  // keep the tray app running
});
