"use strict";

const fs =
  require("fs");

const path =
  require("path");

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

if (
  !fs.existsSync(
    SERVER
  )
) {
  die(
    "server.js introuvable : " +
    SERVER
  );
}

let source =
  fs.readFileSync(
    SERVER,
    "utf8"
  );

if (
  source.includes(
    "PEOPLE_MESSAGE_ENCRYPTION_V1_START"
  )
) {
  console.log("");
  console.log(
    "[OK] Le chiffrement des messages V1 est déjà installé."
  );

  process.exit(0);
}

// ============================================================
// 0. TOUS LES MARQUEURS SONT VALIDÉS AVANT LA PREMIÈRE MODIF
// ============================================================

const markers = {
  encryptionInsert:
`const PEOPLE_SESSION_SECRET = peopleSessionSecret();`,

  localSocialRead:
`      dms: Array.isArray(raw.dms) ? raw.dms : [],`,

  localSocialWrite:
`        dms: Array.isArray(data.dms) ? data.dms : [],`,

  localSocialCatch:
`  } catch {
    return {
      friends: [],
      dms: [],
      friend_requests: [],
      closed_dms: []
    };
  }
}`,

  localGeneralRead:
`    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}`,

  localGeneralWrite:
`      Array.isArray(messages)
        ? messages.slice(-1000)
        : [],`,

  createGeneralColumn:
`    "body VARCHAR(1000) NOT NULL, " +`,

  createDmColumn:
`    "body VARCHAR(2000) NOT NULL, " +`,

  dmInsertParam:
`            cleanBody,
            replyKey || null`,

  dmCommitReturn:
`      await client.query("COMMIT");

      row.image_id =
        boundImageId;`,

  dmHistoryReturn:
`    return result.rows.reverse();`,

  dmReplyDb:
`      text: row.body,`,

  generalReplyDb:
`      text: row.body,`,

  generalSaveParam:
`            cleanUsername,
            cleanText,
            replyKey || null`,

  generalSaveReturn:
`        text:
          row.body,`,

  generalLoadBody:
`        text:
          row.body,`,

  generalLoadReply:
`                      text:
                        row.reply_body || "",`,

  serverReplyDb:
`      text:
        row.body,`,

  serverSaveParam:
`            cleanUsername,
            cleanText,
            replyKey || null`,

  serverSaveReturn:
`        text:
          row.body,`,

  serverLoadBody:
`          text:
            row.body,`,

  serverLoadReply:
`                        text:
                          row.reply_body || "",`,

  systemSaveParam:
`          "Système",
          cleanText`,

  systemSaveReturn:
`      text:
        row.body,`,

  callTimelineParam:
`        body,
        readAt`,

  callPreviewFunction:
`function peopleDmCallConversationPreview(
  body,
  imageId
) {
  const event =
    peopleDmCallParseEventBody(
      body
    );

  if (!event) {
    return (
      body ||
      (
        imageId
          ? "🖼️ Image"
          : ""
      )
    );
  }`,

  startup:
`peopleInitAccounts()
  .then(() => peopleInitSocial())
  .then(() => peopleInitServersV1())
  // === PEOPLE_DELETE_EMPTY_ON_STARTUP_V1 ===`
};

function requireMarker(
  name,
  marker,
  expectedCount = 1
) {
  const count =
    source.split(marker).length -
    1;

  if (
    count !==
      expectedCount
  ) {
    die(
      "Marqueur " +
      name +
      " attendu " +
      expectedCount +
      " fois, trouvé " +
      count +
      ".\nAUCUN fichier n'a été modifié."
    );
  }
}

// Certains petits snippets identiques existent à plusieurs endroits.
// On valide leur nombre exact pour ne jamais remplacer au hasard.
requireMarker(
  "PEOPLE_SESSION_SECRET",
  markers.encryptionInsert
);
requireMarker(
  "localSocialRead",
  markers.localSocialRead
);
requireMarker(
  "localSocialWrite",
  markers.localSocialWrite
);
requireMarker(
  "localSocialCatch",
  markers.localSocialCatch
);
requireMarker(
  "createGeneralColumn",
  markers.createGeneralColumn
);
requireMarker(
  "createDmColumn",
  markers.createDmColumn
);
requireMarker(
  "dmInsertParam",
  markers.dmInsertParam
);
requireMarker(
  "dmCommitReturn",
  markers.dmCommitReturn
);
requireMarker(
  "dmHistoryReturn",
  markers.dmHistoryReturn
);

