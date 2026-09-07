
const fs = require("fs");
const path = require("path");

const ROOT =
  String.raw`D:\crack\Discord 2`;

const SERVER =
  path.join(
    ROOT,
    "server.js"
  );

const SOCIAL =
  path.join(
    ROOT,
    "public",
    "people-social.js"
  );

const INDEX =
  path.join(
    ROOT,
    "public",
    "index.html"
  );

const STYLE =
  path.join(
    ROOT,
    "public",
    "style.css"
  );

const FIX_FILE =
  path.join(
    ROOT,
    "public",
    "people-avatar-upload-fix.js"
  );

const BACKUP_ROOT =
  path.join(
    ROOT,
    "backup"
  );

const FIX_SOURCE =
  fs.readFileSync(
    path.join(
      __dirname,
      "people-avatar-upload-fix.js"
    ),
    "utf8"
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
    .replace(
      /[:.]/g,
      "-"
    );
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
    path.dirname(
      destination
    ),
    {
      recursive: true
    }
  );

  fs.copyFileSync(
    file,
    destination
  );
}

for (const file of [
  SERVER,
  SOCIAL,
  INDEX,
  STYLE
]) {
  if (!fs.existsSync(file)) {
    die(
      "Fichier introuvable : " +
      file
    );
  }
}

let server =
  fs.readFileSync(
    SERVER,
    "utf8"
  );

let social =
  fs.readFileSync(
    SOCIAL,
    "utf8"
  );

let index =
  fs.readFileSync(
    INDEX,
    "utf8"
  );

let style =
  fs.readFileSync(
    STYLE,
    "utf8"
  );

// ============================================================
// 1. PETIT HELPER CLIENT SEPARE
// ============================================================

if (
  fs.existsSync(
    FIX_FILE
  )
) {
  backup(
    FIX_FILE
  );
}

fs.writeFileSync(
  FIX_FILE,
  FIX_SOURCE,
  "utf8"
);

if (
  !index.includes(
    '<script src="people-avatar-upload-fix.js"></script>'
  )
) {
  const marker =
    '<script src="people-social.js"></script>';

  if (!index.includes(marker)) {
    die(
      "people-social.js introuvable dans index.html."
    );
  }

  index = index.replace(
    marker,
    () =>
      '<script src="people-avatar-upload-fix.js"></script>\n' +
      marker
  );
}

// ============================================================
// 2. UPLOAD PP : UNIQUEMENT LE BLOC APRES LE RECADRAGE
// ============================================================

const oldBlock =
`        profileAvatarUploadButton.textContent =
          "Envoi...";

        const response =
          await fetch(
            "/api/profile/avatar",
            {
              method: "PUT",
              credentials: "same-origin",
              headers: {
                "Content-Type":
                  compressed.type ||
                  "image/webp"
              },
              body: compressed
            }
          );

        let data = null;

        try {
          data =
            await response.json();
        } catch {}

        if (!response.ok) {
          throw new Error(
            data?.error ||
            "Impossible de changer la photo."
          );
        }

        window.PeopleAvatars?.refresh(
          currentProfile.username
        );

        const kb =
          Math.max(
            1,
            Math.round(
              compressed.size / 1024
            )
          );`;

const newBlock =
`        profileAvatarUploadButton.textContent =
          "Compression...";

        const uploadBlob =
          await window
            .PeopleAvatarUploadFix
            ?.prepareForUpload(
              compressed
            );

        if (!uploadBlob) {
          throw new Error(
            "La compression finale a échoué."
          );
        }

        profileAvatarUploadButton.textContent =
          "Envoi...";

        const response =
          await fetch(
            "/api/profile/avatar",
            {
              method: "PUT",
              credentials: "same-origin",
              headers: {
                "Content-Type":
                  uploadBlob.type ||
                  "image/jpeg"
              },
              body:
                uploadBlob
            }
          );

        let data = null;

        try {
          data =
            await response.json();
        } catch {}

        if (
          !response.ok ||
          data?.ok === false
        ) {
          throw new Error(
            data?.error ||
            "Impossible de changer la photo."
          );
        }

        window.PeopleAvatarUploadFix
          ?.applyBlobToElement(
            profileModalAvatar,
            currentProfile.username,
            uploadBlob
          );

        window.PeopleAvatarUploadFix
          ?.applyBlobEverywhere(
            currentProfile.username,
            uploadBlob
          );

        profileAvatarUploadButton.textContent =
          "Vérification...";

        const verified =
          await window
            .PeopleAvatarUploadFix
            ?.reloadFromServer(
              currentProfile.username
            );

        if (!verified) {
          throw new Error(
            "La photo a été envoyée, mais People n'arrive pas à la relire. Recharge la page et regarde les logs Render si elle n'apparaît toujours pas."
          );
        }

        const kb =
          Math.max(
            1,
            Math.round(
              uploadBlob.size / 1024
            )
          );`;

if (
  !social.includes(
    newBlock
  )
) {
  if (
    !social.includes(
      oldBlock
    )
  ) {
    die(
      "Le bloc actuel d'upload PP n'a pas été trouvé. " +
      "Aucun remplacement approximatif n'a été fait."
    );
  }

  social = social.replace(
    oldBlock,
    () => newBlock
  );
}

