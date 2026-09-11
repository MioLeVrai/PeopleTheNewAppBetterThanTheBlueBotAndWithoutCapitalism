const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 20000,
  pingInterval: 10000
});

app.use(express.static("public"));

// === PEOPLE_ACCOUNTS_V1_START ===
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const fsAccounts = require("fs");
const pathAccounts = require("path");
const cryptoAccounts = require("crypto");

app.use(express.json({ limit: "32kb" }));

const PEOPLE_COOKIE = "people_session";
const PEOPLE_DB_URL = String(process.env.DATABASE_URL || "").trim();
const PEOPLE_PRODUCTION = process.env.NODE_ENV === "production";
const PEOPLE_LOCAL_ACCOUNTS = pathAccounts.join(__dirname, "people-accounts.local.json");
const PEOPLE_LOCAL_SECRET = pathAccounts.join(__dirname, ".people-local-secret");

let peoplePool = null;

function peopleUsername(value) {
  return String(value || "").normalize("NFKC").trim();
}

function peopleUsernameKey(value) {
  return peopleUsername(value).toLocaleLowerCase("fr-FR");
}

function peopleValidUsername(value) {
  const name = peopleUsername(value);
  return (
    name.length >= 3 &&
    name.length <= 24 &&
    /^[\p{L}\p{N}_.-]+$/u.test(name)
  );
}

function peopleValidPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 128
  );
}

function peopleSessionSecret() {
  if (process.env.SESSION_SECRET) {
    return String(process.env.SESSION_SECRET);
  }

  if (PEOPLE_DB_URL) {
    console.warn(
      "[People] SESSION_SECRET absent : secret derive de DATABASE_URL."
    );
    return cryptoAccounts
      .createHash("sha256")
      .update(PEOPLE_DB_URL + "|people-session-v1")
      .digest("hex");
  }

  if (PEOPLE_PRODUCTION) {
    throw new Error(
      "DATABASE_URL manque. Configure PostgreSQL dans Render avant le deploiement."
    );
  }

  if (fsAccounts.existsSync(PEOPLE_LOCAL_SECRET)) {
    return fsAccounts.readFileSync(PEOPLE_LOCAL_SECRET, "utf8").trim();
  }

  const secret = cryptoAccounts.randomBytes(48).toString("hex");
  fsAccounts.writeFileSync(PEOPLE_LOCAL_SECRET, secret, { mode: 0o600 });
  return secret;
}

const PEOPLE_SESSION_SECRET = peopleSessionSecret();

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
      "\n",
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

const PEOPLE_DM_E2EE_PREFIX =
  "people-e2ee-dm:v1:";

function peopleDmE2eeIsEnvelope(
  value
) {
  return String(
    value ||
    ""
  ).startsWith(
    PEOPLE_DM_E2EE_PREFIX
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
    ) ||
    peopleDmE2eeIsEnvelope(
      plain
    )
  ) {
    /*
      Un MP E2EE est déjà chiffré côté appareil :
      le serveur le conserve OPAQUE.
    */
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
    peopleDmE2eeIsEnvelope(
      stored
    ) ||
    !peopleMessageIsEncrypted(
      stored
    )
  ) {
    /*
      - anciens messages en clair : compatibilité
      - nouveaux MP E2EE : passage opaque jusqu'au client
    */
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
// === PEOPLE_MESSAGE_ENCRYPTION_V1_END ===

// === PEOPLE_SIMPLE_ADMIN_DELETE_V1_START ===
const PEOPLE_SIMPLE_ADMIN_TOKEN =
  String(
    process.env.PEOPLE_SIMPLE_ADMIN_TOKEN ||
    ""
  ).trim();

const peopleSimpleDeletedAccounts =
  new Set();

function peopleSimpleAdminAuthorized(
  req,
  res
) {
  if (
    !PEOPLE_SIMPLE_ADMIN_TOKEN
  ) {
    res.status(503).json({
      ok: false,
      error:
        "PEOPLE_SIMPLE_ADMIN_TOKEN n'est pas configuré sur Render."
    });

    return false;
  }

  const authorization =
    String(
      req.headers.authorization ||
      ""
    );

  const match =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );

  const candidate =
    match
      ? match[1].trim()
      : "";

  const left =
    Buffer.from(
      candidate,
      "utf8"
    );

  const right =
    Buffer.from(
      PEOPLE_SIMPLE_ADMIN_TOKEN,
      "utf8"
    );

  if (
    !candidate ||
    left.length !==
      right.length
  ) {
    res.status(403).json({
      ok: false,
      error:
        "Accès admin refusé."
    });

    return false;
  }

  try {
    if (
      !cryptoAccounts
        .timingSafeEqual(
          left,
          right
        )
    ) {
      res.status(403).json({
        ok: false,
        error:
          "Accès admin refusé."
      });

      return false;
    }
  } catch {
    res.status(403).json({
      ok: false,
      error:
        "Accès admin refusé."
    });

    return false;
  }

  return true;
}
// === PEOPLE_SIMPLE_ADMIN_DELETE_V1_END ===

function peopleReadCookies(header) {
  const out = {};

  for (const part of String(header || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;

    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;

    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }

  return out;
}

function peopleSessionFromCookie(header) {
  try {
    const cookies = peopleReadCookies(header);
    const token = cookies[PEOPLE_COOKIE];
    if (!token) return null;

    const payload = jwt.verify(token, PEOPLE_SESSION_SECRET);
    if (!payload || !payload.sub || !payload.username) return null;

    return {
      id: String(payload.sub),
      username: peopleUsername(payload.username)
    };
  } catch {
    return null;
  }
}

function peopleSetSession(res, user) {
  const token = jwt.sign(
    {
      sub: String(user.id),
      username: user.username
    },
    PEOPLE_SESSION_SECRET,
    { expiresIn: "30d" }
  );

  res.cookie(PEOPLE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: PEOPLE_PRODUCTION,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/"
  });
}

function peopleClearSession(res) {
  res.clearCookie(PEOPLE_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: PEOPLE_PRODUCTION,
    path: "/"
  });
}

function peopleReadLocalAccounts() {
  try {
    if (!fsAccounts.existsSync(PEOPLE_LOCAL_ACCOUNTS)) return [];

    const data = JSON.parse(
      fsAccounts.readFileSync(PEOPLE_LOCAL_ACCOUNTS, "utf8")
    );

    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function peopleWriteLocalAccounts(accounts) {
  fsAccounts.writeFileSync(
    PEOPLE_LOCAL_ACCOUNTS,
    JSON.stringify(accounts, null, 2) + "\n",
    "utf8"
  );
}

async function peopleInitAccounts() {
  if (!PEOPLE_DB_URL) {
    if (PEOPLE_PRODUCTION) {
      throw new Error(
        "People Accounts : DATABASE_URL absent. " +
        "Ajoute DATABASE_URL dans Render > Environment."
      );
    }

    console.log("[People] Comptes locaux : people-accounts.local.json");
    return;
  }

  peoplePool = new Pool({
    connectionString: PEOPLE_DB_URL,
    ssl: /localhost|127\.0\.0\.1/i.test(PEOPLE_DB_URL)
      ? false
      : { rejectUnauthorized: false }
  });

  await peoplePool.query(
    "CREATE TABLE IF NOT EXISTS people_accounts (" +
    "id BIGSERIAL PRIMARY KEY, " +
    "username VARCHAR(24) NOT NULL, " +
    "username_key VARCHAR(64) NOT NULL UNIQUE, " +
    "password_hash TEXT NOT NULL, " +
    "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
    ")"
  );

  console.log("[People] Base comptes PostgreSQL connectee.");
}

async function peopleFindAccount(username) {
  const key = peopleUsernameKey(username);

  if (peoplePool) {
    const result = await peoplePool.query(
      "SELECT id, username, username_key, password_hash, description, created_at " +
      "FROM people_accounts WHERE username_key = $1 LIMIT 1",
      [key]
    );

    return result.rows[0] || null;
  }

  return (
    peopleReadLocalAccounts().find(
      (account) => account.username_key === key
    ) || null
  );
}

async function peopleCreateAccount(username, passwordHash) {
  const name = peopleUsername(username);
  const key = peopleUsernameKey(name);

  if (peoplePool) {
    const result = await peoplePool.query(
      "INSERT INTO people_accounts " +
      "(username, username_key, password_hash) " +
      "VALUES ($1, $2, $3) " +
      "RETURNING id, username, created_at",
      [name, key, passwordHash]
    );

    return result.rows[0];
  }

  const accounts = peopleReadLocalAccounts();

  if (accounts.some((account) => account.username_key === key)) {
    const err = new Error("USERNAME_EXISTS");
    err.code = "USERNAME_EXISTS";
    throw err;
  }

  const account = {
    id: cryptoAccounts.randomUUID(),
    username: name,
    username_key: key,
    password_hash: passwordHash,
    created_at: new Date().toISOString(),
    appearance_theme: "dark",
    appearance_accent: "#67589D"
  };

  accounts.push(account);
  peopleWriteLocalAccounts(accounts);
  return account;
}

const peopleLoginFailures = new Map();

function peopleLoginAllowed(username) {
  const key = peopleUsernameKey(username);
  const entry = peopleLoginFailures.get(key);

  if (!entry) return true;

  if (Date.now() > entry.until) {
    peopleLoginFailures.delete(key);
    return true;
  }

  return entry.count < 8;
}

function peopleRecordLoginFailure(username) {
  const key = peopleUsernameKey(username);
  const now = Date.now();
  const current = peopleLoginFailures.get(key);

  if (!current || now > current.until) {
    peopleLoginFailures.set(key, {
      count: 1,
      until: now + 10 * 60 * 1000
    });
    return;
  }

  current.count += 1;
  current.until = now + 10 * 60 * 1000;
}

function peopleClearLoginFailures(username) {
  peopleLoginFailures.delete(peopleUsernameKey(username));
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const username = peopleUsername(req.body?.username);
    const password = req.body?.password;

    if (!peopleValidUsername(username)) {
      return res.status(400).json({
        ok: false,
        error:
          "Pseudo : 3 a 24 caracteres, lettres/chiffres/_/./- uniquement."
      });
    }

    if (!peopleValidPassword(password)) {
      return res.status(400).json({
        ok: false,
        error:
          "Le mot de passe doit contenir entre 8 et 128 caracteres."
      });
    }

    const existing = await peopleFindAccount(username);

    if (existing) {
      return res.status(409).json({
        ok: false,
        error: "Ce pseudo est deja pris."
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let account;

    try {
      account = await peopleCreateAccount(username, passwordHash);
    } catch (err) {
      if (
        err?.code === "23505" ||
        err?.code === "USERNAME_EXISTS"
      ) {
        return res.status(409).json({
          ok: false,
          error: "Ce pseudo est deja pris."
        });
      }

      throw err;
    }

    peopleSetSession(res, account);

    return res.json({
      ok: true,
      user: {
        id: String(account.id),
        username: account.username
      }
    });
  } catch (err) {
    console.error("[People auth/register]", err);

    return res.status(500).json({
      ok: false,
      error: "Impossible de creer le compte."
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = peopleUsername(req.body?.username);
    const password = req.body?.password;

    if (!peopleLoginAllowed(username)) {
      return res.status(429).json({
        ok: false,
        error:
          "Trop d'essais pour ce pseudo. Reessaie dans quelques minutes."
      });
    }

    const account = await peopleFindAccount(username);

    if (!account || typeof password !== "string") {
      peopleRecordLoginFailure(username);

      return res.status(401).json({
        ok: false,
        error: "Pseudo ou mot de passe incorrect."
      });
    }

    const valid = await bcrypt.compare(
      password,
      account.password_hash
    );

    if (!valid) {
      peopleRecordLoginFailure(username);

      return res.status(401).json({
        ok: false,
        error: "Pseudo ou mot de passe incorrect."
      });
    }

    peopleClearLoginFailures(username);
    peopleSetSession(res, account);

    return res.json({
      ok: true,
      user: {
        id: String(account.id),
        username: account.username
      }
    });
  } catch (err) {
    console.error("[People auth/login]", err);

    return res.status(500).json({
      ok: false,
      error: "Connexion impossible."
    });
  }
});

app.get("/api/auth/me", (req, res) => {
  const session = peopleSessionFromCookie(
    req.headers.cookie || ""
  );

  if (!session) {
    return res.status(401).json({
      ok: false,
      user: null
    });
  }

  return res.json({
    ok: true,
    user: session
  });
});

// === PEOPLE_SIMPLE_ADMIN_DELETE_ROUTE_V1 ===
app.post(
  "/api/simple-admin/delete-account",
  async (
    req,
    res
  ) => {
    try {
      if (
        !peopleSimpleAdminAuthorized(
          req,
          res
        )
      ) {
        return;
      }

      const username =
        peopleUsername(
          req.body?.username
        );

      if (!username) {
        return res.status(400).json({
          ok: false,
          error:
            "Pseudo invalide."
        });
      }

      const deleted =
        await peopleSimpleAdminDeleteAccount(
          username
        );

      if (!deleted) {
        return res.status(404).json({
          ok: false,
          error:
            "Compte introuvable."
        });
      }

      return res.json({
        ok: true,
        deleted
      });
    } catch (err) {
      console.error(
        "[People simple admin delete]",
        err
      );

      return res.status(500).json({
        ok: false,
        error:
          "Impossible de supprimer ce compte."
      });
    }
  }
);
// === PEOPLE_SIMPLE_ADMIN_DELETE_ROUTE_V1 ===

app.post("/api/auth/logout", (req, res) => {
  peopleClearSession(res);
  res.json({ ok: true });
});
// === PEOPLE_ACCOUNTS_V1_END ===

// === PEOPLE_SOCIAL_V2_START ===
const PEOPLE_LOCAL_SOCIAL = pathAccounts.join(
  __dirname,
  "people-social.local.json"
);

// === PEOPLE_DM_E2EE_SERVER_V1_START ===
const PEOPLE_LOCAL_E2EE =
  pathAccounts.join(
    __dirname,
    "people-e2ee.local.json"
  );

function peopleE2eeDeviceId(value) {
  const clean =
    String(value || "").trim();

  return /^[a-zA-Z0-9_-]{16,80}$/.test(clean)
    ? clean
    : "";
}

function peopleE2eePublicJwk(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const x = String(value.x || "");
  const y = String(value.y || "");

  if (
    value.kty !== "EC" ||
    value.crv !== "P-256" ||
    !/^[a-zA-Z0-9_-]{40,90}$/.test(x) ||
    !/^[a-zA-Z0-9_-]{40,90}$/.test(y)
  ) {
    return null;
  }

  return {
    kty: "EC",
    crv: "P-256",
    x,
    y,
    ext: true
  };
}

function peopleReadLocalE2ee() {
  try {
    if (!fsAccounts.existsSync(PEOPLE_LOCAL_E2EE)) {
      return [];
    }

    const raw =
      JSON.parse(
        fsAccounts.readFileSync(
          PEOPLE_LOCAL_E2EE,
          "utf8"
        )
      );

    return Array.isArray(raw)
      ? raw
      : [];
  } catch {
    return [];
  }
}

function peopleWriteLocalE2ee(rows) {
  fsAccounts.writeFileSync(
    PEOPLE_LOCAL_E2EE,
    JSON.stringify(
      Array.isArray(rows)
        ? rows
        : [],
      null,
      2
    ) + "\n",
    "utf8"
  );
}

async function peopleE2eeRegisterDevice(
  accountId,
  deviceId,
  publicJwk
) {
  const userId =
    String(accountId || "");

  const device =
    peopleE2eeDeviceId(deviceId);

  const key =
    peopleE2eePublicJwk(publicJwk);

  if (!userId || !device || !key) {
    const err =
      new Error("E2EE_DEVICE_INVALID");

    err.code =
      "E2EE_DEVICE_INVALID";

    throw err;
  }

  const serialized =
    JSON.stringify(key);

  if (peoplePool) {
    await peoplePool.query(
      "INSERT INTO people_e2ee_devices " +
      "(user_id, device_id, public_jwk, last_seen_at) " +
      "VALUES ($1, $2, $3, NOW()) " +
      "ON CONFLICT (user_id, device_id) " +
      "DO UPDATE SET public_jwk = EXCLUDED.public_jwk, last_seen_at = NOW()",
      [
        userId,
        device,
        serialized
      ]
    );

    return;
  }

  const rows =
    peopleReadLocalE2ee();

  const next = {
    user_id: userId,
    device_id: device,
    public_jwk: serialized,
    last_seen_at:
      new Date().toISOString()
  };

  const index =
    rows.findIndex(
      (row) =>
        String(row.user_id) === userId &&
        String(row.device_id) === device
    );

  if (index >= 0) {
    rows[index] = next;
  } else {
    rows.push(next);
  }

  peopleWriteLocalE2ee(rows);
}

async function peopleE2eeDevices(accountId) {
  const userId =
    String(accountId || "");

  if (!userId) {
    return [];
  }

  let rows;

  if (peoplePool) {
    const result =
      await peoplePool.query(
        "SELECT device_id, public_jwk, last_seen_at " +
        "FROM people_e2ee_devices " +
        "WHERE user_id = $1 " +
        "ORDER BY last_seen_at DESC " +
        "LIMIT 8",
        [userId]
      );

    rows =
      result.rows;
  } else {
    rows =
      peopleReadLocalE2ee()
        .filter(
          (row) =>
            String(row.user_id) === userId
        )
        .sort(
          (a, b) =>
            new Date(
              b.last_seen_at || 0
            ).getTime() -
            new Date(
              a.last_seen_at || 0
            ).getTime()
        )
        .slice(0, 8);
  }

  return rows
    .map(
      (row) => {
        try {
          const publicJwk =
            peopleE2eePublicJwk(
              typeof row.public_jwk === "string"
                ? JSON.parse(row.public_jwk)
                : row.public_jwk
            );

          const deviceId =
            peopleE2eeDeviceId(row.device_id);

          if (!publicJwk || !deviceId) {
            return null;
          }

          return {
            userId,
            deviceId,
            publicJwk
          };
        } catch {
          return null;
        }
      }
    )
    .filter(Boolean);
}

function peopleDmE2eeEnvelope(value) {
  const body =
    String(value || "").trim();

  if (!peopleDmE2eeIsEnvelope(body)) {
    return null;
  }

  if (body.length > 24000) {
    const err =
      new Error("E2EE_ENVELOPE_INVALID");

    err.code =
      "E2EE_ENVELOPE_INVALID";

    throw err;
  }

  const encoded =
    body.slice(
      PEOPLE_DM_E2EE_PREFIX.length
    );

  if (
    !encoded ||
    !/^[a-zA-Z0-9_-]+$/.test(encoded)
  ) {
    const err =
      new Error("E2EE_ENVELOPE_INVALID");

    err.code =
      "E2EE_ENVELOPE_INVALID";

    throw err;
  }

  let envelope;

  try {
    envelope =
      JSON.parse(
        Buffer.from(
          encoded,
          "base64url"
        ).toString("utf8")
      );
  } catch {
    const err =
      new Error("E2EE_ENVELOPE_INVALID");

    err.code =
      "E2EE_ENVELOPE_INVALID";

    throw err;
  }

  const from =
    String(envelope?.from || "");

  const to =
    String(envelope?.to || "");

  const senderDevice =
    peopleE2eeDeviceId(envelope?.sd);

  const senderPublic =
    peopleE2eePublicJwk(envelope?.spk);

  const messageIv =
    String(envelope?.iv || "");

  const ciphertext =
    String(envelope?.ct || "");

  const keys =
    Array.isArray(envelope?.keys)
      ? envelope.keys
      : [];

  if (
    envelope?.v !== 1 ||
    !from ||
    !to ||
    from.length > 100 ||
    to.length > 100 ||
    !senderDevice ||
    !senderPublic ||
    !/^[a-zA-Z0-9_-]{16,40}$/.test(messageIv) ||
    !/^[a-zA-Z0-9_-]{16,16000}$/.test(ciphertext) ||
    keys.length < 1 ||
    keys.length > 16
  ) {
    const err =
      new Error("E2EE_ENVELOPE_INVALID");

    err.code =
      "E2EE_ENVELOPE_INVALID";

    throw err;
  }

  const normalizedKeys =
    keys.map(
      (item) => {
        const userId =
          String(item?.u || "");

        const deviceId =
          peopleE2eeDeviceId(item?.d);

        const iv =
          String(item?.iv || "");

        const wrapped =
          String(item?.ct || "");

        if (
          !userId ||
          userId.length > 100 ||
          !deviceId ||
          !/^[a-zA-Z0-9_-]{16,40}$/.test(iv) ||
          !/^[a-zA-Z0-9_-]{32,160}$/.test(wrapped)
        ) {
          const err =
            new Error("E2EE_ENVELOPE_INVALID");

          err.code =
            "E2EE_ENVELOPE_INVALID";

          throw err;
        }

        return {
          u: userId,
          d: deviceId,
          iv,
          ct: wrapped
        };
      }
    );

  return {
    v: 1,
    from,
    to,
    sd: senderDevice,
    spk: senderPublic,
    iv: messageIv,
    ct: ciphertext,
    keys: normalizedKeys
  };
}
// === PEOPLE_DM_E2EE_SERVER_V1_END ===


function peopleReadLocalSocial() {
  try {
    if (!fsAccounts.existsSync(PEOPLE_LOCAL_SOCIAL)) {
      // === PEOPLE_DM_CLOSE_V1_LOCAL ===
      return {
        friends: [],
        dms: [],
        friend_requests: [],
        closed_dms: []
      };
    }

    const raw = JSON.parse(
      fsAccounts.readFileSync(PEOPLE_LOCAL_SOCIAL, "utf8")
    );

    return {
      friends: Array.isArray(raw.friends) ? raw.friends : [],
      dms: Array.isArray(raw.dms)
        ? raw.dms.map(
            (message) => ({
              ...message,
              body:
                peopleDecryptMessageText(
                  message?.body
                )
            })
          )
        : [],
      friend_requests: Array.isArray(raw.friend_requests)
        ? raw.friend_requests
        : [],
      closed_dms:
        Array.isArray(raw.closed_dms)
          ? raw.closed_dms
          : []
    };
  } catch (err) {
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
}

function peopleWriteLocalSocial(data) {
  fsAccounts.writeFileSync(
    PEOPLE_LOCAL_SOCIAL,
    JSON.stringify(
      {
        friends: Array.isArray(data.friends) ? data.friends : [],
        dms: Array.isArray(data.dms)
          ? data.dms.map(
              (message) => ({
                ...message,
                body:
                  peopleEncryptMessageText(
                    message?.body
                  )
              })
            )
          : [],
        friend_requests: Array.isArray(data.friend_requests)
          ? data.friend_requests
          : [],
        closed_dms:
          Array.isArray(data.closed_dms)
            ? data.closed_dms
            : []
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

function peoplePublicAccount(account) {
  if (!account) return null;

  return {
    id: String(account.id),
    username: peopleUsername(account.username),
    description: String(account.description || ""),
    createdAt: account.created_at || account.createdAt || null
  };
}

function peopleSessionForRequest(req, res) {
  const session = peopleSessionFromCookie(req.headers.cookie || "");

  if (!session) {
    res.status(401).json({
      ok: false,
      error: "Connexion requise."
    });
    return null;
  }

  return session;
}

// === PEOPLE_DM_E2EE_ROUTES_V1_START ===
app.post(
  "/api/e2ee/device",
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(
          req,
          res
        );

      if (!session) {
        return;
      }

      await peopleE2eeRegisterDevice(
        session.id,
        req.body?.deviceId,
        req.body?.publicJwk
      );

      return res.json({
        ok: true
      });
    } catch (err) {
      if (
        err?.code ===
          "E2EE_DEVICE_INVALID"
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Clé E2EE de l'appareil invalide."
          });
      }

      console.error(
        "[People E2EE/device]",
        err
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            "Impossible d'enregistrer la clé E2EE."
        });
    }
  }
);

app.get(
  "/api/e2ee/dm/:username/devices",
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(
          req,
          res
        );

      if (!session) {
        return;
      }

      const target =
        await peopleFindAccount(
          req.params.username
        );

      if (!target) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "Utilisateur introuvable."
          });
      }

      if (
        String(target.id) ===
          String(session.id)
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Conversation E2EE invalide."
          });
      }

      const [
        myDevices,
        otherDevices
      ] =
        await Promise.all([
          peopleE2eeDevices(
            session.id
          ),
          peopleE2eeDevices(
            target.id
          )
        ]);

      return res.json({
        ok: true,
        me: {
          id:
            String(session.id)
        },
        other:
          peoplePublicAccount(
            target
          ),
        myDevices,
        otherDevices
      });
    } catch (err) {
      console.error(
        "[People E2EE/devices]",
        err
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            "Impossible de charger les clés E2EE."
        });
    }
  }
);
// === PEOPLE_DM_E2EE_ROUTES_V1_END ===
// === PEOPLE_DM_SIDEBAR_PREVIEW_CLEAN_V1 ===

function peopleAccountIsOnline(accountId) {
  const wanted = String(accountId);

  for (const id of userIds.values()) {
    if (String(id) === wanted) return true;
  }

  return false;
}

async function peopleFindAccountById(id) {
  const wanted = String(id);

  if (peoplePool) {
    const result = await peoplePool.query(
      "SELECT id, username, username_key, password_hash, " +
      "description, created_at " +
      "FROM people_accounts WHERE id = $1 LIMIT 1",
      [wanted]
    );

    return result.rows[0] || null;
  }

  return (
    peopleReadLocalAccounts().find(
      (account) => String(account.id) === wanted
    ) || null
  );
}

async function peopleFindAccountsByIds(ids) {
  const wanted = [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => String(id || ""))
        .filter(Boolean)
    )
  ];

  if (!wanted.length) {
    return [];
  }

  if (peoplePool) {
    const result = await peoplePool.query(
      "SELECT id, username, username_key, password_hash, " +
      "description, created_at " +
      "FROM people_accounts " +
      "WHERE id = ANY($1::bigint[])",
      [wanted]
    );

    const byId = new Map(
      result.rows.map((account) => [
        String(account.id),
        account
      ])
    );

    return wanted
      .map((id) => byId.get(id))
      .filter(Boolean);
  }

  const byId = new Map(
    peopleReadLocalAccounts().map((account) => [
      String(account.id),
      account
    ])
  );

  return wanted
    .map((id) => byId.get(id))
    .filter(Boolean);
}

async function peopleListAccounts(search = "") {
  const q = peopleUsername(search).toLocaleLowerCase("fr-FR");

  if (peoplePool) {
    const params = [];
    let where = "";

    if (q) {
      params.push("%" + q + "%");
      where = "WHERE LOWER(username) LIKE $1";
    }

    const result = await peoplePool.query(
      "SELECT id, username, description, created_at " +
      "FROM people_accounts " +
      where +
      " ORDER BY LOWER(username) ASC LIMIT 50",
      params
    );

    return result.rows;
  }

  return peopleReadLocalAccounts()
    .filter((account) => {
      if (!q) return true;
      return String(account.username || "")
        .toLocaleLowerCase("fr-FR")
        .includes(q);
    })
    .sort((a, b) =>
      String(a.username || "").localeCompare(
        String(b.username || ""),
        "fr",
        { sensitivity: "base" }
      )
    )
    .slice(0, 50);
}

async function peopleUpdateDescription(accountId, description) {
  const clean = String(description || "").trim().slice(0, 280);

  if (peoplePool) {
    const result = await peoplePool.query(
      "UPDATE people_accounts " +
      "SET description = $1 " +
      "WHERE id = $2 " +
      "RETURNING id, username, description, created_at",
      [clean, String(accountId)]
    );

    return result.rows[0] || null;
  }

  const accounts = peopleReadLocalAccounts();
  const account = accounts.find(
    (item) => String(item.id) === String(accountId)
  );

  if (!account) return null;

  account.description = clean;
  peopleWriteLocalAccounts(accounts);
  return account;
}


// === PEOPLE_APPEARANCE_V2_START ===
const PEOPLE_APPEARANCE_THEMES = new Set([
  "dark",
  "midnight",
  "light",
  "system",
  "custom"
]);

const PEOPLE_DEFAULT_APPEARANCE_PALETTE = Object.freeze({
  background: "#100E1A",
  panel: "#181524",
  secondary: "#090811",
  text: "#F2EFF8",
  accent: "#67589D"
});

const PEOPLE_APPEARANCE_PALETTE_KEYS = Object.freeze([
  "background",
  "panel",
  "secondary",
  "text",
  "accent"
]);

const PEOPLE_DEFAULT_APPEARANCE = {
  theme: "dark",
  accent: PEOPLE_DEFAULT_APPEARANCE_PALETTE.accent,
  palette: {
    ...PEOPLE_DEFAULT_APPEARANCE_PALETTE
  }
};

function peopleNormalizeAppearanceTheme(value) {
  const theme = String(value || "")
    .trim()
    .toLowerCase();

  return PEOPLE_APPEARANCE_THEMES.has(theme)
    ? theme
    : PEOPLE_DEFAULT_APPEARANCE.theme;
}

function peopleNormalizeAppearanceHex(value, fallback) {
  const color = String(value || "")
    .trim()
    .toUpperCase();

  return /^#[0-9A-F]{6}$/.test(color)
    ? color
    : fallback;
}

function peopleReadAppearancePalette(value) {
  if (!value) return null;

  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  return null;
}

function peopleNormalizeAppearancePalette(value, legacyAccent) {
  const source = peopleReadAppearancePalette(value) || {};
  const base = PEOPLE_DEFAULT_APPEARANCE_PALETTE;

  return {
    background: peopleNormalizeAppearanceHex(
      source.background,
      base.background
    ),
    panel: peopleNormalizeAppearanceHex(
      source.panel,
      base.panel
    ),
    secondary: peopleNormalizeAppearanceHex(
      source.secondary,
      base.secondary
    ),
    text: peopleNormalizeAppearanceHex(
      source.text,
      base.text
    ),
    accent: peopleNormalizeAppearanceHex(
      source.accent || legacyAccent,
      base.accent
    )
  };
}

function peopleAppearanceFromAccount(account) {
  const legacyAccent = peopleNormalizeAppearanceHex(
    account?.appearance_accent || account?.appearanceAccent,
    PEOPLE_DEFAULT_APPEARANCE_PALETTE.accent
  );

  const palette = peopleNormalizeAppearancePalette(
    account?.appearance_palette || account?.appearancePalette,
    legacyAccent
  );

  return {
    theme: peopleNormalizeAppearanceTheme(
      account?.appearance_theme || account?.appearanceTheme
    ),
    accent: palette.accent,
    palette
  };
}

async function peopleGetAppearance(accountId) {
  const wanted = String(accountId || "");

  if (peoplePool) {
    const result = await peoplePool.query(
      "SELECT appearance_theme, appearance_accent, appearance_palette " +
      "FROM people_accounts WHERE id = $1 LIMIT 1",
      [wanted]
    );

    return result.rows[0]
      ? peopleAppearanceFromAccount(result.rows[0])
      : null;
  }

  const account = peopleReadLocalAccounts().find(
    (item) => String(item.id) === wanted
  );

  return account
    ? peopleAppearanceFromAccount(account)
    : null;
}