// row.body exact appears in 4 outward blocks.
// We do NOT globally replace it. Each larger contextual block below is unique.
requireMarker(
  "callPreviewFunction",
  markers.callPreviewFunction
);
requireMarker(
  "startup",
  markers.startup
);

// ============================================================
// 1. CRYPTO HELPERS — AES-256-GCM
// ============================================================

const encryptionBlock =
`const PEOPLE_SESSION_SECRET = peopleSessionSecret();

// === PEOPLE_MESSAGE_ENCRYPTION_V1_START ===
const PEOPLE_MESSAGE_ENCRYPTION_PREFIX =
  "people-msg:v1:";

const PEOPLE_MESSAGE_ENCRYPTION_AAD =
  Buffer.from(
    "People message encryption v1",
    "utf8"
  );

const PEOPLE_LOCAL_MESSAGE_KEY =
  pathAccounts.join(
    __dirname,
    ".people-message-encryption-key"
  );

function peopleDecodeMessageEncryptionKey(
  value
) {
  const raw =
    String(
      value ||
      ""
    ).trim();

  if (!raw) {
    return null;
  }

  let key =
    null;

  if (
    /^[0-9a-f]{64}$/i.test(
      raw
    )
  ) {
    key =
      Buffer.from(
        raw,
        "hex"
      );
  } else {
    try {
      key =
        Buffer.from(
          raw,
          "base64url"
        );
    } catch {
      key =
        null;
    }

    if (
      !key ||
      key.length !==
        32
    ) {
      try {
        key =
          Buffer.from(
            raw,
            "base64"
          );
      } catch {
        key =
          null;
      }
    }
  }

  if (
    !key ||
    key.length !==
      32
  ) {
    const err =
      new Error(
        "PEOPLE_MESSAGE_ENCRYPTION_KEY doit contenir exactement 32 octets " +
        "(base64url/base64 ou 64 caractères hex)."
      );

    err.code =
      "PEOPLE_MESSAGE_KEY_INVALID";

    throw err;
  }

  return key;
}

function peopleMessageEncryptionKey() {
  const configured =
    String(
      process.env
        .PEOPLE_MESSAGE_ENCRYPTION_KEY ||
      ""
    ).trim();

  if (configured) {
    return peopleDecodeMessageEncryptionKey(
      configured
    );
  }

  if (PEOPLE_PRODUCTION) {
    const err =
      new Error(
        "PEOPLE_MESSAGE_ENCRYPTION_KEY manque. " +
        "Ajoute cette variable dans Render > Environment avant de démarrer People."
      );

    err.code =
      "PEOPLE_MESSAGE_KEY_MISSING";

    throw err;
  }

  if (
    fsAccounts.existsSync(
      PEOPLE_LOCAL_MESSAGE_KEY
    )
  ) {
    return peopleDecodeMessageEncryptionKey(
      fsAccounts.readFileSync(
        PEOPLE_LOCAL_MESSAGE_KEY,
        "utf8"
      )
    );
  }

  const key =
    cryptoAccounts.randomBytes(
      32
    );

  fsAccounts.writeFileSync(
    PEOPLE_LOCAL_MESSAGE_KEY,
    key.toString(
      "base64url"
    ) +
      "\\n",
    {
      mode:
        0o600
    }
  );

  console.log(
    "[People] Clé locale de chiffrement messages créée."
  );

  return key;
}

const PEOPLE_MESSAGE_ENCRYPTION_KEY =
  peopleMessageEncryptionKey();

function peopleMessageIsEncrypted(
  value
) {
  return String(
    value ||
    ""
  ).startsWith(
    PEOPLE_MESSAGE_ENCRYPTION_PREFIX
  );
}

function peopleEncryptMessageText(
  value
) {
  const plain =
    String(
      value ||
      ""
    );

  if (
    !plain ||
    peopleMessageIsEncrypted(
      plain
    )
  ) {
    return plain;
  }

  const iv =
    cryptoAccounts.randomBytes(
      12
    );

  const cipher =
    cryptoAccounts.createCipheriv(
      "aes-256-gcm",
      PEOPLE_MESSAGE_ENCRYPTION_KEY,
      iv
    );

  cipher.setAAD(
    PEOPLE_MESSAGE_ENCRYPTION_AAD
  );

  const ciphertext =
    Buffer.concat([
      cipher.update(
        plain,
        "utf8"
      ),
      cipher.final()
    ]);

  const tag =
    cipher.getAuthTag();

  return (
    PEOPLE_MESSAGE_ENCRYPTION_PREFIX +
    iv.toString(
      "base64url"
    ) +
    "." +
    tag.toString(
      "base64url"
    ) +
    "." +
    ciphertext.toString(
      "base64url"
    )
  );
}

function peopleDecryptMessageText(
  value
) {
  const stored =
    String(
      value ||
      ""
    );

  if (
    !stored ||
    !peopleMessageIsEncrypted(
      stored
    )
  ) {
    // Compatibilité avec les anciens messages en clair.
    return stored;
  }

  const payload =
    stored.slice(
      PEOPLE_MESSAGE_ENCRYPTION_PREFIX.length
    );

  const parts =
    payload.split(
      "."
    );

  if (
    parts.length !==
      3
  ) {
    const err =
      new Error(
        "Message chiffré invalide."
      );

    err.code =
      "PEOPLE_MESSAGE_DECRYPT_FAILED";

    throw err;
  }

  try {
    const iv =
      Buffer.from(
        parts[0],
        "base64url"
      );

    const tag =
      Buffer.from(
        parts[1],
        "base64url"
      );

    const ciphertext =
      Buffer.from(
        parts[2],
        "base64url"
      );

    if (
      iv.length !==
        12 ||
      tag.length !==
        16
    ) {
      throw new Error(
        "Format AES-GCM invalide."
      );
    }

    const decipher =
      cryptoAccounts.createDecipheriv(
        "aes-256-gcm",
        PEOPLE_MESSAGE_ENCRYPTION_KEY,
        iv
      );

    decipher.setAAD(
      PEOPLE_MESSAGE_ENCRYPTION_AAD
    );

    decipher.setAuthTag(
      tag
    );

    return Buffer.concat([
      decipher.update(
        ciphertext
      ),
      decipher.final()
    ]).toString(
      "utf8"
    );
  } catch (cause) {
    const err =
      new Error(
        "Impossible de déchiffrer un message. " +
        "Vérifie PEOPLE_MESSAGE_ENCRYPTION_KEY."
      );

    err.code =
      "PEOPLE_MESSAGE_DECRYPT_FAILED";

    err.cause =
      cause;

    throw err;
  }
}
// === PEOPLE_MESSAGE_ENCRYPTION_V1_END ===`;

