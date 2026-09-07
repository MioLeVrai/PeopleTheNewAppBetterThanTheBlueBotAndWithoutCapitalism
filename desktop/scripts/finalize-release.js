"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT =
  path.join(
    __dirname,
    ".."
  );

const packageFile =
  path.join(
    ROOT,
    "package.json"
  );

const releaseFile =
  path.join(
    ROOT,
    "release.json"
  );

const pkg =
  JSON.parse(
    fs.readFileSync(
      packageFile,
      "utf8"
    )
  );

const installerName =
  `People-Setup-${pkg.version}.exe`;

const installerFile =
  path.join(
    ROOT,
    "dist",
    installerName
  );

if (!fs.existsSync(installerFile)) {
  console.error(
    `[ERREUR] dist\\${installerName} est introuvable.`
  );
  process.exit(1);
}

const release =
  JSON.parse(
    fs.readFileSync(
      releaseFile,
      "utf8"
    )
  );

const hash =
  crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(
        installerFile
      )
    )
    .digest("hex");

release.version =
  String(pkg.version);

release.installerUrl =
  `https://github.com/MioLeVrai/PeopleTheNewAppBetterThanTheBlueBotAndWithoutCapitalism/releases/download/v${pkg.version}/${installerName}`;

release.sha256 =
  hash;

fs.writeFileSync(
  releaseFile,
  JSON.stringify(
    release,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log("");
console.log("[OK] release.json mis a jour.");
console.log("Version :", release.version);
console.log("Fichier :", installerName);
console.log("SHA256  :", release.sha256);
console.log("URL     :", release.installerUrl);