async function peopleUpdateAppearance(
  accountId,
  theme,
  appearanceValue = {}
) {
  const wanted = String(accountId || "");
  const cleanTheme = peopleNormalizeAppearanceTheme(theme);
  const cleanPalette = peopleNormalizeAppearancePalette(
    appearanceValue?.palette,
    appearanceValue?.accent
  );
  const paletteJson = JSON.stringify(cleanPalette);

  if (peoplePool) {
    const result = await peoplePool.query(
      "UPDATE people_accounts " +
      "SET appearance_theme = $1, appearance_accent = $2, appearance_palette = $3 " +
      "WHERE id = $4 " +
      "RETURNING appearance_theme, appearance_accent, appearance_palette",
      [cleanTheme, cleanPalette.accent, paletteJson, wanted]
    );

    return result.rows[0]
      ? peopleAppearanceFromAccount(result.rows[0])
      : null;
  }

  const accounts = peopleReadLocalAccounts();
  const account = accounts.find(
    (item) => String(item.id) === wanted
  );

  if (!account) return null;

  account.appearance_theme = cleanTheme;
  account.appearance_accent = cleanPalette.accent;
  account.appearance_palette = cleanPalette;
  peopleWriteLocalAccounts(accounts);

  return peopleAppearanceFromAccount(account);
}
// === PEOPLE_APPEARANCE_V2_END ===

async function peopleFriendIds(accountId) {
  const owner = String(accountId);

  if (peoplePool) {
    const result = await peoplePool.query(
      "SELECT friend_id FROM people_friends " +
      "WHERE user_id = $1 ORDER BY created_at ASC",
      [owner]
    );

    return result.rows.map((row) => String(row.friend_id));
  }

  const data = peopleReadLocalSocial();

  return data.friends
    .filter((item) => String(item.user_id) === owner)
    .map((item) => String(item.friend_id));
}

async function peopleHasFriend(accountId, friendId) {
  const ids = await peopleFriendIds(accountId);
  return ids.includes(String(friendId));
}

async function peopleAddFriend(accountId, friendId) {
  const owner = String(accountId);
  const friend = String(friendId);

  if (owner === friend) return;

  if (peoplePool) {
    await peoplePool.query(
      "INSERT INTO people_friends (user_id, friend_id) " +
      "VALUES ($1, $2), ($2, $1) " +
      "ON CONFLICT DO NOTHING",
      [owner, friend]
    );
    return;
  }

  const data = peopleReadLocalSocial();
  const now = new Date().toISOString();

  const ensure = (userId, friendIdValue) => {
    if (
      !data.friends.some(
        (item) =>
          String(item.user_id) === userId &&
          String(item.friend_id) === friendIdValue
      )
    ) {
      data.friends.push({
        user_id: userId,
        friend_id: friendIdValue,
        created_at: now
      });
    }
  };

  ensure(owner, friend);
  ensure(friend, owner);

  peopleWriteLocalSocial(data);
}

async function peopleRemoveFriend(accountId, friendId) {
  const owner = String(accountId);
  const friend = String(friendId);

  if (peoplePool) {
    await peoplePool.query(
      "DELETE FROM people_friends " +
      "WHERE (user_id = $1 AND friend_id = $2) " +
      "OR (user_id = $2 AND friend_id = $1)",
      [owner, friend]
    );
    return;
  }

  const data = peopleReadLocalSocial();

  data.friends = data.friends.filter(
    (item) =>
      !(
        (
          String(item.user_id) === owner &&
          String(item.friend_id) === friend
        ) ||
        (
          String(item.user_id) === friend &&
          String(item.friend_id) === owner
        )
      )
  );

  peopleWriteLocalSocial(data);
}

// === PEOPLE_FRIEND_REQUESTS_V2_START ===
async function peopleFriendRequestRows(accountId) {
  const me = String(accountId);

  if (peoplePool) {
    const result = await peoplePool.query(
      "SELECT id, sender_id, recipient_id, created_at " +
      "FROM people_friend_requests " +
      "WHERE sender_id = $1 OR recipient_id = $1 " +
      "ORDER BY created_at DESC",
      [me]
    );
    return result.rows;
  }

  return peopleReadLocalSocial()
    .friend_requests
    .filter(
      (request) =>
        String(request.sender_id) === me ||
        String(request.recipient_id) === me
    )
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime()
    );
}

async function peopleFriendRelation(accountId, otherId) {
  const me = String(accountId);
  const other = String(otherId);

  if (await peopleHasFriend(me, other)) {
    return {
      isFriend: true,
      friendRequest: null,
      friendRequestId: null
    };
  }

  const requests = await peopleFriendRequestRows(me);

  const outgoing = requests.find(
    (request) =>
      String(request.sender_id) === me &&
      String(request.recipient_id) === other
  );

  if (outgoing) {
    return {
      isFriend: false,
      friendRequest: "outgoing",
      friendRequestId: String(outgoing.id)
    };
  }

  const incoming = requests.find(
    (request) =>
      String(request.sender_id) === other &&
      String(request.recipient_id) === me
  );

  if (incoming) {
    return {
      isFriend: false,
      friendRequest: "incoming",
      friendRequestId: String(incoming.id)
    };
  }

  return {
    isFriend: false,
    friendRequest: null,
    friendRequestId: null
  };
}

async function peopleCreateFriendRequest(senderId, recipientId) {
  const sender = String(senderId);
  const recipient = String(recipientId);

  if (sender === recipient) {
    const err = new Error("SELF_REQUEST");
    err.code = "SELF_REQUEST";
    throw err;
  }

  if (await peopleHasFriend(sender, recipient)) {
    const err = new Error("ALREADY_FRIENDS");
    err.code = "ALREADY_FRIENDS";
    throw err;
  }

  const current = await peopleFriendRequestRows(sender);

  const incoming = current.find(
    (request) =>
      String(request.sender_id) === recipient &&
      String(request.recipient_id) === sender
  );

  if (incoming) {
    const err = new Error("INCOMING_EXISTS");
    err.code = "INCOMING_EXISTS";
    err.requestId = String(incoming.id);
    throw err;
  }

  const existing = current.find(
    (request) =>
      String(request.sender_id) === sender &&
      String(request.recipient_id) === recipient
  );

  if (existing) return existing;

  if (peoplePool) {
    const result = await peoplePool.query(
      "INSERT INTO people_friend_requests " +
      "(sender_id, recipient_id) VALUES ($1, $2) " +
      "ON CONFLICT DO NOTHING " +
      "RETURNING id, sender_id, recipient_id, created_at",
      [sender, recipient]
    );

    if (result.rows[0]) return result.rows[0];

    const conflict = await peoplePool.query(
      "SELECT id, sender_id, recipient_id, created_at " +
      "FROM people_friend_requests " +
      "WHERE (sender_id = $1 AND recipient_id = $2) " +
      "OR (sender_id = $2 AND recipient_id = $1) " +
      "LIMIT 1",
      [sender, recipient]
    );

    const row = conflict.rows[0];

    if (row && String(row.sender_id) === recipient) {
      const err = new Error("INCOMING_EXISTS");
      err.code = "INCOMING_EXISTS";
      err.requestId = String(row.id);
      throw err;
    }

    return row || null;
  }

  const data = peopleReadLocalSocial();

  const request = {
    id: cryptoAccounts.randomUUID(),
    sender_id: sender,
    recipient_id: recipient,
    created_at: new Date().toISOString()
  };

  data.friend_requests.push(request);
  peopleWriteLocalSocial(data);

  return request;
}

async function peopleAcceptFriendRequest(accountId, requestId) {
  const me = String(accountId);
  const id = String(requestId);

  if (peoplePool) {
    const client = await peoplePool.connect();

    try {
      await client.query("BEGIN");

      const found = await client.query(
        "SELECT id, sender_id, recipient_id " +
        "FROM people_friend_requests " +
        "WHERE id = $1 AND recipient_id = $2 " +
        "FOR UPDATE",
        [id, me]
      );

      const request = found.rows[0];

      if (!request) {
        await client.query("ROLLBACK");
        return null;
      }

      const sender = String(request.sender_id);

      await client.query(
        "INSERT INTO people_friends (user_id, friend_id) " +
        "VALUES ($1, $2), ($2, $1) " +
        "ON CONFLICT DO NOTHING",
        [me, sender]
      );

      await client.query(
        "DELETE FROM people_friend_requests " +
        "WHERE (sender_id = $1 AND recipient_id = $2) " +
        "OR (sender_id = $2 AND recipient_id = $1)",
        [me, sender]
      );

      await client.query("COMMIT");

      return {
        senderId: sender,
        recipientId: me
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  const data = peopleReadLocalSocial();

  const request = data.friend_requests.find(
    (item) =>
      String(item.id) === id &&
      String(item.recipient_id) === me
  );

  if (!request) return null;

  const sender = String(request.sender_id);
  const now = new Date().toISOString();

  const ensure = (owner, friend) => {
    if (
      !data.friends.some(
        (item) =>
          String(item.user_id) === owner &&
          String(item.friend_id) === friend
      )
    ) {
      data.friends.push({
        user_id: owner,
        friend_id: friend,
        created_at: now
      });
    }
  };

  ensure(me, sender);
  ensure(sender, me);

  data.friend_requests = data.friend_requests.filter(
    (item) =>
      !(
        (
          String(item.sender_id) === me &&
          String(item.recipient_id) === sender
        ) ||
        (
          String(item.sender_id) === sender &&
          String(item.recipient_id) === me
        )
      )
  );

  peopleWriteLocalSocial(data);

  return {
    senderId: sender,
    recipientId: me
  };
}

async function peopleDeleteFriendRequest(accountId, requestId) {
  const me = String(accountId);
  const id = String(requestId);

  if (peoplePool) {
    const result = await peoplePool.query(
      "DELETE FROM people_friend_requests " +
      "WHERE id = $1 " +
      "AND (sender_id = $2 OR recipient_id = $2) " +
      "RETURNING id, sender_id, recipient_id",
      [id, me]
    );

    const row = result.rows[0];

    if (!row) return null;

    return {
      senderId: String(row.sender_id),
      recipientId: String(row.recipient_id)
    };
  }

  const data = peopleReadLocalSocial();

  const request = data.friend_requests.find(
    (item) =>
      String(item.id) === id &&
      (
        String(item.sender_id) === me ||
        String(item.recipient_id) === me
      )
  );

  if (!request) return null;

  data.friend_requests = data.friend_requests.filter(
    (item) => String(item.id) !== id
  );

  peopleWriteLocalSocial(data);

  return {
    senderId: String(request.sender_id),
    recipientId: String(request.recipient_id)
  };
}
// === PEOPLE_FRIEND_REQUESTS_V2_END ===

async function peopleCreateDm(
  senderId,
  recipientId,
  body,
  imageId = null,
  replyToId = null
) {
  const sender =
    String(senderId);

  const recipient =
    String(recipientId);

  const rawBody =
    String(body || "")
      .trim();

  const cleanBody =
    peopleDmE2eeIsEnvelope(
      rawBody
    )
      ? rawBody
      : rawBody.slice(
          0,
          2000
        );

  const imageKey =
    peopleNormalizeMessageImageId(
      imageId
    );

  const replyKey =
    peopleReplyId(
      replyToId
    );

  if (
    !cleanBody &&
    !imageKey
  ) {
    return null;
  }

  if (peoplePool) {
    await peopleEnsureReplyColumns();

    const client =
      await peoplePool.connect();

    try {
      await client.query("BEGIN");

      const reply =
        replyKey
          ? await peopleDmReplyPreview(
              sender,
              recipient,
              replyKey,
              client
            )
          : null;

      if (
        replyKey &&
        !reply
      ) {
        const err =
          new Error("REPLY_INVALID");

        err.code =
          "REPLY_INVALID";

        throw err;
      }

      const result =
        await client.query(
          "INSERT INTO people_direct_messages " +
          "(sender_id, recipient_id, body, reply_to_id) " +
          "VALUES ($1, $2, $3, $4) " +
          "RETURNING id, sender_id, recipient_id, body, reply_to_id, created_at, read_at",
          [
            sender,
            recipient,
            peopleEncryptMessageText(
              cleanBody
            ),
            replyKey || null
          ]
        );

      const row =
        result.rows[0];

      let boundImageId =
        null;

      if (imageKey) {
        boundImageId =
          await peopleBindDmMessageImage(
            sender,
            imageKey,
            row.id,
            sender,
            recipient,
            client
          );

        if (!boundImageId) {
          const err =
            new Error("IMAGE_INVALID");

          err.code =
            "IMAGE_INVALID";

          throw err;
        }
      }

      await client.query("COMMIT");

      row.body =
        peopleDecryptMessageText(
          row.body
        );

      row.image_id =
        boundImageId;

      row.reply_to =
        reply;

      return row;
    } catch (err) {
      await client
        .query("ROLLBACK")
        .catch(() => {});

      throw err;
    } finally {
      client.release();
    }
  }

  const data =
    peopleReadLocalSocial();

  const reply =
    replyKey
      ? await peopleDmReplyPreview(
          sender,
          recipient,
          replyKey
        )
      : null;

  if (
    replyKey &&
    !reply
  ) {
    const err =
      new Error("REPLY_INVALID");

    err.code =
      "REPLY_INVALID";

    throw err;
  }

  const message = {
    id:
      cryptoAccounts.randomUUID(),
    sender_id:
      sender,
    recipient_id:
      recipient,
    body:
      cleanBody,
    image_id:
      null,
    reply_to_id:
      replyKey || null,
    created_at:
      new Date().toISOString(),
    read_at:
      null
  };

  if (imageKey) {
    const bound =
      await peopleBindDmMessageImage(
        sender,
        imageKey,
        message.id,
        sender,
        recipient
      );

    if (!bound) {
      const err =
        new Error("IMAGE_INVALID");

      err.code =
        "IMAGE_INVALID";

      throw err;
    }

    message.image_id =
      bound;
  }

  data.dms.push(message);

  if (
    data.dms.length >
    10000
  ) {
    data.dms =
      data.dms.slice(-10000);
  }

  peopleWriteLocalSocial(data);

  message.reply_to =
    reply;

  return message;
}

// === PEOPLE_DM_PAGINATION_V1_START ===
const PEOPLE_DM_HISTORY_PAGE_SIZE = 50;

async function peopleDmHistory(
  accountId,
  otherId,
  options = null
) {
  const me =
    String(accountId);

  const other =
    String(otherId);

  const beforeRaw =
    String(
      options?.before ||
      ""
    ).trim();

  const afterRaw =
    String(
      options?.after ||
      ""
    ).trim();

  function peopleDmHistoryCursor(value) {
    if (!value) {
      return null;
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return null;
    }

    return date.toISOString();
  }

  const before =
    peopleDmHistoryCursor(
      beforeRaw
    );

  const after =
    before
      ? null
      : peopleDmHistoryCursor(
          afterRaw
        );

  const direction =
    before
      ? "older"
      : after
        ? "newer"
        : "latest";

  if (peoplePool) {
    await peopleEnsureReplyColumns();

    const params = [
      me,
      other
    ];

    let cursorSql = "";
    let orderSql = "DESC";

    if (before) {
      params.push(before);
      cursorSql =
        " AND dm.created_at < $3 ";
    } else if (after) {
      params.push(after);
      cursorSql =
        " AND dm.created_at > $3 ";
      orderSql = "ASC";
    }

    const result =
      await peoplePool.query(
        "SELECT " +
        "dm.id, dm.sender_id, dm.recipient_id, dm.body, dm.reply_to_id, dm.created_at, dm.read_at, " +
        "(SELECT i.id FROM people_message_images i " +
        "WHERE i.dm_message_id = dm.id LIMIT 1) AS image_id, " +
        "ra.username AS reply_sender_username, " +
        "rdm.body AS reply_body, " +
        "(SELECT ri.id FROM people_message_images ri " +
        "WHERE ri.dm_message_id = rdm.id LIMIT 1) AS reply_image_id " +
        "FROM people_direct_messages dm " +
        "LEFT JOIN people_direct_messages rdm " +
        "ON rdm.id = dm.reply_to_id " +
        "LEFT JOIN people_accounts ra " +
        "ON ra.id = rdm.sender_id " +
        "WHERE ((dm.sender_id = $1 AND dm.recipient_id = $2) " +
        "OR (dm.sender_id = $2 AND dm.recipient_id = $1)) " +
        cursorSql +
        "ORDER BY dm.created_at " +
        orderSql +
        " LIMIT " +
        String(
          PEOPLE_DM_HISTORY_PAGE_SIZE +
          1
        ),
        params
      );

    const hasMore =
      result.rows.length >
      PEOPLE_DM_HISTORY_PAGE_SIZE;

    let rows =
      result.rows.slice(
        0,
        PEOPLE_DM_HISTORY_PAGE_SIZE
      );

    if (
      orderSql === "DESC"
    ) {
      rows =
        rows.reverse();
    }

    return {
      messages:
        rows.map(
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
        ),
      hasMore,
      direction
    };
  }

  const all =
    peopleReadLocalSocial()
      .dms;

  const byId =
    new Map(
      all.map(
        (message) => [
          String(message.id),
          message
        ]
      )
    );

  const beforeTime =
    before
      ? new Date(before).getTime()
      : null;

  const afterTime =
    after
      ? new Date(after).getTime()
      : null;

  let filtered =
    all
      .filter(
        (message) => {
          const inConversation =
            (
              String(
                message.sender_id
              ) === me &&
              String(
                message.recipient_id
              ) === other
            ) ||
            (
              String(
                message.sender_id
              ) === other &&
              String(
                message.recipient_id
              ) === me
            );

          if (!inConversation) {
            return false;
          }

          const time =
            new Date(
              message.created_at
            ).getTime();

          if (
            beforeTime !== null &&
            !(time < beforeTime)
          ) {
            return false;
          }

          if (
            afterTime !== null &&
            !(time > afterTime)
          ) {
            return false;
          }

          return true;
        }
      )
      .sort(
        (a, b) => {
          const left =
            new Date(
              a.created_at
            ).getTime();

          const right =
            new Date(
              b.created_at
            ).getTime();

          return after
            ? left - right
            : right - left;
        }
      );

  const hasMore =
    filtered.length >
    PEOPLE_DM_HISTORY_PAGE_SIZE;

  filtered =
    filtered.slice(
      0,
      PEOPLE_DM_HISTORY_PAGE_SIZE
    );

  if (!after) {
    filtered.reverse();
  }

  /*
    On clone les lignes locales avant d'ajouter les infos de réponse.
    Ça évite de modifier people-social.local.json juste parce qu'on a lu
    une page d'historique.
  */
  filtered =
    filtered.map(
      (message) => ({
        ...message
      })
    );

  for (const message of filtered) {
    const replyId =
      peopleReplyId(
        message.reply_to_id
      );

    const reply =
      replyId
        ? byId.get(replyId)
        : null;

    if (replyId && reply) {
      const sender =
        await peopleFindAccountById(
          reply.sender_id
        );

      message.reply_sender_username =
        sender?.username ||
        "Utilisateur";

      message.reply_body =
        reply.body || "";

      message.reply_image_id =
        reply.image_id || null;
    } else {
      message.reply_sender_username =
        null;

      message.reply_body =
        null;

      message.reply_image_id =
        null;
    }
  }

  return {
    messages:
      filtered,
    hasMore,
    direction
  };
}
// === PEOPLE_DM_PAGINATION_V1_END ===

async function peopleMarkDmRead(accountId, otherId) {
  const me = String(accountId);
  const other = String(otherId);

  if (peoplePool) {
    await peoplePool.query(
      "UPDATE people_direct_messages SET read_at = NOW() " +
      "WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL",
      [me, other]
    );
    return;
  }

  const data = peopleReadLocalSocial();
  let changed = false;

  for (const message of data.dms) {
    if (
      String(message.recipient_id) === me &&
      String(message.sender_id) === other &&
      !message.read_at
    ) {
      message.read_at = new Date().toISOString();
      changed = true;
    }
  }

  if (changed) peopleWriteLocalSocial(data);
}

// === PEOPLE_DM_CLOSE_V1_START ===
async function peopleDmClosedIds(
  accountId
) {
  const me =
    String(
      accountId
    );

  if (peoplePool) {
    const result =
      await peoplePool.query(
        "SELECT other_id FROM people_closed_dms WHERE user_id = $1",
        [
          me
        ]
      );

    return new Set(
      result.rows.map(
        (row) =>
          String(
            row.other_id
          )
      )
    );
  }

  const data =
    peopleReadLocalSocial();

  return new Set(
    (
      Array.isArray(
        data.closed_dms
      )
        ? data.closed_dms
        : []
    )
      .filter(
        (item) =>
          String(
            item.user_id
          ) === me
      )
      .map(
        (item) =>
          String(
            item.other_id
          )
      )
  );
}

async function peopleSetDmClosed(
  accountId,
  otherId,
  closed
) {
  const me =
    String(
      accountId
    );

  const other =
    String(
      otherId
    );

  if (
    !me ||
    !other ||
    me === other
  ) {
    return;
  }

  if (peoplePool) {
    if (closed) {
      await peoplePool.query(
        "INSERT INTO people_closed_dms (user_id, other_id) " +
        "VALUES ($1, $2) " +
        "ON CONFLICT (user_id, other_id) " +
        "DO UPDATE SET closed_at = NOW()",
        [
          me,
          other
        ]
      );
    } else {
      await peoplePool.query(
        "DELETE FROM people_closed_dms " +
        "WHERE user_id = $1 AND other_id = $2",
        [
          me,
          other
        ]
      );
    }

    return;
  }

  const data =
    peopleReadLocalSocial();

  const list =
    Array.isArray(
      data.closed_dms
    )
      ? data.closed_dms
      : [];

  data.closed_dms =
    list.filter(
      (item) =>
        !(
          String(
            item.user_id
          ) === me &&
          String(
            item.other_id
          ) === other
        )
    );

  if (closed) {
    data.closed_dms.push({
      user_id:
        me,
      other_id:
        other,
      closed_at:
        new Date()
          .toISOString()
    });
  }

  peopleWriteLocalSocial(
    data
  );
}
// === PEOPLE_DM_CLOSE_V1_END ===

async function peopleDmConversations(accountId) {
  const me =
    String(accountId);

  const closedIds =
    await peopleDmClosedIds(
      me
    );

  let messages;

  if (peoplePool) {
    const result =
      await peoplePool.query(
        "SELECT " +
        "dm.id, dm.sender_id, dm.recipient_id, dm.body, dm.created_at, dm.read_at, " +
        "(SELECT i.id FROM people_message_images i " +
        "WHERE i.dm_message_id = dm.id LIMIT 1) AS image_id " +
        "FROM people_direct_messages dm " +
        "WHERE dm.sender_id = $1 OR dm.recipient_id = $1 " +
        "ORDER BY dm.created_at DESC LIMIT 1000",
        [me]
      );

    messages =
      result.rows;
  } else {
    messages =
      peopleReadLocalSocial()
        .dms
        .filter(
          (message) =>
            String(
              message.sender_id
            ) === me ||
            String(
              message.recipient_id
            ) === me
        )
        .sort(
          (a, b) =>
            new Date(
              b.created_at
            ).getTime() -
            new Date(
              a.created_at
            ).getTime()
        )
        .slice(0, 1000);
  }

  const map =
    new Map();

  for (
    const message of messages
  ) {
    const otherId =
      String(
        message.sender_id
      ) === me
        ? String(
            message.recipient_id
          )
        : String(
            message.sender_id
          );

    if (
      closedIds.has(
        otherId
      )
    ) {
      continue;
    }

    if (
      !map.has(otherId)
    ) {
      map.set(
        otherId,
        {
          otherId,
          lastMessage:
            peopleDmCallConversationPreview(
              message.body,
              message.image_id
            ),
          lastMessageE2ee:
            peopleDmE2eeIsEnvelope(
              message.body
            )
              ? message.body
              : null,
          lastAt:
            message.created_at,
          unreadCount:
            0
        }
      );
    }

    if (
      String(
        message.recipient_id
      ) === me &&
      !message.read_at
    ) {
      map.get(
        otherId
      ).unreadCount += 1;
    }
  }

  const out = [];
  const conversationItems = [
    ...map.values()
  ];
  const accounts = await peopleFindAccountsByIds(
    conversationItems.map(
      (item) => item.otherId
    )
  );
  const accountsById = new Map(
    accounts.map((account) => [
      String(account.id),
      account
    ])
  );

  for (
    const item of conversationItems
  ) {
    const account =
      accountsById.get(
        String(item.otherId)
      );

    if (!account) {
      continue;
    }

    out.push({
      user: {
        ...peoplePublicAccount(
          account
        ),
        online:
          peopleAccountIsOnline(
            account.id
          )
      },
      lastMessage:
        item.lastMessage,
      lastMessageE2ee:
        item.lastMessageE2ee ||
        null,
      lastAt:
        item.lastAt,
      unreadCount:
        item.unreadCount
    });
  }

  out.sort(
    (a, b) =>
      new Date(
        b.lastAt
      ).getTime() -
      new Date(
        a.lastAt
      ).getTime()
  );

  return out;
}

// === PEOPLE_GENERAL_HISTORY_V1_START ===
const PEOPLE_LOCAL_GENERAL =
  pathAccounts.join(
    __dirname,
    "people-general.local.json"
  );

function peopleReadLocalGeneral() {
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
}

function peopleWriteLocalGeneral(messages) {
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
    ) + "\n",
    "utf8"
  );
}

// === PEOPLE_MESSAGE_REPLIES_DELETE_V1_START ===
let peopleReplyColumnsPromise = null;

function peopleReplyId(value) {
  return String(value || "")
    .trim()
    .slice(0, 100);
}

async function peopleEnsureReplyColumns() {
  if (!peoplePool) return;

  if (!peopleReplyColumnsPromise) {
    peopleReplyColumnsPromise =
      Promise.all([
        peoplePool.query(
          "ALTER TABLE people_general_messages " +
          "ADD COLUMN IF NOT EXISTS reply_to_id BIGINT NULL"
        ),
        peoplePool.query(
          "ALTER TABLE people_direct_messages " +
          "ADD COLUMN IF NOT EXISTS reply_to_id BIGINT NULL"
        ),
        peoplePool.query(
          "CREATE INDEX IF NOT EXISTS people_general_reply_idx " +
          "ON people_general_messages(reply_to_id)"
        ),
        peoplePool.query(
          "CREATE INDEX IF NOT EXISTS people_dm_reply_idx " +
          "ON people_direct_messages(reply_to_id)"
        )
      ]).catch((err) => {
        peopleReplyColumnsPromise = null;
        throw err;
      });
  }

  await peopleReplyColumnsPromise;
}

function peopleDeletedReply(id) {
  return {
    id: String(id),
    username: "Message supprimé",
    text: "",
    imageId: null,
    deleted: true
  };
}

async function peopleGeneralReplyPreview(
  replyToId,
  db = peoplePool
) {
  const id =
    peopleReplyId(replyToId);

  if (!id) return null;

  if (peoplePool) {
    if (!/^\d+$/.test(id)) {
      return null;
    }

    const result =
      await db.query(
        "SELECT gm.id, gm.username, gm.body, " +
        "(SELECT i.id FROM people_message_images i " +
        "WHERE i.general_message_id = gm.id LIMIT 1) AS image_id " +
        "FROM people_general_messages gm " +
        "WHERE gm.id = $1 LIMIT 1",
        [id]
      );

    const row =
      result.rows[0];

    if (!row) return null;

    return {
      id: String(row.id),
      username: row.username,
      text:
        peopleDecryptMessageText(
          row.body
        ),
      imageId:
        row.image_id
          ? String(row.image_id)
          : null,
      deleted: false
    };
  }

  const message =
    peopleReadLocalGeneral()
      .find(
        (item) =>
          String(item.id) === id
      );

  if (!message) return null;

  return {
    id: String(message.id),
    username:
      String(message.username || ""),
    text:
      String(message.text || ""),
    imageId:
      message.imageId
        ? String(message.imageId)
        : null,
    deleted: false
  };
}

async function peopleDmReplyPreview(
  accountA,
  accountB,
  replyToId,
  db = peoplePool
) {
  const me =
    String(accountA);

  const other =
    String(accountB);

  const id =
    peopleReplyId(replyToId);

  if (!id) return null;

  if (peoplePool) {
    if (!/^\d+$/.test(id)) {
      return null;
    }

    const result =
      await db.query(
        "SELECT dm.id, dm.sender_id, dm.body, " +
        "a.username AS sender_username, " +
        "(SELECT i.id FROM people_message_images i " +
        "WHERE i.dm_message_id = dm.id LIMIT 1) AS image_id " +
        "FROM people_direct_messages dm " +
        "LEFT JOIN people_accounts a ON a.id = dm.sender_id " +
        "WHERE dm.id = $3 AND (" +
        "(dm.sender_id = $1 AND dm.recipient_id = $2) OR " +
        "(dm.sender_id = $2 AND dm.recipient_id = $1)" +
        ") LIMIT 1",
        [me, other, id]
      );

    const row =
      result.rows[0];

    if (!row) return null;

    return {
      id: String(row.id),
      username:
        row.sender_username ||
        "Utilisateur",
      text:
        peopleDecryptMessageText(
          row.body
        ),
      imageId:
        row.image_id
          ? String(row.image_id)
          : null,
      deleted: false
    };
  }

  const message =
    peopleReadLocalSocial()
      .dms
      .find(
        (item) =>
          String(item.id) === id &&
          (
            (
              String(item.sender_id) === me &&
              String(item.recipient_id) === other
            ) ||
            (
              String(item.sender_id) === other &&
              String(item.recipient_id) === me
            )
          )
      );

  if (!message) return null;

  const sender =
    await peopleFindAccountById(
      message.sender_id
    );

  return {
    id: String(message.id),
    username:
      sender?.username ||
      "Utilisateur",
    text:
      String(message.body || ""),
    imageId:
      message.image_id
        ? String(message.image_id)
        : null,
    deleted: false
  };
}

function peopleDeleteLocalBoundMessageImage(
  scope,
  messageId
) {
  if (peoplePool) return;

  const wantedScope =
    String(scope);

  const wantedMessage =
    String(messageId);

  const meta =
    peopleReadLocalMessageImageMeta();

  let changed = false;

  for (
    const [id, item]
    of Object.entries(meta)
  ) {
    if (
      String(item?.scope) !==
        wantedScope ||
      String(item?.messageId) !==
        wantedMessage
    ) {
      continue;
    }

    if (item.file) {
      try {
        fsAccounts.unlinkSync(
          pathAccounts.join(
            PEOPLE_LOCAL_MESSAGE_IMAGE_DIR,
            item.file
          )
        );
      } catch {}
    }

    delete meta[id];
    changed = true;
  }

  if (changed) {
    peopleWriteLocalMessageImageMeta(
      meta
    );
  }
}

async function peopleDeleteGeneralMessage(
  accountId,
  messageId
) {
  const owner =
    String(accountId);

  const id =
    peopleReplyId(messageId);

  if (!id) return false;

  if (peoplePool) {
    await peopleEnsureReplyColumns();

    if (!/^\d+$/.test(id)) {
      return false;
    }

    const result =
      await peoplePool.query(
        "DELETE FROM people_general_messages " +
        "WHERE id = $1 AND sender_id = $2 " +
        "RETURNING id",
        [id, owner]
      );

    return Boolean(
      result.rows[0]
    );
  }

  const messages =
    peopleReadLocalGeneral();

  const index =
    messages.findIndex(
      (item) =>
        String(item.id) === id &&
        String(item.senderId) === owner
    );

  if (index < 0) {
    return false;
  }

  messages.splice(
    index,
    1
  );

  peopleWriteLocalGeneral(
    messages
  );

  peopleDeleteLocalBoundMessageImage(
    "general",
    id
  );

  return true;
}

async function peopleDeleteDmMessage(
  accountId,
  messageId
) {
  const owner =
    String(accountId);

  const id =
    peopleReplyId(messageId);

  if (!id) return null;

  if (peoplePool) {
    await peopleEnsureReplyColumns();

    if (!/^\d+$/.test(id)) {
      return null;
    }

    const result =
      await peoplePool.query(
        "DELETE FROM people_direct_messages " +
        "WHERE id = $1 AND sender_id = $2 " +
        "RETURNING id, sender_id, recipient_id",
        [id, owner]
      );

    const row =
      result.rows[0];

    if (!row) return null;

    return {
      id:
        String(row.id),
      senderId:
        String(row.sender_id),
      recipientId:
        String(row.recipient_id)
    };
  }

  const data =
    peopleReadLocalSocial();

  const index =
    data.dms.findIndex(
      (item) =>
        String(item.id) === id &&
        String(item.sender_id) === owner
    );

  if (index < 0) {
    return null;
  }

  const message =
    data.dms[index];

  data.dms.splice(
    index,
    1
  );

  peopleWriteLocalSocial(
    data
  );

  peopleDeleteLocalBoundMessageImage(
    "dm",
    id
  );

  return {
    id,
    senderId:
      String(message.sender_id),
    recipientId:
      String(message.recipient_id)
  };
}

function peopleDmReplyFromHistoryRow(
  message
) {
  const replyId =
    peopleReplyId(
      message?.reply_to_id
    );

  if (!replyId) {
    return null;
  }

  if (
    !message.reply_sender_username
  ) {
    return peopleDeletedReply(
      replyId
    );
  }

  return {
    id: replyId,
    username:
      message.reply_sender_username,
    text:
      message.reply_body || "",
    imageId:
      message.reply_image_id
        ? String(
            message.reply_image_id
          )
        : null,
    deleted: false
  };
}
// === PEOPLE_MESSAGE_REPLIES_DELETE_V1_END ===

async function peopleSaveGeneralMessage(
  senderId,
  username,
  text,
  imageId = null,
  replyToId = null
) {
  const cleanUsername =
    peopleUsername(username).slice(0, 24);

  const cleanText =
    String(text || "")
      .trim()
      .slice(0, 1000);

  const imageKey =
    peopleNormalizeMessageImageId(
      imageId
    );

  const replyKey =
    peopleReplyId(
      replyToId
    );

  if (
    !cleanUsername ||
    (
      !cleanText &&
      !imageKey
    )
  ) {
    return null;
  }

  if (peoplePool) {
    await peopleEnsureReplyColumns();

    const client =
      await peoplePool.connect();

    try {
      await client.query("BEGIN");

      const reply =
        replyKey
          ? await peopleGeneralReplyPreview(
              replyKey,
              client
            )
          : null;

      if (
        replyKey &&
        !reply
      ) {
        const err =
          new Error("REPLY_INVALID");

        err.code =
          "REPLY_INVALID";

        throw err;
      }

      const result =
        await client.query(
          "INSERT INTO people_general_messages " +
          "(sender_id, username, body, reply_to_id) " +
          "VALUES ($1, $2, $3, $4) " +
          "RETURNING id, username, body, reply_to_id, created_at",
          [
            String(senderId),
            cleanUsername,
            peopleEncryptMessageText(
              cleanText
            ),
            replyKey || null
          ]
        );

      const row =
        result.rows[0];

      let boundImageId =
        null;

      if (imageKey) {
        boundImageId =
          await peopleBindGeneralMessageImage(
            senderId,
            imageKey,
            row.id,
            client
          );

        if (!boundImageId) {
          const err =
            new Error("IMAGE_INVALID");

          err.code =
            "IMAGE_INVALID";

          throw err;
        }
      }

      await client.query("COMMIT");

      return {
        id:
          String(row.id),
        username:
          row.username,
        text:
          peopleDecryptMessageText(
            row.body
          ),
        imageId:
          boundImageId,
        replyTo:
          reply,
        time:
          new Date(
            row.created_at
          ).getTime()
      };
    } catch (err) {
      await client
        .query("ROLLBACK")
        .catch(() => {});

      throw err;
    } finally {
      client.release();
    }
  }

  const messages =
    peopleReadLocalGeneral();

  const reply =
    replyKey
      ? await peopleGeneralReplyPreview(
          replyKey
        )
      : null;

  if (
    replyKey &&
    !reply
  ) {
    const err =
      new Error("REPLY_INVALID");

    err.code =
      "REPLY_INVALID";

    throw err;
  }

  const message = {
    id:
      cryptoAccounts.randomUUID(),
    senderId:
      String(senderId),
    username:
      cleanUsername,
    text:
      cleanText,
    imageId:
      null,
    replyToId:
      replyKey || null,
    time:
      Date.now()
  };

  if (imageKey) {
    const bound =
      await peopleBindGeneralMessageImage(
        senderId,
        imageKey,
        message.id
      );

    if (!bound) {
      const err =
        new Error("IMAGE_INVALID");

      err.code =
        "IMAGE_INVALID";

      throw err;
    }

    message.imageId =
      bound;
  }

  messages.push(message);

  peopleWriteLocalGeneral(
    messages
  );

  return {
    ...message,
    replyTo: reply
  };
}

async function peopleLoadGeneralMessages(
  limit = 100
) {
  const safeLimit =
    Math.max(
      1,
      Math.min(
        200,
        Number(limit) || 100
      )
    );

  if (peoplePool) {
    await peopleEnsureReplyColumns();

    const result =
      await peoplePool.query(
        "SELECT " +
        "gm.id, gm.username, gm.body, gm.reply_to_id, gm.created_at, " +
        "(SELECT i.id FROM people_message_images i " +
        "WHERE i.general_message_id = gm.id LIMIT 1) AS image_id, " +
        "rgm.username AS reply_username, " +
        "rgm.body AS reply_body, " +
        "(SELECT ri.id FROM people_message_images ri " +
        "WHERE ri.general_message_id = rgm.id LIMIT 1) AS reply_image_id " +
        "FROM people_general_messages gm " +
        "LEFT JOIN people_general_messages rgm " +
        "ON rgm.id = gm.reply_to_id " +
        "ORDER BY gm.created_at DESC " +
        "LIMIT $1",
        [safeLimit]
      );

    return result.rows
      .reverse()
      .map((row) => ({
        id:
          String(row.id),
        username:
          row.username,
        text:
          peopleDecryptMessageText(
            row.body
          ),
        imageId:
          row.image_id
            ? String(row.image_id)
            : null,
        replyTo:
          row.reply_to_id
            ? (
                row.reply_username
                  ? {
                      id:
                        String(
                          row.reply_to_id
                        ),
                      username:
                        row.reply_username,
                      text:
                        peopleDecryptMessageText(
                          row.reply_body || ""
                        ),
                      imageId:
                        row.reply_image_id
                          ? String(
                              row.reply_image_id
                            )
                          : null,
                      deleted:
                        false
                    }
                  : peopleDeletedReply(
                      row.reply_to_id
                    )
              )
            : null,
        time:
          new Date(
            row.created_at
          ).getTime()
      }));
  }

  const all =
    peopleReadLocalGeneral();

  const byId =
    new Map(
      all.map(
        (message) => [
          String(message.id),
          message
        ]
      )
    );

  return all
    .slice(-safeLimit)
    .map((message) => {
      const replyId =
        peopleReplyId(
          message.replyToId
        );

      const target =
        replyId
          ? byId.get(replyId)
          : null;

      return {
        id:
          String(message.id || ""),
        username:
          String(
            message.username || ""
          ),
        text:
          String(
            message.text || ""
          ),
        imageId:
          message.imageId
            ? String(
                message.imageId
              )
            : null,
        replyTo:
          replyId
            ? (
                target
                  ? {
                      id:
                        String(target.id),
                      username:
                        String(
                          target.username || ""
                        ),
                      text:
                        String(
                          target.text || ""
                        ),
                      imageId:
                        target.imageId
                          ? String(
                              target.imageId
                            )
                          : null,
                      deleted:
                        false
                    }
                  : peopleDeletedReply(
                      replyId
                    )
              )
            : null,
        time:
          Number(
            message.time ||
            Date.now()
          )
      };
    });
}
// === PEOPLE_GENERAL_HISTORY_V1_END ===

function peopleEmitToAccount(accountId, event, payload) {
  const wanted = String(accountId);

  for (const [socketId, id] of userIds.entries()) {
    if (String(id) === wanted) {
      io.to(socketId).emit(event, payload);
    }
  }
}

async function peopleInitSocial() {
  if (!PEOPLE_DB_URL) {
    if (!fsAccounts.existsSync(PEOPLE_LOCAL_SOCIAL)) {
      peopleWriteLocalSocial({
        friends: [],
        dms: [],
        friend_requests: []
      });
    }

    // PEOPLE_FRIENDS_MUTUAL_LOCAL_MIGRATION
    {
      const socialData = peopleReadLocalSocial();
      const pairs = new Set(
        socialData.friends.map(
          (item) =>
            String(item.user_id) + ":" +
            String(item.friend_id)
        )
      );

      const cleaned = socialData.friends.filter(
        (item) =>
          pairs.has(
            String(item.friend_id) + ":" +
            String(item.user_id)
          )
      );

      if (cleaned.length !== socialData.friends.length) {
        socialData.friends = cleaned;
        peopleWriteLocalSocial(socialData);
      }
    }

    const accounts = peopleReadLocalAccounts();
    let changed = false;

    for (const account of accounts) {
      if (typeof account.description !== "string") {
        account.description = "";
        changed = true;
      }

      const appearance =
        peopleAppearanceFromAccount(account);

      if (
        account.appearance_theme !==
        appearance.theme
      ) {
        account.appearance_theme =
          appearance.theme;
        changed = true;
      }

      if (
        account.appearance_accent !==
        appearance.accent
      ) {
        account.appearance_accent =
          appearance.accent;
        changed = true;
      }
    }

    if (changed) peopleWriteLocalAccounts(accounts);

    console.log("[People] Profils et MP locaux actives.");
    return;
  }

  await peoplePool.query(
    "ALTER TABLE people_accounts " +
    "ADD COLUMN IF NOT EXISTS description VARCHAR(280) NOT NULL DEFAULT ''"
  );

  await peoplePool.query(
    "ALTER TABLE people_accounts " +
    "ADD COLUMN IF NOT EXISTS appearance_theme VARCHAR(16) NOT NULL DEFAULT 'dark'"
  );

  await peoplePool.query(
    "ALTER TABLE people_accounts " +
    "ADD COLUMN IF NOT EXISTS appearance_accent VARCHAR(7) NOT NULL DEFAULT '#67589D'"
  );

  await peoplePool.query(
    "ALTER TABLE people_accounts " +
    "ADD COLUMN IF NOT EXISTS appearance_palette TEXT NOT NULL DEFAULT ''"
  );

  await peoplePool.query(
    "CREATE TABLE IF NOT EXISTS people_friends (" +
    "user_id BIGINT NOT NULL REFERENCES people_accounts(id) ON DELETE CASCADE, " +
    "friend_id BIGINT NOT NULL REFERENCES people_accounts(id) ON DELETE CASCADE, " +
    "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
    "PRIMARY KEY (user_id, friend_id)" +
    ")"
  );

  await peoplePool.query(
    "CREATE TABLE IF NOT EXISTS people_friend_requests (" +
    "id BIGSERIAL PRIMARY KEY, " +
    "sender_id BIGINT NOT NULL REFERENCES people_accounts(id) ON DELETE CASCADE, " +
    "recipient_id BIGINT NOT NULL REFERENCES people_accounts(id) ON DELETE CASCADE, " +
    "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
    "UNIQUE(sender_id, recipient_id), " +
    "CHECK(sender_id <> recipient_id)" +
    ")"
  );

  await peoplePool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS people_friend_requests_pair_idx " +
    "ON people_friend_requests (" +
    "LEAST(sender_id, recipient_id), " +
    "GREATEST(sender_id, recipient_id)" +
    ")"
  );

  await peoplePool.query(
    "DELETE FROM people_friends f " +
    "WHERE NOT EXISTS (" +
    "SELECT 1 FROM people_friends r " +
    "WHERE r.user_id = f.friend_id " +
    "AND r.friend_id = f.user_id" +
    ")"
  );

  await peoplePool.query(
    "CREATE TABLE IF NOT EXISTS people_general_messages (" +
    "id BIGSERIAL PRIMARY KEY, " +
    "sender_id BIGINT NULL REFERENCES people_accounts(id) ON DELETE SET NULL, " +
    "username VARCHAR(24) NOT NULL, " +
    "body TEXT NOT NULL, " +
    "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
    ")"
  );

  await peoplePool.query(
    "CREATE INDEX IF NOT EXISTS people_general_messages_created_idx " +
    "ON people_general_messages(created_at DESC)"
  );

  await peoplePool.query(
    "CREATE TABLE IF NOT EXISTS people_direct_messages (" +
    "id BIGSERIAL PRIMARY KEY, " +
    "sender_id BIGINT NOT NULL REFERENCES people_accounts(id) ON DELETE CASCADE, " +
    "recipient_id BIGINT NOT NULL REFERENCES people_accounts(id) ON DELETE CASCADE, " +
    "body TEXT NOT NULL, " +
    "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
    "read_at TIMESTAMPTZ NULL" +
    ")"
  );
  await peoplePool.query(
    "CREATE TABLE IF NOT EXISTS people_e2ee_devices (" +
    "user_id BIGINT NOT NULL REFERENCES people_accounts(id) ON DELETE CASCADE, " +
    "device_id VARCHAR(80) NOT NULL, " +
    "public_jwk TEXT NOT NULL, " +
    "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
    "last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
    "PRIMARY KEY (user_id, device_id)" +
    ")"
  );

  await peoplePool.query(
    "CREATE INDEX IF NOT EXISTS people_e2ee_devices_seen_idx " +
    "ON people_e2ee_devices(user_id, last_seen_at DESC)"
  );

  await peoplePool.query(
    "CREATE TABLE IF NOT EXISTS people_closed_dms (" +
    "user_id BIGINT NOT NULL REFERENCES people_accounts(id) ON DELETE CASCADE, " +
    "other_id BIGINT NOT NULL REFERENCES people_accounts(id) ON DELETE CASCADE, " +
    "closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
    "PRIMARY KEY (user_id, other_id), " +
    "CHECK(user_id <> other_id)" +
    ")"
  );

  await peoplePool.query(
    "CREATE TABLE IF NOT EXISTS people_message_images (" +
    "id BIGSERIAL PRIMARY KEY, " +
    "owner_id BIGINT NOT NULL REFERENCES people_accounts(id) ON DELETE CASCADE, " +
    "mime_type VARCHAR(32) NOT NULL, " +
    "data BYTEA NOT NULL, " +
    "general_message_id BIGINT UNIQUE NULL REFERENCES people_general_messages(id) ON DELETE CASCADE, " +
    "dm_message_id BIGINT UNIQUE NULL REFERENCES people_direct_messages(id) ON DELETE CASCADE, " +
    "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
    "CHECK(NOT (general_message_id IS NOT NULL AND dm_message_id IS NOT NULL))" +
    ")"
  );

  await peoplePool.query(
    "CREATE INDEX IF NOT EXISTS people_message_images_owner_idx " +
    "ON people_message_images(owner_id, created_at DESC)"
  );

  await peoplePool.query(
    "CREATE INDEX IF NOT EXISTS people_message_images_pending_created_idx " +
    "ON people_message_images(created_at) " +
    "WHERE general_message_id IS NULL AND dm_message_id IS NULL"
  );

  await peoplePool.query(
    "CREATE INDEX IF NOT EXISTS people_dm_sender_recipient_idx " +
    "ON people_direct_messages(sender_id, recipient_id, created_at DESC)"
  );

  await peoplePool.query(
    "CREATE INDEX IF NOT EXISTS people_dm_recipient_unread_idx " +
    "ON people_direct_messages(recipient_id, read_at)"
  );

  console.log("[People] Profils, amis et MP PostgreSQL actives.");
}