source =
  source.replace(
    markers.encryptionInsert,
    encryptionBlock
  );

// ============================================================
// 2. FALLBACK JSON : lecture déchiffrée, écriture chiffrée
// ============================================================

source =
  source.replace(
    markers.localSocialRead,
`      dms: Array.isArray(raw.dms)
        ? raw.dms.map(
            (message) => ({
              ...message,
              body:
                peopleDecryptMessageText(
                  message?.body
                )
            })
          )
        : [],`
  );

source =
  source.replace(
    markers.localSocialWrite,
`        dms: Array.isArray(data.dms)
          ? data.dms.map(
              (message) => ({
                ...message,
                body:
                  peopleEncryptMessageText(
                    message?.body
                  )
              })
            )
          : [],`
  );

source =
  source.replace(
    markers.localSocialCatch,
`  } catch (err) {
    if (
      err?.code ===
        "PEOPLE_MESSAGE_DECRYPT_FAILED"
    ) {
      throw err;
    }

    return {
      friends: [],
      dms: [],
      friend_requests: [],
      closed_dms: []
    };
  }
}`
  );

const localGeneralReadOld =
`function peopleReadLocalGeneral() {
  try {
    if (!fsAccounts.existsSync(PEOPLE_LOCAL_GENERAL)) {
      return [];
    }

    const data = JSON.parse(
      fsAccounts.readFileSync(
        PEOPLE_LOCAL_GENERAL,
        "utf8"
      )
    );

    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}`;

