import "dotenv/config";
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from "electron";
import Store from "electron-store";
import path from "path";
import url from "url";
import https from "https";
import http from "http";

const DEFAULT_EVENTS = "https://ringstreak-rc.onrender.com/events";

const EVENTS_URL = process.env.RS_EVENTS_URL || process.env.RC_EVENTS_URL || DEFAULT_EVENTS;

const RS_USER_ID = process.env.RS_USER_ID || process.env.USER || "demo-user";

function deriveUrl(pathname: string, fallback: string) {
  if (pathname.startsWith("http")) return pathname;
  try {
    const events = new URL(EVENTS_URL);
    events.pathname = pathname;
    events.search = "";
    events.hash = "";
    return events.toString();
  } catch {
    return fallback;
  }
}

const SIGN_IN_URL =
  process.env.RC_SIGN_IN_URL || deriveUrl("/rc/auth/start", "http://localhost:8082/rc/auth/start");
const STATUS_URL = (() => {
  try {
    const u = new URL(EVENTS_URL);
    u.pathname = "/rc/auth/status";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return "http://localhost:8082/rc/auth/status";
  }
})();
const AUTH_STATUS_URL = process.env.RC_AUTH_STATUS_URL || STATUS_URL;

const AUTO_SIGN_IN = String(process.env.POPUP_AUTO_SIGNIN || "") === "1";

let win: BrowserWindow | null = null;
let tray: Tray | null = null;

const store = new Store<{ lastSignInPromptAt?: number }>();
const PROMPT_COOLDOWN_MS = 12 * 24 * 60 * 60 * 1000;
const STATUS_POLL_MS = 60 * 1000;

function fetchJson(urlStr: string): Promise<any> {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const mod = u.protocol === "https:" ? https : http;
      const req = mod.request(urlStr, { method: "GET" }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      });
      req.on("error", () => resolve(null));
      req.end();
    } catch {
      resolve(null);
    }
  });
}

async function maybePromptSignIn() {
  if (!win) return;

  const last = store.get("lastSignInPromptAt") || 0;
  const tooSoon = Date.now() - last < PROMPT_COOLDOWN_MS;
  if (tooSoon) return;

  const status = await fetchJson(STATUS_URL);
  const signedIn = Boolean(status && status.signedIn === true);
  if (signedIn) return;

  try {
    shell.openExternal(SIGN_IN_URL);
    store.set("lastSignInPromptAt", Date.now());
  } catch (e) {
    console.warn("Failed to open sign-in URL:", (e as Error).message);
  }
}

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
    query: {
      events: EVENTS_URL,
      uid: RS_USER_ID,
      auth: AUTH_STATUS_URL,
      signIn: SIGN_IN_URL,
      auto: AUTO_SIGN_IN ? "1" : "0",
    },
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
      label: "Re-authenticate",
      click: () => {
        store.set("lastSignInPromptAt", 0);
        shell.openExternal(SIGN_IN_URL);
      },
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
  console.log(`[popup] user: ${RS_USER_ID}`);
  createWindow();
  createTray();
  maybePromptSignIn();
  setInterval(maybePromptSignIn, STATUS_POLL_MS);
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({ openAtLogin: true });
    } catch (e) {
      console.warn("setLoginItemSettings failed:", (e as Error).message);
    }
  }
});

app.on("window-all-closed", () => {});