// === PEOPLE_SIMPLE_ADMIN_DELETE_HELPERS_V1 ===
function peopleSimpleAdminKickAccount(
  accountId
) {
  const wanted =
    String(
      accountId
    );

  peopleSimpleDeletedAccounts.add(
    wanted
  );

  for (
    const call of
    [...peopleDmCalls.values()]
  ) {
    if (
      String(
        call?.callerAccountId ||
        ""
      ) === wanted ||
      String(
        call?.calleeAccountId ||
        ""
      ) === wanted
    ) {
      peopleDmCallFinish(
        call.id,
        "disconnected"
      );
    }
  }

  for (
    const [
      socketId,
      currentId
    ]
    of [...userIds.entries()]
  ) {
    if (
      String(
        currentId ||
        ""
      ) !== wanted
    ) {
      continue;
    }

    const socket =
      io.sockets.sockets.get(
        socketId
      );

    if (socket) {
      leaveVoice(
        socket
      );

      socket.emit(
        "account-deleted",
        {
          ok: true
        }
      );

      socket.disconnect(
        true
      );
    }

    users.delete(
      socketId
    );

    userIds.delete(
      socketId
    );

    socketServerIds.delete(
      socketId
    );

    voiceUsers.delete(
      socketId
    );
  }
}

async function peopleSimpleAdminDeleteLocal(
  account
) {
  const id =
    String(
      account.id
    );

  const accounts =
    peopleReadLocalAccounts()
      .filter(
        (item) =>
          String(
            item.id
          ) !== id
      );

  peopleWriteLocalAccounts(
    accounts
  );

  const social =
    peopleReadLocalSocial();

  social.friends =
    (
      Array.isArray(
        social.friends
      )
        ? social.friends
        : []
    ).filter(
      (item) =>
        String(
          item.user_id
        ) !== id &&
        String(
          item.friend_id
        ) !== id
    );

  social.friend_requests =
    (
      Array.isArray(
        social.friend_requests
      )
        ? social.friend_requests
        : []
    ).filter(
      (item) =>
        String(
          item.sender_id
        ) !== id &&
        String(
          item.recipient_id
        ) !== id
    );

  social.dms =
    (
      Array.isArray(
        social.dms
      )
        ? social.dms
        : []
    ).filter(
      (item) =>
        String(
          item.sender_id
        ) !== id &&
        String(
          item.recipient_id
        ) !== id
    );

  if (
    Array.isArray(
      social.closed_dms
    )
  ) {
    social.closed_dms =
      social.closed_dms
        .filter(
          (item) =>
            String(
              item.user_id
            ) !== id &&
            String(
              item.other_id
            ) !== id
        );
  }

  peopleWriteLocalSocial(
    social
  );

  const serverData =
    peopleReadLocalServers();

  serverData.members =
    serverData.members
      .filter(
        (item) =>
          String(
            item.userId ??
            item.user_id ??
            ""
          ) !== id
      );

  /*
    Ici on ne détruit pas directement les serveurs créés
    par ce compte. Ils restent sans propriétaire si des
    membres sont encore présents ; le nettoyage global
    supprimera ensuite ceux qui sont devenus totalement vides.
  */
  serverData.servers =
    serverData.servers.map(
      (item) => {
        const owner =
          String(
            item.ownerId ??
            item.owner_id ??
            ""
          );

        if (
          owner !== id
        ) {
          return item;
        }

        return {
          ...item,
          ownerId: null,
          owner_id: null
        };
      }
    );

  peopleWriteLocalServers(
    serverData
  );
}

async function peopleSimpleAdminDeleteAccount(
  username
) {
  const account =
    await peopleFindAccount(
      username
    );

  if (!account) {
    return null;
  }

  const accountId =
    String(
      account.id
    );

  if (peoplePool) {
    /*
      Les FK existantes de People nettoient les amis,
      demandes, MP, PP, images et memberships.
      Les messages serveur gardent leur historique
      avec sender_id = NULL lorsque prévu par le schéma.
    */
    await peoplePool.query(
      "DELETE FROM people_accounts WHERE id = $1",
      [
        accountId
      ]
    );
  } else {
    await peopleSimpleAdminDeleteLocal(
      account
    );
  }

  peopleSimpleAdminKickAccount(
    accountId
  );

  // === PEOPLE_DELETE_EMPTY_AFTER_ACCOUNT_DELETE_V1 ===
  await peopleDeleteAllEmptyServers();

  return {
    id:
      accountId,
    username:
      account.username
  };
}
// === PEOPLE_SIMPLE_ADMIN_DELETE_HELPERS_V1 ===

// === PEOPLE_PROFILE_AVATARS_V1_START ===
const PEOPLE_LOCAL_AVATAR_DIR =
  pathAccounts.join(__dirname, "people-avatars");

const PEOPLE_LOCAL_AVATAR_META =
  pathAccounts.join(
    __dirname,
    "people-avatar-meta.local.json"
  );

const PEOPLE_AVATAR_MAX_BYTES =
  3 * 1024 * 1024;

let peopleAvatarTablePromise = null;

async function peopleEnsureAvatarTable() {
  if (!peoplePool) return;

  if (!peopleAvatarTablePromise) {
    peopleAvatarTablePromise = peoplePool
      .query(
        "CREATE TABLE IF NOT EXISTS people_profile_avatars (" +
        "account_id BIGINT PRIMARY KEY REFERENCES people_accounts(id) ON DELETE CASCADE, " +
        "mime_type VARCHAR(32) NOT NULL, " +
        "data BYTEA NOT NULL, " +
        "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
        ")"
      )
      .catch((err) => {
        peopleAvatarTablePromise = null;
        throw err;
      });
  }

  await peopleAvatarTablePromise;
}

function peopleAvatarMime(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a
      ])
    )
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (buffer.length >= 6) {
    const sig = buffer.subarray(0, 6).toString("ascii");

    if (sig === "GIF87a" || sig === "GIF89a") {
      return "image/gif";
    }
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

function peopleAvatarExtension(mime) {
  return {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  }[mime] || "";
}

function peopleReadAvatarMeta() {
  try {
    if (!fsAccounts.existsSync(PEOPLE_LOCAL_AVATAR_META)) {
      return {};
    }

    const data = JSON.parse(
      fsAccounts.readFileSync(PEOPLE_LOCAL_AVATAR_META, "utf8")
    );

    return data && typeof data === "object" && !Array.isArray(data)
      ? data
      : {};
  } catch {
    return {};
  }
}

function peopleWriteAvatarMeta(meta) {
  fsAccounts.writeFileSync(
    PEOPLE_LOCAL_AVATAR_META,
    JSON.stringify(meta || {}, null, 2) + "\n",
    "utf8"
  );
}

async function peopleSaveAvatar(accountId, buffer) {
  const ownerId = String(accountId);

  if (
    !Buffer.isBuffer(buffer) ||
    !buffer.length ||
    buffer.length > PEOPLE_AVATAR_MAX_BYTES
  ) {
    const err = new Error("AVATAR_SIZE");
    err.code = "AVATAR_SIZE";
    throw err;
  }

  const mime = peopleAvatarMime(buffer);

  if (!mime) {
    const err = new Error("AVATAR_TYPE");
    err.code = "AVATAR_TYPE";
    throw err;
  }

  if (peoplePool) {
    await peopleEnsureAvatarTable();

    await peoplePool.query(
      "INSERT INTO people_profile_avatars " +
      "(account_id, mime_type, data, updated_at) " +
      "VALUES ($1, $2, $3, NOW()) " +
      "ON CONFLICT (account_id) DO UPDATE SET " +
      "mime_type = EXCLUDED.mime_type, " +
      "data = EXCLUDED.data, " +
      "updated_at = NOW()",
      [ownerId, mime, buffer]
    );

    return {
      mime,
      byteSize: buffer.length
    };
  }

  fsAccounts.mkdirSync(
    PEOPLE_LOCAL_AVATAR_DIR,
    { recursive: true }
  );

  const meta = peopleReadAvatarMeta();
  const previous = meta[ownerId];

  if (previous?.file) {
    try {
      fsAccounts.unlinkSync(
        pathAccounts.join(
          PEOPLE_LOCAL_AVATAR_DIR,
          previous.file
        )
      );
    } catch {}
  }

  const file =
    ownerId + peopleAvatarExtension(mime);

  fsAccounts.writeFileSync(
    pathAccounts.join(
      PEOPLE_LOCAL_AVATAR_DIR,
      file
    ),
    buffer
  );

  meta[ownerId] = {
    file,
    mime,
    updatedAt: new Date().toISOString()
  };

  peopleWriteAvatarMeta(meta);

  return {
    mime,
    byteSize: buffer.length
  };
}

async function peopleLoadAvatar(accountId) {
  const ownerId = String(accountId);

  if (peoplePool) {
    await peopleEnsureAvatarTable();

    const result = await peoplePool.query(
      "SELECT mime_type, data " +
      "FROM people_profile_avatars " +
      "WHERE account_id = $1 LIMIT 1",
      [ownerId]
    );

    const row = result.rows[0];

    if (!row) return null;

    return {
      mime: row.mime_type,
      data: row.data
    };
  }

  const meta = peopleReadAvatarMeta();
  const item = meta[ownerId];

  if (!item?.file) return null;

  const filePath =
    pathAccounts.join(
      PEOPLE_LOCAL_AVATAR_DIR,
      item.file
    );

  if (!fsAccounts.existsSync(filePath)) {
    return null;
  }

  return {
    mime: item.mime,
    data: fsAccounts.readFileSync(filePath)
  };
}

app.get(
  "/api/profile/avatar/:username",
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(req, res);

      if (!session) return;

      const account =
        await peopleFindAccount(
          req.params.username
        );

      if (!account) {
        return res.status(404).end();
      }

      const avatar =
        await peopleLoadAvatar(account.id);

      if (!avatar) {
        return res.status(404).end();
      }

      res.setHeader("Content-Type", avatar.mime);
      res.setHeader(
        "Content-Length",
        String(avatar.data.length)
      );
      res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
      );
      res.setHeader(
        "Cache-Control",
        "private, no-store"
      );

      res.end(avatar.data);
    } catch (err) {
      console.error(
        "[People avatar/get]",
        err
      );

      res.status(500).end();
    }
  }
);

app.put(
  "/api/profile/avatar",
  express.raw({
    type: () => true,
    limit: "3mb"
  }),
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(req, res);

      if (!session) return;

      const saved =
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

      const account =
        await peopleFindAccountById(
          session.id
        );

      if (!account) {
        return res.status(404).json({
          ok: false,
          error: "Compte introuvable."
        });
      }

      io.emit(
        "profile-avatar-updated",
        {
          username: account.username
        }
      );

      res.json({
        ok: true,
        username: account.username,
        mime: saved.mime,
        byteSize: saved.byteSize
      });
    } catch (err) {
      if (
        err?.type === "entity.too.large" ||
        err?.code === "AVATAR_SIZE"
      ) {
        return res.status(413).json({
          ok: false,
          error:
            "La photo de profil doit faire moins de 3 Mo."
        });
      }

      if (err?.code === "AVATAR_TYPE") {
        return res.status(400).json({
          ok: false,
          error:
            "Format non accepte. JPEG, PNG, WebP ou GIF."
        });
      }

      if (
        err?.message ===
        "AVATAR_VERIFY_FAILED"
      ) {
        return res.status(500).json({
          ok: false,
          error:
            "La photo a été reçue mais n'a pas pu être relue depuis le stockage."
        });
      }

      console.error(
        "[People avatar/upload]",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          "Impossible de changer la photo de profil."
      });
    }
  }
);
// === PEOPLE_PROFILE_AVATARS_V1_END ===

// === PEOPLE_AVATAR_ULTRA_UPLOAD_V1_START ===
app.put(
  "/api/profile/avatar-ultra",
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(
          req,
          res
        );

      if (!session) return;

      const encoded =
        String(
          req.body?.data ||
          ""
        ).trim();

      if (
        !encoded ||
        encoded.length >
          26000
      ) {
        return res.status(413).json({
          ok: false,
          error:
            "La photo compressée est encore trop lourde."
        });
      }

      let buffer = null;

      try {
        buffer =
          Buffer.from(
            encoded,
            "base64"
          );
      } catch {
        buffer = null;
      }

      if (
        !Buffer.isBuffer(
          buffer
        ) ||
        buffer.length <= 0 ||
        buffer.length >
          18 * 1024
      ) {
        return res.status(413).json({
          ok: false,
          error:
            "La photo compressée dépasse la limite."
        });
      }

      const mime =
        peopleAvatarMime(
          buffer
        );

      if (
        mime !==
        "image/jpeg"
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "La photo finale doit être en JPEG."
        });
      }

      const saved =
        await peopleSaveAvatar(
          session.id,
          buffer
        );

      const verified =
        await peopleLoadAvatar(
          session.id
        );

      if (
        !verified ||
        !Buffer.isBuffer(
          verified.data
        ) ||
        verified.data.length <= 0
      ) {
        throw new Error(
          "AVATAR_ULTRA_VERIFY"
        );
      }

      const account =
        await peopleFindAccountById(
          session.id
        );

      if (!account) {
        return res.status(404).json({
          ok: false,
          error:
            "Compte introuvable."
        });
      }

      io.emit(
        "profile-avatar-updated",
        {
          username:
            account.username
        }
      );

      res.json({
        ok: true,
        username:
          account.username,
        byteSize:
          saved.byteSize,
        mime:
          saved.mime,
        avatarDataUrl:
          "data:" +
          (
            verified.mime ||
            saved.mime ||
            "image/jpeg"
          ) +
          ";base64," +
          verified.data.toString(
            "base64"
          )
      });
    } catch (err) {
      console.error(
        "[People avatar/ultra]",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          "Impossible d'enregistrer la photo de profil."
      });
    }
  }
);
// === PEOPLE_AVATAR_ULTRA_UPLOAD_V1_END ===

// === PEOPLE_AVATAR_JSON_DISPLAY_V1_START ===
app.get(
  "/api/profile/avatar-json/:username",
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(
          req,
          res
        );

      if (!session) {
        return;
      }

      const account =
        await peopleFindAccount(
          req.params.username
        );

      if (!account) {
        return res.status(404).json({
          ok: false,
          error:
            "Profil introuvable."
        });
      }

      const avatar =
        await peopleLoadAvatar(
          account.id
        );

      if (
        !avatar ||
        !Buffer.isBuffer(
          avatar.data
        ) ||
        avatar.data.length <= 0
      ) {
        return res.json({
          ok: true,
          avatar: null
        });
      }

      res.setHeader(
        "Cache-Control",
        "private, no-store"
      );

      res.json({
        ok: true,
        avatar: {
          mime:
            avatar.mime ||
            "image/jpeg",
          data:
            avatar.data.toString(
              "base64"
            ),
          byteSize:
            avatar.data.length
        }
      });
    } catch (err) {
      console.error(
        "[People avatar/json]",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          "Impossible de charger la photo de profil."
      });
    }
  }
);
// === PEOPLE_AVATAR_JSON_DISPLAY_V1_END ===

// === PEOPLE_APPEARANCE_ROUTES_V2_START ===
app.get(
  "/api/settings/appearance",
  async (req, res) => {
    try {
      const session = peopleSessionForRequest(req, res);
      if (!session) return;

      const appearance = await peopleGetAppearance(session.id);

      if (!appearance) {
        return res.status(404).json({
          ok: false,
          error: "Compte introuvable."
        });
      }

      return res.json({
        ok: true,
        appearance
      });
    } catch (err) {
      console.error("[People appearance/get]", err);
      return res.status(500).json({
        ok: false,
        error: "Impossible de charger l'apparence."
      });
    }
  }
);