const localGeneralReadNew =
`function peopleReadLocalGeneral() {
  try {
    if (!fsAccounts.existsSync(PEOPLE_LOCAL_GENERAL)) {
      return [];
    }

    const data = JSON.parse(
      fsAccounts.readFileSync(
        PEOPLE_LOCAL_GENERAL,
        "utf8"
      )
    );

    return Array.isArray(data)
      ? data.map(
          (message) => ({
            ...message,
            text:
              peopleDecryptMessageText(
                message?.text
              )
          })
        )
      : [];
  } catch (err) {
    if (
      err?.code ===
        "PEOPLE_MESSAGE_DECRYPT_FAILED"
    ) {
      throw err;
    }

    return [];
  }
}`;

const localGeneralWriteOld =
`function peopleWriteLocalGeneral(messages) {
  fsAccounts.writeFileSync(
    PEOPLE_LOCAL_GENERAL,
    JSON.stringify(
      Array.isArray(messages)
        ? messages.slice(-1000)
        : [],
      null,
      2
    ) + "\\n",
    "utf8"
  );
}`;

const localGeneralWriteNew =
`function peopleWriteLocalGeneral(messages) {
  fsAccounts.writeFileSync(
    PEOPLE_LOCAL_GENERAL,
    JSON.stringify(
      Array.isArray(messages)
        ? messages
            .slice(-1000)
            .map(
              (message) => ({
                ...message,
                text:
                  peopleEncryptMessageText(
                    message?.text
                  )
              })
            )
        : [],
      null,
      2
    ) + "\\n",
    "utf8"
  );
}`;

if (
  !source.includes(
    localGeneralReadOld
  ) ||
  !source.includes(
    localGeneralWriteOld
  )
) {
  die(
    "Fonctions JSON général actuelles non reconnues. " +
    "AUCUN fichier n'a été modifié."
  );
}

source =
  source.replace(
    localGeneralReadOld,
    localGeneralReadNew
  );

source =
  source.replace(
    localGeneralWriteOld,
    localGeneralWriteNew
  );

// ============================================================
// 3. PostgreSQL : les ciphertexts dépassent VARCHAR(1000/2000)
// ============================================================

source =
  source.replace(
    markers.createGeneralColumn,
`    "body TEXT NOT NULL, " +`
  );

source =
  source.replace(
    markers.createDmColumn,
`    "body TEXT NOT NULL, " +`
  );

// ============================================================
// 4. MP : INSERT chiffré, retours/historique déchiffrés
// ============================================================

source =
  source.replace(
    markers.dmInsertParam,
`            peopleEncryptMessageText(
              cleanBody
            ),
            replyKey || null`
  );

source =
  source.replace(
    markers.dmCommitReturn,
`      await client.query("COMMIT");

      row.body =
        peopleDecryptMessageText(
          row.body
        );

      row.image_id =
        boundImageId;`
  );

source =
  source.replace(
    markers.dmHistoryReturn,
`    return result.rows
      .reverse()
      .map(
        (row) => ({
          ...row,
          body:
            peopleDecryptMessageText(
              row.body
            ),
          reply_body:
            row.reply_body ===
              null ||
            row.reply_body ===
              undefined
              ? row.reply_body
              : peopleDecryptMessageText(
                  row.reply_body
                )
        })
      );`
  );

// ============================================================
// 5. Reply previews DB — contextuel, pas de replace global
// ============================================================

const generalReplyOld =
`    return {
      id: String(row.id),
      username: row.username,
      text: row.body,
      imageId:`;

const generalReplyNew =
`    return {
      id: String(row.id),
      username: row.username,
      text:
        peopleDecryptMessageText(
          row.body
        ),
      imageId:`;

if (
  !source.includes(
    generalReplyOld
  )
) {
  die(
    "peopleGeneralReplyPreview() introuvable. AUCUN fichier n'a été modifié."
  );
}

source =
  source.replace(
    generalReplyOld,
    generalReplyNew
  );

const dmReplyOld =
`    return {
      id: String(row.id),
      username:
        row.sender_username ||
        "Utilisateur",
      text: row.body,
      imageId:`;

const dmReplyNew =
`    return {
      id: String(row.id),
      username:
        row.sender_username ||
        "Utilisateur",
      text:
        peopleDecryptMessageText(
          row.body
        ),
      imageId:`;

if (
  !source.includes(
    dmReplyOld
  )
) {
  die(
    "peopleDmReplyPreview() introuvable. AUCUN fichier n'a été modifié."
  );
}

