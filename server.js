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
      "SELECT id, username, username_key, password_hash, created_at " +
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
    created_at: new Date().toISOString()
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

app.post("/api/auth/logout", (req, res) => {
  peopleClearSession(res);
  res.json({ ok: true });
});
// === PEOPLE_ACCOUNTS_V1_END ===

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, app: "People" });
});

const users = new Map();
const voiceUsers = new Map();

function cleanUsername(value) {
  return String(value || "Invité").trim().slice(0, 24) || "Invité";
}

function emitVoiceState() {
  io.emit(
    "voice-state",
    [...voiceUsers.entries()].map(([id, user]) => ({
      id,
      username: user.username,
      muted: Boolean(user.muted),
      camera: Boolean(user.camera)
    }))
  );
}


// === PEOPLE_ONLINE_PANEL_V1_START ===
function emitOnlineUsers() {
  io.emit(
    "online-users",
    [...users.entries()].map(([id, username]) => ({
      id,
      username
    }))
  );
}
// === PEOPLE_ONLINE_PANEL_V1_END ===

function leaveVoice(socket) {
  if (!voiceUsers.has(socket.id)) return;

  voiceUsers.delete(socket.id);
  socket.broadcast.emit("peer-left", socket.id);
  emitVoiceState();
}

io.on("connection", (socket) => {
  socket.on("keepalive", () => {});

  socket.on("join", ({ reconnect } = {}) => {
    const account = peopleSessionFromCookie(
      socket.handshake.headers.cookie || ""
    );

    if (!account) {
      socket.emit("auth-required");
      return;
    }

    const cleanName = cleanUsername(account.username);
    const wasKnown = users.has(socket.id);

    users.set(socket.id, cleanName);
    io.emit("user-count", users.size);
    emitOnlineUsers();

    if (!wasKnown && !reconnect) {
      io.emit("system-message", {
        text: `${cleanName} a rejoint le serveur`,
        time: Date.now()
      });
    }
  });

  socket.on("chat-message", ({ text } = {}) => {
    const username = users.get(socket.id);
    if (!username) return;

    const cleanText = String(text || "").trim().slice(0, 1000);
    if (!cleanText) return;

    io.emit("chat-message", {
      username,
      text: cleanText,
      time: Date.now()
    });
  });

  socket.on("voice-join", ({ muted, camera } = {}) => {
    const username = users.get(socket.id);
    if (!username) return;

    const existingPeers = [...voiceUsers.entries()]
      .filter(([id]) => id !== socket.id)
      .map(([id, user]) => ({
        id,
        username: user.username,
        muted: Boolean(user.muted),
        camera: Boolean(user.camera)
      }));

    voiceUsers.set(socket.id, {
      username,
      muted: Boolean(muted),
      camera: Boolean(camera)
    });

    socket.emit("voice-peers", existingPeers);
    emitVoiceState();
  });

  socket.on("voice-leave", () => {
    leaveVoice(socket);
  });

  socket.on("voice-mute", ({ muted } = {}) => {
    const user = voiceUsers.get(socket.id);
    if (!user) return;

    user.muted = Boolean(muted);
    voiceUsers.set(socket.id, user);
    emitVoiceState();
  });

  socket.on("voice-camera", ({ camera } = {}) => {
    const user = voiceUsers.get(socket.id);
    if (!user) return;

    user.camera = Boolean(camera);
    voiceUsers.set(socket.id, user);
    emitVoiceState();
  });

  socket.on("webrtc-offer", ({ target, sdp } = {}) => {
    if (!voiceUsers.has(socket.id) || !voiceUsers.has(target) || !sdp) return;

    io.to(target).emit("webrtc-offer", {
      from: socket.id,
      username: users.get(socket.id) || "Invité",
      sdp
    });
  });

  socket.on("webrtc-answer", ({ target, sdp } = {}) => {
    if (!voiceUsers.has(socket.id) || !voiceUsers.has(target) || !sdp) return;

    io.to(target).emit("webrtc-answer", {
      from: socket.id,
      sdp
    });
  });

  socket.on("webrtc-ice-candidate", ({ target, candidate } = {}) => {
    if (!voiceUsers.has(socket.id) || !voiceUsers.has(target) || !candidate) return;

    io.to(target).emit("webrtc-ice-candidate", {
      from: socket.id,
      candidate
    });
  });

  socket.on("voice-peer-reconnect", ({ target } = {}) => {
    if (!voiceUsers.has(socket.id) || !voiceUsers.has(target)) return;

    io.to(target).emit("voice-peer-reconnect", {
      from: socket.id
    });
  });

  socket.on("disconnect", () => {
    const username = users.get(socket.id);

    leaveVoice(socket);
    users.delete(socket.id);
    io.emit("user-count", users.size);
    emitOnlineUsers();

    if (username) {
      io.emit("system-message", {
        text: `${username} a quitté le serveur`,
        time: Date.now()
      });
    }
  });
});

const PORT = Number(process.env.PORT) || 3000;

peopleInitAccounts()
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