app.put(
  "/api/settings/appearance",
  async (req, res) => {
    try {
      const session = peopleSessionForRequest(req, res);
      if (!session) return;

      const rawTheme = String(req.body?.theme || "")
        .trim()
        .toLowerCase();

      if (!PEOPLE_APPEARANCE_THEMES.has(rawTheme)) {
        return res.status(400).json({
          ok: false,
          error: "Thème d'apparence invalide."
        });
      }

      const currentAppearance = await peopleGetAppearance(session.id);

      if (!currentAppearance) {
        return res.status(404).json({
          ok: false,
          error: "Compte introuvable."
        });
      }

      let rawPalette = req.body?.palette;

      if (rawPalette == null) {
        rawPalette = {
          ...currentAppearance.palette,
          accent:
            req.body?.accent == null
              ? currentAppearance.palette.accent
              : req.body.accent
        };
      }

      if (
        !rawPalette ||
        typeof rawPalette !== "object" ||
        Array.isArray(rawPalette)
      ) {
        return res.status(400).json({
          ok: false,
          error: "Palette d'apparence invalide."
        });
      }

      for (const key of PEOPLE_APPEARANCE_PALETTE_KEYS) {
        const value = String(rawPalette[key] || "")
          .trim()
          .toUpperCase();

        if (!/^#[0-9A-F]{6}$/.test(value)) {
          return res.status(400).json({
            ok: false,
            error: "Couleur invalide pour " + key + "."
          });
        }
      }

      const appearance = await peopleUpdateAppearance(
        session.id,
        rawTheme,
        {
          palette: rawPalette,
          accent: rawPalette.accent
        }
      );

      if (!appearance) {
        return res.status(404).json({
          ok: false,
          error: "Compte introuvable."
        });
      }

      return res.json({
        ok: true,
        appearance
      });
    } catch (err) {
      console.error("[People appearance/put]", err);
      return res.status(500).json({
        ok: false,
        error: "Impossible d'enregistrer l'apparence."
      });
    }
  }
);
// === PEOPLE_APPEARANCE_ROUTES_V2_END ===

app.get("/api/profile/:username", async (req, res) => {
  try {
    const session = peopleSessionForRequest(req, res);
    if (!session) return;

    const account = await peopleFindAccount(req.params.username);

    if (!account) {
      return res.status(404).json({
        ok: false,
        error: "Profil introuvable."
      });
    }

    const relation = await peopleFriendRelation(
      session.id,
      account.id
    );

    return res.json({
      ok: true,
      profile: {
        ...peoplePublicAccount(account),
        online: peopleAccountIsOnline(account.id),
        isFriend: relation.isFriend,
        friendRequest: relation.friendRequest,
        friendRequestId: relation.friendRequestId,
        isSelf: String(account.id) === String(session.id)
      }
    });
  } catch (err) {
    console.error("[People profile/get]", err);
    res.status(500).json({
      ok: false,
      error: "Impossible de charger ce profil."
    });
  }
});

app.put("/api/profile/me", async (req, res) => {
  try {
    const session = peopleSessionForRequest(req, res);
    if (!session) return;

    const description = String(
      req.body?.description || ""
    ).trim();

    if (description.length > 280) {
      return res.status(400).json({
        ok: false,
        error: "La description est limitee a 280 caracteres."
      });
    }

    const account = await peopleUpdateDescription(
      session.id,
      description
    );

    if (!account) {
      return res.status(404).json({
        ok: false,
        error: "Compte introuvable."
      });
    }

    res.json({
      ok: true,
      profile: {
        ...peoplePublicAccount(account),
        online: true,
        isFriend: false,
        isSelf: true
      }
    });
  } catch (err) {
    console.error("[People profile/update]", err);
    res.status(500).json({
      ok: false,
      error: "Impossible de modifier le profil."
    });
  }
});

app.get("/api/social/people", async (req, res) => {
  try {
    const session = peopleSessionForRequest(req, res);
    if (!session) return;

    const query =
      String(req.query.q || "")
        .trim()
        .slice(0, 50);

    const friendIds = new Set(
      await peopleFriendIds(session.id)
    );

    const requestRows =
      await peopleFriendRequestRows(session.id);

    const requestByOther = new Map();

    for (const request of requestRows) {
      const outgoing =
        String(request.sender_id) ===
        String(session.id);

      const otherId = outgoing
        ? String(request.recipient_id)
        : String(request.sender_id);

      requestByOther.set(otherId, {
        friendRequest:
          outgoing ? "outgoing" : "incoming",
        friendRequestId: String(request.id)
      });
    }

    let accounts = [];

    if (query) {
      /*
        Recherche volontaire :
        on peut retrouver un nouveau compte
        uniquement quand l'utilisateur tape
        réellement un pseudo.
      */
      accounts =
        await peopleListAccounts(
          query
        );
    } else {
      /*
        Aucun annuaire global au repos.
        On ne montre ici que les comptes
        avec lesquels un MP existe déjà.

        Les amis et demandes sont exclus
        car ils sont déjà affichés juste
        au-dessus dans leurs propres zones.
      */
      const conversations =
        await peopleDmConversations(
          session.id
        );

      for (
        const conversation
        of conversations
      ) {
        const account =
          conversation?.user;

        if (
          !account?.id
        ) {
          continue;
        }

        const id =
          String(account.id);

        if (
          friendIds.has(id) ||
          requestByOther.has(id)
        ) {
          continue;
        }

        accounts.push(
          account
        );
      }
    }

    const seen =
      new Set();

    res.json({
      ok: true,
      people: accounts
        .filter(
          (account) => {
            const id =
              String(
                account?.id || ""
              );

            if (
              !id ||
              id ===
                String(session.id) ||
              seen.has(id)
            ) {
              return false;
            }

            seen.add(id);

            return true;
          }
        )
        .map((account) => {
          const id =
            String(account.id);

          const pending =
            requestByOther.get(id) ||
            {};

          return {
            ...peoplePublicAccount(
              account
            ),
            online:
              peopleAccountIsOnline(
                account.id
              ),
            isFriend:
              friendIds.has(id),
            friendRequest:
              pending.friendRequest ||
              null,
            friendRequestId:
              pending.friendRequestId ||
              null
          };
        })
    });
  } catch (err) {
    console.error("[People social/people]", err);

    res.status(500).json({
      ok: false,
      error: "Impossible de charger les personnes."
    });
  }
});

app.get("/api/social/friends", async (req, res) => {
  try {
    const session = peopleSessionForRequest(req, res);
    if (!session) return;

    const ids = await peopleFriendIds(session.id);
    const accounts =
      await peopleFindAccountsByIds(ids);
    const friends = accounts.map(
      (account) => ({
        ...peoplePublicAccount(account),
        online:
          peopleAccountIsOnline(
            account.id
          ),
        isFriend: true
      })
    );

    friends.sort((a, b) => {
      if (a.online !== b.online) {
        return a.online ? -1 : 1;
      }

      return a.username.localeCompare(
        b.username,
        "fr",
        { sensitivity: "base" }
      );
    });

    res.json({
      ok: true,
      friends
    });
  } catch (err) {
    console.error("[People social/friends]", err);
    res.status(500).json({
      ok: false,
      error: "Impossible de charger les amis."
    });
  }
});

app.get("/api/social/friend-requests", async (req, res) => {
  try {
    const session = peopleSessionForRequest(req, res);
    if (!session) return;

    const rows =
      await peopleFriendRequestRows(session.id);

    const incoming = [];
    const outgoing = [];
    const otherIds = rows.map(
      (request) =>
        String(request.recipient_id) ===
        String(session.id)
          ? request.sender_id
          : request.recipient_id
    );
    const requestAccounts =
      await peopleFindAccountsByIds(
        otherIds
      );
    const requestAccountsById =
      new Map(
        requestAccounts.map(
          (account) => [
            String(account.id),
            account
          ]
        )
      );

    for (const request of rows) {
      const isIncoming =
        String(request.recipient_id) ===
        String(session.id);

      const otherId = isIncoming
        ? request.sender_id
        : request.recipient_id;

      const account =
        requestAccountsById.get(
          String(otherId)
        );

      if (!account) continue;

      const item = {
        id: String(request.id),
        createdAt: request.created_at,
        user: {
          ...peoplePublicAccount(account),
          online:
            peopleAccountIsOnline(account.id)
        }
      };

      if (isIncoming) incoming.push(item);
      else outgoing.push(item);
    }

    res.json({
      ok: true,
      incoming,
      outgoing
    });
  } catch (err) {
    console.error(
      "[People friend-requests/list]",
      err
    );

    res.status(500).json({
      ok: false,
      error:
        "Impossible de charger les demandes d'ami."
    });
  }
});

app.post("/api/social/friends/:username", async (req, res) => {
  try {
    const session = peopleSessionForRequest(req, res);
    if (!session) return;

    const target = await peopleFindAccount(
      req.params.username
    );

    if (!target) {
      return res.status(404).json({
        ok: false,
        error: "Utilisateur introuvable."
      });
    }

    if (String(target.id) === String(session.id)) {
      return res.status(400).json({
        ok: false,
        error:
          "Tu ne peux pas t'envoyer une demande a toi-meme."
      });
    }

    try {
      const request =
        await peopleCreateFriendRequest(
          session.id,
          target.id
        );

      peopleEmitToAccount(
        target.id,
        "friend-state-changed",
        {
          type: "request",
          from: session.username
        }
      );

      peopleEmitToAccount(
        session.id,
        "friend-state-changed",
        {
          type: "request-sent",
          to: target.username
        }
      );

      return res.json({
        ok: true,
        state: "outgoing",
        requestId: request
          ? String(request.id)
          : null
      });
    } catch (err) {
      if (err?.code === "ALREADY_FRIENDS") {
        return res.status(409).json({
          ok: false,
          error: "Vous etes deja amis."
        });
      }

      if (err?.code === "INCOMING_EXISTS") {
        return res.status(409).json({
          ok: false,
          error:
            "Cette personne t'a deja envoye une demande. " +
            "Accepte-la dans Demandes d'ami."
        });
      }

      throw err;
    }
  } catch (err) {
    console.error(
      "[People friends/request]",
      err
    );

    res.status(500).json({
      ok: false,
      error:
        "Impossible d'envoyer la demande d'ami."
    });
  }
});

app.post(
  "/api/social/friend-requests/:id/accept",
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(req, res);

      if (!session) return;

      const accepted =
        await peopleAcceptFriendRequest(
          session.id,
          req.params.id
        );

      if (!accepted) {
        return res.status(404).json({
          ok: false,
          error: "Demande d'ami introuvable."
        });
      }

      peopleEmitToAccount(
        accepted.senderId,
        "friend-state-changed",
        {
          type: "accepted",
          by: session.username
        }
      );

      peopleEmitToAccount(
        session.id,
        "friend-state-changed",
        { type: "accepted" }
      );

      res.json({ ok: true });
    } catch (err) {
      console.error(
        "[People friend-requests/accept]",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          "Impossible d'accepter cette demande."
      });
    }
  }
);

app.delete(
  "/api/social/friend-requests/:id",
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(req, res);

      if (!session) return;

      const removed =
        await peopleDeleteFriendRequest(
          session.id,
          req.params.id
        );

      if (!removed) {
        return res.status(404).json({
          ok: false,
          error: "Demande d'ami introuvable."
        });
      }

      const otherId =
        String(removed.senderId) ===
        String(session.id)
          ? removed.recipientId
          : removed.senderId;

      peopleEmitToAccount(
        otherId,
        "friend-state-changed",
        { type: "request-removed" }
      );

      peopleEmitToAccount(
        session.id,
        "friend-state-changed",
        { type: "request-removed" }
      );

      res.json({ ok: true });
    } catch (err) {
      console.error(
        "[People friend-requests/delete]",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          "Impossible de supprimer cette demande."
      });
    }
  }
);

app.delete("/api/social/friends/:username", async (req, res) => {
  try {
    const session = peopleSessionForRequest(req, res);
    if (!session) return;

    const target = await peopleFindAccount(
      req.params.username
    );

    if (!target) {
      return res.status(404).json({
        ok: false,
        error: "Utilisateur introuvable."
      });
    }

    await peopleRemoveFriend(
      session.id,
      target.id
    );

    peopleEmitToAccount(
      target.id,
      "friend-state-changed",
      {
        type: "removed",
        by: session.username
      }
    );

    peopleEmitToAccount(
      session.id,
      "friend-state-changed",
      { type: "removed" }
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(
      "[People friends/remove]",
      err
    );

    res.status(500).json({
      ok: false,
      error: "Impossible de retirer cet ami."
    });
  }
});

// === PEOPLE_MESSAGE_DELETE_ROUTES_V1_START ===
app.delete(
  "/api/dm/message/:id",
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(
          req,
          res
        );

      if (!session) return;

      const removed =
        await peopleDeleteDmMessage(
          session.id,
          req.params.id
        );

      if (!removed) {
        return res.status(403).json({
          ok: false,
          error:
            "Tu ne peux supprimer que tes propres messages."
        });
      }

      const payload = {
        id:
          removed.id,
        senderId:
          removed.senderId,
        recipientId:
          removed.recipientId
      };

      peopleEmitToAccount(
        removed.senderId,
        "dm-message-deleted",
        payload
      );

      peopleEmitToAccount(
        removed.recipientId,
        "dm-message-deleted",
        payload
      );

      res.json({
        ok: true
      });
    } catch (err) {
      console.error(
        "[People dm/delete]",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          "Impossible de supprimer ce message."
      });
    }
  }
);
// === PEOPLE_MESSAGE_DELETE_ROUTES_V1_END ===

// === PEOPLE_DM_CLOSE_ROUTES_V1_START ===
app.post(
  "/api/dm/:username/close",
  async (
    req,
    res
  ) => {
    try {
      const session =
        peopleSessionForRequest(
          req,
          res
        );

      if (!session) {
        return;
      }

      const target =
        await peopleFindAccount(
          req.params.username
        );

      if (!target) {
        return res.status(404).json({
          ok: false,
          error:
            "Utilisateur introuvable."
        });
      }

      if (
        String(
          target.id
        ) ===
        String(
          session.id
        )
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Conversation invalide."
        });
      }

      await peopleSetDmClosed(
        session.id,
        target.id,
        true
      );

      res.json({
        ok: true
      });
    } catch (err) {
      console.error(
        "[People dm/close]",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          "Impossible de fermer ce MP."
      });
    }
  }
);

app.post(
  "/api/dm/:username/open",
  async (
    req,
    res
  ) => {
    try {
      const session =
        peopleSessionForRequest(
          req,
          res
        );

      if (!session) {
        return;
      }

      const target =
        await peopleFindAccount(
          req.params.username
        );

      if (!target) {
        return res.status(404).json({
          ok: false,
          error:
            "Utilisateur introuvable."
        });
      }

      await peopleSetDmClosed(
        session.id,
        target.id,
        false
      );

      res.json({
        ok: true
      });
    } catch (err) {
      console.error(
        "[People dm/open]",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          "Impossible de rouvrir ce MP."
      });
    }
  }
);
// === PEOPLE_DM_CLOSE_ROUTES_V1_END ===

app.get("/api/dm/conversations", async (req, res) => {
  try {
    const session = peopleSessionForRequest(req, res);
    if (!session) return;

    const conversations =
      await peopleDmConversations(session.id);

    res.json({
      ok: true,
      conversations,
      unreadTotal: conversations.reduce(
        (sum, item) => sum + Number(item.unreadCount || 0),
        0
      )
    });
  } catch (err) {
    console.error("[People dm/conversations]", err);
    res.status(500).json({
      ok: false,
      error: "Impossible de charger les MP."
    });
  }
});

app.get("/api/dm/:username", async (req, res) => {
  try {
    const session =
      peopleSessionForRequest(
        req,
        res
      );

    if (!session) {
      return;
    }

    const target =
      await peopleFindAccount(
        req.params.username
      );

    if (!target) {
      return res.status(404).json({
        ok: false,
        error:
          "Utilisateur introuvable."
      });
    }

    if (
      String(target.id) ===
      String(session.id)
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Tu ne peux pas ouvrir un MP avec toi-meme."
      });
    }

    // === PEOPLE_NAVIGATION_PARALLEL_V1_DM ===
    // L'historique et la relation d'amitié sont indépendants : les attendre
    // en parallèle réduit la latence réelle du premier affichage d'un MP.
    const [history, isFriend] =
      await Promise.all([
        peopleDmHistory(
          session.id,
          target.id,
          {
            before:
              req.query?.before,
            after:
              req.query?.after
          }
        ),
        peopleHasFriend(
          session.id,
          target.id
        )
      ]);

    const messages =
      Array.isArray(
        history?.messages
      )
        ? history.messages
        : [];

    res.json({
      ok: true,
      user: {
        ...peoplePublicAccount(
          target
        ),
        online:
          peopleAccountIsOnline(
            target.id
          ),
        isFriend
      },
      pageSize:
        PEOPLE_DM_HISTORY_PAGE_SIZE,
      hasMore:
        Boolean(
          history?.hasMore
        ),
      direction:
        String(
          history?.direction ||
          "latest"
        ),
      messages:
        messages.map(
          (message) => ({
            id:
              String(
                message.id
              ),
            senderId:
              String(
                message.sender_id
              ),
            recipientId:
              String(
                message.recipient_id
              ),
            body:
              message.body,
            imageId:
              message.image_id
                ? String(
                    message.image_id
                  )
                : null,
            replyTo:
              peopleDmReplyFromHistoryRow(
                message
              ),
            createdAt:
              message.created_at,
            readAt:
              message.read_at ||
              null
          })
        )
    });
  } catch (err) {
    console.error(
      "[People dm/history]",
      err
    );

    res.status(500).json({
      ok: false,
      error:
        "Impossible de charger cette conversation."
    });
  }
});

app.post("/api/dm/:username/read", async (req, res) => {
  try {
    const session = peopleSessionForRequest(req, res);
    if (!session) return;

    const target = await peopleFindAccount(
      req.params.username
    );

    if (!target) {
      return res.status(404).json({
        ok: false,
        error: "Utilisateur introuvable."
      });
    }

    await peopleMarkDmRead(session.id, target.id);

    res.json({
      ok: true
    });
  } catch (err) {
    console.error("[People dm/read]", err);
    res.status(500).json({
      ok: false,
      error: "Impossible de marquer les MP comme lus."
    });
  }
});

const peopleDmRate = new Map();

function peopleDmRateAllowed(accountId) {
  const key = String(accountId);
  const now = Date.now();
  const old = peopleDmRate.get(key) || [];
  const fresh = old.filter(
    (time) => now - time < 5000
  );

  if (fresh.length >= 12) {
    peopleDmRate.set(key, fresh);
    return false;
  }

  fresh.push(now);
  peopleDmRate.set(key, fresh);
  return true;
}

app.post("/api/dm/:username", async (req, res) => {
  try {
    const session =
      peopleSessionForRequest(
        req,
        res
      );

    if (!session) {
      return;
    }

    if (
      !peopleDmRateAllowed(
        session.id
      )
    ) {
      return res.status(429).json({
        ok: false,
        error:
          "Tu envoies trop de messages trop vite."
      });
    }

    const target =
      await peopleFindAccount(
        req.params.username
      );

    if (!target) {
      return res.status(404).json({
        ok: false,
        error:
          "Utilisateur introuvable."
      });
    }

    if (
      String(target.id) ===
      String(session.id)
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Tu ne peux pas t'envoyer un MP."
      });
    }

    const body =
      String(
        req.body?.body || ""
      ).trim();

    const e2eeEnvelope =
      peopleDmE2eeEnvelope(
        body
      );

    const imageId =
      peopleNormalizeMessageImageId(
        req.body?.imageId
      );

    const replyToId =
      peopleReplyId(
        req.body?.replyToId
      );

    if (
      (
        !body &&
        !imageId
      ) ||
      (
        !e2eeEnvelope &&
        body.length > 2000
      ) ||
      (
        e2eeEnvelope &&
        body.length > 24000
      )
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Le MP doit contenir du texte ou une image."
      });
    }

    if (e2eeEnvelope) {
      const senderId =
        String(session.id);

      const recipientId =
        String(target.id);

      const allowedIds =
        new Set([
          senderId,
          recipientId
        ]);

      const hasSenderKey =
        e2eeEnvelope.keys.some(
          (item) =>
            String(item.u) ===
              senderId
        );

      const hasRecipientKey =
        e2eeEnvelope.keys.some(
          (item) =>
            String(item.u) ===
              recipientId
        );

      if (
        e2eeEnvelope.from !==
          senderId ||
        e2eeEnvelope.to !==
          recipientId ||
        !hasSenderKey ||
        !hasRecipientKey ||
        e2eeEnvelope.keys.some(
          (item) =>
            !allowedIds.has(
              String(item.u)
            )
        )
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Enveloppe E2EE invalide."
          });
      }
    }

    const message =
      await peopleCreateDm(
        session.id,
        target.id,
        body,
        imageId,
        replyToId
      );

    // === PEOPLE_DM_REOPEN_ON_MESSAGE_V1 ===
    await peopleSetDmClosed(
      session.id,
      target.id,
      false
    );

    await peopleSetDmClosed(
      target.id,
      session.id,
      false
    );

    const sender =
      await peopleFindAccountById(
        session.id
      );

    const payload = {
      id:
        String(message.id),
      sender:
        peoplePublicAccount(
          sender
        ),
      recipient:
        peoplePublicAccount(
          target
        ),
      body:
        message.body,
      imageId:
        message.image_id
          ? String(
              message.image_id
            )
          : null,
      replyTo:
        message.reply_to || null,
      createdAt:
        message.created_at
    };

    peopleEmitToAccount(
      target.id,
      "dm-message",
      payload
    );

    peopleEmitToAccount(
      session.id,
      "dm-message-sent",
      payload
    );

    res.json({
      ok: true,
      message: payload
    });
  } catch (err) {
    if (
      err?.code ===
        "E2EE_ENVELOPE_INVALID"
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Enveloppe E2EE invalide."
      });
    }

    if (
      err?.code ===
      "IMAGE_INVALID"
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Cette image n'est plus disponible. Réessaie de la sélectionner."
      });
    }

    console.error(
      "[People dm/send]",
      err
    );

    res.status(500).json({
      ok: false,
      error:
        "Impossible d'envoyer ce MP."
    });
  }
});
// === PEOPLE_SOCIAL_V2_END ===

// === PEOPLE_MESSAGE_IMAGES_V1_START ===
const PEOPLE_MESSAGE_IMAGE_MAX_BYTES =
  5 * 1024 * 1024;

const PEOPLE_LOCAL_MESSAGE_IMAGE_DIR =
  pathAccounts.join(
    __dirname,
    "people-message-images"
  );

const PEOPLE_LOCAL_MESSAGE_IMAGE_META =
  pathAccounts.join(
    __dirname,
    "people-message-images.local.json"
  );

const peopleMessageImageRate =
  new Map();

function peopleMessageImageMime(
  buffer
) {
  if (!Buffer.isBuffer(buffer)) {
    return null;
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a
      ])
    )
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (buffer.length >= 6) {
    const sig =
      buffer
        .subarray(0, 6)
        .toString("ascii");

    if (
      sig === "GIF87a" ||
      sig === "GIF89a"
    ) {
      return "image/gif";
    }
  }

  if (
    buffer.length >= 12 &&
    buffer
      .subarray(0, 4)
      .toString("ascii") === "RIFF" &&
    buffer
      .subarray(8, 12)
      .toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

function peopleMessageImageExtension(
  mime
) {
  return {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  }[mime] || "";
}

function peopleNormalizeMessageImageId(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .slice(0, 100);
}

function peopleMessageImageUploadAllowed(
  accountId
) {
  const key =
    String(accountId);

  const now =
    Date.now();

  const recent =
    (
      peopleMessageImageRate
        .get(key) || []
    ).filter(
      (time) =>
        now - time <
        60 * 1000
    );

  if (recent.length >= 12) {
    peopleMessageImageRate.set(
      key,
      recent
    );

    return false;
  }

  recent.push(now);

  peopleMessageImageRate.set(
    key,
    recent
  );

  return true;
}

function peopleReadLocalMessageImageMeta() {
  try {
    if (
      !fsAccounts.existsSync(
        PEOPLE_LOCAL_MESSAGE_IMAGE_META
      )
    ) {
      return {};
    }

    const raw =
      JSON.parse(
        fsAccounts.readFileSync(
          PEOPLE_LOCAL_MESSAGE_IMAGE_META,
          "utf8"
        )
      );

    return (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw)
    )
      ? raw
      : {};
  } catch {
    return {};
  }
}

function peopleWriteLocalMessageImageMeta(
  meta
) {
  fsAccounts.writeFileSync(
    PEOPLE_LOCAL_MESSAGE_IMAGE_META,
    JSON.stringify(
      meta || {},
      null,
      2
    ) + "\n",
    "utf8"
  );
}

let peopleMessageImageLastCleanupAt = 0;
const PEOPLE_MESSAGE_IMAGE_CLEANUP_INTERVAL_MS =
  60 * 60 * 1000;

async function peopleCreatePendingMessageImage(
  ownerId,
  buffer
) {
  if (
    !Buffer.isBuffer(buffer) ||
    !buffer.length ||
    buffer.length >
      PEOPLE_MESSAGE_IMAGE_MAX_BYTES
  ) {
    const err =
      new Error("IMAGE_SIZE");

    err.code =
      "IMAGE_SIZE";

    throw err;
  }

  const mime =
    peopleMessageImageMime(
      buffer
    );

  if (!mime) {
    const err =
      new Error("IMAGE_TYPE");

    err.code =
      "IMAGE_TYPE";

    throw err;
  }

  const owner =
    String(ownerId);

  if (peoplePool) {
    const now = Date.now();

    if (
      now -
        peopleMessageImageLastCleanupAt >=
      PEOPLE_MESSAGE_IMAGE_CLEANUP_INTERVAL_MS
    ) {
      peopleMessageImageLastCleanupAt =
        now;

      try {
        await peoplePool.query(
          "DELETE FROM people_message_images " +
          "WHERE general_message_id IS NULL " +
          "AND dm_message_id IS NULL " +
          "AND created_at < NOW() - INTERVAL '1 day'"
        );
      } catch (err) {
        console.warn(
          "[People image cleanup]",
          err?.message || err
        );
      }
    }

    const result =
      await peoplePool.query(
        "INSERT INTO people_message_images " +
        "(owner_id, mime_type, data) " +
        "VALUES ($1, $2, $3) " +
        "RETURNING id",
        [
          owner,
          mime,
          buffer
        ]
      );

    return {
      id: String(
        result.rows[0].id
      ),
      mime
    };
  }

  fsAccounts.mkdirSync(
    PEOPLE_LOCAL_MESSAGE_IMAGE_DIR,
    { recursive: true }
  );

  const id =
    cryptoAccounts.randomUUID();

  const file =
    id +
    peopleMessageImageExtension(
      mime
    );

  fsAccounts.writeFileSync(
    pathAccounts.join(
      PEOPLE_LOCAL_MESSAGE_IMAGE_DIR,
      file
    ),
    buffer
  );

  const meta =
    peopleReadLocalMessageImageMeta();

  meta[id] = {
    id,
    ownerId: owner,
    mime,
    file,
    scope: null,
    messageId: null,
    senderId: null,
    recipientId: null,
    createdAt:
      new Date().toISOString()
  };

  peopleWriteLocalMessageImageMeta(
    meta
  );

  return {
    id,
    mime
  };
}

async function peopleBindGeneralMessageImage(
  ownerId,
  imageId,
  messageId,
  client = peoplePool
) {
  const imageKey =
    peopleNormalizeMessageImageId(
      imageId
    );

  if (!imageKey) {
    return null;
  }

  const owner =
    String(ownerId);

  const message =
    String(messageId);

  if (peoplePool) {
    if (
      !/^\d+$/.test(
        imageKey
      )
    ) {
      return null;
    }

    const result =
      await client.query(
        "UPDATE people_message_images " +
        "SET general_message_id = $3 " +
        "WHERE id = $1 " +
        "AND owner_id = $2 " +
        "AND general_message_id IS NULL " +
        "AND dm_message_id IS NULL " +
        "RETURNING id",
        [
          imageKey,
          owner,
          message
        ]
      );

    return result.rows[0]
      ? String(
          result.rows[0].id
        )
      : null;
  }

  const meta =
    peopleReadLocalMessageImageMeta();

  const item =
    meta[imageKey];

  if (
    !item ||
    String(item.ownerId) !== owner ||
    item.scope
  ) {
    return null;
  }

  item.scope =
    "general";

  item.messageId =
    message;

  meta[imageKey] =
    item;

  peopleWriteLocalMessageImageMeta(
    meta
  );

  return imageKey;
}

async function peopleBindDmMessageImage(
  ownerId,
  imageId,
  messageId,
  senderId,
  recipientId,
  client = peoplePool
) {
  const imageKey =
    peopleNormalizeMessageImageId(
      imageId
    );

  if (!imageKey) {
    return null;
  }

  const owner =
    String(ownerId);

  const message =
    String(messageId);

  if (peoplePool) {
    if (
      !/^\d+$/.test(
        imageKey
      )
    ) {
      return null;
    }

    const result =
      await client.query(
        "UPDATE people_message_images " +
        "SET dm_message_id = $3 " +
        "WHERE id = $1 " +
        "AND owner_id = $2 " +
        "AND general_message_id IS NULL " +
        "AND dm_message_id IS NULL " +
        "RETURNING id",
        [
          imageKey,
          owner,
          message
        ]
      );

    return result.rows[0]
      ? String(
          result.rows[0].id
        )
      : null;
  }

  const meta =
    peopleReadLocalMessageImageMeta();

  const item =
    meta[imageKey];

  if (
    !item ||
    String(item.ownerId) !== owner ||
    item.scope
  ) {
    return null;
  }

  item.scope =
    "dm";

  item.messageId =
    message;

  item.senderId =
    String(senderId);

  item.recipientId =
    String(recipientId);

  meta[imageKey] =
    item;

  peopleWriteLocalMessageImageMeta(
    meta
  );

  return imageKey;
}

app.post(
  "/api/chat/image",
  express.raw({
    type: () => true,
    limit: "5mb"
  }),
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(
          req,
          res
        );

      if (!session) {
        return;
      }

      if (
        !peopleMessageImageUploadAllowed(
          session.id
        )
      ) {
        return res.status(429).json({
          ok: false,
          error:
            "Tu envoies trop d'images trop vite."
        });
      }

      const image =
        await peopleCreatePendingMessageImage(
          session.id,
          req.body
        );

      res.json({
        ok: true,
        imageId: image.id
      });
    } catch (err) {
      if (
        err?.type ===
          "entity.too.large" ||
        err?.code ===
          "IMAGE_SIZE"
      ) {
        return res.status(413).json({
          ok: false,
          error:
            "L'image doit faire moins de 5 Mo."
        });
      }

      if (
        err?.code ===
        "IMAGE_TYPE"
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Format non accepte. JPEG, PNG, WebP ou GIF."
        });
      }

      console.error(
        "[People chat/image upload]",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          "Impossible d'envoyer l'image."
      });
    }
  }
);

