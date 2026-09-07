"use strict";

const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  net,
  shell
} = require("electron");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");
const { once } = require("events");

const PEOPLE_SITE_URL =
  String(
    process.env.PEOPLE_WEB_URL ||
    "https://peoplethenewappbetterthanthebluebotandwi.onrender.com"
  ).replace(/\/$/, "");

const PEOPLE_VERSION_URL =
  new URL(
    "/api/desktop/version",
    PEOPLE_SITE_URL
  ).toString();

const CHECK_EVERY_MS =
  5 * 60 * 1000;

const MIN_CHECK_GAP_MS =
  30 * 1000;

let mainWindow = null;
let updateWindow = null;
let latestRelease = null;
let dismissedVersion = null;
let downloadRunning = false;
let lastVersionCheckAt = 0;

function cleanVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v/i, "");
}


function compareVersions(a, b) {
  const left =
    cleanVersion(a)
      .split("-")[0]
      .split(".")
      .map(
        (part) =>
          Number.parseInt(
            part,
            10
          ) || 0
      );

  const right =
    cleanVersion(b)
      .split("-")[0]
      .split(".")
      .map(
        (part) =>
          Number.parseInt(
            part,
            10
          ) || 0
      );

  const length =
    Math.max(
      left.length,
      right.length,
      3
    );

  for (
    let index = 0;
    index < length;
    index += 1
  ) {
    const l =
      left[index] || 0;

    const r =
      right[index] || 0;

    if (l > r) return 1;
    if (l < r) return -1;
  }

  return 0;
}

function allowedPeopleUrl(value) {
  try {
    const wanted =
      new URL(PEOPLE_SITE_URL);

    const current =
      new URL(value);

    return (
      current.protocol === "https:" &&
      current.origin === wanted.origin
    );
  } catch {
    return false;
  }
}

