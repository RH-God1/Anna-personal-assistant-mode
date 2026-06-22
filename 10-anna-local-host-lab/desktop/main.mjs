import { app, BrowserWindow, Menu, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLocalAnnaHost } from "../src/host.js";

const smokeTest = process.argv.includes("--smoke-test");
const openDevTools = process.argv.includes("--devtools");
const requestedPort = Number(process.env.ANNA_DESKTOP_PORT || 0);
const nodePath = process.env.ANNA_NODE_PATH ||
  process.env.npm_node_execpath ||
  process.env.NODE ||
  "node";
const smokeUserDataDir = smokeTest
  ? fs.mkdtempSync(path.join(os.tmpdir(), "anna-desktop-smoke-"))
  : null;
const userDataDir = process.env.ANNA_DESKTOP_USER_DATA_DIR || smokeUserDataDir;

if (userDataDir) {
  app.setPath("userData", userDataDir);
}

let annaHost = null;
let hostUrl = null;
let mainWindow = null;
let cleanupStarted = false;

function isLocalAnnaUrl(url) {
  if (!hostUrl) return false;
  try {
    return new URL(url).origin === new URL(hostUrl).origin;
  } catch {
    return false;
  }
}

function isExternalUrl(url) {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function openOutsideAnna(url) {
  if (isExternalUrl(url)) void shell.openExternal(url);
}

async function startAnnaHost() {
  annaHost = createLocalAnnaHost({ nodePath });
  const port = Number.isFinite(requestedPort) && requestedPort >= 0 ? requestedPort : 0;
  hostUrl = await annaHost.listen(port);
  return hostUrl;
}

async function closeAnnaHost() {
  if (!annaHost) return;
  const host = annaHost;
  annaHost = null;
  await host.close();
}

function buildMenu() {
  const appMenu = process.platform === "darwin"
    ? [{
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" }
        ]
      }]
    : [];

  return Menu.buildFromTemplate([
    ...appMenu,
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "close" }
      ]
    }
  ]);
}

function protectNavigation(webContents) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalAnnaUrl(url)) return { action: "allow" };
    openOutsideAnna(url);
    return { action: "deny" };
  });

  webContents.on("will-navigate", (event, url) => {
    if (isLocalAnnaUrl(url)) return;
    event.preventDefault();
    openOutsideAnna(url);
  });
}

async function createMainWindow({ reveal = true } = {}) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1040,
    minHeight: 720,
    title: "Anna",
    show: false,
    backgroundColor: "#0f1113",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 18, y: 18 },
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  if (reveal) {
    mainWindow.once("ready-to-show", () => {
      mainWindow?.show();
    });
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(hostUrl);

  if (openDevTools) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

async function runSmokeTest() {
  const health = await fetch(`${hostUrl}/healthz`);
  if (!health.ok) throw new Error(`healthz returned HTTP ${health.status}`);

  const status = await fetch(`${hostUrl}/api/status`, {
    headers: { "X-Anna-Admin-Token": annaHost.adminToken }
  });
  if (!status.ok) throw new Error(`status returned HTTP ${status.status}`);

  const body = await status.json();
  if (!Array.isArray(body.apps) || body.apps.length < 1) {
    throw new Error("status did not return registered Anna apps");
  }

  await createMainWindow({ reveal: false });
  const title = mainWindow?.webContents.getTitle() || "";
  if (!title.includes("Anna")) {
    throw new Error(`desktop window loaded unexpected title: ${title || "(empty)"}`);
  }
  mainWindow?.close();

  console.log(`Anna desktop smoke test OK: ${hostUrl}`);
}

async function bootstrap() {
  app.setName("Anna");
  await startAnnaHost();
  app.on("web-contents-created", (_event, contents) => protectNavigation(contents));

  if (smokeTest) {
    await runSmokeTest();
    await closeAnnaHost();
    app.exit(0);
    return;
  }

  Menu.setApplicationMenu(buildMenu());
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
}

app.whenReady().then(bootstrap).catch(async (error) => {
  console.error(error);
  await closeAnnaHost();
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (smokeTest) return;
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (cleanupStarted) return;
  cleanupStarted = true;
  event.preventDefault();
  closeAnnaHost().finally(() => app.quit());
});