app.get(
  "/api/chat/image/:id",
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(
          req,
          res
        );

      if (!session) {
        return;
      }

      const imageId =
        peopleNormalizeMessageImageId(
          req.params.id
        );

      if (!imageId) {
        return res.status(404).end();
      }

      if (peoplePool) {
        if (
          !/^\d+$/.test(
            imageId
          )
        ) {
          return res.status(404).end();
        }

        const result =
          await peoplePool.query(
            "SELECT " +
            "i.owner_id, i.mime_type, i.data, " +
            "i.general_message_id, i.dm_message_id, " +
            "dm.sender_id, dm.recipient_id, " +
            "gm.server_id AS general_server_id " +
            "FROM people_message_images i " +
            "LEFT JOIN people_direct_messages dm " +
            "ON dm.id = i.dm_message_id " +
            "LEFT JOIN people_general_messages gm " +
            "ON gm.id = i.general_message_id " +
            "WHERE i.id = $1 LIMIT 1",
            [imageId]
          );

        const row =
          result.rows[0];

        if (!row) {
          return res.status(404).end();
        }

        const me =
          String(session.id);

        const generalAllowed =
          row.general_message_id &&
          row.general_server_id &&
          await peopleIsServerMember(
            me,
            row.general_server_id
          );

        const allowed =
          Boolean(
            generalAllowed
          ) ||
          String(row.owner_id) === me ||
          (
            row.dm_message_id &&
            (
              String(row.sender_id) === me ||
              String(row.recipient_id) === me
            )
          );

        if (!allowed) {
          return res.status(403).end();
        }

        res.setHeader(
          "Content-Type",
          row.mime_type
        );

        res.setHeader(
          "Content-Length",
          String(
            row.data.length
          )
        );

        res.setHeader(
          "X-Content-Type-Options",
          "nosniff"
        );

        res.setHeader(
          "Cache-Control",
          "private, max-age=86400"
        );

        return res.end(
          row.data
        );
      }

      const meta =
        peopleReadLocalMessageImageMeta();

      const item =
        meta[imageId];

      if (!item) {
        return res.status(404).end();
      }

      const me =
        String(session.id);

      const generalMessage =
        item.scope === "general"
          ? peopleReadLocalGeneral()
              .find(
                (message) =>
                  String(message.id) ===
                  String(item.messageId)
              )
          : null;

      const generalAllowed =
        generalMessage?.serverId
          ? await peopleIsServerMember(
              me,
              generalMessage.serverId
            )
          : false;

      const allowed =
        Boolean(
          generalAllowed
        ) ||
        String(item.ownerId) ===
          me ||
        (
          item.scope === "dm" &&
          (
            String(item.senderId) === me ||
            String(item.recipientId) === me
          )
        );

      if (!allowed) {
        return res.status(403).end();
      }

      const filePath =
        pathAccounts.join(
          PEOPLE_LOCAL_MESSAGE_IMAGE_DIR,
          item.file
        );

      if (
        !fsAccounts.existsSync(
          filePath
        )
      ) {
        return res.status(404).end();
      }

      const data =
        fsAccounts.readFileSync(
          filePath
        );

      res.setHeader(
        "Content-Type",
        item.mime
      );

      res.setHeader(
        "Content-Length",
        String(data.length)
      );

      res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
      );

      res.setHeader(
        "Cache-Control",
        "private, max-age=86400"
      );

      res.end(data);
    } catch (err) {
      console.error(
        "[People chat/image get]",
        err
      );

      res.status(500).end();
    }
  }
);
// === PEOPLE_MESSAGE_IMAGES_V1_END ===

// === PEOPLE_SERVERS_V1_START ===
const PEOPLE_LOCAL_SERVERS =
  pathAccounts.join(
    __dirname,
    "people-servers.local.json"
  );

function peopleServerRoom(serverId) {
  return (
    "people-server:" +
    String(serverId)
  );
}

function peopleServerName(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

function peopleValidServerName(value) {
  const name =
    peopleServerName(value);

  return (
    name.length >= 2 &&
    name.length <= 40 &&
    !/[\u0000-\u001f\u007f]/u.test(name)
  );
}

function peopleNewInviteCode() {
  return cryptoAccounts
    .randomBytes(14)
    .toString("base64url");
}

function peopleReadLocalServers() {
  try {
    if (
      !fsAccounts.existsSync(
        PEOPLE_LOCAL_SERVERS
      )
    ) {
      return {
        servers: [],
        members: [],
        channels: []
      };
    }

    const raw =
      JSON.parse(
        fsAccounts.readFileSync(
          PEOPLE_LOCAL_SERVERS,
          "utf8"
        )
      );

    return {
      servers:
        Array.isArray(raw?.servers)
          ? raw.servers
          : [],
      members:
        Array.isArray(raw?.members)
          ? raw.members
          : [],
      channels:
        Array.isArray(raw?.channels)
          ? raw.channels
          : []
    };
  } catch {
    return {
      servers: [],
      members: [],
      channels: []
    };
  }
}

function peopleWriteLocalServers(data) {
  fsAccounts.writeFileSync(
    PEOPLE_LOCAL_SERVERS,
    JSON.stringify(
      {
        servers:
          Array.isArray(data?.servers)
            ? data.servers
            : [],
        members:
          Array.isArray(data?.members)
            ? data.members
            : [],
        channels:
          Array.isArray(data?.channels)
            ? data.channels
            : []
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

function peopleServerPublic(server) {
  if (!server) return null;

  return {
    id:
      String(server.id),
    name:
      server.name,
    ownerId:
      server.ownerId ??
      server.owner_id ??
      null,
    official:
      Boolean(
        server.official ??
        server.is_official
      ),
    createdAt:
      server.createdAt ??
      server.created_at ??
      null
  };
}

async function peopleGetServer(serverId) {
  const id =
    String(serverId || "").trim();

  if (!id) return null;

  if (peoplePool) {
    if (!/^\d+$/.test(id)) {
      return null;
    }

    const result =
      await peoplePool.query(
        "SELECT id, name, owner_id, invite_code, is_official, created_at " +
        "FROM people_servers WHERE id = $1 LIMIT 1",
        [id]
      );

    const row =
      result.rows[0];

    if (!row) return null;

    return {
      id:
        String(row.id),
      name:
        row.name,
      ownerId:
        row.owner_id
          ? String(row.owner_id)
          : null,
      inviteCode:
        row.invite_code,
      official:
        Boolean(row.is_official),
      createdAt:
        row.created_at
    };
  }

  const data =
    peopleReadLocalServers();

  return (
    data.servers.find(
      (server) =>
        String(server.id) === id
    ) || null
  );
}

async function peopleGetServerByInvite(code) {
  const invite =
    String(code || "")
      .trim()
      .slice(0, 80);

  if (!invite) return null;

  if (peoplePool) {
    const result =
      await peoplePool.query(
        "SELECT id, name, owner_id, invite_code, is_official, created_at " +
        "FROM people_servers WHERE invite_code = $1 LIMIT 1",
        [invite]
      );

    const row =
      result.rows[0];

    if (!row) return null;

    return {
      id:
        String(row.id),
      name:
        row.name,
      ownerId:
        row.owner_id
          ? String(row.owner_id)
          : null,
      inviteCode:
        row.invite_code,
      official:
        Boolean(row.is_official),
      createdAt:
        row.created_at
    };
  }

  return (
    peopleReadLocalServers()
      .servers
      .find(
        (server) =>
          String(server.inviteCode) ===
          invite
      ) || null
  );
}

async function peopleIsServerMember(
  accountId,
  serverId
) {
  const userId =
    String(accountId || "");

  const id =
    String(serverId || "");

  if (!userId || !id) {
    return false;
  }

  if (peoplePool) {
    if (
      !/^\d+$/.test(userId) ||
      !/^\d+$/.test(id)
    ) {
      return false;
    }

    const result =
      await peoplePool.query(
        "SELECT 1 FROM people_server_members " +
        "WHERE server_id = $1 AND user_id = $2 LIMIT 1",
        [
          id,
          userId
        ]
      );

    return Boolean(
      result.rows[0]
    );
  }

  return peopleReadLocalServers()
    .members
    .some(
      (member) =>
        String(member.serverId) === id &&
        String(member.userId) === userId
    );
}

async function peopleServerMemberCount(
  serverId
) {
  const id =
    String(serverId || "");

  if (!id) return 0;

  if (peoplePool) {
    if (!/^\d+$/.test(id)) {
      return 0;
    }

    const result =
      await peoplePool.query(
        "SELECT COUNT(*)::int AS count " +
        "FROM people_server_members WHERE server_id = $1",
        [id]
      );

    return Number(
      result.rows[0]?.count || 0
    );
  }

  return peopleReadLocalServers()
    .members
    .filter(
      (member) =>
        String(member.serverId) === id
    ).length;
}

// === PEOPLE_DELETE_EMPTY_SERVERS_V1_START ===

async function peopleDeleteServerIfEmpty(
  serverId
) {
  const id =
    String(
      serverId ||
      ""
    ).trim();

  if (!id) {
    return false;
  }

  const server =
    await peopleGetServer(
      id
    );

  /*
    Le serveur officiel People est permanent.
    Seuls les serveurs créés par les utilisateurs
    peuvent disparaître automatiquement.
  */
  if (
    !server ||
    server.official
  ) {
    return false;
  }

  if (peoplePool) {
    if (
      !/^\d+$/.test(
        id
      )
    ) {
      return false;
    }

    const client =
      await peoplePool.connect();

    try {
      await client.query(
        "BEGIN"
      );

      const locked =
        await client.query(
          "SELECT id, is_official FROM people_servers " +
          "WHERE id = $1 FOR UPDATE",
          [
            id
          ]
        );

      const row =
        locked.rows[0];

      if (
        !row ||
        row.is_official
      ) {
        await client.query(
          "ROLLBACK"
        );

        return false;
      }

      const countResult =
        await client.query(
          "SELECT COUNT(*)::int AS count " +
          "FROM people_server_members " +
          "WHERE server_id = $1",
          [
            id
          ]
        );

      const memberCount =
        Number(
          countResult.rows[0]?.count ||
          0
        );

      if (
        memberCount >
        0
      ) {
        await client.query(
          "ROLLBACK"
        );

        return false;
      }

      /*
        Les images liées aux messages sont déjà en ON DELETE CASCADE.
        On supprime explicitement les messages avant le serveur
        pour rester compatible avec les anciennes bases People.
      */
      await client.query(
        "DELETE FROM people_general_messages " +
        "WHERE server_id = $1",
        [
          id
        ]
      );

      const removed =
        await client.query(
          "DELETE FROM people_servers " +
          "WHERE id = $1 AND is_official = FALSE " +
          "RETURNING id",
          [
            id
          ]
        );

      if (
        !removed.rows[0]
      ) {
        await client.query(
          "ROLLBACK"
        );

        return false;
      }

      await client.query(
        "COMMIT"
      );
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
  } else {
    const data =
      peopleReadLocalServers();

    const localServer =
      data.servers.find(
        (item) =>
          String(
            item.id
          ) === id
      );

    if (
      !localServer ||
      Boolean(
        localServer.official
      )
    ) {
      return false;
    }

    const memberCount =
      data.members.filter(
        (member) =>
          String(
            member.serverId ??
            member.server_id ??
            ""
          ) === id
      ).length;

    if (
      memberCount >
      0
    ) {
      return false;
    }

    const messages =
      peopleReadLocalGeneral();

    const removedMessages =
      messages.filter(
        (message) =>
          String(
            message.serverId ??
            message.server_id ??
            ""
          ) === id
      );

    for (
      const message of
      removedMessages
    ) {
      peopleDeleteLocalBoundMessageImage(
        "general",
        message.id
      );
    }

    peopleWriteLocalGeneral(
      messages.filter(
        (message) =>
          String(
            message.serverId ??
            message.server_id ??
            ""
          ) !== id
      )
    );

    data.servers =
      data.servers.filter(
        (item) =>
          String(
            item.id
          ) !== id
      );

    data.members =
      data.members.filter(
        (member) =>
          String(
            member.serverId ??
            member.server_id ??
            ""
          ) !== id
      );

    data.channels =
      (data.channels || []).filter(
        (channel) =>
          String(
            channel.serverId ??
            channel.server_id ??
            ""
          ) !== id
      );

    peopleWriteLocalServers(
      data
    );
  }

  /*
    Nettoyage défensif des sockets :
    normalement il n'existe déjà plus aucun membre,
    mais une socket peut encore avoir cet ancien serveur sélectionné.
  */
  io.to(
    peopleServerRoom(
      id
    )
  ).emit(
    "server-deleted",
    {
      serverId:
        id
    }
  );

  for (
    const [
      socketId,
      currentServerId
    ]
    of [
      ...socketServerIds.entries()
    ]
  ) {
    if (
      String(
        currentServerId ||
        ""
      ) !== id
    ) {
      continue;
    }

    const socket =
      io.sockets.sockets.get(
        socketId
      );

    if (socket) {
      leaveVoice(
        socket
      );

      await socket.leave(
        peopleServerRoom(
          id
        )
      );

      socket.emit(
        "server-membership-left",
        {
          serverId:
            id,
          deleted:
            true
        }
      );
    }

    socketServerIds.delete(
      socketId
    );
  }

  for (
    const [
      voiceSocketId,
      voiceUser
    ]
    of [
      ...voiceUsers.entries()
    ]
  ) {
    if (
      String(
        voiceUser?.serverId ||
        ""
      ) !== id
    ) {
      continue;
    }

    const socket =
      io.sockets.sockets.get(
        voiceSocketId
      );

    if (socket) {
      leaveVoice(
        socket
      );
    }
  }

  console.log(
    "[People] Serveur vide supprimé : " +
    id
  );

  return true;
}

async function peopleDeleteAllEmptyServers() {
  let ids =
    [];

  if (peoplePool) {
    const result =
      await peoplePool.query(
        "SELECT s.id " +
        "FROM people_servers s " +
        "WHERE s.is_official = FALSE " +
        "AND NOT EXISTS (" +
        "SELECT 1 FROM people_server_members m " +
        "WHERE m.server_id = s.id" +
        ")"
      );

    ids =
      result.rows.map(
        (row) =>
          String(
            row.id
          )
      );
  } else {
    const data =
      peopleReadLocalServers();

    const used =
      new Set(
        data.members.map(
          (member) =>
            String(
              member.serverId ??
              member.server_id ??
              ""
            )
        )
      );

    ids =
      data.servers
        .filter(
          (server) =>
            !Boolean(
              server.official
            ) &&
            !used.has(
              String(
                server.id
              )
            )
        )
        .map(
          (server) =>
            String(
              server.id
            )
        );
  }

  let deleted =
    0;

  for (
    const id of
    ids
  ) {
    if (
      await peopleDeleteServerIfEmpty(
        id
      )
    ) {
      deleted +=
        1;
    }
  }

  if (
    deleted >
    0
  ) {
    console.log(
      "[People] " +
      deleted +
      " serveur(s) vide(s) nettoyé(s)."
    );
  }

  return deleted;
}

// === PEOPLE_DELETE_EMPTY_SERVERS_V1_END ===

async function peopleListServersForUser(
  accountId
) {
  const userId =
    String(accountId);

  if (peoplePool) {
    const result =
      await peoplePool.query(
        "SELECT s.id, s.name, s.owner_id, s.is_official, s.created_at " +
        "FROM people_servers s " +
        "JOIN people_server_members m ON m.server_id = s.id " +
        "WHERE m.user_id = $1 " +
        "ORDER BY m.joined_at ASC, s.id ASC",
        [userId]
      );

    return result.rows.map(
      (row) => ({
        id:
          String(row.id),
        name:
          row.name,
        ownerId:
          row.owner_id
            ? String(row.owner_id)
            : null,
        official:
          Boolean(row.is_official),
        createdAt:
          row.created_at
      })
    );
  }

  const data =
    peopleReadLocalServers();

  const joinedIds =
    new Set(
      data.members
        .filter(
          (member) =>
            String(member.userId) ===
            userId
        )
        .map(
          (member) =>
            String(member.serverId)
        )
    );

  return data.servers
    .filter(
      (server) =>
        joinedIds.has(
          String(server.id)
        )
    )
    .map(
      peopleServerPublic
    );
}

async function peopleJoinServer(
  accountId,
  serverId
) {
  const userId =
    String(accountId);

  const id =
    String(serverId);

  if (peoplePool) {
    await peoplePool.query(
      "INSERT INTO people_server_members (server_id, user_id) " +
      "VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [
        id,
        userId
      ]
    );

    return;
  }

  const data =
    peopleReadLocalServers();

  const exists =
    data.members.some(
      (member) =>
        String(member.serverId) === id &&
        String(member.userId) === userId
    );

  if (!exists) {
    data.members.push({
      serverId:
        id,
      userId:
        userId,
      joinedAt:
        new Date().toISOString()
    });

    peopleWriteLocalServers(data);
  }
}

async function peopleCreateServer(
  accountId,
  rawName
) {
  const ownerId =
    String(accountId);

  const name =
    peopleServerName(rawName);

  if (
    !peopleValidServerName(name)
  ) {
    const err =
      new Error("SERVER_NAME");

    err.code =
      "SERVER_NAME";

    throw err;
  }

  if (peoplePool) {
    const client =
      await peoplePool.connect();

    try {
      await client.query("BEGIN");

      const result =
        await client.query(
          "INSERT INTO people_servers " +
          "(name, owner_id, invite_code, is_official, legacy_seeded) " +
          "VALUES ($1, $2, $3, FALSE, TRUE) " +
          "RETURNING id, name, owner_id, invite_code, is_official, created_at",
          [
            name,
            ownerId,
            peopleNewInviteCode()
          ]
        );

      const row =
        result.rows[0];

      await client.query(
        "INSERT INTO people_server_members (server_id, user_id) " +
        "VALUES ($1, $2)",
        [
          row.id,
          ownerId
        ]
      );

      await client.query("COMMIT");

      return {
        id:
          String(row.id),
        name:
          row.name,
        ownerId:
          String(row.owner_id),
        inviteCode:
          row.invite_code,
        official:
          false,
        createdAt:
          row.created_at
      };
    } catch (err) {
      await client
        .query("ROLLBACK")
        .catch(() => {});

      throw err;
    } finally {
      client.release();
    }
  }

  const data =
    peopleReadLocalServers();

  const id =
    cryptoAccounts.randomUUID();

  const server = {
    id,
    name,
    ownerId,
    inviteCode:
      peopleNewInviteCode(),
    official:
      false,
    legacySeeded:
      true,
    createdAt:
      new Date().toISOString()
  };

  data.servers.push(server);

  data.members.push({
    serverId:
      id,
    userId:
      ownerId,
    joinedAt:
      new Date().toISOString()
  });

  peopleWriteLocalServers(data);

  return server;
}

async function peopleServerReplyPreview(
  serverId,
  replyToId,
  db = peoplePool,
  channelId = null
) {
  const id =
    peopleReplyId(replyToId);

  const sid =
    String(serverId || "");

  const cid =
    channelId ? String(channelId) : "";

  if (!id || !sid) {
    return null;
  }

  if (peoplePool) {
    if (
      !/^\d+$/.test(id) ||
      !/^\d+$/.test(sid)
    ) {
      return null;
    }

    const result =
      await db.query(
        "SELECT gm.id, gm.username, gm.body, " +
        "(SELECT i.id FROM people_message_images i " +
        "WHERE i.general_message_id = gm.id LIMIT 1) AS image_id " +
        "FROM people_general_messages gm " +
        "WHERE gm.id = $1 AND gm.server_id = $2 " +
        (cid ? "AND gm.channel_id = $3 " : "") +
        "LIMIT 1",
        cid ? [id, sid, cid] : [id, sid]
      );

    const row =
      result.rows[0];

    if (!row) return null;

    return {
      id:
        String(row.id),
      username:
        row.username,
      text:
        peopleDecryptMessageText(
          row.body
        ),
      imageId:
        row.image_id
          ? String(row.image_id)
          : null,
      deleted:
        false
    };
  }

  const message =
    peopleReadLocalGeneral()
      .find(
        (item) =>
          String(item.id) === id &&
          String(item.serverId) === sid &&
          (!cid || String(item.channelId || "") === cid)
      );

  if (!message) {
    return null;
  }

  return {
    id:
      String(message.id),
    username:
      String(message.username || ""),
    text:
      String(message.text || ""),
    imageId:
      message.imageId
        ? String(message.imageId)
        : null,
    deleted:
      false
  };
}

async function peopleServerSaveMessage(
  serverId,
  channelId,
  senderId,
  username,
  text,
  imageId = null,
  replyToId = null
) {
  const sid =
    String(serverId);

  const cid =
    String(channelId || "");

  const cleanUsername =
    peopleUsername(username)
      .slice(0, 24);

  const cleanText =
    String(text || "")
      .trim()
      .slice(0, 1000);

  const imageKey =
    peopleNormalizeMessageImageId(
      imageId
    );

  const replyKey =
    peopleReplyId(
      replyToId
    );

  if (
    !sid ||
    !cid ||
    !cleanUsername ||
    (
      !cleanText &&
      !imageKey
    )
  ) {
    return null;
  }

  if (peoplePool) {
    const client =
      await peoplePool.connect();

    try {
      await client.query("BEGIN");

      const reply =
        replyKey
          ? await peopleServerReplyPreview(
              sid,
              replyKey,
              client,
              cid
            )
          : null;

      if (
        replyKey &&
        !reply
      ) {
        const err =
          new Error("REPLY_INVALID");

        err.code =
          "REPLY_INVALID";

        throw err;
      }

      const result =
        await client.query(
          "INSERT INTO people_general_messages " +
          "(server_id, channel_id, sender_id, username, body, reply_to_id) " +
          "VALUES ($1, $2, $3, $4, $5, $6) " +
          "RETURNING id, username, body, reply_to_id, created_at",
          [
            sid,
            cid,
            String(senderId),
            cleanUsername,
            peopleEncryptMessageText(
              cleanText
            ),
            replyKey || null
          ]
        );

      const row =
        result.rows[0];

      let boundImageId =
        null;

      if (imageKey) {
        boundImageId =
          await peopleBindGeneralMessageImage(
            senderId,
            imageKey,
            row.id,
            client
          );

        if (!boundImageId) {
          const err =
            new Error("IMAGE_INVALID");

          err.code =
            "IMAGE_INVALID";

          throw err;
        }
      }

      await client.query("COMMIT");

      return {
        id:
          String(row.id),
        serverId:
          sid,
        channelId:
          cid,
        username:
          row.username,
        text:
          peopleDecryptMessageText(
            row.body
          ),
        imageId:
          boundImageId,
        replyTo:
          reply,
        time:
          new Date(
            row.created_at
          ).getTime()
      };
    } catch (err) {
      await client
        .query("ROLLBACK")
        .catch(() => {});

      throw err;
    } finally {
      client.release();
    }
  }

  const messages =
    peopleReadLocalGeneral();

  const reply =
    replyKey
      ? await peopleServerReplyPreview(
          sid,
          replyKey,
          peoplePool,
          cid
        )
      : null;

  if (
    replyKey &&
    !reply
  ) {
    const err =
      new Error("REPLY_INVALID");

    err.code =
      "REPLY_INVALID";

    throw err;
  }

  const message = {
    id:
      cryptoAccounts.randomUUID(),
    serverId:
      sid,
    channelId:
      cid,
    senderId:
      String(senderId),
    username:
      cleanUsername,
    text:
      cleanText,
    imageId:
      null,
    replyToId:
      replyKey || null,
    time:
      Date.now()
  };

  if (imageKey) {
    const bound =
      await peopleBindGeneralMessageImage(
        senderId,
        imageKey,
        message.id
      );

    if (!bound) {
      const err =
        new Error("IMAGE_INVALID");

      err.code =
        "IMAGE_INVALID";

      throw err;
    }

    message.imageId =
      bound;
  }

  messages.push(message);

  peopleWriteLocalGeneral(messages);

  return {
    ...message,
    replyTo:
      reply
  };
}

async function peopleServerLoadMessages(
  serverId,
  channelId,
  limit = 100
) {
  const sid =
    String(serverId);

  const cid =
    String(channelId || "");

  const safeLimit =
    Math.max(
      1,
      Math.min(
        200,
        Number(limit) || 100
      )
    );

  if (peoplePool) {
    const result =
      await peoplePool.query(
        "SELECT " +
        "gm.id, gm.username, gm.body, gm.reply_to_id, gm.is_system, gm.created_at, " +
        "(SELECT i.id FROM people_message_images i " +
        "WHERE i.general_message_id = gm.id LIMIT 1) AS image_id, " +
        "rgm.username AS reply_username, " +
        "rgm.body AS reply_body, " +
        "(SELECT ri.id FROM people_message_images ri " +
        "WHERE ri.general_message_id = rgm.id LIMIT 1) AS reply_image_id " +
        "FROM people_general_messages gm " +
        "LEFT JOIN people_general_messages rgm " +
        "ON rgm.id = gm.reply_to_id AND rgm.server_id = gm.server_id AND rgm.channel_id = gm.channel_id " +
        "WHERE gm.server_id = $1 AND gm.channel_id = $2 " +
        "ORDER BY gm.created_at DESC LIMIT $3",
        [
          sid,
          cid,
          safeLimit
        ]
      );

    return result.rows
      .reverse()
      .map(
        (row) => ({
          id:
            String(row.id),
          serverId:
            sid,
          channelId:
            cid,
          system:
            Boolean(row.is_system),
          username:
            row.username,
          text:
            peopleDecryptMessageText(
              row.body
            ),
          imageId:
            row.image_id
              ? String(row.image_id)
              : null,
          replyTo:
            row.reply_to_id
              ? (
                  row.reply_username
                    ? {
                        id:
                          String(
                            row.reply_to_id
                          ),
                        username:
                          row.reply_username,
                        text:
                          peopleDecryptMessageText(
                            row.reply_body || ""
                          ),
                        imageId:
                          row.reply_image_id
                            ? String(
                                row.reply_image_id
                              )
                            : null,
                        deleted:
                          false
                      }
                    : peopleDeletedReply(
                        row.reply_to_id
                      )
                )
              : null,
          time:
            new Date(
              row.created_at
            ).getTime()
        })
      );
  }

  const all =
    peopleReadLocalGeneral()
      .filter(
        (message) =>
          String(message.serverId) ===
          sid &&
          String(message.channelId || "") ===
          cid
      );

  const byId =
    new Map(
      all.map(
        (message) => [
          String(message.id),
          message
        ]
      )
    );

  return all
    .slice(-safeLimit)
    .map(
      (message) => {
        const replyId =
          peopleReplyId(
            message.replyToId
          );

        const target =
          replyId
            ? byId.get(replyId)
            : null;

        return {
          id:
            String(message.id || ""),
          serverId:
            sid,
          channelId:
            cid,
          system:
            Boolean(
              message.system ||
              message.isSystem
            ),
          username:
            String(
              message.username || ""
            ),
          text:
            String(
              message.text || ""
            ),
          imageId:
            message.imageId
              ? String(message.imageId)
              : null,
          replyTo:
            replyId
              ? (
                  target
                    ? {
                        id:
                          String(target.id),
                        username:
                          String(
                            target.username || ""
                          ),
                        text:
                          String(
                            target.text || ""
                          ),
                        imageId:
                          target.imageId
                            ? String(
                                target.imageId
                              )
                            : null,
                        deleted:
                          false
                      }
                    : peopleDeletedReply(
                        replyId
                      )
                )
              : null,
          time:
            Number(
              message.time ||
              Date.now()
            )
        };
      }
    );
}

async function peopleServerDeleteMessage(
  accountId,
  serverId,
  channelId,
  messageId
) {
  const owner =
    String(accountId);

  const sid =
    String(serverId);

  const cid =
    String(channelId || "");

  const id =
    peopleReplyId(messageId);

  if (
    !owner ||
    !sid ||
    !cid ||
    !id
  ) {
    return false;
  }

  if (peoplePool) {
    if (
      !/^\d+$/.test(id) ||
      !/^\d+$/.test(sid)
    ) {
      return false;
    }

    const result =
      await peoplePool.query(
        "DELETE FROM people_general_messages " +
        "WHERE id = $1 AND sender_id = $2 AND server_id = $3 AND channel_id = $4 " +
        "RETURNING id",
        [
          id,
          owner,
          sid,
          cid
        ]
      );

    return Boolean(
      result.rows[0]
    );
  }

  const messages =
    peopleReadLocalGeneral();

  const index =
    messages.findIndex(
      (item) =>
        String(item.id) === id &&
        String(item.senderId) === owner &&
        String(item.serverId) === sid &&
        String(item.channelId || "") === cid
    );

  if (index < 0) {
    return false;
  }

  messages.splice(index, 1);

  peopleWriteLocalGeneral(
    messages
  );

  peopleDeleteLocalBoundMessageImage(
    "general",
    id
  );

  return true;
}

async function peopleInitServersV1() {
  if (peoplePool) {
    await peoplePool.query(
      "CREATE TABLE IF NOT EXISTS people_servers (" +
      "id BIGSERIAL PRIMARY KEY, " +
      "name VARCHAR(40) NOT NULL, " +
      "owner_id BIGINT NULL REFERENCES people_accounts(id) ON DELETE SET NULL, " +
      "invite_code VARCHAR(80) UNIQUE NOT NULL, " +
      "is_official BOOLEAN NOT NULL DEFAULT FALSE, " +
      "legacy_seeded BOOLEAN NOT NULL DEFAULT FALSE, " +
      "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
      ")"
    );

    await peoplePool.query(
      "ALTER TABLE people_servers " +
      "ADD COLUMN IF NOT EXISTS legacy_seeded BOOLEAN NOT NULL DEFAULT FALSE"
    );

    await peoplePool.query(
      "CREATE TABLE IF NOT EXISTS people_server_members (" +
      "server_id BIGINT NOT NULL REFERENCES people_servers(id) ON DELETE CASCADE, " +
      "user_id BIGINT NOT NULL REFERENCES people_accounts(id) ON DELETE CASCADE, " +
      "joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
      "PRIMARY KEY(server_id, user_id)" +
      ")"
    );

    await peoplePool.query(
      "CREATE INDEX IF NOT EXISTS people_server_members_user_idx " +
      "ON people_server_members(user_id, joined_at)"
    );

    let officialResult =
      await peoplePool.query(
        "SELECT id, name, owner_id, invite_code, is_official, legacy_seeded, created_at " +
        "FROM people_servers WHERE is_official = TRUE LIMIT 1"
      );

    let official =
      officialResult.rows[0];

    if (!official) {
      const founderResult =
        await peoplePool.query(
          "SELECT id FROM people_accounts " +
          "ORDER BY created_at ASC, id ASC LIMIT 1"
        );

      const founderId =
        founderResult.rows[0]?.id || null;

      const inserted =
        await peoplePool.query(
          "INSERT INTO people_servers " +
          "(name, owner_id, invite_code, is_official, legacy_seeded) " +
          "VALUES ('People', $1, $2, TRUE, FALSE) " +
          "RETURNING id, name, owner_id, invite_code, is_official, legacy_seeded, created_at",
          [
            founderId,
            peopleNewInviteCode()
          ]
        );

      official =
        inserted.rows[0];
    }

    /*
      Migration : seul le compte fondateur garde un accès direct.
      Aucun autre compte existant ou futur n'est ajouté automatiquement.
    */
    if (!official.legacy_seeded) {
      if (official.owner_id) {
        await peoplePool.query(
          "INSERT INTO people_server_members (server_id, user_id) " +
          "VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [
            official.id,
            official.owner_id
          ]
        );
      }

      await peoplePool.query(
        "UPDATE people_servers SET legacy_seeded = TRUE WHERE id = $1",
        [official.id]
      );
    }

    await peoplePool.query(
      "ALTER TABLE people_general_messages " +
      "ADD COLUMN IF NOT EXISTS server_id BIGINT NULL " +
      "REFERENCES people_servers(id) ON DELETE CASCADE"
    );

    await peoplePool.query(
      "ALTER TABLE people_general_messages " +
      "ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE"
    );

    await peoplePool.query(
      "UPDATE people_general_messages " +
      "SET server_id = $1 WHERE server_id IS NULL",
      [official.id]
    );

    await peoplePool.query(
      "CREATE INDEX IF NOT EXISTS people_general_messages_server_created_idx " +
      "ON people_general_messages(server_id, created_at DESC)"
    );

    console.log(
      "[People] Serveur officiel prêt. Invitation: /invite/" +
      official.invite_code
    );

    return;
  }

  const data =
    peopleReadLocalServers();

  let official =
    data.servers.find(
      (server) =>
        Boolean(server.official)
    );

  if (!official) {
    const accounts =
      peopleReadLocalAccounts()
        .slice()
        .sort(
          (a, b) =>
            new Date(
              a.created_at ||
              a.createdAt ||
              0
            ).getTime() -
            new Date(
              b.created_at ||
              b.createdAt ||
              0
            ).getTime()
        );

    const founderId =
      accounts[0]?.id
        ? String(accounts[0].id)
        : null;

    official = {
      id:
        cryptoAccounts.randomUUID(),
      name:
        "People",
      ownerId:
        founderId,
      inviteCode:
        peopleNewInviteCode(),
      official:
        true,
      legacySeeded:
        false,
      createdAt:
        new Date().toISOString()
    };

    data.servers.push(
      official
    );
  }

  if (!official.legacySeeded) {
    if (official.ownerId) {
      const exists =
        data.members.some(
          (member) =>
            String(member.serverId) ===
              String(official.id) &&
            String(member.userId) ===
              String(official.ownerId)
        );

      if (!exists) {
        data.members.push({
          serverId:
            String(official.id),
          userId:
            String(official.ownerId),
          joinedAt:
            new Date().toISOString()
        });
      }
    }

    official.legacySeeded =
      true;
  }

  const messages =
    peopleReadLocalGeneral();

  let changed = false;

  for (const message of messages) {
    if (!message.serverId) {
      message.serverId =
        String(official.id);

      changed = true;
    }
  }

  if (changed) {
    peopleWriteLocalGeneral(
      messages
    );
  }

  peopleWriteLocalServers(
    data
  );

  console.log(
    "[People] Serveur officiel local prêt. Invitation: /invite/" +
    official.inviteCode
  );
}


// === PEOPLE_SERVER_CHANNELS_V2_START ===
function peopleChannelName(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 50);
}

function peopleValidChannelName(value) {
  const name = peopleChannelName(value);
  return Boolean(
    name &&
    name.length <= 50 &&
    !/[\u0000-\u001f\u007f]/u.test(name)
  );
}

function peopleChannelType(value) {
  const type = String(value || "").toLowerCase();
  return ["category", "text", "voice"].includes(type)
    ? type
    : "";
}

function peopleChannelPublic(channel) {
  if (!channel) return null;
  return {
    id: String(channel.id),
    serverId: String(channel.serverId ?? channel.server_id ?? ""),
    type: peopleChannelType(channel.type),
    name: String(channel.name || ""),
    parentId: channel.parentId ?? channel.parent_id ?? null,
    position: Number(channel.position || 0),
    createdAt: channel.createdAt ?? channel.created_at ?? null
  };
}

async function peopleListServerChannels(serverId) {
  const sid = String(serverId || "");
  if (!sid) return [];

  if (peoplePool) {
    const result = await peoplePool.query(
      "SELECT id, server_id, type, name, parent_id, position, created_at " +
      "FROM people_server_channels WHERE server_id = $1 " +
      "ORDER BY position ASC, id ASC",
      [sid]
    );
    return result.rows.map(peopleChannelPublic);
  }

  const data = peopleReadLocalServers();
  return (data.channels || [])
    .filter((item) => String(item.serverId ?? item.server_id ?? "") === sid)
    .map(peopleChannelPublic)
    .sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name, "fr"));
}

async function peopleGetServerChannel(serverId, channelId, wantedType = "") {
  const sid = String(serverId || "");
  const cid = String(channelId || "");
  const expected = peopleChannelType(wantedType);
  if (!sid || !cid) return null;

  const channels = await peopleListServerChannels(sid);
  return channels.find((item) =>
    String(item.id) === cid && (!expected || item.type === expected)
  ) || null;
}

async function peopleDefaultServerChannel(serverId, type = "text") {
  const wanted = peopleChannelType(type) || "text";
  const channels = await peopleListServerChannels(serverId);
  return channels.find((item) => item.type === wanted) || null;
}

async function peopleCanManageServerChannels(accountId, serverId) {
  const server = await peopleGetServer(serverId);
  return Boolean(
    server &&
    server.ownerId &&
    String(server.ownerId) === String(accountId)
  );
}

async function peopleBroadcastServerChannels(serverId) {
  const sid = String(serverId || "");
  if (!sid) return;
  const channels = await peopleListServerChannels(sid);
  io.to(peopleServerRoom(sid)).emit("server-channels-updated", {
    serverId: sid,
    channels
  });
}

async function peopleCreateServerChannel(serverId, rawType, rawName, rawParentId = null) {
  const sid = String(serverId || "");
  const type = peopleChannelType(rawType);
  const name = peopleChannelName(rawName);
  let parentId = rawParentId ? String(rawParentId) : null;

  if (!sid || !type || !peopleValidChannelName(name)) {
    const err = new Error("CHANNEL_INVALID");
    err.code = "CHANNEL_INVALID";
    throw err;
  }

  if (type === "category") {
    parentId = null;
  } else if (parentId) {
    const parent = await peopleGetServerChannel(sid, parentId, "category");
    if (!parent) parentId = null;
  }

  const existing = await peopleListServerChannels(sid);
  const position = existing.length
    ? Math.max(...existing.map((item) => Number(item.position || 0))) + 1
    : 0;

  if (peoplePool) {
    const result = await peoplePool.query(
      "INSERT INTO people_server_channels (server_id, type, name, parent_id, position) " +
      "VALUES ($1, $2, $3, $4, $5) " +
      "RETURNING id, server_id, type, name, parent_id, position, created_at",
      [sid, type, name, parentId, position]
    );
    return peopleChannelPublic(result.rows[0]);
  }

  const data = peopleReadLocalServers();
  const channel = {
    id: cryptoAccounts.randomUUID(),
    serverId: sid,
    type,
    name,
    parentId,
    position,
    createdAt: new Date().toISOString()
  };
  data.channels = Array.isArray(data.channels) ? data.channels : [];
  data.channels.push(channel);
  peopleWriteLocalServers(data);
  return peopleChannelPublic(channel);
}

async function peopleUpdateServerChannel(serverId, channelId, patch = {}) {
  const sid = String(serverId || "");
  const cid = String(channelId || "");
  const current = await peopleGetServerChannel(sid, cid);
  if (!current) return null;

  let name = current.name;
  if (Object.prototype.hasOwnProperty.call(patch, "name")) {
    name = peopleChannelName(patch.name);
    if (!peopleValidChannelName(name)) {
      const err = new Error("CHANNEL_INVALID");
      err.code = "CHANNEL_INVALID";
      throw err;
    }
  }

  let parentId = current.parentId ? String(current.parentId) : null;
  if (current.type === "category") {
    parentId = null;
  } else if (Object.prototype.hasOwnProperty.call(patch, "parentId")) {
    const requested = patch.parentId ? String(patch.parentId) : null;
    if (requested) {
      const parent = await peopleGetServerChannel(sid, requested, "category");
      parentId = parent ? String(parent.id) : null;
    } else {
      parentId = null;
    }
  }

  const position = Number.isFinite(Number(patch.position))
    ? Math.max(0, Math.floor(Number(patch.position)))
    : current.position;

  if (peoplePool) {
    const result = await peoplePool.query(
      "UPDATE people_server_channels SET name = $3, parent_id = $4, position = $5 " +
      "WHERE id = $1 AND server_id = $2 " +
      "RETURNING id, server_id, type, name, parent_id, position, created_at",
      [cid, sid, name, parentId, position]
    );
    return peopleChannelPublic(result.rows[0]);
  }

  const data = peopleReadLocalServers();
  const item = (data.channels || []).find((entry) =>
    String(entry.id) === cid && String(entry.serverId ?? entry.server_id ?? "") === sid
  );
  if (!item) return null;
  item.name = name;
  item.parentId = parentId;
  item.position = position;
  peopleWriteLocalServers(data);
  return peopleChannelPublic(item);
}

async function peopleDeleteServerChannel(serverId, channelId) {
  const sid = String(serverId || "");
  const cid = String(channelId || "");
  const current = await peopleGetServerChannel(sid, cid);
  if (!current) return { ok: false, code: "NOT_FOUND" };

  const channels = await peopleListServerChannels(sid);
  if (current.type === "text" && channels.filter((item) => item.type === "text").length <= 1) {
    return { ok: false, code: "LAST_TEXT" };
  }

  if (current.type === "voice") {
    for (const [socketId, voiceUser] of [...voiceUsers.entries()]) {
      if (
        String(voiceUser?.serverId || "") === sid &&
        String(voiceUser?.channelId || "") === cid
      ) {
        const targetSocket = io.sockets.sockets.get(socketId);
        if (targetSocket) leaveVoice(targetSocket);
      }
    }
  }

  if (peoplePool) {
    const client = await peoplePool.connect();
    try {
      await client.query("BEGIN");
      if (current.type === "category") {
        await client.query(
          "UPDATE people_server_channels SET parent_id = NULL WHERE server_id = $1 AND parent_id = $2",
          [sid, cid]
        );
      }
      await client.query(
        "DELETE FROM people_server_channels WHERE id = $1 AND server_id = $2",
        [cid, sid]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } else {
    const data = peopleReadLocalServers();
    if (current.type === "category") {
      for (const item of data.channels || []) {
        if (String(item.parentId ?? item.parent_id ?? "") === cid) item.parentId = null;
      }
    }
    data.channels = (data.channels || []).filter((item) => String(item.id) !== cid);
    peopleWriteLocalServers(data);

    if (current.type === "text") {
      const messages = peopleReadLocalGeneral();
      const removed = messages.filter((message) =>
        String(message.serverId || "") === sid && String(message.channelId || "") === cid
      );
      for (const message of removed) {
        peopleDeleteLocalBoundMessageImage("general", message.id);
      }
      peopleWriteLocalGeneral(messages.filter((message) =>
        !(String(message.serverId || "") === sid && String(message.channelId || "") === cid)
      ));
    }
  }

  return { ok: true, channel: current };
}

async function peopleInitServerChannelsV2() {
  if (peoplePool) {
    await peoplePool.query(
      "CREATE TABLE IF NOT EXISTS people_server_channels (" +
      "id BIGSERIAL PRIMARY KEY, " +
      "server_id BIGINT NOT NULL REFERENCES people_servers(id) ON DELETE CASCADE, " +
      "type VARCHAR(12) NOT NULL CHECK(type IN ('category','text','voice')), " +
      "name VARCHAR(50) NOT NULL, " +
      "parent_id BIGINT NULL REFERENCES people_server_channels(id) ON DELETE SET NULL, " +
      "position INTEGER NOT NULL DEFAULT 0, " +
      "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
      ")"
    );
    await peoplePool.query(
      "CREATE INDEX IF NOT EXISTS people_server_channels_server_position_idx " +
      "ON people_server_channels(server_id, position, id)"
    );
    await peoplePool.query(
      "ALTER TABLE people_general_messages ADD COLUMN IF NOT EXISTS channel_id BIGINT NULL " +
      "REFERENCES people_server_channels(id) ON DELETE CASCADE"
    );

    const servers = await peoplePool.query("SELECT id FROM people_servers ORDER BY id ASC");
    for (const row of servers.rows) {
      const sid = String(row.id);
      let text = await peopleDefaultServerChannel(sid, "text");
      if (!text) text = await peopleCreateServerChannel(sid, "text", "général", null);
      let voice = await peopleDefaultServerChannel(sid, "voice");
      if (!voice) voice = await peopleCreateServerChannel(sid, "voice", "vocal", null);
      await peoplePool.query(
        "UPDATE people_general_messages SET channel_id = $2 WHERE server_id = $1 AND channel_id IS NULL",
        [sid, text.id]
      );
    }
    await peoplePool.query(
      "CREATE INDEX IF NOT EXISTS people_general_messages_channel_created_idx " +
      "ON people_general_messages(channel_id, created_at DESC)"
    );
    console.log("[People] Catégories et salons serveur V2 prêts.");
    return;
  }

  const data = peopleReadLocalServers();
  data.channels = Array.isArray(data.channels) ? data.channels : [];
  for (const server of data.servers || []) {
    const sid = String(server.id);
    let text = data.channels.find((item) => String(item.serverId || "") === sid && item.type === "text");
    if (!text) {
      text = {
        id: cryptoAccounts.randomUUID(), serverId: sid, type: "text", name: "général",
        parentId: null, position: data.channels.length, createdAt: new Date().toISOString()
      };
      data.channels.push(text);
    }
    if (!data.channels.some((item) => String(item.serverId || "") === sid && item.type === "voice")) {
      data.channels.push({
        id: cryptoAccounts.randomUUID(), serverId: sid, type: "voice", name: "vocal",
        parentId: null, position: data.channels.length, createdAt: new Date().toISOString()
      });
    }
    const messages = peopleReadLocalGeneral();
    let changed = false;
    for (const message of messages) {
      if (String(message.serverId || "") === sid && !message.channelId) {
        message.channelId = String(text.id);
        changed = true;
      }
    }
    if (changed) peopleWriteLocalGeneral(messages);
  }
  peopleWriteLocalServers(data);
  console.log("[People] Catégories et salons serveur locaux V2 prêts.");
}

app.get("/api/servers/:id/channels", async (req, res) => {
  try {
    const session = peopleSessionForRequest(req, res);
    if (!session) return;
    const member = await peopleIsServerMember(session.id, req.params.id);
    if (!member) return res.status(403).json({ ok: false, error: "Tu n'es pas membre de ce serveur." });
    res.json({ ok: true, channels: await peopleListServerChannels(req.params.id) });
  } catch (err) {
    console.error("[People channels/list]", err);
    res.status(500).json({ ok: false, error: "Impossible de charger les salons." });
  }
});

app.post("/api/servers/:id/channels", async (req, res) => {
  try {
    const session = peopleSessionForRequest(req, res);
    if (!session) return;
    if (!(await peopleCanManageServerChannels(session.id, req.params.id))) {
      return res.status(403).json({ ok: false, error: "Seul le propriétaire peut gérer les salons pour le moment." });
    }
    const channel = await peopleCreateServerChannel(req.params.id, req.body?.type, req.body?.name, req.body?.parentId);
    await peopleBroadcastServerChannels(req.params.id);
    res.status(201).json({ ok: true, channel });
  } catch (err) {
    const status = err?.code === "CHANNEL_INVALID" ? 400 : 500;
    res.status(status).json({ ok: false, error: status === 400 ? "Nom ou type de salon invalide." : "Impossible de créer cet élément." });
  }
});

app.patch("/api/servers/:id/channels/:channelId", async (req, res) => {
  try {
    const session = peopleSessionForRequest(req, res);
    if (!session) return;
    if (!(await peopleCanManageServerChannels(session.id, req.params.id))) {
      return res.status(403).json({ ok: false, error: "Seul le propriétaire peut gérer les salons pour le moment." });
    }
    const channel = await peopleUpdateServerChannel(req.params.id, req.params.channelId, req.body || {});
    if (!channel) return res.status(404).json({ ok: false, error: "Salon introuvable." });
    await peopleBroadcastServerChannels(req.params.id);
    res.json({ ok: true, channel });
  } catch (err) {
    const status = err?.code === "CHANNEL_INVALID" ? 400 : 500;
    res.status(status).json({ ok: false, error: status === 400 ? "Nom de salon invalide." : "Impossible de modifier cet élément." });
  }
});

app.delete("/api/servers/:id/channels/:channelId", async (req, res) => {
  try {
    const session = peopleSessionForRequest(req, res);
    if (!session) return;
    if (!(await peopleCanManageServerChannels(session.id, req.params.id))) {
      return res.status(403).json({ ok: false, error: "Seul le propriétaire peut gérer les salons pour le moment." });
    }
    const result = await peopleDeleteServerChannel(req.params.id, req.params.channelId);
    if (!result.ok && result.code === "LAST_TEXT") {
      return res.status(400).json({ ok: false, error: "Un serveur doit garder au moins un salon textuel." });
    }
    if (!result.ok) return res.status(404).json({ ok: false, error: "Salon introuvable." });
    await peopleBroadcastServerChannels(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[People channels/delete]", err);
    res.status(500).json({ ok: false, error: "Impossible de supprimer cet élément." });
  }
});
// === PEOPLE_SERVER_CHANNELS_V2_END ===

app.get(
  "/api/servers",
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(
          req,
          res
        );

      if (!session) return;

      const servers =
        await peopleListServersForUser(
          session.id
        );

      res.json({
        ok: true,
        servers
      });
    } catch (err) {
      console.error(
        "[People servers/list]",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          "Impossible de charger tes serveurs."
      });
    }
  }
);

app.post(
  "/api/servers",
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(
          req,
          res
        );

      if (!session) return;

      const server =
        await peopleCreateServer(
          session.id,
          req.body?.name
        );

      if (!(await peopleDefaultServerChannel(server.id, "text"))) {
        await peopleCreateServerChannel(server.id, "text", "général", null);
      }
      if (!(await peopleDefaultServerChannel(server.id, "voice"))) {
        await peopleCreateServerChannel(server.id, "voice", "vocal", null);
      }

      res.status(201).json({
        ok: true,
        server:
          peopleServerPublic(server)
      });
    } catch (err) {
      if (
        err?.code ===
        "SERVER_NAME"
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Le nom du serveur doit faire entre 2 et 40 caractères."
        });
      }

      console.error(
        "[People servers/create]",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          "Impossible de créer le serveur."
      });
    }
  }
);

