"use strict";

const fs = require("fs");
const path = require("path");

const version =
  String(
    process.argv[2] ||
    ""
  ).trim();

if (
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(
    version
  )
) {
  console.error(
    "[ERREUR] Version invalide. Exemple : 1.0.1"
  );
  process.exit(1);
}

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

const release =
  JSON.parse(
    fs.readFileSync(
      releaseFile,
      "utf8"
    )
  );

pkg.version =
  version;

release.version =
  version;

release.sha256 =
  "";

fs.writeFileSync(
  packageFile,
  JSON.stringify(
    pkg,
    null,
    2
  ) + "\n",
  "utf8"
);

fs.writeFileSync(
  releaseFile,
  JSON.stringify(
    release,
    null,
    2
  ) + "\n",
  "utf8"
);

const lockFile =
  path.join(
    ROOT,
    "package-lock.json"
  );

if (
  fs.existsSync(
    lockFile
  )
) {
  try {
    const lock =
      JSON.parse(
        fs.readFileSync(
          lockFile,
          "utf8"
        )
      );

    lock.version =
      version;

    if (lock.packages?.[""]) {
      lock.packages[""].version =
        version;
    }

    fs.writeFileSync(
      lockFile,
      JSON.stringify(
        lock,
        null,
        2
      ) + "\n",
      "utf8"
    );
  } catch (err) {
    console.warn(
      "[INFO] package-lock.json sera régénéré par npm install."
    );
  }
}

console.log(
  "[OK] People Desktop passe en version " +
  version
);
