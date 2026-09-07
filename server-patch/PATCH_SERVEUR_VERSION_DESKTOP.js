"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  String.raw`D:\crack\Discord 2`;

const SERVER =
  path.join(
    ROOT,
    "server.js"
  );

const BACKUP_ROOT =
  path.join(
    ROOT,
    "backup"
  );

const BLOCK = `// === PEOPLE_DESKTOP_VERSION_API_V2_START ===
const PEOPLE_DESKTOP_RELEASE_FILE =
  pathAccounts.join(
    __dirname,
    "desktop",
    "release.json"
  );

function peopleDesktopReleaseInfo() {
  const fallback = {
    version: "1.0.0",
    installerUrl:
      "https://github.com/MioLeVrai/PeopleTheNewAppBetterThanTheBlueBotAndWithoutCapitalism/releases/download/v1.0.0/People-Setup-1.0.0.exe",
    sha256: "",
    message:
      "Une nouvelle version de People est disponible."
  };

  try {
    if (
      !fsAccounts.existsSync(
        PEOPLE_DESKTOP_RELEASE_FILE
      )
    ) {
      return fallback;
    }

    const release =
      JSON.parse(
        fsAccounts.readFileSync(
          PEOPLE_DESKTOP_RELEASE_FILE,
          "utf8"
        )
      );

    return {
      version:
        String(
          release?.version ||
          fallback.version
        ).trim(),
      installerUrl:
        String(
          release?.installerUrl ||
          fallback.installerUrl
        ).trim(),
      sha256:
        String(
          release?.sha256 ||
          ""
        )
          .trim()
          .toLowerCase(),
      message:
        String(
          release?.message ||
          fallback.message
        ).trim()
    };
  } catch (err) {
    console.warn(
      "[People desktop/version]",
      err?.message || err
    );

    return fallback;
  }
}

app.get(
  "/api/desktop/version",
  (_req, res) => {
    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, max-age=0"
    );

    res.status(200).json({
      ok: true,
      ...peopleDesktopReleaseInfo()
    });
  }
);
// === PEOPLE_DESKTOP_VERSION_API_V2_END ===`;

function die(message) {
  console.error(
    "\n[ERREUR] " +
    message
  );
  process.exit(1);
}

function stamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-");
}

function backup(file) {
  if (!fs.existsSync(file)) return;

  const destination =
    path.join(
      BACKUP_ROOT,
      stamp(),
      path.relative(
        ROOT,
        file
      )
    );

  fs.mkdirSync(
    path.dirname(destination),
    { recursive: true }
  );

  fs.copyFileSync(
    file,
    destination
  );
}

if (!fs.existsSync(SERVER)) {
  die("server.js introuvable.");
}

let server =
  fs.readFileSync(
    SERVER,
    "utf8"
  );

if (
  !server.includes(
    'app.get("/health"'
  )
) {
  die("Route /health introuvable.");
}

const oldV2 =
  /\/\/ === PEOPLE_DESKTOP_VERSION_API_V2_START ===[\s\S]*?\/\/ === PEOPLE_DESKTOP_VERSION_API_V2_END ===/;

const oldV1 =
  /\/\/ === PEOPLE_DESKTOP_APP_VERSION_V1_START ===[\s\S]*?\/\/ === PEOPLE_DESKTOP_APP_VERSION_V1_END ===/;

if (oldV2.test(server)) {
  server =
    server.replace(
      oldV2,
      () => BLOCK
    );
} else if (oldV1.test(server)) {
  server =
    server.replace(
      oldV1,
      () => BLOCK
    );
} else {
  server =
    server.replace(
      'app.get("/health"',
      BLOCK +
      "\n\n" +
      'app.get("/health"'
    );
}

if (
  server.split(
    "PEOPLE_DESKTOP_VERSION_API_V2_START"
  ).length - 1 !== 1
) {
  die(
    "Le bloc version desktop n'est pas unique."
  );
}

fs.mkdirSync(
  BACKUP_ROOT,
  { recursive: true }
);

backup(SERVER);

fs.writeFileSync(
  SERVER,
  server,
  "utf8"
);

console.log("");
console.log("============================================================");
console.log("        PEOPLE - API DE VERSION DESKTOP");
console.log("============================================================");
console.log("");
console.log("[OK] GET /api/desktop/version");
console.log("[OK] Lit desktop/release.json.");
console.log("[OK] Cache desactive.");
console.log("[OK] Backup uniquement dans backup/.");
console.log("");