source =
  source.replace(
    dmReplyOld,
    dmReplyNew
  );

// ============================================================
// 6. Général historique legacy : DB encrypt/decrypt
// ============================================================

const generalSaveParamOld =
`            String(senderId),
            cleanUsername,
            cleanText,
            replyKey || null`;

const generalSaveParamNew =
`            String(senderId),
            cleanUsername,
            peopleEncryptMessageText(
              cleanText
            ),
            replyKey || null`;

if (
  !source.includes(
    generalSaveParamOld
  )
) {
  die(
    "INSERT général legacy introuvable. AUCUN fichier n'a été modifié."
  );
}

source =
  source.replace(
    generalSaveParamOld,
    generalSaveParamNew
  );

const generalSaveReturnOld =
`        username:
          row.username,
        text:
          row.body,
        imageId:`;

const generalSaveReturnNew =
`        username:
          row.username,
        text:
          peopleDecryptMessageText(
            row.body
          ),
        imageId:`;

if (
  !source.includes(
    generalSaveReturnOld
  )
) {
  die(
    "Retour général legacy introuvable. AUCUN fichier n'a été modifié."
  );
}

source =
  source.replace(
    generalSaveReturnOld,
    generalSaveReturnNew
  );

// First occurrence of load general mapping after function marker.
const loadGeneralStart =
  source.indexOf(
    "async function peopleLoadGeneralMessages("
  );

const loadGeneralEnd =
  source.indexOf(
    "// === PEOPLE_GENERAL_HISTORY_V1_END ===",
    loadGeneralStart
  );

if (
  loadGeneralStart <
    0 ||
  loadGeneralEnd <=
    loadGeneralStart
) {
  die(
    "peopleLoadGeneralMessages() impossible à délimiter. AUCUN fichier n'a été modifié."
  );
}

let loadGeneralBlock =
  source.slice(
    loadGeneralStart,
    loadGeneralEnd
  );

if (
  !loadGeneralBlock.includes(
`        text:
          row.body,`
  ) ||
  !loadGeneralBlock.includes(
`                      text:
                        row.reply_body || "",`
  )
) {
  die(
    "Mapping peopleLoadGeneralMessages() inattendu. AUCUN fichier n'a été modifié."
  );
}

loadGeneralBlock =
  loadGeneralBlock
    .replace(
`        text:
          row.body,`,
`        text:
          peopleDecryptMessageText(
            row.body
          ),`
    )
    .replace(
`                      text:
                        row.reply_body || "",`,
`                      text:
                        peopleDecryptMessageText(
                          row.reply_body || ""
                        ),`
    );

source =
  source.slice(
    0,
    loadGeneralStart
  ) +
  loadGeneralBlock +
  source.slice(
    loadGeneralEnd
  );

// ============================================================
// 7. Serveurs : reply/save/load chiffrés
// ============================================================

const serverReplyStart =
  source.indexOf(
    "async function peopleServerReplyPreview("
  );

const serverReplyEnd =
  source.indexOf(
    "async function peopleServerSaveMessage(",
    serverReplyStart
  );

if (
  serverReplyStart <
    0 ||
  serverReplyEnd <=
    serverReplyStart
) {
  die(
    "peopleServerReplyPreview() impossible à délimiter. AUCUN fichier n'a été modifié."
  );
}

let serverReplyBlock =
  source.slice(
    serverReplyStart,
    serverReplyEnd
  );

if (
  !serverReplyBlock.includes(
`      text:
        row.body,`
  )
) {
  die(
    "Mapping reply serveur inattendu. AUCUN fichier n'a été modifié."
  );
}

serverReplyBlock =
  serverReplyBlock.replace(
`      text:
        row.body,`,
`      text:
        peopleDecryptMessageText(
          row.body
        ),`
  );

source =
  source.slice(
    0,
    serverReplyStart
  ) +
  serverReplyBlock +
  source.slice(
    serverReplyEnd
  );

const serverSaveStart =
  source.indexOf(
    "async function peopleServerSaveMessage("
  );

const serverLoadStart =
  source.indexOf(
    "async function peopleServerLoadMessages(",
    serverSaveStart
  );