async function readServerRelease() {
  const response =
    await net.fetch(
      PEOPLE_VERSION_URL +
      "?t=" +
      Date.now(),
      {
        cache: "no-store"
      }
    );

  if (!response.ok) {
    throw new Error(
      `Serveur de version : HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  const version =
    cleanVersion(
      data?.version
    );

  const installerUrl =
    String(
      data?.installerUrl ||
      ""
    ).trim();

  if (!version) {
    throw new Error(
      "Le serveur n'a pas renvoyé de version desktop."
    );
  }

  return {
    version,
    installerUrl,
    sha256:
      String(
        data?.sha256 ||
        ""
      )
        .trim()
        .toLowerCase(),
    message:
      String(
        data?.message ||
        "Une nouvelle version de People est disponible."
      ).trim()
  };
}

function sendUpdateProgress(payload) {
  if (
    updateWindow &&
    !updateWindow.isDestroyed()
  ) {
    updateWindow.webContents.send(
      "people-update:progress",
      payload
    );
  }
}

function closeUpdateWindow() {
  if (
    updateWindow &&
    !updateWindow.isDestroyed()
  ) {
    updateWindow.close();
  }
}

function showUpdateWindow(release) {
  latestRelease =
    release;

  if (
    updateWindow &&
    !updateWindow.isDestroyed()
  ) {
    updateWindow.focus();
    return;
  }

  updateWindow =
    new BrowserWindow({
      width: 520,
      height: 330,
      parent: mainWindow || undefined,
      modal: Boolean(mainWindow),
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      show: false,
      backgroundColor: "#100e1a",
      webPreferences: {
        preload:
          path.join(
            __dirname,
            "update-preload.js"
          ),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

  updateWindow.loadFile(
    path.join(
      __dirname,
      "update-window.html"
    )
  );

  updateWindow.once(
    "ready-to-show",
    () => {
      updateWindow?.center();
      updateWindow?.show();
      updateWindow?.focus();
    }
  );

  updateWindow.on(
    "close",
    (event) => {
      if (downloadRunning) {
        event.preventDefault();
        return;
      }

      if (latestRelease?.version) {
        dismissedVersion =
          latestRelease.version;
      }
    }
  );

  updateWindow.on(
    "closed",
    () => {
      updateWindow = null;
    }
  );
}

async function checkDesktopVersion({ force = false } = {}) {
  const now =
    Date.now();

  if (
    !force &&
    now - lastVersionCheckAt <
      MIN_CHECK_GAP_MS
  ) {
    return;
  }

  lastVersionCheckAt =
    now;

  try {
    const release =
      await readServerRelease();

    const localVersion =
      cleanVersion(
        app.getVersion()
      );

    /*
      On propose uniquement une vraie mise à jour.
      Si le serveur est à la même version, ou plus ancien,
      aucune fenêtre n'apparaît.
    */
    if (
      compareVersions(
        release.version,
        localVersion
      ) <= 0
    ) {
      latestRelease = null;
      dismissedVersion = null;
      return;
    }

    latestRelease =
      release;

    if (
      force ||
      dismissedVersion !==
        release.version
    ) {
      showUpdateWindow(
        release
      );
    }
  } catch (err) {
    console.warn(
      "[People desktop/version]",
      err?.message || err
    );
  }
}

async function downloadInstaller(release) {
  const url =
    new URL(
      release.installerUrl
    );

  if (url.protocol !== "https:") {
    throw new Error(
      "L'adresse de mise à jour doit utiliser HTTPS."
    );
  }

  const response =
    await net.fetch(
      url.toString(),
      {
        redirect: "follow",
        cache: "no-store"
      }
    );

  if (!response.ok) {
    throw new Error(
      `Téléchargement impossible : HTTP ${response.status}`
    );
  }

  if (!response.body) {
    throw new Error(
      "Le serveur n'a renvoyé aucun fichier."
    );
  }

  const total =
    Number(
      response.headers.get(
        "content-length"
      ) || 0
    );

  const target =
    path.join(
      app.getPath("temp"),
      `People-Setup-${release.version}.exe`
    );

  try {
    fs.unlinkSync(target);
  } catch {}

  const output =
    fs.createWriteStream(
      target
    );

  const hasher =
    crypto.createHash(
      "sha256"
    );

  let received = 0;

  try {
    const input =
      Readable.fromWeb(
        response.body
      );

    for await (
      const chunk
      of input
    ) {
      const buffer =
        Buffer.from(chunk);

      received +=
        buffer.length;

      hasher.update(
        buffer
      );

      if (
        !output.write(buffer)
      ) {
        await once(
          output,
          "drain"
        );
      }

      const percent =
        total > 0
          ? Math.min(
              99,
              Math.round(
                received /
                total *
                100
              )
            )
          : null;

      sendUpdateProgress({
        phase: "download",
        percent,
        received,
        total
      });
    }

    output.end();
    await once(
      output,
      "finish"
    );
  } catch (err) {
    output.destroy();

    try {
      fs.unlinkSync(target);
    } catch {}

    throw err;
  }

  const actualHash =
    hasher
      .digest("hex")
      .toLowerCase();

  if (
    release.sha256 &&
    actualHash !==
      release.sha256
  ) {
    try {
      fs.unlinkSync(target);
    } catch {}

    throw new Error(
      "Le fichier téléchargé ne correspond pas au hash attendu. Mise à jour annulée."
    );
  }

  sendUpdateProgress({
    phase: "ready",
    percent: 100
  });

  return target;
}

async function installLatestUpdate() {
  if (downloadRunning) {
    return {
      ok: false,
      error:
        "Une mise à jour est déjà en cours."
    };
  }

  if (
    !latestRelease?.installerUrl
  ) {
    return {
      ok: false,
      error:
        "Aucun installateur n'est disponible sur le serveur."
    };
  }

  downloadRunning = true;

  try {
    sendUpdateProgress({
      phase: "starting",
      percent: 0
    });

    const installer =
      await downloadInstaller(
        latestRelease
      );

    sendUpdateProgress({
      phase: "launching",
      percent: 100
    });

    const openError =
      await shell.openPath(
        installer
      );

    if (openError) {
      throw new Error(
        openError
      );
    }

    setTimeout(
      () => {
        app.quit();
      },
      850
    );

    return {
      ok: true
    };
  } catch (err) {
    console.error(
      "[People desktop/update]",
      err
    );

    downloadRunning = false;

    sendUpdateProgress({
      phase: "error",
      error:
        err?.message ||
        "La mise à jour a échoué."
    });

    return {
      ok: false,
      error:
        err?.message ||
        "La mise à jour a échoué."
    };
  }
}

function createMainWindow() {
  mainWindow =
    new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 900,
      minHeight: 620,
      show: false,
      backgroundColor: "#100e1a",
      icon:
        path.join(
          __dirname,
          "assets",
          "people.ico"
        ),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

  Menu.setApplicationMenu(
    null
  );

  mainWindow.loadURL(
    PEOPLE_SITE_URL
  );

  mainWindow.once(
    "ready-to-show",
    () => {
      mainWindow?.show();
    }
  );

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;

      console.warn(
        "[People desktop/site]",
        errorCode,
        errorDescription,
        validatedURL
      );
    }
  );

  mainWindow.webContents.on(
    "will-navigate",
    (event, url) => {
      if (
        allowedPeopleUrl(url)
      ) {
        return;
      }

      event.preventDefault();
      void shell.openExternal(url);
    }
  );

  mainWindow.webContents.setWindowOpenHandler(
    ({ url }) => {
      if (
        allowedPeopleUrl(url)
      ) {
        mainWindow?.loadURL(url);
      } else {
        void shell.openExternal(url);
      }

      return {
        action: "deny"
      };
    }
  );


  mainWindow.on(
    "focus",
    () => {
      void checkDesktopVersion();
    }
  );

  mainWindow.webContents.on(
    "did-finish-load",
    () => {
      setTimeout(
        () => {
          void checkDesktopVersion();
        },
        750
      );
    }
  );

  mainWindow.on(
    "closed",
    () => {
      mainWindow = null;
      closeUpdateWindow();
    }
  );
}

ipcMain.handle(
  "people-update:get-state",
  () => ({
    currentVersion:
      cleanVersion(
        app.getVersion()
      ),
    serverVersion:
      latestRelease?.version ||
      "?",
    message:
      latestRelease?.message ||
      "Une nouvelle version de People est disponible."
  })
);

ipcMain.on(
  "people-update:close",
  () => {
    if (downloadRunning) {
      return;
    }

    if (latestRelease?.version) {
      dismissedVersion =
        latestRelease.version;
    }

    closeUpdateWindow();
  }
);

ipcMain.handle(
  "people-update:install",
  installLatestUpdate
);

app.whenReady()
  .then(() => {
    createMainWindow();

    setTimeout(
      () => {
        void checkDesktopVersion();
      },
      1600
    );

    setInterval(
      () => {
        void checkDesktopVersion();
      },
      CHECK_EVERY_MS
    );
  });

app.on(
  "window-all-closed",
  () => {
    app.quit();
  }
);
