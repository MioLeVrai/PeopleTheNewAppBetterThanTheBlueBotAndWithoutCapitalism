
const fs = require("fs");
const path = require("path");

const ROOT =
  String.raw`D:\crack\Discord 2`;

const STYLE =
  path.join(
    ROOT,
    "public",
    "style.css"
  );

const BACKUP_ROOT =
  path.join(
    ROOT,
    "backup"
  );

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
  if (!fs.existsSync(file)) {
    return;
  }

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
    {
      recursive: true
    }
  );

  fs.copyFileSync(
    file,
    destination
  );
}

if (!fs.existsSync(STYLE)) {
  die("style.css introuvable.");
}

let style =
  fs.readFileSync(
    STYLE,
    "utf8"
  );

const block = `
/* === PEOPLE_LOGOUT_TRUE_BOTTOM_RIGHT_V1_START === */

.people-fixed-logout {
  right: 14px !important;
  bottom: 14px !important;
}

@media (max-width: 820px) {
  .people-fixed-logout {
    right: 10px !important;
    bottom: 10px !important;
  }
}

/* === PEOPLE_LOGOUT_TRUE_BOTTOM_RIGHT_V1_END === */
`.trim();

const regex =
  /\/\* === PEOPLE_LOGOUT_TRUE_BOTTOM_RIGHT_V1_START === \*\/[\s\S]*?\/\* === PEOPLE_LOGOUT_TRUE_BOTTOM_RIGHT_V1_END === \*\//;

if (regex.test(style)) {
  style = style.replace(
    regex,
    () => block
  );
} else {
  style =
    style.trimEnd() +
    "\n\n" +
    block +
    "\n";
}

if (
  !style.includes(
    "bottom: 14px !important;"
  )
) {
  die(
    "Verification CSS echouee."
  );
}

fs.mkdirSync(
  BACKUP_ROOT,
  {
    recursive: true
  }
);

backup(STYLE);

fs.writeFileSync(
  STYLE,
  style,
  "utf8"
);

console.log("");
console.log("============================================================");
console.log("        PEOPLE - DECONNEXION VRAI COIN BAS DROIT");
console.log("============================================================");
console.log("");
console.log("[OK] Porte descendue a 14px du bas.");
console.log("[OK] Porte a 14px de la droite.");
console.log("[OK] Mobile : marge 10px.");
console.log("[OK] Un seul fichier touche : style.css.");
console.log("[OK] Backup uniquement dans backup/.");
console.log("");