if (
  serverSaveStart <
    0 ||
  serverLoadStart <=
    serverSaveStart
) {
  die(
    "peopleServerSaveMessage() impossible à délimiter. AUCUN fichier n'a été modifié."
  );
}

let serverSaveBlock =
  source.slice(
    serverSaveStart,
    serverLoadStart
  );

if (
  !serverSaveBlock.includes(
`            cleanUsername,
            cleanText,
            replyKey || null`
  ) ||
  !serverSaveBlock.includes(
`        text:
          row.body,`
  )
) {
  die(
    "peopleServerSaveMessage() inattendu. AUCUN fichier n'a été modifié."
  );
}

serverSaveBlock =
  serverSaveBlock
    .replace(
`            cleanUsername,
            cleanText,
            replyKey || null`,
`            cleanUsername,
            peopleEncryptMessageText(
              cleanText
            ),
            replyKey || null`
    )
    .replace(
`        text:
          row.body,`,
`        text:
          peopleDecryptMessageText(
            row.body
          ),`
    );

source =
  source.slice(
    0,
    serverSaveStart
  ) +
  serverSaveBlock +
  source.slice(
    serverLoadStart
  );

const serverLoadEnd =
  source.indexOf(
    "async function peopleServerDeleteMessage(",
    serverLoadStart
  );

if (
  serverLoadEnd <=
    serverLoadStart
) {
  die(
    "peopleServerLoadMessages() impossible à délimiter. AUCUN fichier n'a été modifié."
  );
}

let serverLoadBlock =
  source.slice(
    serverLoadStart,
    serverLoadEnd
  );

if (
  !serverLoadBlock.includes(
`          text:
            row.body,`
  ) ||
  !serverLoadBlock.includes(
`                        text:
                          row.reply_body || "",`
  )
) {
  die(
    "peopleServerLoadMessages() inattendu. AUCUN fichier n'a été modifié."
  );
}

serverLoadBlock =
  serverLoadBlock
    .replace(
`          text:
            row.body,`,
`          text:
            peopleDecryptMessageText(
              row.body
            ),`
    )
    .replace(
`                        text:
                          row.reply_body || "",`,
`                        text:
                          peopleDecryptMessageText(
                            row.reply_body || ""
                          ),`
    );

source =
  source.slice(
    0,
    serverLoadStart
  ) +
  serverLoadBlock +
  source.slice(
    serverLoadEnd
  );

// ============================================================
// 8. Messages système serveur
// ============================================================

const systemStart =
  source.indexOf(
    "async function peopleSaveServerSystemMessage("
  );

const systemEnd =
  source.indexOf(
    "async function peopleEmitServerMembershipMessage(",
    systemStart
  );

if (
  systemStart <
    0 ||
  systemEnd <=
    systemStart
) {
  die(
    "peopleSaveServerSystemMessage() impossible à délimiter. AUCUN fichier n'a été modifié."
  );
}

let systemBlock =
  source.slice(
    systemStart,
    systemEnd
  );

if (
  !systemBlock.includes(
`          "Système",
          cleanText`
  ) ||
  !systemBlock.includes(
`      text:
        row.body,`
  )
) {
  die(
    "Message système serveur inattendu. AUCUN fichier n'a été modifié."
  );
}

systemBlock =
  systemBlock
    .replace(
`          "Système",
          cleanText`,
`          "Système",
          peopleEncryptMessageText(
            cleanText
          )`
    )
    .replace(
`      text:
        row.body,`,
`      text:
        peopleDecryptMessageText(
          row.body
        ),`
    );

source =
  source.slice(
    0,
    systemStart
  ) +
  systemBlock +
  source.slice(
    systemEnd
  );

// ============================================================
// 9. Historique appels MP
// ============================================================

const callSaveStart =
  source.indexOf(
    "function peopleDmCallSaveTimeline("
  );

const callSaveEnd =
  source.indexOf(
    "function peopleDmCall",
    callSaveStart +
      20
  );

let callSaveBlock =
  callSaveEnd >
    callSaveStart
    ? source.slice(
        callSaveStart,
        callSaveEnd
      )
    : "";

if (
  !callSaveBlock ||
  !callSaveBlock.includes(
`        body,
        readAt`
  )
) {
  die(
    "Historique appels MP inattendu. AUCUN fichier n'a été modifié."
  );
}