app.get(
  "/api/servers/invite/:code",
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(
          req,
          res
        );

      if (!session) return;

      const server =
        await peopleGetServerByInvite(
          req.params.code
        );

      if (!server) {
        return res.status(404).json({
          ok: false,
          error:
            "Cette invitation n'existe plus."
        });
      }

      // === PEOPLE_NAVIGATION_PARALLEL_V1_INVITE ===
      const [joined, memberCount] =
        await Promise.all([
          peopleIsServerMember(
            session.id,
            server.id
          ),
          peopleServerMemberCount(
            server.id
          )
        ]);

      res.json({
        ok: true,
        server: {
          ...peopleServerPublic(
            server
          ),
          joined,
          memberCount
        }
      });
    } catch (err) {
      console.error(
        "[People servers/invite preview]",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          "Impossible de charger l'invitation."
      });
    }
  }
);

// === PEOPLE_SERVER_MEMBERSHIP_MESSAGES_V1_START ===
async function peopleSaveServerSystemMessage(
  serverId,
  text
) {
  const sid =
    String(serverId || "");

  const cleanText =
    String(text || "")
      .trim()
      .slice(0, 1000);

  if (
    !sid ||
    !cleanText
  ) {
    return null;
  }

  const textChannel = await peopleDefaultServerChannel(sid, "text");
  const channelId = textChannel ? String(textChannel.id) : null;
  if (!channelId) return null;

  if (peoplePool) {
    const result =
      await peoplePool.query(
        "INSERT INTO people_general_messages " +
        "(server_id, channel_id, sender_id, username, body, is_system) " +
        "VALUES ($1, $2, NULL, $3, $4, TRUE) " +
        "RETURNING id, body, created_at",
        [
          sid,
          channelId,
          "Système",
          peopleEncryptMessageText(
            cleanText
          )
        ]
      );

    const row =
      result.rows[0];

    return {
      id:
        String(row.id),
      serverId:
        sid,
      channelId,
      username:
        "Système",
      text:
        peopleDecryptMessageText(
          row.body
        ),
      system:
        true,
      time:
        new Date(
          row.created_at
        ).getTime()
    };
  }

  const messages =
    peopleReadLocalGeneral();

  const message = {
    id:
      cryptoAccounts.randomUUID(),
    serverId:
      sid,
    channelId,
    senderId:
      null,
    username:
      "Système",
    text:
      cleanText,
    imageId:
      null,
    replyToId:
      null,
    system:
      true,
    time:
      Date.now()
  };

  messages.push(
    message
  );

  peopleWriteLocalGeneral(
    messages
  );

  return message;
}

async function peopleEmitServerMembershipMessage(
  serverId,
  accountId,
  action
) {
  const sid =
    String(serverId || "");

  const uid =
    String(accountId || "");

  if (
    !sid ||
    !uid
  ) {
    return;
  }

  const account =
    await peopleFindAccountById(
      uid
    );

  const username =
    peopleUsername(
      account?.username ||
      "Quelqu'un"
    );

  const text =
    action === "leave"
      ? `${username} a quitté le serveur`
      : `${username} a rejoint le serveur`;

  const saved =
    await peopleSaveServerSystemMessage(
      sid,
      text
    );

  if (!saved) {
    return;
  }

  io.to(
    peopleServerRoom(
      sid
    )
  ).emit(
    "system-message",
    saved
  );
}
// === PEOPLE_SERVER_MEMBERSHIP_MESSAGES_V1_END ===

app.post(
  "/api/servers/invite/:code/join",
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(
          req,
          res
        );

      if (!session) return;

      const server =
        await peopleGetServerByInvite(
          req.params.code
        );

      if (!server) {
        return res.status(404).json({
          ok: false,
          error:
            "Cette invitation n'existe plus."
        });
      }

      const wasAlreadyMember =
        await peopleIsServerMember(
          session.id,
          server.id
        );

      await peopleJoinServer(
        session.id,
        server.id
      );

      if (!wasAlreadyMember) {
        await peopleEmitServerMembershipMessage(
          server.id,
          session.id,
          "join"
        );

        await emitOnlineUsers(
          server.id
        );
      }

      res.json({
        ok: true,
        server:
          peopleServerPublic(server)
      });
    } catch (err) {
      console.error(
        "[People servers/join]",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          "Impossible de rejoindre le serveur."
      });
    }
  }
);

// === PEOPLE_SERVER_LEAVE_V1_START ===
app.delete(
  "/api/servers/:id/membership",
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(
          req,
          res
        );

      if (!session) return;

      const server =
        await peopleGetServer(
          req.params.id
        );

      if (!server) {
        return res.status(404).json({
          ok: false,
          error:
            "Serveur introuvable."
        });
      }

      const member =
        await peopleIsServerMember(
          session.id,
          server.id
        );

      if (!member) {
        return res.status(404).json({
          ok: false,
          error:
            "Tu n'es pas membre de ce serveur."
        });
      }

      // === PEOPLE_OWNER_CAN_LEAVE_USER_SERVER_V1 ===
      const leavingOwner =
        Boolean(
          server.ownerId &&
          String(
            server.ownerId
          ) ===
            String(
              session.id
            )
        );

      /*
        Le serveur officiel People reste permanent.
        Pour un serveur utilisateur, le propriétaire peut partir.
      */
      if (
        server.official &&
        leavingOwner
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Le propriétaire du serveur officiel People ne peut pas le quitter."
        });
      }

      if (peoplePool) {
        await peoplePool.query(
          "DELETE FROM people_server_members " +
          "WHERE server_id = $1 AND user_id = $2",
          [
            String(server.id),
            String(session.id)
          ]
        );

        // === PEOPLE_OWNER_CLEAR_ON_LEAVE_V1 ===
        if (leavingOwner) {
          await peoplePool.query(
            "UPDATE people_servers " +
            "SET owner_id = NULL " +
            "WHERE id = $1 AND is_official = FALSE",
            [
              String(
                server.id
              )
            ]
          );
        }
      } else {
        const data =
          peopleReadLocalServers();

        data.members =
          data.members.filter(
            (entry) =>
              !(
                String(entry.serverId) ===
                  String(server.id) &&
                String(entry.userId) ===
                  String(session.id)
              )
          );

        if (leavingOwner) {
          const storedServer =
            data.servers.find(
              (item) =>
                String(
                  item.id
                ) ===
                  String(
                    server.id
                  )
            );

          if (
            storedServer &&
            !Boolean(
              storedServer.official
            )
          ) {
            storedServer.ownerId =
              null;

            storedServer.owner_id =
              null;
          }
        }

        peopleWriteLocalServers(
          data
        );
      }

      for (
        const [
          socketId,
          currentServerId
        ]
        of socketServerIds.entries()
      ) {
        if (
          String(currentServerId) !==
            String(server.id) ||
          String(
            userIds.get(socketId) || ""
          ) !==
            String(session.id)
        ) {
          continue;
        }

        const targetSocket =
          io.sockets.sockets.get(
            socketId
          );

        if (targetSocket) {
          leaveVoice(
            targetSocket
          );

          await targetSocket.leave(
            peopleServerRoom(
              server.id
            )
          );

          targetSocket.emit(
            "server-membership-left",
            {
              serverId:
                String(server.id)
            }
          );
        }

        socketServerIds.delete(
          socketId
        );
      }

      // === PEOPLE_VOICE_MEMBERSHIP_CLEANUP_V2 ===
      for (
        const [
          voiceSocketId,
          voiceUser
        ]
        of [...voiceUsers.entries()]
      ) {
        if (
          String(
            voiceUser?.serverId ||
            ""
          ) !==
            String(
              server.id
            ) ||
          String(
            voiceUser?.accountId ||
            userIds.get(
              voiceSocketId
            ) ||
            ""
          ) !==
            String(
              session.id
            )
        ) {
          continue;
        }

        const voiceSocket =
          io.sockets.sockets.get(
            voiceSocketId
          );

        if (voiceSocket) {
          leaveVoice(
            voiceSocket
          );
        }
      }

      // === PEOPLE_DELETE_EMPTY_AFTER_LEAVE_V1 ===
      const serverDeleted =
        await peopleDeleteServerIfEmpty(
          server.id
        );

      if (!serverDeleted) {
        emitOnlineUsers(
          server.id
        );

        await peopleEmitServerMembershipMessage(
          server.id,
          session.id,
          "leave"
        );
      }

      res.json({
        ok: true,
        serverId:
          String(server.id),
        deleted:
          serverDeleted
      });
    } catch (err) {
      console.error(
        "[People servers/leave]",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          "Impossible de quitter le serveur."
      });
    }
  }
);
// === PEOPLE_SERVER_LEAVE_V1_END ===

app.get(
  "/api/servers/:id/invite",
  async (req, res) => {
    try {
      const session =
        peopleSessionForRequest(
          req,
          res
        );

      if (!session) return;

      const server =
        await peopleGetServer(
          req.params.id
        );

      if (!server) {
        return res.status(404).json({
          ok: false,
          error:
            "Serveur introuvable."
        });
      }

      const member =
        await peopleIsServerMember(
          session.id,
          server.id
        );

      if (!member) {
        return res.status(403).json({
          ok: false,
          error:
            "Tu n'es pas membre de ce serveur."
        });
      }

      res.json({
        ok: true,
        invitePath:
          "/invite/" +
          server.inviteCode
      });
    } catch (err) {
      console.error(
        "[People servers/invite link]",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          "Impossible de créer le lien d'invitation."
      });
    }
  }
);

app.get(
  "/invite/:code",
  (req, res) => {
    res.sendFile(
      pathAccounts.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);
// === PEOPLE_SERVERS_V1_END ===

// === PEOPLE_DESKTOP_APP_VERSION_V1_START ===
const PEOPLE_DESKTOP_RELEASE_FILE =
  pathAccounts.join(
    __dirname,
    "release.json"
  );

const PEOPLE_DESKTOP_DEFAULT_VERSION =
  "1.0.0";

const PEOPLE_DESKTOP_DEFAULT_INSTALLER_URL =
  "https://github.com/MioLeVrai/PeopleTheNewAppBetterThanTheBlueBotAndWithoutCapitalism/releases/latest/download/People-Setup.exe";

function peopleDesktopReleaseInfo() {
  let release = {};

  try {
    if (
      fsAccounts.existsSync(
        PEOPLE_DESKTOP_RELEASE_FILE
      )
    ) {
      release =
        JSON.parse(
          fsAccounts.readFileSync(
            PEOPLE_DESKTOP_RELEASE_FILE,
            "utf8"
          )
        );
    }
  } catch (err) {
    console.warn(
      "[People release.json]",
      err?.message || err
    );
  }

  const version =
    String(
      process.env.PEOPLE_DESKTOP_VERSION ||
      release?.version ||
      PEOPLE_DESKTOP_DEFAULT_VERSION
    ).trim() ||
    PEOPLE_DESKTOP_DEFAULT_VERSION;

  const installerUrl =
    String(
      process.env.PEOPLE_DESKTOP_INSTALLER_URL ||
      release?.installerUrl ||
      PEOPLE_DESKTOP_DEFAULT_INSTALLER_URL
    ).trim();

  const sha256 =
    String(
      process.env.PEOPLE_DESKTOP_SHA256 ||
      release?.sha256 ||
      ""
    )
      .trim()
      .toLowerCase();

  const message =
    String(
      process.env.PEOPLE_DESKTOP_UPDATE_MESSAGE ||
      release?.message ||
      "Une nouvelle version de People est disponible."
    ).trim();

  return {
    version,
    installerUrl,
    sha256,
    message
  };
}

app.get(
  "/api/desktop/version",
  (req, res) => {
    res.set(
      "Cache-Control",
      "no-store, max-age=0"
    );

    res.status(200).json({
      ok: true,
      ...peopleDesktopReleaseInfo()
    });
  }
);
// === PEOPLE_DESKTOP_APP_VERSION_V1_END ===

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, app: "People" });
});

const users = new Map();
const userIds = new Map();
const socketServerIds = new Map();
const socketTextChannelIds = new Map();
const voiceUsers = new Map();

// === PEOPLE_DM_CALLS_V1_START ===
const peopleDmCalls =
  new Map();

const peopleDmCallTimers =
  new Map();

const peopleDmCallRingTimers =
  new Map();

const peopleDmCallLastStart =
  new Map();

const PEOPLE_DM_CALL_RING_MS =
  35 * 1000;

const PEOPLE_DM_CALL_SOLO_MS =
  3 * 60 * 1000;

async function peopleDmCallFindAccountByUsername(
  value
) {
  const wantedKey =
    peopleUsernameKey(
      value
    );

  if (!wantedKey) {
    return null;
  }

  const matches =
    await peopleListAccounts(
      value
    );

  return (
    matches.find(
      (account) =>
        peopleUsernameKey(
          account?.username
        ) === wantedKey
    ) ||
    null
  );
}

function peopleDmCallAccountSocketIds(
  accountId
) {
  const wanted =
    String(
      accountId ||
      ""
    );

  const sockets = [];

  for (
    const [socketId, currentId]
    of userIds.entries()
  ) {
    if (
      String(currentId) ===
      wanted
    ) {
      sockets.push(
        socketId
      );
    }
  }

  return sockets;
}

function peopleDmCallAccountBusy(
  accountId
) {
  const wanted =
    String(
      accountId ||
      ""
    );

  if (!wanted) {
    return false;
  }

  for (
    const call of
    peopleDmCalls.values()
  ) {
    if (
      call.status !==
        "active"
    ) {
      continue;
    }

    const role =
      peopleDmCallRoleForAccount(
        call,
        wanted
      );

    if (
      role &&
      peopleDmCallSocketForRole(
        call,
        role
      )
    ) {
      return true;
    }
  }

  return false;
}