// ============================================================
// 3. SERVEUR : VERIFIE QUE LA PP EST BIEN RELISIBLE
// ============================================================

const oldServer =
`      const saved =
        await peopleSaveAvatar(
          session.id,
          req.body
        );

      const account =`;

const newServer =
`      const saved =
        await peopleSaveAvatar(
          session.id,
          req.body
        );

      const verifiedAvatar =
        await peopleLoadAvatar(
          session.id
        );

      if (
        !verifiedAvatar ||
        !Buffer.isBuffer(
          verifiedAvatar.data
        ) ||
        verifiedAvatar.data.length <= 0
      ) {
        throw new Error(
          "AVATAR_VERIFY_FAILED"
        );
      }

      const account =`;

if (
  !server.includes(
    "AVATAR_VERIFY_FAILED"
  )
) {
  if (
    !server.includes(
      oldServer
    )
  ) {
    die(
      "Route serveur de la PP introuvable."
    );
  }

  server = server.replace(
    oldServer,
    () => newServer
  );
}

if (
  !server.includes(
    'err?.message === "AVATAR_VERIFY_FAILED"'
  )
) {
  const marker =
`      if (err?.code === "AVATAR_TYPE") {
        return res.status(400).json({
          ok: false,
          error:
            "Format non accepte. JPEG, PNG, WebP ou GIF."
        });
      }`;

  const replacement =
    marker +
`

      if (
        err?.message ===
        "AVATAR_VERIFY_FAILED"
      ) {
        return res.status(500).json({
          ok: false,
          error:
            "La photo a été reçue mais n'a pas pu être relue depuis le stockage."
        });
      }`;

  if (!server.includes(marker)) {
    die(
      "Bloc d'erreur avatar serveur introuvable."
    );
  }

  server = server.replace(
    marker,
    () => replacement
  );
}

// ============================================================
// 4. DECONNEXION : BAS A GAUCHE, POINT
// ============================================================

const cssBlock = `
/* === PEOPLE_LOGOUT_BOTTOM_LEFT_TEMP_V1_START === */

.people-fixed-logout {
  left: 14px !important;
  right: auto !important;
  bottom: 14px !important;
  top: auto !important;
}

@media (max-width: 820px) {
  .people-fixed-logout {
    left: 10px !important;
    right: auto !important;
    bottom: 10px !important;
    top: auto !important;
  }
}

/* === PEOPLE_LOGOUT_BOTTOM_LEFT_TEMP_V1_END === */
`.trim();

const cssRegex =
  /\/\* === PEOPLE_LOGOUT_BOTTOM_LEFT_TEMP_V1_START === \*\/[\s\S]*?\/\* === PEOPLE_LOGOUT_BOTTOM_LEFT_TEMP_V1_END === \*\//;

if (
  cssRegex.test(
    style
  )
) {
  style = style.replace(
    cssRegex,
    () => cssBlock
  );
} else {
  style =
    style.trimEnd() +
    "\n\n" +
    cssBlock +
    "\n";
}

// ============================================================
// 5. VERIFICATIONS
// ============================================================

for (const needle of [
  "PeopleAvatarUploadFix",
  "prepareForUpload",
  "reloadFromServer"
]) {
  if (!social.includes(needle)) {
    die(
      "Verification upload PP : " +
      needle
    );
  }
}

if (
  !index.includes(
    '<script src="people-avatar-upload-fix.js"></script>'
  )
) {
  die(
    "Verification script avatar fix."
  );
}

if (
  !server.includes(
    "AVATAR_VERIFY_FAILED"
  )
) {
  die(
    "Verification serveur avatar."
  );
}

if (
  !style.includes(
    "left: 14px !important;"
  ) ||
  !style.includes(
    "right: auto !important;"
  )
) {
  die(
    "Verification CSS deconnexion."
  );
}

// ============================================================
// 6. BACKUPS UNIQUEMENT DANS backup/
// ============================================================

fs.mkdirSync(
  BACKUP_ROOT,
  {
    recursive: true
  }
);

for (const file of [
  SERVER,
  SOCIAL,
  INDEX,
  STYLE
]) {
  backup(file);
}

fs.writeFileSync(
  SERVER,
  server,
  "utf8"
);

fs.writeFileSync(
  SOCIAL,
  social,
  "utf8"
);

fs.writeFileSync(
  INDEX,
  index,
  "utf8"
);

fs.writeFileSync(
  STYLE,
  style,
  "utf8"
);

console.log("");
console.log("============================================================");
console.log("        PEOPLE - FIX PP + LOGOUT BAS GAUCHE");
console.log("============================================================");
console.log("");
console.log("[OK] PP recadree puis reencodee en JPEG 384x384.");
console.log("[OK] Compression cible : environ 300 Ko max.");
console.log("[OK] Apercu applique immediatement apres upload.");
console.log("[OK] People relit ensuite la PP depuis le serveur pour verifier.");
console.log("[OK] Le serveur verifie aussi le stockage apres sauvegarde.");
console.log("[OK] Deconnexion forcee en bas a gauche.");
console.log("[OK] right:auto neutralise les anciens CSS.");
console.log("[OK] Backups uniquement dans backup/.");
console.log("");