callSaveBlock =
  callSaveBlock.replace(
`        body,
        readAt`,
`        peopleEncryptMessageText(
          body
        ),
        readAt`
  );

source =
  source.slice(
    0,
    callSaveStart
  ) +
  callSaveBlock +
  source.slice(
    callSaveEnd
  );

// Conversation preview : accepte DB chiffrée et local déchiffré.
source =
  source.replace(
    markers.callPreviewFunction,
`function peopleDmCallConversationPreview(
  body,
  imageId
) {
  const cleanBody =
    peopleDecryptMessageText(
      body
    );

  const event =
    peopleDmCallParseEventBody(
      cleanBody
    );

  if (!event) {
    return (
      cleanBody ||
      (
        imageId
          ? "🖼️ Image"
          : ""
      )
    );
  }`
  );

// ============================================================
// 10. MIGRATION AUTOMATIQUE ANCIENS MESSAGES
// ============================================================

const migrationBlock =
`// === PEOPLE_MESSAGE_ENCRYPTION_MIGRATION_V1_START ===
async function peopleMigrateStoredMessageEncryption() {
  if (peoplePool) {
    const client =
      await peoplePool.connect();

    let migratedGeneral =
      0;

    let migratedDm =
      0;

    try {
      await client.query(
        "BEGIN"
      );

      /*
        Les ciphertexts AES-GCM sont plus longs que le texte initial.
        TEXT évite toute troncature.
      */
      await client.query(
        "ALTER TABLE people_general_messages " +
        "ALTER COLUMN body TYPE TEXT"
      );

      await client.query(
        "ALTER TABLE people_direct_messages " +
        "ALTER COLUMN body TYPE TEXT"
      );

      const generalRows =
        await client.query(
          "SELECT id, body FROM people_general_messages ORDER BY id ASC"
        );

      for (
        const row of
        generalRows.rows
      ) {
        const body =
          String(
            row.body ||
            ""
          );

        if (!body) {
          continue;
        }

        if (
          peopleMessageIsEncrypted(
            body
          )
        ) {
          // Valide également que la clé actuelle est la bonne.
          peopleDecryptMessageText(
            body
          );

          continue;
        }

        await client.query(
          "UPDATE people_general_messages SET body = $1 WHERE id = $2",
          [
            peopleEncryptMessageText(
              body
            ),
            row.id
          ]
        );

        migratedGeneral +=
          1;
      }

      const dmRows =
        await client.query(
          "SELECT id, body FROM people_direct_messages ORDER BY id ASC"
        );

      for (
        const row of
        dmRows.rows
      ) {
        const body =
          String(
            row.body ||
            ""
          );

        if (!body) {
          continue;
        }

        if (
          peopleMessageIsEncrypted(
            body
          )
        ) {
          peopleDecryptMessageText(
            body
          );

          continue;
        }

        await client.query(
          "UPDATE people_direct_messages SET body = $1 WHERE id = $2",
          [
            peopleEncryptMessageText(
              body
            ),
            row.id
          ]
        );

        migratedDm +=
          1;
      }

      await client.query(
        "COMMIT"
      );

      console.log(
        "[People] Chiffrement messages : " +
        migratedGeneral +
        " serveur(s) + " +
        migratedDm +
        " MP migré(s)."
      );

      return;
    } catch (err) {
      await client
        .query(
          "ROLLBACK"
        )
        .catch(
          () => {}
        );

      throw err;
    } finally {
      client.release();
    }
  }

  /*
    En local, les helpers de lecture renvoient du plaintext
    et les helpers d'écriture rechiffrent avant JSON.stringify().
  */
  if (
    fsAccounts.existsSync(
      PEOPLE_LOCAL_SOCIAL
    )
  ) {
    peopleWriteLocalSocial(
      peopleReadLocalSocial()
    );
  }

  if (
    fsAccounts.existsSync(
      PEOPLE_LOCAL_GENERAL
    )
  ) {
    peopleWriteLocalGeneral(
      peopleReadLocalGeneral()
    );
  }

  console.log(
    "[People] Chiffrement messages local vérifié."
  );
}
// === PEOPLE_MESSAGE_ENCRYPTION_MIGRATION_V1_END ===

const PORT = Number(process.env.PORT) || 3000;`;

const portMarker =
`const PORT = Number(process.env.PORT) || 3000;`;