function peopleDmCallEmitSocketIds(
  socketIds,
  event,
  payload
) {
  const unique =
    new Set(
      socketIds
        .map(
          (id) =>
            String(
              id ||
              ""
            )
        )
        .filter(Boolean)
    );

  for (
    const socketId of
    unique
  ) {
    io.to(
      socketId
    ).emit(
      event,
      payload
    );
  }
}

function peopleDmCallClearTimer(
  map,
  callId
) {
  const id =
    String(
      callId ||
      ""
    );

  const timer =
    map.get(
      id
    );

  if (timer) {
    clearTimeout(
      timer
    );
  }

  map.delete(
    id
  );
}

function peopleDmCallParticipantCount(
  call
) {
  if (!call) {
    return 0;
  }

  let count = 0;

  if (
    String(
      call.callerSocketId ||
      ""
    )
  ) {
    count += 1;
  }

  if (
    String(
      call.calleeSocketId ||
      ""
    )
  ) {
    count += 1;
  }

  return count;
}

function peopleDmCallRoleForAccount(
  call,
  accountId
) {
  const wanted =
    String(
      accountId ||
      ""
    );

  if (
    wanted &&
    String(
      call?.callerAccountId ||
      ""
    ) === wanted
  ) {
    return "caller";
  }

  if (
    wanted &&
    String(
      call?.calleeAccountId ||
      ""
    ) === wanted
  ) {
    return "callee";
  }

  return "";
}

function peopleDmCallSocketForRole(
  call,
  role
) {
  return String(
    role === "caller"
      ? call?.callerSocketId || ""
      : role === "callee"
        ? call?.calleeSocketId || ""
        : ""
  );
}

function peopleDmCallSetSocketForRole(
  call,
  role,
  socketId
) {
  const value =
    String(
      socketId ||
      ""
    ) || null;

  if (role === "caller") {
    call.callerSocketId =
      value;
  } else if (
    role === "callee"
  ) {
    call.calleeSocketId =
      value;
  }
}

function peopleDmCallMediaForRole(
  call,
  role
) {
  const value =
    role === "caller"
      ? call?.callerMedia
      : call?.calleeMedia;

  return {
    muted:
      Boolean(
        value?.muted
      ),
    camera:
      Boolean(
        value?.camera
      ),
    screen:
      Boolean(
        value?.screen
      )
  };
}

function peopleDmCallSetMediaForRole(
  call,
  role,
  media = {}
) {
  const value = {
    muted:
      Boolean(
        media?.muted
      ),
    camera:
      Boolean(
        media?.camera
      ),
    screen:
      Boolean(
        media?.screen
      )
  };

  if (role === "caller") {
    call.callerMedia =
      value;
  } else if (
    role === "callee"
  ) {
    call.calleeMedia =
      value;
  }
}

function peopleDmCallOtherRole(
  role
) {
  return role === "caller"
    ? "callee"
    : role === "callee"
      ? "caller"
      : "";
}

function peopleDmCallUsernameForRole(
  call,
  role
) {
  return String(
    role === "caller"
      ? call?.callerUsername || "Utilisateur"
      : role === "callee"
        ? call?.calleeUsername || "Utilisateur"
        : "Utilisateur"
  );
}

function peopleDmCallAccountIdForRole(
  call,
  role
) {
  return String(
    role === "caller"
      ? call?.callerAccountId || ""
      : role === "callee"
        ? call?.calleeAccountId || ""
        : ""
  );
}

function peopleDmCallFindBetween(
  accountA,
  accountB
) {
  const a =
    String(
      accountA ||
      ""
    );

  const b =
    String(
      accountB ||
      ""
    );

  if (!a || !b) {
    return null;
  }

  for (
    const call of
    peopleDmCalls.values()
  ) {
    if (
      call.status !==
        "active"
    ) {
      continue;
    }

    const samePair =
      (
        String(
          call.callerAccountId
        ) === a &&
        String(
          call.calleeAccountId
        ) === b
      ) ||
      (
        String(
          call.callerAccountId
        ) === b &&
        String(
          call.calleeAccountId
        ) === a
      );

    if (samePair) {
      return call;
    }
  }

  return null;
}

function peopleDmCallFinish(
  callId,
  reason = "hangup"
) {
  const id =
    String(
      callId ||
      ""
    );

  const call =
    peopleDmCalls.get(
      id
    );

  if (!call) {
    return false;
  }

  peopleDmCallClearTimer(
    peopleDmCallTimers,
    id
  );

  peopleDmCallClearTimer(
    peopleDmCallRingTimers,
    id
  );

  peopleDmCalls.delete(
    id
  );

  const durationSeconds =
    call.acceptedAt
      ? Math.max(
          0,
          Math.round(
            (
              Date.now() -
              Number(
                call.acceptedAt
              )
            ) /
            1000
          )
        )
      : 0;

  peopleDmCallSaveTimeline(
    call,
    "ended",
    String(
      reason ||
      "hangup"
    ),
    durationSeconds
  );

  peopleDmCallEmitSocketIds(
    [
      call.callerSocketId,
      call.calleeSocketId,
      ...peopleDmCallAccountSocketIds(
        call.callerAccountId
      ),
      ...peopleDmCallAccountSocketIds(
        call.calleeAccountId
      )
    ],
    "dm-call-ended",
    {
      callId:
        id,
      reason:
        String(
          reason ||
          "hangup"
        )
    }
  );

  peopleVoiceRefreshAccount(
    call.callerAccountId
  );

  peopleVoiceRefreshAccount(
    call.calleeAccountId
  );

  return true;
}

function peopleDmCallScheduleSoloTimeout(
  call
) {
  if (!call) {
    return;
  }

  peopleDmCallClearTimer(
    peopleDmCallTimers,
    call.id
  );

  const count =
    peopleDmCallParticipantCount(
      call
    );

  if (count === 0) {
    peopleDmCallFinish(
      call.id,
      "empty"
    );

    return;
  }

  if (count !== 1) {
    return;
  }

  call.soloSince =
    Date.now();

  const timer =
    setTimeout(
      () => {
        const current =
          peopleDmCalls.get(
            String(
              call.id
            )
          );

        if (
          !current ||
          peopleDmCallParticipantCount(
            current
          ) !== 1
        ) {
          return;
        }

        peopleDmCallFinish(
          current.id,
          "alone-timeout"
        );
      },
      PEOPLE_DM_CALL_SOLO_MS
    );

  peopleDmCallTimers.set(
    String(
      call.id
    ),
    timer
  );
}

function peopleDmCallStopRinging(
  call
) {
  if (!call) {
    return;
  }

  call.ringActive =
    false;

  peopleDmCallClearTimer(
    peopleDmCallRingTimers,
    call.id
  );

  peopleDmCallEmitSocketIds(
    [
      ...peopleDmCallAccountSocketIds(
        call.callerAccountId
      ),
      ...peopleDmCallAccountSocketIds(
        call.calleeAccountId
      )
    ],
    "dm-call-ring-ended",
    {
      callId:
        call.id
    }
  );
}

function peopleDmCallScheduleRingTimeout(
  call
) {
  if (!call) {
    return;
  }

  peopleDmCallClearTimer(
    peopleDmCallRingTimers,
    call.id
  );

  call.ringActive =
    true;

  const timer =
    setTimeout(
      () => {
        const current =
          peopleDmCalls.get(
            String(
              call.id
            )
          );

        if (!current) {
          return;
        }

        peopleDmCallStopRinging(
          current
        );
      },
      PEOPLE_DM_CALL_RING_MS
    );

  peopleDmCallRingTimers.set(
    String(
      call.id
    ),
    timer
  );
}

function peopleDmCallForActiveSocket(
  callId,
  socketId
) {
  const call =
    peopleDmCalls.get(
      String(
        callId ||
        ""
      )
    );

  if (
    !call ||
    call.status !==
      "active"
  ) {
    return null;
  }

  const currentSocket =
    String(
      socketId ||
      ""
    );

  if (
    String(
      call.callerSocketId ||
      ""
    ) !== currentSocket &&
    String(
      call.calleeSocketId ||
      ""
    ) !== currentSocket
  ) {
    return null;
  }

  return call;
}

function peopleDmCallOtherSocket(
  call,
  socketId
) {
  const current =
    String(
      socketId ||
      ""
    );

  if (
    String(
      call.callerSocketId ||
      ""
    ) === current
  ) {
    return String(
      call.calleeSocketId ||
      ""
    );
  }

  if (
    String(
      call.calleeSocketId ||
      ""
    ) === current
  ) {
    return String(
      call.callerSocketId ||
      ""
    );
  }

  return "";
}

function peopleDmCallNotifyConnected(
  call,
  joiningSocketId
) {
  const callerSocket =
    String(
      call?.callerSocketId ||
      ""
    );

  const calleeSocket =
    String(
      call?.calleeSocketId ||
      ""
    );

  if (
    !callerSocket ||
    !calleeSocket
  ) {
    return false;
  }

  peopleDmCallClearTimer(
    peopleDmCallTimers,
    call.id
  );

  call.soloSince =
    null;

  peopleDmCallStopRinging(
    call
  );

  const callerMedia =
    peopleDmCallMediaForRole(
      call,
      "caller"
    );

  const calleeMedia =
    peopleDmCallMediaForRole(
      call,
      "callee"
    );

  io.to(
    callerSocket
  ).emit(
    "dm-call-accepted",
    {
      callId:
        call.id,
      peerSocketId:
        calleeSocket,
      peerUsername:
        call.calleeUsername,
      initiator:
        String(
          callerSocket
        ) !== String(
          joiningSocketId ||
          ""
        ),
      peerMuted:
        calleeMedia.muted,
      peerCamera:
        calleeMedia.camera,
      peerScreen:
        calleeMedia.screen
    }
  );

  io.to(
    calleeSocket
  ).emit(
    "dm-call-accepted",
    {
      callId:
        call.id,
      peerSocketId:
        callerSocket,
      peerUsername:
        call.callerUsername,
      initiator:
        String(
          calleeSocket
        ) !== String(
          joiningSocketId ||
          ""
        ),
      peerMuted:
        callerMedia.muted,
      peerCamera:
        callerMedia.camera,
      peerScreen:
        callerMedia.screen
    }
  );

  return true;
}

function peopleDmCallJoinParticipant(
  call,
  accountId,
  socketId
) {
  if (
    !call ||
    call.status !==
      "active"
  ) {
    return {
      ok: false,
      reason:
        "unavailable"
    };
  }

  const role =
    peopleDmCallRoleForAccount(
      call,
      accountId
    );

  if (!role) {
    return {
      ok: false,
      reason:
        "unavailable"
    };
  }

  const currentSocket =
    peopleDmCallSocketForRole(
      call,
      role
    );

  if (currentSocket) {
    return {
      ok: false,
      reason:
        "already-joined"
    };
  }

  if (
    !peopleAccountHasVoiceSlot(
      accountId
    )
  ) {
    return {
      ok: false,
      reason:
        "limit"
    };
  }

  peopleDmCallSetSocketForRole(
    call,
    role,
    socketId
  );

  peopleDmCallSetMediaForRole(
    call,
    role,
    {
      muted: false,
      camera: false,
      screen: false
    }
  );

  peopleDmCalls.set(
    call.id,
    call
  );

  peopleVoiceRefreshAccount(
    accountId
  );

  const otherRole =
    peopleDmCallOtherRole(
      role
    );

  const peerSocketId =
    peopleDmCallSocketForRole(
      call,
      otherRole
    );

  if (peerSocketId) {
    peopleDmCallNotifyConnected(
      call,
      socketId
    );
  } else {
    peopleDmCallScheduleSoloTimeout(
      call
    );
  }

  const peerMedia =
    peopleDmCallMediaForRole(
      call,
      otherRole
    );

  return {
    ok: true,
    role,
    peerSocketId,
    peerUsername:
      peopleDmCallUsernameForRole(
        call,
        otherRole
      ),
    peerMuted:
      peerMedia.muted,
    peerCamera:
      peerMedia.camera,
    peerScreen:
      peerMedia.screen,
    initiator:
      false
  };
}

function peopleDmCallLeaveSocket(
  call,
  socketId,
  reason = "left"
) {
  if (!call) {
    return false;
  }

  const current =
    String(
      socketId ||
      ""
    );

  let role = "";

  if (
    String(
      call.callerSocketId ||
      ""
    ) === current
  ) {
    role = "caller";
  } else if (
    String(
      call.calleeSocketId ||
      ""
    ) === current
  ) {
    role = "callee";
  }

  if (!role) {
    return false;
  }

  const accountId =
    peopleDmCallAccountIdForRole(
      call,
      role
    );

  const otherRole =
    peopleDmCallOtherRole(
      role
    );

  const otherSocket =
    peopleDmCallSocketForRole(
      call,
      otherRole
    );

  peopleDmCallSetSocketForRole(
    call,
    role,
    null
  );

  peopleDmCallSetMediaForRole(
    call,
    role,
    {
      muted: false,
      camera: false,
      screen: false
    }
  );

  peopleDmCalls.set(
    call.id,
    call
  );

  io.to(
    current
  ).emit(
    "dm-call-left",
    {
      callId:
        call.id,
      reason:
        String(
          reason ||
          "left"
        )
    }
  );

  if (otherSocket) {
    io.to(
      otherSocket
    ).emit(
      "dm-call-peer-left",
      {
        callId:
          call.id,
        reason:
          String(
            reason ||
            "left"
          ),
        rejoinWindowMs:
          PEOPLE_DM_CALL_SOLO_MS
      }
    );
  }

  peopleVoiceRefreshAccount(
    accountId
  );

  if (
    peopleDmCallParticipantCount(
      call
    ) === 0
  ) {
    peopleDmCallFinish(
      call.id,
      "empty"
    );
  } else {
    peopleDmCallScheduleSoloTimeout(
      call
    );
  }

  return true;
}

function peopleDmCallDisconnect(
  socket
) {
  const socketId =
    String(
      socket?.id ||
      ""
    );

  const accountId =
    String(
      userIds.get(
        socketId
      ) ||
      ""
    );

  if (
    !socketId ||
    !accountId
  ) {
    return;
  }

  for (
    const call of
    [...peopleDmCalls.values()]
  ) {
    if (
      String(
        call.callerSocketId ||
        ""
      ) === socketId ||
      String(
        call.calleeSocketId ||
        ""
      ) === socketId
    ) {
      peopleDmCallLeaveSocket(
        call,
        socketId,
        "disconnected"
      );
    }
  }
}

// === PEOPLE_DM_CALLS_V1_END ===

// === PEOPLE_DM_CALLS_V2_START ===
const PEOPLE_DM_CALL_EVENT_PREFIX =
  "[[PEOPLE_CALL_V1|";

function peopleDmCallEventBody(
  type,
  callId,
  reason = "",
  durationSeconds = 0
) {
  const cleanType =
    type === "ended"
      ? "ended"
      : "started";

  const cleanId =
    String(
      callId ||
      ""
    ).replace(
      /[^a-zA-Z0-9-]/g,
      ""
    );

  const cleanReason =
    String(
      reason ||
      ""
    ).replace(
      /[^a-zA-Z0-9-]/g,
      ""
    );

  const duration =
    Math.max(
      0,
      Math.min(
        24 * 60 * 60,
        Math.round(
          Number(
            durationSeconds
          ) || 0
        )
      )
    );

  return (
    PEOPLE_DM_CALL_EVENT_PREFIX +
    cleanType +
    "|" +
    cleanId +
    "|" +
    cleanReason +
    "|" +
    duration +
    "]]"
  );
}

function peopleDmCallParseEventBody(
  body
) {
  const match =
    String(
      body ||
      ""
    ).match(
      /^\[\[PEOPLE_CALL_V1\|(started|ended)\|([a-zA-Z0-9-]+)\|([a-zA-Z0-9-]*)\|(\d+)\]\]$/
    );

  if (!match) {
    return null;
  }

  return {
    type:
      match[1],
    callId:
      match[2],
    reason:
      match[3] || "",
    durationSeconds:
      Math.max(
        0,
        Number(
          match[4]
        ) || 0
      )
  };
}

function peopleDmCallConversationPreview(
  body,
  imageId
) {
  const cleanBody =
    peopleDecryptMessageText(
      body
    );

  if (
    peopleDmE2eeIsEnvelope(
      cleanBody
    )
  ) {
    return "Message privé";
  }

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
  }

  if (
    event.type ===
    "started"
  ) {
    return "📞 Appel lancé";
  }

  const labels = {
    declined:
      "📞 Appel refusé",
    cancelled:
      "📞 Appel annulé",
    timeout:
      "📞 Appel manqué",
    "alone-timeout":
      "📞 Appel terminé",
    empty:
      "📞 Appel terminé",
    disconnected:
      "📞 Appel interrompu",
    hangup:
      "📞 Appel terminé"
  };

  return (
    labels[
      event.reason
    ] ||
    "📞 Appel terminé"
  );
}

function peopleDmCallEmitHistory(
  call,
  type,
  reason,
  durationSeconds,
  createdAt
) {
  const payload = {
    callId:
      call.id,
    callerId:
      String(
        call.callerAccountId
      ),
    calleeId:
      String(
        call.calleeAccountId
      ),
    type,
    reason:
      String(
        reason ||
        ""
      ),
    durationSeconds:
      Number(
        durationSeconds ||
        0
      ),
    createdAt
  };

  peopleEmitToAccount(
    call.callerAccountId,
    "dm-call-history",
    payload
  );

  peopleEmitToAccount(
    call.calleeAccountId,
    "dm-call-history",
    payload
  );
}

function peopleDmCallSaveTimeline(
  call,
  type,
  reason = "",
  durationSeconds = 0
) {
  if (!call) {
    return;
  }

  const body =
    peopleDmCallEventBody(
      type,
      call.id,
      reason,
      durationSeconds
    );

  const createdAt =
    new Date()
      .toISOString();

  /*
    L'événement de fin ne crée pas un deuxième badge non lu.
    Il reste bien visible dans l'historique.
  */
  const readAt =
    type === "ended"
      ? createdAt
      : null;

  if (peoplePool) {
    void peoplePool.query(
      "INSERT INTO people_direct_messages " +
      "(sender_id, recipient_id, body, read_at) " +
      "VALUES ($1, $2, $3, $4) " +
      "RETURNING id",
      [
        String(
          call.callerAccountId
        ),
        String(
          call.calleeAccountId
        ),
        peopleEncryptMessageText(
          body
        ),
        readAt
      ]
    )
      .then(
        () => {
          peopleDmCallEmitHistory(
            call,
            type,
            reason,
            durationSeconds,
            createdAt
          );
        }
      )
      .catch(
        (err) => {
          console.error(
            "[People dm-call/history]",
            err
          );
        }
      );

    return;
  }

  try {
    const data =
      peopleReadLocalSocial();

    data.dms.push({
      id:
        cryptoAccounts
          .randomUUID(),
      sender_id:
        String(
          call.callerAccountId
        ),
      recipient_id:
        String(
          call.calleeAccountId
        ),
      body,
      image_id:
        null,
      reply_to_id:
        null,
      created_at:
        createdAt,
      read_at:
        readAt
    });

    if (
      data.dms.length >
      10000
    ) {
      data.dms =
        data.dms.slice(
          -10000
        );
    }

    peopleWriteLocalSocial(
      data
    );

    peopleDmCallEmitHistory(
      call,
      type,
      reason,
      durationSeconds,
      createdAt
    );
  } catch (err) {
    console.error(
      "[People dm-call/history local]",
      err
    );
  }
}

function peopleDmCallDeliverPendingForAccount(
  accountId,
  socketId
) {
  const wanted =
    String(
      accountId ||
      ""
    );

  const targetSocket =
    String(
      socketId ||
      ""
    );

  if (
    !wanted ||
    !targetSocket
  ) {
    return;
  }

  for (
    const call of
    peopleDmCalls.values()
  ) {
    if (
      call.status !==
        "active"
    ) {
      continue;
    }

    const role =
      peopleDmCallRoleForAccount(
        call,
        wanted
      );

    if (!role) {
      continue;
    }

    if (
      peopleDmCallSocketForRole(
        call,
        role
      )
    ) {
      continue;
    }

    const otherRole =
      peopleDmCallOtherRole(
        role
      );

    const otherSocket =
      peopleDmCallSocketForRole(
        call,
        otherRole
      );

    if (!otherSocket) {
      continue;
    }

    const initialRing =
      role === "callee" &&
      Boolean(
        call.ringActive
      );

    io.to(
      targetSocket
    ).emit(
      "dm-call-incoming",
      {
        callId:
          call.id,
        caller: {
          id:
            peopleDmCallAccountIdForRole(
              call,
              otherRole
            ),
          username:
            peopleDmCallUsernameForRole(
              call,
              otherRole
            )
        },
        rejoin:
          !initialRing,
        silent:
          !initialRing
      }
    );
  }
}

// === PEOPLE_DM_CALLS_V2_END ===

function cleanUsername(value) {
  return String(value || "Invité")
    .trim()
    .slice(0, 24) || "Invité";
}

function peopleAccountConnectionCount(
  accountId
) {
  const wanted =
    String(accountId || "");

  if (!wanted) {
    return 0;
  }

  let count = 0;

  for (
    const id
    of userIds.values()
  ) {
    if (
      String(id) ===
      wanted
    ) {
      count += 1;
    }
  }

  return count;
}

async function peopleServerPresenceRoster(
  serverId
) {
  const sid =
    String(serverId || "");

  if (!sid) {
    return [];
  }

  const connectionCounts =
    new Map();

  for (const id of userIds.values()) {
    const key =
      String(id || "");

    if (!key) {
      continue;
    }

    connectionCounts.set(
      key,
      (
        connectionCounts.get(key) ||
        0
      ) + 1
    );
  }

  if (peoplePool) {
    const result =
      await peoplePool.query(
        "SELECT a.id, a.username, m.joined_at " +
        "FROM people_server_members m " +
        "JOIN people_accounts a ON a.id = m.user_id " +
        "WHERE m.server_id = $1 " +
        "ORDER BY LOWER(a.username) ASC, a.id ASC",
        [sid]
      );

    return result.rows.map(
      (row) => {
        const accountId =
          String(row.id);

        const connections =
          connectionCounts.get(
            accountId
          ) || 0;

        return {
          id:
            accountId,
          accountId,
          username:
            row.username,
          online:
            connections > 0,
          connections
        };
      }
    );
  }

  const serverData =
    peopleReadLocalServers();

  const accounts =
    peopleReadLocalAccounts();

  return serverData.members
    .filter(
      (member) =>
        String(
          member.serverId
        ) === sid
    )
    .map(
      (member) => {
        const accountId =
          String(
            member.userId
          );

        const account =
          accounts.find(
            (item) =>
              String(
                item.id
              ) ===
              accountId
          );

        if (!account) {
          return null;
        }

        const connections =
          connectionCounts.get(
            accountId
          ) || 0;

        return {
          id:
            accountId,
          accountId,
          username:
            account.username,
          online:
            connections > 0,
          connections
        };
      }
    )
    .filter(Boolean)
    .sort(
      (a, b) =>
        String(
          a.username || ""
        ).localeCompare(
          String(
            b.username || ""
          ),
          "fr",
          {
            sensitivity:
              "base"
          }
        )
    );
}

async function emitOnlineUsers(
  serverId,
  knownRoster = null
) {
  const sid =
    String(serverId || "");

  if (!sid) {
    return;
  }

  try {
    const roster =
      Array.isArray(
        knownRoster
      )
        ? knownRoster
        : await peopleServerPresenceRoster(
            sid
          );

    const onlineCount =
      roster.filter(
        (user) =>
          user?.online ===
          true
      ).length;

    io.to(
      peopleServerRoom(
        sid
      )
    ).emit(
      "user-count",
      onlineCount
    );

    io.to(
      peopleServerRoom(
        sid
      )
    ).emit(
      "online-users",
      roster
    );
  } catch (err) {
    console.error(
      "[People presence/server]",
      sid,
      err
    );
  }
}

// === PEOPLE_GLOBAL_PRESENCE_EVENT_V1_START ===
function peopleEmitGlobalPresence(
  accountId
) {
  const uid =
    String(
      accountId ||
      ""
    );

  if (!uid) {
    return;
  }

  const payload = {
    accountId:
      uid,
    online:
      peopleAccountIsOnline(
        uid
      )
  };

  /*
    Envoi uniquement aux sockets People authentifiées.
    La présence était déjà publique dans l'annuaire/profils ;
    cet événement ne rajoute aucune donnée privée.
  */
  for (
    const socketId of
    userIds.keys()
  ) {
    io.to(
      socketId
    ).emit(
      "people-presence-changed",
      payload
    );
  }
}
// === PEOPLE_GLOBAL_PRESENCE_EVENT_V1_END ===

async function peopleRefreshPresenceForAccount(
  accountId
) {
  const uid =
    String(accountId || "");

  if (!uid) {
    return;
  }

  // === PEOPLE_GLOBAL_PRESENCE_REFRESH_V1 ===
  peopleEmitGlobalPresence(
    uid
  );

  try {
    const servers =
      await peopleListServersForUser(
        uid
      );

    await Promise.all(
      servers.map(
        (server) =>
          emitOnlineUsers(
            server.id
          )
      )
    );
  } catch (err) {
    console.error(
      "[People presence/account]",
      uid,
      err
    );
  }
}

/*
  Une petite grâce évite le clignotement "hors ligne"
  pendant un simple F5 / reconnect Socket.IO.
  Changer d'onglet navigateur ne ferme pas la socket,
  donc ça ne touche jamais au statut.
*/
const peoplePresenceOfflineTimers =
  new Map();

function peopleCancelPresenceOffline(
  accountId
) {
  const uid =
    String(accountId || "");

  const timer =
    peoplePresenceOfflineTimers.get(
      uid
    );

  if (!timer) {
    return false;
  }

  clearTimeout(timer);

  peoplePresenceOfflineTimers.delete(
    uid
  );

  return true;
}

function peopleSchedulePresenceOffline(
  accountId
) {
  const uid =
    String(accountId || "");

  if (!uid) {
    return;
  }

  peopleCancelPresenceOffline(
    uid
  );

  const timer =
    setTimeout(
      async () => {
        peoplePresenceOfflineTimers.delete(
          uid
        );

        if (
          peopleAccountIsOnline(
            uid
          )
        ) {
          return;
        }

        await peopleRefreshPresenceForAccount(
          uid
        );
      },
      1200
    );

  peoplePresenceOfflineTimers.set(
    uid,
    timer
  );
}

// === PEOPLE_VOICE_NAVIGATION_V2_START ===
function peopleVoiceRoom(
  serverId
) {
  const sid =
    String(
      serverId ||
      ""
    );

  return (
    "people:voice:" +
    sid
  );
}

function peopleVoiceChannelRoom(serverId, channelId) {
  return "people:voice-channel:" + String(serverId || "") + ":" + String(channelId || "");
}
// === PEOPLE_VOICE_NAVIGATION_V2_END ===

// === PEOPLE_MULTI_VOICE_V1_START ===
const PEOPLE_MAX_VOICE_ROOMS_PER_ACCOUNT =
  1;

function peopleVoiceAccountServerIds(
  accountId,
  exceptSocketId = ""
) {
  const wantedAccount =
    String(
      accountId ||
      ""
    );

  const excludedSocket =
    String(
      exceptSocketId ||
      ""
    );

  const rooms =
    new Set();

  if (!wantedAccount) {
    return rooms;
  }

  for (
    const [socketId, user]
    of voiceUsers.entries()
  ) {
    if (
      excludedSocket &&
      String(socketId) ===
        excludedSocket
    ) {
      continue;
    }

    if (
      String(
        user?.accountId ||
        ""
      ) !== wantedAccount
    ) {
      continue;
    }

    const serverId =
      String(
        user?.serverId ||
        ""
      );

    if (serverId) {
      rooms.add(
        serverId
      );
    }
  }

  return rooms;
}

// === PEOPLE_UNIFIED_VOICE_LIMIT_V3_START ===
// === PEOPLE_SINGLE_VOICE_GLOBAL_V4 ===
const PEOPLE_MAX_SIMULTANEOUS_VOICES =
  1;

function peopleAccountDmCallCount(
  accountId,
  {
    includeRinging = false
  } = {}
) {
  const wanted =
    String(
      accountId ||
      ""
    );

  if (!wanted) {
    return 0;
  }

  let count =
    0;

  for (
    const call of
    peopleDmCalls.values()
  ) {
    if (
      call.status !==
        "active"
    ) {
      continue;
    }

    const role =
      peopleDmCallRoleForAccount(
        call,
        wanted
      );

    if (!role) {
      continue;
    }

    if (
      peopleDmCallSocketForRole(
        call,
        role
      )
    ) {
      count +=
        1;
    }
  }

  return count;
}

function peopleAccountActiveVoiceCount(
  accountId
) {
  return (
    peopleVoiceAccountServerIds(
      accountId
    ).size +
    peopleAccountDmCallCount(
      accountId
    )
  );
}

function peopleAccountReservedVoiceCount(
  accountId
) {
  /*
    Un appel qui sonne reserve deja l'unique place vocale.
    On ne peut donc pas rejoindre un vocal serveur
    pendant qu'un appel MP est en attente.
  */
  return (
    peopleVoiceAccountServerIds(
      accountId
    ).size +
    peopleAccountDmCallCount(
      accountId,
      {
        includeRinging:
          true
      }
    )
  );
}

function peopleAccountHasVoiceSlot(
  accountId
) {
  return (
    peopleAccountReservedVoiceCount(
      accountId
    ) <
    PEOPLE_MAX_SIMULTANEOUS_VOICES
  );
}
// === PEOPLE_UNIFIED_VOICE_LIMIT_V3_END ===

function peopleVoiceAccountInServer(
  accountId,
  serverId,
  exceptSocketId = ""
) {
  const wantedAccount =
    String(
      accountId ||
      ""
    );

  const wantedServer =
    String(
      serverId ||
      ""
    );

  const excludedSocket =
    String(
      exceptSocketId ||
      ""
    );

  if (
    !wantedAccount ||
    !wantedServer
  ) {
    return false;
  }

  for (
    const [socketId, user]
    of voiceUsers.entries()
  ) {
    if (
      excludedSocket &&
      String(socketId) ===
        excludedSocket
    ) {
      continue;
    }

    if (
      String(
        user?.accountId ||
        ""
      ) === wantedAccount &&
      String(
        user?.serverId ||
        ""
      ) === wantedServer
    ) {
      return true;
    }
  }

  return false;
}

function peopleVoicePublicUser(
  socketId,
  user
) {
  return {
    id:
      String(
        socketId
      ),
    username:
      user?.username,
    channelId:
      user?.channelId ? String(user.channelId) : null,
    muted:
      Boolean(
        user?.muted
      ),
    camera:
      Boolean(
        user?.camera
      ),
    screen:
      Boolean(
        user?.screen
      )
  };
}

function peopleVoiceRefreshAccount(
  accountId,
  extraServerIds = []
) {
  const rooms =
    peopleVoiceAccountServerIds(
      accountId
    );

  for (
    const value of
    extraServerIds || []
  ) {
    const sid =
      String(
        value ||
        ""
      );

    if (sid) {
      rooms.add(
        sid
      );
    }
  }

  for (
    const sid of
    rooms
  ) {
    emitVoiceState(
      sid
    );
  }
}
// === PEOPLE_MULTI_VOICE_V1_END ===

