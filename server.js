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

// === PEOPLE_SOCIAL_V2_START ===
const PEOPLE_LOCAL_SOCIAL = pathAccounts.join(
  __dirname,
  "people-social.local.json"
);

function peopleReadLocalSocial() {
  try {
    if (!fsAccounts.existsSync(PEOPLE_LOCAL_SOCIAL)) {
      return { friends: [], dms: [], friend_requests: [] };
    }

    const raw = JSON.parse(
      fsAccounts.readFileSync(PEOPLE_LOCAL_SOCIAL, "utf8")
    );

    return {
      friends: Array.isArray(raw.friends) ? raw.friends : [],
      dms: Array.isArray(raw.dms) ? raw.dms : [],
      friend_requests: Array.isArray(raw.friend_requests)
        ? raw.friend_requests
        : []
    };
  } catch {
    return { friends: [], dms: [], friend_requests: [] };
  }
}

function peopleWriteLocalSocial(data) {
  fsAccounts.writeFileSync(
    PEOPLE_LOCAL_SOCIAL,
    JSON.stringify(
      {
        friends: Array.isArray(data.friends) ? data.friends : [],
        dms: Array.isArray(data.dms) ? data.dms : [],
        friend_requests: Array.isArray(data.friend_requests)
          ? data.friend_requests
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

async function peopleCreateDm(senderId, recipientId, body) {
  const sender = String(senderId);
  const recipient = String(recipientId);
  const cleanBody = String(body || "").trim().slice(0, 2000);

  if (!cleanBody) return null;

  if (peoplePool) {
    const result = await peoplePool.query(
      "INSERT INTO people_direct_messages " +
      "(sender_id, recipient_id, body) " +
      "VALUES ($1, $2, $3) " +
      "RETURNING id, sender_id, recipient_id, body, created_at, read_at",
      [sender, recipient, cleanBody]
    );

    return result.rows[0] || null;
  }

  const data = peopleReadLocalSocial();

  const message = {
    id: cryptoAccounts.randomUUID(),
    sender_id: sender,
    recipient_id: recipient,
    body: cleanBody,
    created_at: new Date().toISOString(),
    read_at: null
  };

  data.dms.push(message);

  if (data.dms.length > 10000) {
    data.dms = data.dms.slice(-10000);
  }

  peopleWriteLocalSocial(data);
  return message;
}

async function peopleDmHistory(accountId, otherId) {
  const me = String(accountId);
  const other = String(otherId);

  if (peoplePool) {
    const result = await peoplePool.query(
      "SELECT id, sender_id, recipient_id, body, created_at, read_at " +
      "FROM people_direct_messages " +
      "WHERE (sender_id = $1 AND recipient_id = $2) " +
      "OR (sender_id = $2 AND recipient_id = $1) " +
      "ORDER BY created_at DESC LIMIT 150",
      [me, other]
    );

    return result.rows.reverse();
  }

  return peopleReadLocalSocial()
    .dms
    .filter(
      (message) =>
        (
          String(message.sender_id) === me &&
          String(message.recipient_id) === other
        ) ||
        (
          String(message.sender_id) === other &&
          String(message.recipient_id) === me
        )
    )
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() -
        new Date(b.created_at).getTime()
    )
    .slice(-150);
}

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

async function peopleDmConversations(accountId) {
  const me = String(accountId);
  let messages;

  if (peoplePool) {
    const result = await peoplePool.query(
      "SELECT id, sender_id, recipient_id, body, created_at, read_at " +
      "FROM people_direct_messages " +
      "WHERE sender_id = $1 OR recipient_id = $1 " +
      "ORDER BY created_at DESC LIMIT 1000",
      [me]
    );

    messages = result.rows;
  } else {
    messages = peopleReadLocalSocial()
      .dms
      .filter(
        (message) =>
          String(message.sender_id) === me ||
          String(message.recipient_id) === me
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() -
          new Date(a.created_at).getTime()
      )
      .slice(0, 1000);
  }

  const map = new Map();

  for (const message of messages) {
    const otherId =
      String(message.sender_id) === me
        ? String(message.recipient_id)
        : String(message.sender_id);

    if (!map.has(otherId)) {
      map.set(otherId, {
        otherId,
        lastMessage: message.body,
        lastAt: message.created_at,
        unreadCount: 0
      });
    }

    if (
      String(message.recipient_id) === me &&
      !message.read_at
    ) {
      map.get(otherId).unreadCount += 1;
    }
  }

  const out = [];

  for (const item of map.values()) {
    const account = await peopleFindAccountById(item.otherId);
    if (!account) continue;

    out.push({
      user: {
        ...peoplePublicAccount(account),
        online: peopleAccountIsOnline(account.id)
      },
      lastMessage: item.lastMessage,
      lastAt: item.lastAt,
      unreadCount: item.unreadCount
    });
  }

  out.sort(
    (a, b) =>
      new Date(b.lastAt).getTime() -
      new Date(a.lastAt).getTime()
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

    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function peopleWriteLocalGeneral(messages) {
  fsAccounts.writeFileSync(
    PEOPLE_LOCAL_GENERAL,
    JSON.stringify(
      Array.isArray(messages)
        ? messages.slice(-1000)
        : [],
      null,
      2
    ) + "\n",
    "utf8"
  );
}

async function peopleSaveGeneralMessage(
  senderId,
  username,
  text
) {
  const cleanUsername =
    peopleUsername(username).slice(0, 24);

  const cleanText =
    String(text || "")
      .trim()
      .slice(0, 1000);

  if (!cleanUsername || !cleanText) {
    return null;
  }

  if (peoplePool) {
    const result = await peoplePool.query(
      "INSERT INTO people_general_messages " +
      "(sender_id, username, body) " +
      "VALUES ($1, $2, $3) " +
      "RETURNING id, username, body, created_at",
      [
        String(senderId),
        cleanUsername,
        cleanText
      ]
    );

    const row = result.rows[0];

    return {
      id: String(row.id),
      username: row.username,
      text: row.body,
      time: new Date(row.created_at).getTime()
    };
  }

  const messages = peopleReadLocalGeneral();

  const message = {
    id: cryptoAccounts.randomUUID(),
    senderId: String(senderId),
    username: cleanUsername,
    text: cleanText,
    time: Date.now()
  };

  messages.push(message);
  peopleWriteLocalGeneral(messages);

  return message;
}

async function peopleLoadGeneralMessages(
  limit = 100
) {
  const safeLimit = Math.max(
    1,
    Math.min(200, Number(limit) || 100)
  );

  if (peoplePool) {
    const result = await peoplePool.query(
      "SELECT id, username, body, created_at " +
      "FROM people_general_messages " +
      "ORDER BY created_at DESC " +
      "LIMIT $1",
      [safeLimit]
    );

    return result.rows
      .reverse()
      .map((row) => ({
        id: String(row.id),
        username: row.username,
        text: row.body,
        time:
          new Date(row.created_at).getTime()
      }));
  }

  return peopleReadLocalGeneral()
    .slice(-safeLimit)
    .map((message) => ({
      id: String(message.id || ""),
      username:
        String(message.username || ""),
      text: String(message.text || ""),
      time: Number(
        message.time || Date.now()
      )
    }));
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
    "body VARCHAR(1000) NOT NULL, " +
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
    "body VARCHAR(2000) NOT NULL, " +
    "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
    "read_at TIMESTAMPTZ NULL" +
    ")"
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

    const accounts = await peopleListAccounts(
      String(req.query.q || "").slice(0, 50)
    );

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

    res.json({
      ok: true,
      people: accounts
        .filter(
          (account) =>
            String(account.id) !==
            String(session.id)
        )
        .map((account) => {
          const id = String(account.id);
          const pending =
            requestByOther.get(id) || {};

          return {
            ...peoplePublicAccount(account),
            online:
              peopleAccountIsOnline(account.id),
            isFriend: friendIds.has(id),
            friendRequest:
              pending.friendRequest || null,
            friendRequestId:
              pending.friendRequestId || null
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
    const friends = [];

    for (const id of ids) {
      const account = await peopleFindAccountById(id);
      if (!account) continue;

      friends.push({
        ...peoplePublicAccount(account),
        online: peopleAccountIsOnline(account.id),
        isFriend: true
      });
    }

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

    for (const request of rows) {
      const isIncoming =
        String(request.recipient_id) ===
        String(session.id);

      const otherId = isIncoming
        ? request.sender_id
        : request.recipient_id;

      const account =
        await peopleFindAccountById(otherId);

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
        error: "Tu ne peux pas ouvrir un MP avec toi-meme."
      });
    }

    const messages = await peopleDmHistory(
      session.id,
      target.id
    );

    res.json({
      ok: true,
      user: {
        ...peoplePublicAccount(target),
        online: peopleAccountIsOnline(target.id),
        isFriend: await peopleHasFriend(
          session.id,
          target.id
        )
      },
      messages: messages.map((message) => ({
        id: String(message.id),
        senderId: String(message.sender_id),
        recipientId: String(message.recipient_id),
        body: message.body,
        createdAt: message.created_at,
        readAt: message.read_at || null
      }))
    });
  } catch (err) {
    console.error("[People dm/history]", err);
    res.status(500).json({
      ok: false,
      error: "Impossible de charger cette conversation."
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
    const session = peopleSessionForRequest(req, res);
    if (!session) return;

    if (!peopleDmRateAllowed(session.id)) {
      return res.status(429).json({
        ok: false,
        error: "Tu envoies trop de messages trop vite."
      });
    }

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
        error: "Tu ne peux pas t'envoyer un MP."
      });
    }

    const body = String(req.body?.body || "").trim();

    if (!body || body.length > 2000) {
      return res.status(400).json({
        ok: false,
        error: "Le message doit contenir entre 1 et 2000 caracteres."
      });
    }

    const message = await peopleCreateDm(
      session.id,
      target.id,
      body
    );

    const sender = await peopleFindAccountById(
      session.id
    );

    const payload = {
      id: String(message.id),
      sender: peoplePublicAccount(sender),
      recipient: peoplePublicAccount(target),
      body: message.body,
      createdAt: message.created_at
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
    console.error("[People dm/send]", err);
    res.status(500).json({
      ok: false,
      error: "Impossible d'envoyer ce MP."
    });
  }
});
// === PEOPLE_SOCIAL_V2_END ===

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, app: "People" });
});

const users = new Map();
const userIds = new Map();
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
    userIds.set(socket.id, String(account.id));
    io.emit("user-count", users.size);
    emitOnlineUsers();

    peopleLoadGeneralMessages(100)
      .then((history) => {
        socket.emit(
          "chat-history",
          history
        );
      })
      .catch((err) => {
        console.error(
          "[People general/history]",
          err
        );
      });

    if (!wasKnown && !reconnect) {
      io.emit("system-message", {
        text: `${cleanName} a rejoint le serveur`,
        time: Date.now()
      });
    }
  });

  socket.on("chat-message", async ({ text } = {}) => {
    const username =
      users.get(socket.id);

    const senderId =
      userIds.get(socket.id);

    if (!username || !senderId) return;

    const cleanText =
      String(text || "")
        .trim()
        .slice(0, 1000);

    if (!cleanText) return;

    try {
      const saved =
        await peopleSaveGeneralMessage(
          senderId,
          username,
          cleanText
        );

      if (!saved) return;

      io.emit(
        "chat-message",
        saved
      );
    } catch (err) {
      console.error(
        "[People general/save]",
        err
      );

      socket.emit(
        "system-message",
        {
          text:
            "Le message n'a pas pu etre sauvegarde.",
          time: Date.now()
        }
      );
    }
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
    userIds.delete(socket.id);
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
  .then(() => peopleInitSocial())
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