if (
  !source.includes(
    portMarker
  )
) {
  die(
    "PORT final introuvable. AUCUN fichier n'a été modifié."
  );
}

source =
  source.replace(
    portMarker,
    migrationBlock
  );

source =
  source.replace(
    markers.startup,
`peopleInitAccounts()
  .then(() => peopleInitSocial())
  .then(() => peopleInitServersV1())
  .then(() => peopleMigrateStoredMessageEncryption())
  // === PEOPLE_DELETE_EMPTY_ON_STARTUP_V1 ===`
  );

// ============================================================
// 11. VALIDATIONS FINALES AVANT LE PREMIER WRITE
// ============================================================

const finalNeedles = [
  "PEOPLE_MESSAGE_ENCRYPTION_V1_START",
  "aes-256-gcm",
  "PEOPLE_MESSAGE_ENCRYPTION_KEY",
  "peopleEncryptMessageText(",
  "peopleDecryptMessageText(",
  "PEOPLE_MESSAGE_ENCRYPTION_MIGRATION_V1_START",
  "ALTER COLUMN body TYPE TEXT",
  ".then(() => peopleMigrateStoredMessageEncryption())",
  "body TEXT NOT NULL",
  '"people-arcade"' // intentionally impossible? removed below
];

// Remove sentinel used to ensure array formatting stays explicit.
finalNeedles.pop();

for (
  const needle of
  finalNeedles
) {
  if (
    !source.includes(
      needle
    )
  ) {
    die(
      "Validation finale échouée : " +
      needle +
      "\nAUCUN fichier n'a été modifié."
    );
  }
}

if (
  source.includes(
    '"body VARCHAR(1000) NOT NULL, " +'
  ) ||
  source.includes(
    '"body VARCHAR(2000) NOT NULL, " +'
  )
) {
  die(
    "Les anciennes colonnes VARCHAR sont encore présentes. " +
    "AUCUN fichier n'a été modifié."
  );
}

// Les 5 INSERT de textes connus doivent maintenant chiffrer.
const encryptCallCount =
  (
    source.match(
      /peopleEncryptMessageText\(/g
    ) ||
    []
  ).length;

if (
  encryptCallCount <
    9
) {
  die(
    "Pas assez de points de chiffrement détectés (" +
    encryptCallCount +
    "). AUCUN fichier n'a été modifié."
  );
}

// Startup doit migrer AVANT l'écoute HTTP.
const migrationPos =
  source.indexOf(
    ".then(() => peopleMigrateStoredMessageEncryption())"
  );

const listenPos =
  source.indexOf(
    "server.listen("
  );

if (
  migrationPos <
    0 ||
  listenPos <
    0 ||
  migrationPos >
    listenPos
) {
  die(
    "La migration n'est pas placée avant server.listen(). " +
    "AUCUN fichier n'a été modifié."
  );
}

// ============================================================
// 12. BACKUP + WRITE — seulement maintenant
// ============================================================

const backup =
  path.join(
    BACKUP_ROOT,
    stamp(),
    "server.js"
  );

fs.mkdirSync(
  path.dirname(
    backup
  ),
  {
    recursive:
      true
  }
);

fs.copyFileSync(
  SERVER,
  backup
);

fs.writeFileSync(
  SERVER,
  source,
  "utf8"
);

console.log("");
console.log(
  "============================================================"
);
console.log(
  "       PEOPLE - CHIFFREMENT MESSAGES V1"
);
console.log(
  "============================================================"
);
console.log("");
console.log(
  "[OK] AES-256-GCM activé."
);
console.log(
  "[OK] MP chiffrés au repos."
);
console.log(
  "[OK] Messages serveurs chiffrés au repos."
);
console.log(
  "[OK] Messages système et historique appels chiffrés."
);
console.log(
  "[OK] PostgreSQL + JSON local couverts."
);
console.log(
  "[OK] Anciens messages migrés automatiquement au démarrage."
);
console.log(
  "[OK] Colonnes body converties en TEXT."
);
console.log(
  "[OK] Uniquement server.js modifié."
);
console.log("");
console.log(
  "IMPORTANT Render :"
);
console.log(
  "  configure PEOPLE_MESSAGE_ENCRYPTION_KEY AVANT le prochain démarrage."
);
console.log("");