function peopleVoiceRoster(
  serverId
) {
  const sid =
    String(serverId || "");

  return [
    ...voiceUsers.entries()
  ]
    .filter(
      ([, user]) =>
        String(user.serverId) ===
        sid
    )
    .map(
      ([id, user]) =>
        peopleVoicePublicUser(
          id,
          user
        )
    );
}

function emitVoiceState(
  serverId
) {
  const sid =
    String(serverId || "");

  if (!sid) return;

  const payload = {
    serverId:
      sid,
    roster:
      peopleVoiceRoster(
        sid
      )
  };

  /*
    - peopleServerRoom : personnes qui REGARDENT ce serveur
    - peopleVoiceRoom  : personnes qui sont DANS le vocal,
      même si elles naviguent ailleurs dans People.
  */
  io.to(
    peopleServerRoom(
      sid
    )
  )
    .to(
      peopleVoiceRoom(
        sid
      )
    )
    .emit(
      "voice-state",
      payload
    );
}

function leaveVoice(socket) {
  const current =
    voiceUsers.get(
      socket.id
    );

  if (!current) return;

  const sid =
    String(
      current.serverId || ""
    );

  const accountId =
    String(
      current.accountId ||
      userIds.get(
        socket.id
      ) ||
      ""
    );

  voiceUsers.delete(
    socket.id
  );

  if (sid) {
    /*
      Les peers restent abonnés à peopleVoiceRoom(sid)
      même s'ils sont actuellement dans Amis / MP / autre serveur.
    */
    socket.to(
      peopleVoiceRoom(
        sid
      )
    ).emit(
      "peer-left",
      socket.id
    );

    void socket.leave(
      peopleVoiceRoom(
        sid
      )
    );

    if (current.channelId) {
      void socket.leave(
        peopleVoiceChannelRoom(
          sid,
          current.channelId
        )
      );
    }
  }

  if (accountId) {
    peopleVoiceRefreshAccount(
      accountId,
      [
        sid
      ]
    );
  } else if (sid) {
    emitVoiceState(
      sid
    );
  }
}

io.on("connection", (socket) => {
  socket.on(
    "keepalive",
    () => {}
  );

  socket.on(
    "join",
    () => {
      const account =
        peopleSessionFromCookie(
          socket.handshake.headers.cookie ||
          ""
        );

      if (!account) {
        socket.emit(
          "auth-required"
        );

        return;
      }

      const accountId =
        String(account.id);

      const wasAlreadyOnline =
        peopleAccountIsOnline(
          accountId
        );

      const hadPendingOffline =
        peopleCancelPresenceOffline(
          accountId
        );

      users.set(
        socket.id,
        cleanUsername(
          account.username
        )
      );

      userIds.set(
        socket.id,
        accountId
      );

      peopleDmCallDeliverPendingForAccount(
        String(account.id),
        socket.id
      );

      if (
        !wasAlreadyOnline &&
        !hadPendingOffline
      ) {
        void peopleRefreshPresenceForAccount(
          accountId
        );
      }

      socket.emit(
        "people-ready",
        {
          ok: true
        }
      );
    }
  );

// === PEOPLE_DM_CALL_SOCKET_V1_START ===
  socket.on(
    "dm-call-start",
    async (
      { targetUsername } = {},
      ack = () => {}
    ) => {
      try {
        const callerAccountId =
          userIds.get(
            socket.id
          );

        const callerUsername =
          users.get(
            socket.id
          );

        if (
          !callerAccountId ||
          !callerUsername
        ) {
          return ack({
            ok: false,
            error:
              "Session invalide."
          });
        }

        const target =
          await peopleDmCallFindAccountByUsername(
            targetUsername
          );

        if (!target) {
          return ack({
            ok: false,
            error:
              "Utilisateur introuvable."
          });
        }

        if (
          String(
            target.id
          ) ===
          String(
            callerAccountId
          )
        ) {
          return ack({
            ok: false,
            error:
              "Tu ne peux pas t'appeler toi-même."
          });
        }

        const existingCall =
          peopleDmCallFindBetween(
            callerAccountId,
            target.id
          );

        if (existingCall) {
          const role =
            peopleDmCallRoleForAccount(
              existingCall,
              callerAccountId
            );

          if (
            peopleDmCallSocketForRole(
              existingCall,
              role
            )
          ) {
            return ack({
              ok: false,
              error:
                "Tu es déjà dans cet appel."
            });
          }

          const joined =
            peopleDmCallJoinParticipant(
              existingCall,
              callerAccountId,
              socket.id
            );

          if (!joined.ok) {
            return ack({
              ok: false,
              reason:
                joined.reason,
              error:
                joined.reason === "limit"
                  ? "Tu es déjà dans un vocal ou un autre appel."
                  : "Impossible de rejoindre cet appel."
            });
          }

          return ack({
            ok: true,
            callId:
              existingCall.id,
            target:
              peoplePublicAccount(
                target
              ),
            created:
              false,
            rejoined:
              true,
            peerSocketId:
              joined.peerSocketId,
            peerUsername:
              joined.peerUsername,
            peerMuted:
              joined.peerMuted,
            peerCamera:
              joined.peerCamera,
            peerScreen:
              joined.peerScreen,
            initiator:
              joined.initiator
          });
        }

        const now =
          Date.now();

        const lastStart =
          Number(
            peopleDmCallLastStart.get(
              String(
                callerAccountId
              )
            ) || 0
          );

        if (
          now - lastStart <
          3000
        ) {
          return ack({
            ok: false,
            error:
              "Attends un instant avant de rappeler."
          });
        }

        peopleDmCallLastStart.set(
          String(
            callerAccountId
          ),
          now
        );

        if (
          !peopleAccountHasVoiceSlot(
            callerAccountId
          )
        ) {
          return ack({
            ok: false,
            error:
              "Tu es déjà dans un vocal ou un appel."
          });
        }

        if (
          peopleAccountActiveVoiceCount(
            target.id
          ) >=
          PEOPLE_MAX_SIMULTANEOUS_VOICES
        ) {
          return ack({
            ok: false,
            error:
              "Cette personne est déjà dans un vocal ou un appel."
          });
        }

        const callId =
          cryptoAccounts
            .randomUUID();

        const call = {
          id:
            callId,
          status:
            "active",
          callerAccountId:
            String(
              callerAccountId
            ),
          callerSocketId:
            String(
              socket.id
            ),
          callerUsername:
            cleanUsername(
              callerUsername
            ),
          callerMedia: {
            muted: false,
            camera: false,
            screen: false
          },
          calleeAccountId:
            String(
              target.id
            ),
          calleeSocketId:
            null,
          calleeUsername:
            cleanUsername(
              target.username
            ),
          calleeMedia: {
            muted: false,
            camera: false,
            screen: false
          },
          createdAt:
            Date.now(),
          acceptedAt:
            Date.now(),
          soloSince:
            Date.now(),
          ringActive:
            true
        };

        peopleDmCalls.set(
          callId,
          call
        );

        peopleDmCallSaveTimeline(
          call,
          "started"
        );

        peopleVoiceRefreshAccount(
          callerAccountId
        );

        peopleDmCallScheduleSoloTimeout(
          call
        );

        peopleDmCallScheduleRingTimeout(
          call
        );

        const targetSockets =
          peopleDmCallAccountSocketIds(
            target.id
          );

        peopleDmCallEmitSocketIds(
          targetSockets,
          "dm-call-incoming",
          {
            callId,
            caller: {
              id:
                String(
                  callerAccountId
                ),
              username:
                call.callerUsername
            },
            rejoin:
              false,
            silent:
              false
          }
        );

        ack({
          ok: true,
          callId,
          target:
            peoplePublicAccount(
              target
            ),
          created:
            true,
          rejoined:
            false,
          peerSocketId:
            "",
          peerUsername:
            call.calleeUsername,
          peerMuted:
            false,
          peerCamera:
            false,
          peerScreen:
            false,
          initiator:
            false
        });
      } catch (err) {
        console.error(
          "[People dm-call/start]",
          err
        );

        ack({
          ok: false,
          error:
            "Impossible de lancer l'appel."
        });
      }
    }
  );

  socket.on(
    "dm-call-answer",
    (
      { callId } = {},
      ack = () => {}
    ) => {
      const call =
        peopleDmCalls.get(
          String(
            callId ||
            ""
          )
        );

      const accountId =
        userIds.get(
          socket.id
        );

      if (
        !call ||
        call.status !==
          "active" ||
        !accountId
      ) {
        return ack({
          ok: false,
          reason:
            "unavailable"
        });
      }

      const role =
        peopleDmCallRoleForAccount(
          call,
          accountId
        );

      if (!role) {
        return ack({
          ok: false,
          reason:
            "unavailable"
        });
      }

      const joined =
        peopleDmCallJoinParticipant(
          call,
          accountId,
          socket.id
        );

      if (!joined.ok) {
        return ack({
          ok: false,
          reason:
            joined.reason
        });
      }

      const otherAccountSockets =
        peopleDmCallAccountSocketIds(
          accountId
        ).filter(
          (id) =>
            String(id) !==
            String(
              socket.id
            )
        );

      peopleDmCallEmitSocketIds(
        otherAccountSockets,
        "dm-call-left",
        {
          callId:
            call.id,
          reason:
            "joined-elsewhere"
        }
      );

      ack({
        ok: true,
        peerSocketId:
          joined.peerSocketId,
        peerUsername:
          joined.peerUsername,
        peerMuted:
          joined.peerMuted,
        peerCamera:
          joined.peerCamera,
        peerScreen:
          joined.peerScreen,
        initiator:
          joined.initiator
      });
    }
  );

  socket.on(
    "dm-call-decline",
    ({ callId } = {}) => {
      const call =
        peopleDmCalls.get(
          String(
            callId ||
            ""
          )
        );

      const accountId =
        userIds.get(
          socket.id
        );

      if (
        !call ||
        call.status !==
          "active" ||
        !accountId
      ) {
        return;
      }

      const role =
        peopleDmCallRoleForAccount(
          call,
          accountId
        );

      if (!role) {
        return;
      }

      if (
        peopleDmCallSocketForRole(
          call,
          role
        )
      ) {
        return;
      }

      if (
        role === "callee"
      ) {
        peopleDmCallStopRinging(
          call
        );
      }

      peopleDmCallEmitSocketIds(
        peopleDmCallAccountSocketIds(
          accountId
        ),
        "dm-call-left",
        {
          callId:
            call.id,
          reason:
            "declined"
        }
      );

      const otherRole =
        peopleDmCallOtherRole(
          role
        );

      const otherSocket =
        peopleDmCallSocketForRole(
          call,
          otherRole
        );

      if (otherSocket) {
        io.to(
          otherSocket
        ).emit(
          "dm-call-peer-declined",
          {
            callId:
              call.id
          }
        );
      }
    }
  );

  socket.on(
    "dm-call-cancel",
    ({ callId } = {}) => {
      const call =
        peopleDmCalls.get(
          String(
            callId ||
            ""
          )
        );

      if (!call) {
        return;
      }

      peopleDmCallLeaveSocket(
        call,
        socket.id,
        "left"
      );
    }
  );

  socket.on(
    "dm-call-hangup",
    ({ callId } = {}) => {
      const call =
        peopleDmCalls.get(
          String(
            callId ||
            ""
          )
        );

      if (!call) {
        return;
      }

      peopleDmCallLeaveSocket(
        call,
        socket.id,
        "left"
      );
    }
  );

  socket.on(
    "dm-call-webrtc-offer",
    ({
      callId,
      target,
      sdp
    } = {}) => {
      const call =
        peopleDmCallForActiveSocket(
          callId,
          socket.id
        );

      if (
        !call ||
        !sdp
      ) {
        return;
      }

      const other =
        peopleDmCallOtherSocket(
          call,
          socket.id
        );

      if (
        !other ||
        String(target) !==
          other
      ) {
        return;
      }

      io.to(
        other
      ).emit(
        "dm-call-webrtc-offer",
        {
          callId:
            call.id,
          from:
            String(
              socket.id
            ),
          sdp
        }
      );
    }
  );

  socket.on(
    "dm-call-webrtc-answer",
    ({
      callId,
      target,
      sdp
    } = {}) => {
      const call =
        peopleDmCallForActiveSocket(
          callId,
          socket.id
        );

      if (
        !call ||
        !sdp
      ) {
        return;
      }

      const other =
        peopleDmCallOtherSocket(
          call,
          socket.id
        );

      if (
        !other ||
        String(target) !==
          other
      ) {
        return;
      }

      io.to(
        other
      ).emit(
        "dm-call-webrtc-answer",
        {
          callId:
            call.id,
          from:
            String(
              socket.id
            ),
          sdp
        }
      );
    }
  );

  socket.on(
    "dm-call-webrtc-ice",
    ({
      callId,
      target,
      candidate
    } = {}) => {
      const call =
        peopleDmCallForActiveSocket(
          callId,
          socket.id
        );

      if (
        !call ||
        !candidate
      ) {
        return;
      }

      const other =
        peopleDmCallOtherSocket(
          call,
          socket.id
        );

      if (
        !other ||
        String(target) !==
          other
      ) {
        return;
      }

      io.to(
        other
      ).emit(
        "dm-call-webrtc-ice",
        {
          callId:
            call.id,
          from:
            String(
              socket.id
            ),
          candidate
        }
      );
    }
  );

  socket.on(
    "dm-call-media-state",
    ({
      callId,
      muted,
      camera,
      screen
    } = {}) => {
      const call =
        peopleDmCallForActiveSocket(
          callId,
          socket.id
        );

      if (!call) {
        return;
      }

      const current =
        String(
          socket.id
        );

      const role =
        String(
          call.callerSocketId ||
          ""
        ) === current
          ? "caller"
          : "callee";

      peopleDmCallSetMediaForRole(
        call,
        role,
        {
          muted,
          camera,
          screen
        }
      );

      peopleDmCalls.set(
        call.id,
        call
      );

      const other =
        peopleDmCallOtherSocket(
          call,
          socket.id
        );

      if (!other) {
        return;
      }

      io.to(
        other
      ).emit(
        "dm-call-media-state",
        {
          callId:
            call.id,
          muted:
            Boolean(
              muted
            ),
          camera:
            Boolean(
              camera
            ),
          screen:
            Boolean(
              screen
            )
        }
      );
    }
  );
  // === PEOPLE_DM_CALL_SOCKET_V1_END ===

  socket.on(
    "server-select",
    async (
      { serverId, channelId } = {},
      ack = () => {}
    ) => {
      try {
        const accountId =
          userIds.get(
            socket.id
          );

        if (!accountId) {
          return ack({
            ok: false,
            error:
              "Session invalide."
          });
        }

        const server =
          await peopleGetServer(
            serverId
          );

        if (!server) {
          return ack({
            ok: false,
            error:
              "Serveur introuvable."
          });
        }

        const member =
          await peopleIsServerMember(
            accountId,
            server.id
          );

        if (!member) {
          return ack({
            ok: false,
            error:
              "Tu n'es pas membre de ce serveur."
          });
        }

        const oldServerId =
          socketServerIds.get(
            socket.id
          );

        if (
          oldServerId &&
          String(oldServerId) !==
            String(server.id)
        ) {
          /*
            Le serveur consulté change, mais le vocal
            de cet onglet reste totalement indépendant.
          */
          await socket.leave(
            peopleServerRoom(
              oldServerId
            )
          );

          socketServerIds.delete(
            socket.id
          );
          socketTextChannelIds.delete(
            socket.id
          );

          emitOnlineUsers(
            oldServerId
          );
        }

        socketServerIds.set(
          socket.id,
          String(server.id)
        );

        await socket.join(
          peopleServerRoom(
            server.id
          )
        );

        const channels = await peopleListServerChannels(server.id);
        const requestedText = channelId
          ? channels.find((item) => String(item.id) === String(channelId) && item.type === "text")
          : null;
        const activeTextChannel = requestedText || channels.find((item) => item.type === "text") || null;

        if (!activeTextChannel) {
          return ack({ ok: false, error: "Ce serveur n'a aucun salon textuel." });
        }

        socketTextChannelIds.set(socket.id, String(activeTextChannel.id));

        // === PEOPLE_NAVIGATION_PARALLEL_V1_SERVER ===
        // Historique et présence ne dépendent pas l'un de l'autre.
        const [history, online] =
          await Promise.all([
            peopleServerLoadMessages(
              server.id,
              activeTextChannel.id,
              100
            ),
            peopleServerPresenceRoster(
              server.id
            )
          ]);

        const voice =
          peopleVoiceRoster(
            server.id
          );

        emitOnlineUsers(
          server.id,
          online
        );

        ack({
          ok: true,
          server:
            peopleServerPublic(
              server
            ),
          history,
          online,
          voice,
          channels,
          activeChannelId: String(activeTextChannel.id)
        });
      } catch (err) {
        console.error(
          "[People server/select]",
          err
        );

        ack({
          ok: false,
          error:
            "Impossible d'ouvrir ce serveur."
        });
      }
    }
  );


  socket.on(
    "server-channel-select",
    async ({ serverId, channelId } = {}, ack = () => {}) => {
      try {
        const accountId = userIds.get(socket.id);
        const sid = String(serverId || socketServerIds.get(socket.id) || "");
        if (!accountId || !sid) return ack({ ok: false, error: "Session invalide." });
        if (!(await peopleIsServerMember(accountId, sid))) return ack({ ok: false, error: "Tu n'es pas membre de ce serveur." });
        const channel = await peopleGetServerChannel(sid, channelId, "text");
        if (!channel) return ack({ ok: false, error: "Salon textuel introuvable." });
        socketServerIds.set(socket.id, sid);
        socketTextChannelIds.set(socket.id, String(channel.id));
        const history = await peopleServerLoadMessages(sid, channel.id, 100);
        ack({ ok: true, serverId: sid, channel, activeChannelId: String(channel.id), history });
      } catch (err) {
        console.error("[People channel/select]", err);
        ack({ ok: false, error: "Impossible d'ouvrir ce salon." });
      }
    }
  );

  // === PEOPLE_GENERAL_OPTIMISTIC_SERVER_V1_START ===
  socket.on(
    "chat-message",
    async (
      {
        text,
        imageId,
        replyToId,
        clientId
      } = {},
      ack = () => {}
    ) => {
      const reply =
        typeof ack === "function"
          ? ack
          : () => {};

      const username =
        users.get(socket.id);

      const senderId =
        userIds.get(socket.id);

      const serverId =
        socketServerIds.get(socket.id);

      const channelId =
        socketTextChannelIds.get(socket.id);

      if (!username || !senderId || !serverId || !channelId) {
        reply({
          ok: false,
          error: "Session ou serveur invalide."
        });
        return;
      }

      const cleanText =
        String(text || "")
          .trim()
          .slice(0, 1000);

      const imageKey =
        peopleNormalizeMessageImageId(imageId);

      if (!cleanText && !imageKey) {
        reply({
          ok: false,
          error: "Message vide."
        });
        return;
      }

      // Identifiant purement client : il sert uniquement à remplacer le
      // message optimiste local par la version persistée du serveur.
      const cleanClientId =
        String(clientId || "")
          .trim()
          .slice(0, 120);

      try {
        const saved =
          await peopleServerSaveMessage(
            serverId,
            channelId,
            senderId,
            username,
            cleanText,
            imageKey,
            replyToId
          );

        if (!saved) {
          reply({
            ok: false,
            error: "Impossible d'enregistrer le message."
          });
          return;
        }

        const payload =
          cleanClientId
            ? { ...saved, clientId: cleanClientId }
            : saved;

        io.to(
          peopleServerRoom(serverId)
        ).emit(
          "chat-message",
          payload
        );

        reply({
          ok: true,
          message: payload
        });
      } catch (err) {
        console.error(
          "[People server message/save]",
          err
        );

        const errorText =
          err?.code === "IMAGE_INVALID"
            ? "Cette image n'est plus disponible. Réessaie de la sélectionner."
            : err?.code === "REPLY_INVALID"
              ? "Le message auquel tu réponds n'est plus disponible."
              : "Le message n'a pas pu être sauvegardé.";

        // Comportement historique conservé pour tous les anciens clients.
        socket.emit(
          "system-message",
          {
            text: errorText,
            time: Date.now()
          }
        );

        // Les clients récents peuvent en plus retirer leur bulle optimiste.
        reply({
          ok: false,
          error: errorText
        });
      }
    }
  );
  // === PEOPLE_GENERAL_OPTIMISTIC_SERVER_V1_END ===

  socket.on(
    "chat-message-delete",
    async (
      { id } = {},
      ack = () => {}
    ) => {
      try {
        const senderId =
          userIds.get(
            socket.id
          );

        const serverId =
          socketServerIds.get(
            socket.id
          );

        const channelId =
          socketTextChannelIds.get(
            socket.id
          );

        if (
          !senderId ||
          !serverId ||
          !channelId
        ) {
          return ack({
            ok: false,
            error:
              "Aucun serveur actif."
          });
        }

        const removed =
          await peopleServerDeleteMessage(
            senderId,
            serverId,
            channelId,
            id
          );

        if (!removed) {
          return ack({
            ok: false,
            error:
              "Tu ne peux supprimer que tes propres messages."
          });
        }

        io.to(
          peopleServerRoom(
            serverId
          )
        ).emit(
          "chat-message-deleted",
          {
            id:
              String(id),
            channelId:
              String(channelId)
          }
        );

        ack({
          ok: true
        });
      } catch (err) {
        console.error(
          "[People server message/delete]",
          err
        );

        ack({
          ok: false,
          error:
            "Impossible de supprimer ce message."
        });
      }
    }
  );

  socket.on(
    "voice-join",
    async (
      {
        serverId:
          requestedServerId,
        channelId:
          requestedChannelId,
        muted,
        camera,
        screen
      } = {},
      ack = () => {}
    ) => {
      // === PEOPLE_VOICE_JOIN_V2 ===
      try {
        const username =
          users.get(
            socket.id
          );

        const accountId =
          userIds.get(
            socket.id
          );

        const wantedServerId =
          String(
            requestedServerId ||
            socketServerIds.get(
              socket.id
            ) ||
            ""
          );

        if (
          !username ||
          !accountId ||
          !wantedServerId
        ) {
          return ack({
            ok: false,
            error:
              "Session vocale invalide."
          });
        }

        const server =
          await peopleGetServer(
            wantedServerId
          );

        if (!server) {
          return ack({
            ok: false,
            error:
              "Serveur vocal introuvable."
          });
        }

        const member =
          await peopleIsServerMember(
            accountId,
            server.id
          );

        if (!member) {
          return ack({
            ok: false,
            error:
              "Tu n'es plus membre de ce serveur."
          });
        }

        const sid =
          String(
            server.id
          );

        const voiceChannel =
          await peopleGetServerChannel(
            sid,
            requestedChannelId,
            "voice"
          ) ||
          await peopleDefaultServerChannel(
            sid,
            "voice"
          );

        if (!voiceChannel) {
          return ack({ ok: false, error: "Salon vocal introuvable." });
        }

        const voiceChannelId = String(voiceChannel.id);

        const aid =
          String(
            accountId
          );

        const currentVoice =
          voiceUsers.get(
            socket.id
          );

        /*
          Une seule session vocale People est autorisee
          par compte, quel que soit l'onglet utilise.
        */
        if (currentVoice) {
          if (
            String(
              currentVoice.serverId
            ) === sid &&
            String(currentVoice.channelId || "") === voiceChannelId
          ) {
            await socket.join(
              peopleVoiceRoom(
                sid
              )
            );
            await socket.join(
              peopleVoiceChannelRoom(
                sid,
                voiceChannelId
              )
            );

            const roster =
              peopleVoiceRoster(
                sid
              );

            return ack({
              ok: true,
              serverId:
                sid,
              channelId:
                voiceChannelId,
              roster: roster.filter((user) => String(user.channelId || "") === voiceChannelId),
              voiceRooms:
                peopleVoiceAccountServerIds(
                  aid
                ).size
            });
          }
        }

        /*
          On vérifie les autres sessions du compte AVANT de quitter le
          vocal actuel. Ainsi, un changement refusé ne fait jamais perdre
          la room dans laquelle l'utilisateur se trouvait déjà.
        */
        if (
          peopleVoiceAccountInServer(
            aid,
            sid,
            socket.id
          )
        ) {
          return ack({
            ok: false,
            code:
              "VOICE_ALREADY_HERE",
            error:
              "Ton compte est déjà connecté à un vocal."
          });
        }

        const currentRooms =
          peopleVoiceAccountServerIds(
            aid,
            socket.id
          );

        const reservedElsewhere =
          currentRooms.size +
          peopleAccountDmCallCount(
            aid,
            {
              includeRinging:
                true
            }
          );

        if (
          !currentRooms.has(
            sid
          ) &&
          reservedElsewhere >=
            PEOPLE_MAX_SIMULTANEOUS_VOICES
        ) {
          return ack({
            ok: false,
            code:
              "VOICE_LIMIT",
            error:
              "Tu es déjà dans un autre vocal ou un appel."
          });
        }

        /*
          === PEOPLE_VOICE_AUTO_SWITCH_V1 ===
          Si CE socket est déjà dans un autre vocal serveur, le nouveau
          voice-join devient un déplacement atomique : on annonce le départ
          à l'ancienne room puis on continue immédiatement vers la nouvelle.
        */
        if (currentVoice) {
          leaveVoice(socket);
        }

        voiceUsers.set(
          socket.id,
          {
            serverId:
              sid,
            accountId:
              aid,
            channelId:
              voiceChannelId,
            username,
            muted:
              Boolean(
                muted
              ),
            camera:
              Boolean(
                camera
              ),
            screen:
              Boolean(
                screen
              )
          }
        );

        await socket.join(
          peopleVoiceRoom(
            sid
          )
        );

        await socket.join(
          peopleVoiceChannelRoom(
            sid,
            voiceChannelId
          )
        );

        const roster =
          peopleVoiceRoster(
            sid
          );

        socket.emit(
          "voice-peers",
          roster.filter(
            (user) =>
              user.id !== socket.id &&
              String(user.channelId || "") === voiceChannelId
          )
        );

        /*
          Rafraichit l'etat vocal du compte.
        */
        peopleVoiceRefreshAccount(
          aid
        );

        const roomCount =
          peopleAccountActiveVoiceCount(
            aid
          );

        ack({
          ok: true,
          serverId:
            sid,
          channelId:
            voiceChannelId,
          roster: roster.filter((user) => String(user.channelId || "") === voiceChannelId),
          voiceRooms:
            roomCount
        });
      } catch (err) {
        console.error(
          "[People voice-join V2]",
          err
        );

        ack({
          ok: false,
          error:
            "Impossible de rejoindre le vocal."
        });
      }
    }
  );

  socket.on(
    "voice-leave",
    () => {
      leaveVoice(socket);
    }
  );

  socket.on(
    "voice-mute",
    ({ muted } = {}) => {
      const user =
        voiceUsers.get(
          socket.id
        );

      if (!user) return;

      user.muted =
        Boolean(muted);

      voiceUsers.set(
        socket.id,
        user
      );

      emitVoiceState(
        user.serverId
      );
    }
  );

  socket.on(
    "voice-camera",
    ({ camera } = {}) => {
      const user =
        voiceUsers.get(
          socket.id
        );

      if (!user) return;

      user.camera =
        Boolean(camera);

      voiceUsers.set(
        socket.id,
        user
      );

      emitVoiceState(
        user.serverId
      );
    }
  );

  socket.on(
    "voice-screen",
    ({ screen } = {}) => {
      const user =
        voiceUsers.get(
          socket.id
        );

      if (!user) return;

      user.screen =
        Boolean(screen);

      voiceUsers.set(
        socket.id,
        user
      );

      emitVoiceState(
        user.serverId
      );
    }
  );

  socket.on(
    "webrtc-offer",
    ({
      target,
      sdp
    } = {}) => {
      const mine =
        voiceUsers.get(
          socket.id
        );

      const other =
        voiceUsers.get(
          target
        );

      if (
        !mine ||
        !other ||
        String(mine.serverId) !==
          String(other.serverId) ||
        String(mine.channelId || "") !==
          String(other.channelId || "") ||
        !sdp
      ) {
        return;
      }

      io.to(target).emit(
        "webrtc-offer",
        {
          from:
            socket.id,
          username:
            users.get(
              socket.id
            ) || "Invité",
          sdp
        }
      );
    }
  );

  socket.on(
    "webrtc-answer",
    ({
      target,
      sdp
    } = {}) => {
      const mine =
        voiceUsers.get(
          socket.id
        );

      const other =
        voiceUsers.get(
          target
        );

      if (
        !mine ||
        !other ||
        String(mine.serverId) !==
          String(other.serverId) ||
        String(mine.channelId || "") !==
          String(other.channelId || "") ||
        !sdp
      ) {
        return;
      }

      io.to(target).emit(
        "webrtc-answer",
        {
          from:
            socket.id,
          sdp
        }
      );
    }
  );

  socket.on(
    "webrtc-ice-candidate",
    ({
      target,
      candidate
    } = {}) => {
      const mine =
        voiceUsers.get(
          socket.id
        );

      const other =
        voiceUsers.get(
          target
        );

      if (
        !mine ||
        !other ||
        String(mine.serverId) !==
          String(other.serverId) ||
        String(mine.channelId || "") !==
          String(other.channelId || "") ||
        !candidate
      ) {
        return;
      }

      io.to(target).emit(
        "webrtc-ice-candidate",
        {
          from:
            socket.id,
          candidate
        }
      );
    }
  );

  socket.on(
    "voice-peer-reconnect",
    ({ target } = {}) => {
      const mine =
        voiceUsers.get(
          socket.id
        );

      const other =
        voiceUsers.get(
          target
        );

      if (
        !mine ||
        !other ||
        String(mine.serverId) !==
          String(other.serverId) ||
        String(mine.channelId || "") !==
          String(other.channelId || "")
      ) {
        return;
      }

      io.to(target).emit(
        "voice-peer-reconnect",
        {
          from:
            socket.id
        }
      );
    }
  );

  socket.on(
    "disconnect",
    () => { 
      peopleDmCallDisconnect(
        socket
      );

      const accountId =
        userIds.get(
          socket.id
        );

      leaveVoice(
        socket
      );

      users.delete(
        socket.id
      );

      userIds.delete(
        socket.id
      );

      socketServerIds.delete(
        socket.id
      );

      socketTextChannelIds.delete(
        socket.id
      );

      if (
        accountId &&
        !peopleAccountIsOnline(
          accountId
        )
      ) {
        peopleSchedulePresenceOffline(
          accountId
        );
      }
    }
  );
});

// === PEOPLE_MESSAGE_ENCRYPTION_MIGRATION_V1_START ===
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
          peopleDmE2eeIsEnvelope(
            body
          )
        ) {
          /*
            Déjà chiffré de bout en bout :
            ne surtout pas le convertir en AES serveur.
          */
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

const PORT = Number(process.env.PORT) || 3000;

peopleInitAccounts()
  .then(() => peopleInitSocial())
  .then(() => peopleInitServersV1())
  .then(() => peopleInitServerChannelsV2())
  .then(() => peopleMigrateStoredMessageEncryption())
  // === PEOPLE_DELETE_EMPTY_ON_STARTUP_V1 ===
  .then(() => peopleDeleteAllEmptyServers())
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`People lance sur http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error(
      "[People] Impossible d'initialiser les comptes :",
      err
    );
    process.exit(1);
  });