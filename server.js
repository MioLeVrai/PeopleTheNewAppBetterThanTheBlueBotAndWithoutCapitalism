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
      dms: Array.isArray(raw.dms) ? raw.dms : [],
      friend_requests: Array.isArray(raw.friend_requests)
        ? raw.friend_requests
        : [],
      closed_dms:
        Array.isArray(raw.closed_dms)
          ? raw.closed_dms
          : []
    };
  } catch {
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
        dms: Array.isArray(data.dms) ? data.dms : [],
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

  const cleanBody =
    String(body || "")
      .trim()
      .slice(0, 2000);

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
            cleanBody,
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

async function peopleDmHistory(
  accountId,
  otherId
) {
  const me =
    String(accountId);

  const other =
    String(otherId);

  if (peoplePool) {
    await peopleEnsureReplyColumns();

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
        "WHERE (dm.sender_id = $1 AND dm.recipient_id = $2) " +
        "OR (dm.sender_id = $2 AND dm.recipient_id = $1) " +
        "ORDER BY dm.created_at DESC LIMIT 150",
        [
          me,
          other
        ]
      );

    return result.rows.reverse();
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

  const filtered =
    all
      .filter(
        (message) =>
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
          )
      )
      .sort(
        (a, b) =>
          new Date(
            a.created_at
          ).getTime() -
          new Date(
            b.created_at
          ).getTime()
      )
      .slice(-150);

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

  return filtered;
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

  for (
    const item of map.values()
  ) {
    const account =
      await peopleFindAccountById(
        item.otherId
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
      text: row.body,
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
      text: row.body,
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
            cleanText,
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
          row.body,
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
          row.body,
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
                        row.reply_body || "",
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
    "CREATE INDEX IF NOT EXISTS people_dm_sender_recipient_idx " +
    "ON people_direct_messages(sender_id, recipient_id, created_at DESC)"
  );

  await peoplePool.query(
    "CREATE INDEX IF NOT EXISTS people_dm_recipient_unread_idx " +
    "ON people_direct_messages(recipient_id, read_at)"
  );

  console.log("[People] Profils, amis et MP PostgreSQL actives.");
}

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

    const messages =
      await peopleDmHistory(
        session.id,
        target.id
      );

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
        isFriend:
          await peopleHasFriend(
            session.id,
            target.id
          )
      },
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
      body.length > 2000
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Le MP doit contenir du texte ou une image."
      });
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
    await peoplePool.query(
      "DELETE FROM people_message_images " +
      "WHERE general_message_id IS NULL " +
      "AND dm_message_id IS NULL " +
      "AND created_at < NOW() - INTERVAL '1 day'"
    );

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
        members: []
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
          : []
    };
  } catch {
    return {
      servers: [],
      members: []
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
  db = peoplePool
) {
  const id =
    peopleReplyId(replyToId);

  const sid =
    String(serverId || "");

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
        "WHERE gm.id = $1 AND gm.server_id = $2 LIMIT 1",
        [
          id,
          sid
        ]
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
        row.body,
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
          String(item.serverId) === sid
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
  senderId,
  username,
  text,
  imageId = null,
  replyToId = null
) {
  const sid =
    String(serverId);

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
          "(server_id, sender_id, username, body, reply_to_id) " +
          "VALUES ($1, $2, $3, $4, $5) " +
          "RETURNING id, username, body, reply_to_id, created_at",
          [
            sid,
            String(senderId),
            cleanUsername,
            cleanText,
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
        username:
          row.username,
        text:
          row.body,
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
    serverId:
      sid,
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
  limit = 100
) {
  const sid =
    String(serverId);

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
        "ON rgm.id = gm.reply_to_id AND rgm.server_id = gm.server_id " +
        "WHERE gm.server_id = $1 " +
        "ORDER BY gm.created_at DESC LIMIT $2",
        [
          sid,
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
          system:
            Boolean(row.is_system),
          username:
            row.username,
          text:
            row.body,
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
                          row.reply_body || "",
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
          sid
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
  messageId
) {
  const owner =
    String(accountId);

  const sid =
    String(serverId);

  const id =
    peopleReplyId(messageId);

  if (
    !owner ||
    !sid ||
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
        "WHERE id = $1 AND sender_id = $2 AND server_id = $3 " +
        "RETURNING id",
        [
          id,
          owner,
          sid
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
        String(item.serverId) === sid
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

      const joined =
        await peopleIsServerMember(
          session.id,
          server.id
        );

      const memberCount =
        await peopleServerMemberCount(
          server.id
        );

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

  if (peoplePool) {
    const result =
      await peoplePool.query(
        "INSERT INTO people_general_messages " +
        "(server_id, sender_id, username, body, is_system) " +
        "VALUES ($1, NULL, $2, $3, TRUE) " +
        "RETURNING id, body, created_at",
        [
          sid,
          "Système",
          cleanText
        ]
      );

    const row =
      result.rows[0];

    return {
      id:
        String(row.id),
      serverId:
        sid,
      username:
        "Système",
      text:
        row.body,
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

      if (
        server.ownerId &&
        String(server.ownerId) ===
          String(session.id)
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Tu ne peux pas quitter un serveur dont tu es propriétaire pour l'instant."
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

      emitOnlineUsers(
        server.id
      );

      await peopleEmitServerMembershipMessage(
        server.id,
        session.id,
        "leave"
      );

      res.json({
        ok: true,
        serverId:
          String(server.id)
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
const PEOPLE_DESKTOP_PACKAGE_FILE =
  pathAccounts.join(
    __dirname,
    "desktop",
    "package.json"
  );

const PEOPLE_DESKTOP_RELEASE_FILE =
  pathAccounts.join(
    __dirname,
    "desktop",
    "release.json"
  );

const PEOPLE_DESKTOP_DEFAULT_INSTALLER_URL =
  "https://github.com/MioLeVrai/PeopleTheNewAppBetterThanTheBlueBotAndWithoutCapitalism/releases/latest/download/People-Setup.exe";

function peopleDesktopReleaseInfo() {
  let packageVersion =
    "1.0.0";

  let release = {};

  try {
    const desktopPackage =
      JSON.parse(
        fsAccounts.readFileSync(
          PEOPLE_DESKTOP_PACKAGE_FILE,
          "utf8"
        )
      );

    if (desktopPackage?.version) {
      packageVersion =
        String(
          desktopPackage.version
        ).trim();
    }
  } catch (err) {
    console.warn(
      "[People desktop/package]",
      err?.message || err
    );
  }

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
      "[People desktop/release]",
      err?.message || err
    );
  }

  const version =
    String(
      release?.version ||
      packageVersion
    ).trim() ||
    packageVersion;

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
const voiceUsers = new Map();

// === PEOPLE_DM_CALLS_V1_START ===
const peopleDmCalls =
  new Map();

const peopleDmCallTimers =
  new Map();

const peopleDmCallLastStart =
  new Map();

const PEOPLE_DM_CALL_RING_MS =
  35 * 1000;

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

  for (
    const call of
    peopleDmCalls.values()
  ) {
    if (
      call.status !== "ringing" &&
      call.status !== "active"
    ) {
      continue;
    }

    if (
      String(
        call.callerAccountId
      ) === wanted ||
      String(
        call.calleeAccountId
      ) === wanted
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

  // === PEOPLE_DM_CALL_FINISH_VOICE_REFRESH_V3 ===
  const wasActive =
    call.status ===
    "active";

  const timer =
    peopleDmCallTimers.get(
      id
    );

  if (timer) {
    clearTimeout(
      timer
    );
  }

  peopleDmCallTimers.delete(
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

  const recipients = [
    call.callerSocketId
  ];

  if (
    call.calleeSocketId
  ) {
    recipients.push(
      call.calleeSocketId
    );
  } else {
    recipients.push(
      ...peopleDmCallAccountSocketIds(
        call.calleeAccountId
      )
    );
  }

  peopleDmCallEmitSocketIds(
    recipients,
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

  if (wasActive) {
    peopleVoiceRefreshAccount(
      call.callerAccountId
    );

    peopleVoiceRefreshAccount(
      call.calleeAccountId
    );
  }

  return true;
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
      call.callerSocketId
    ) !== currentSocket &&
    String(
      call.calleeSocketId
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
      call.callerSocketId
    ) === current
  ) {
    return String(
      call.calleeSocketId ||
      ""
    );
  }

  if (
    String(
      call.calleeSocketId
    ) === current
  ) {
    return String(
      call.callerSocketId ||
      ""
    );
  }

  return "";
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
        call.callerSocketId
      ) === socketId
    ) {
      peopleDmCallFinish(
        call.id,
        "disconnected"
      );

      continue;
    }

    if (
      call.status ===
        "active" &&
      String(
        call.calleeSocketId
      ) === socketId
    ) {
      peopleDmCallFinish(
        call.id,
        "disconnected"
      );

      continue;
    }

    /*
      V2 : si l'appelé ferme son dernier onglet pendant
      que ça sonne, l'appel continue jusqu'au timeout.
      S'il rouvre People avant, il reçoit l'appel.
    */
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
        body,
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
        "ringing" ||
      String(
        call.calleeAccountId
      ) !== wanted
    ) {
      continue;
    }

    io.to(
      targetSocket
    ).emit(
      "dm-call-incoming",
      {
        callId:
          call.id,
        caller: {
          id:
            String(
              call.callerAccountId
            ),
          username:
            call.callerUsername
        }
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

        return {
          id:
            accountId,
          accountId,
          username:
            row.username,
          online:
            peopleAccountIsOnline(
              accountId
            ),
          connections:
            peopleAccountConnectionCount(
              accountId
            )
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

        return {
          id:
            accountId,
          accountId,
          username:
            account.username,
          online:
            peopleAccountIsOnline(
              accountId
            ),
          connections:
            peopleAccountConnectionCount(
              accountId
            )
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

async function peopleRefreshPresenceForAccount(
  accountId
) {
  const uid =
    String(accountId || "");

  if (!uid) {
    return;
  }

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
    const involved =
      String(
        call?.callerAccountId ||
        ""
      ) === wanted ||
      String(
        call?.calleeAccountId ||
        ""
      ) === wanted;

    if (!involved) {
      continue;
    }

    if (
      call.status ===
      "active"
    ) {
      count +=
        1;

      continue;
    }

    if (
      includeRinging &&
      call.status ===
        "ringing"
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
    muted:
      Boolean(
        user?.muted
      ),
    camera:
      Boolean(
        user?.camera
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

        const targetSockets =
          peopleDmCallAccountSocketIds(
            target.id
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
          !peopleAccountHasVoiceSlot(
            target.id
          )
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
            "ringing",
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
          createdAt:
            Date.now()
        };

        peopleDmCalls.set(
          callId,
          call
        );

        peopleDmCallSaveTimeline(
          call,
          "started"
        );

        const timer =
          setTimeout(
            () => {
              peopleDmCallFinish(
                callId,
                "timeout"
              );
            },
            PEOPLE_DM_CALL_RING_MS
          );

        peopleDmCallTimers.set(
          callId,
          timer
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
            }
          }
        );

        ack({
          ok: true,
          callId,
          target:
            peoplePublicAccount(
              target
            )
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
          "ringing" ||
        !accountId ||
        String(
          call.calleeAccountId
        ) !==
          String(
            accountId
          )
      ) {
        return ack({
          ok: false,
          reason:
            "unavailable"
        });
      }

      // === VOICE_LIMIT_ON_ANSWER ===
      if (
        peopleAccountActiveVoiceCount(
          call.callerAccountId
        ) >=
          PEOPLE_MAX_SIMULTANEOUS_VOICES ||
        peopleAccountActiveVoiceCount(
          call.calleeAccountId
        ) >=
          PEOPLE_MAX_SIMULTANEOUS_VOICES
      ) {
        peopleDmCallFinish(
          call.id,
          "limit"
        );

        return ack({
          ok: false,
          reason:
            "limit"
        });
      }

      const timer =
        peopleDmCallTimers.get(
          call.id
        );

      if (timer) {
        clearTimeout(
          timer
        );
      }

      peopleDmCallTimers.delete(
        call.id
      );

      call.status =
        "active";

      call.acceptedAt =
        Date.now();

      call.calleeSocketId =
        String(
          socket.id
        );

      peopleDmCalls.set(
        call.id,
        call
      );

      /*
        L'appel MP devient une vraie session vocale.
        On rafraîchit les listes des vocaux serveur
        et tous les appels concernés.
      */
      peopleVoiceRefreshAccount(
        call.callerAccountId
      );

      peopleVoiceRefreshAccount(
        call.calleeAccountId
      );

      const otherCalleeSockets =
        peopleDmCallAccountSocketIds(
          call.calleeAccountId
        ).filter(
          (id) =>
            String(id) !==
            String(
              socket.id
            )
        );

      peopleDmCallEmitSocketIds(
        otherCalleeSockets,
        "dm-call-ended",
        {
          callId:
            call.id,
          reason:
            "answered-elsewhere"
        }
      );

      io.to(
        call.callerSocketId
      ).emit(
        "dm-call-accepted",
        {
          callId:
            call.id,
          peerSocketId:
            call.calleeSocketId,
          peerUsername:
            call.calleeUsername,
          initiator:
            true,
          peerCamera:
            false
        }
      );

      io.to(
        call.calleeSocketId
      ).emit(
        "dm-call-accepted",
        {
          callId:
            call.id,
          peerSocketId:
            call.callerSocketId,
          peerUsername:
            call.callerUsername,
          initiator:
            false,
          peerCamera:
            false
        }
      );

      ack({
        ok: true
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
          "ringing" ||
        !accountId ||
        String(
          call.calleeAccountId
        ) !==
          String(
            accountId
          )
      ) {
        return;
      }

      peopleDmCallFinish(
        call.id,
        "declined"
      );
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

      if (
        !call ||
        call.status !==
          "ringing" ||
        String(
          call.callerSocketId
        ) !==
          String(
            socket.id
          )
      ) {
        return;
      }

      peopleDmCallFinish(
        call.id,
        "cancelled"
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

      const current =
        String(
          socket.id
        );

      if (
        String(
          call.callerSocketId
        ) !== current &&
        String(
          call.calleeSocketId ||
          ""
        ) !== current
      ) {
        return;
      }

      peopleDmCallFinish(
        call.id,
        "hangup"
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
      camera
    } = {}) => {
      const call =
        peopleDmCallForActiveSocket(
          callId,
          socket.id
        );

      if (!call) {
        return;
      }

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
            )
        }
      );
    }
  );
  // === PEOPLE_DM_CALL_SOCKET_V1_END ===

  socket.on(
    "server-select",
    async (
      { serverId } = {},
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

        const history =
          await peopleServerLoadMessages(
            server.id,
            100
          );

        const online =
          await peopleServerPresenceRoster(
            server.id
          );

        const voice =
          peopleVoiceRoster(
            server.id
          );

        emitOnlineUsers(
          server.id
        );

        ack({
          ok: true,
          server:
            peopleServerPublic(
              server
            ),
          history,
          online,
          voice
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
    "chat-message",
    async ({
      text,
      imageId,
      replyToId
    } = {}) => {
      const username =
        users.get(
          socket.id
        );

      const senderId =
        userIds.get(
          socket.id
        );

      const serverId =
        socketServerIds.get(
          socket.id
        );

      if (
        !username ||
        !senderId ||
        !serverId
      ) {
        return;
      }

      const cleanText =
        String(text || "")
          .trim()
          .slice(0, 1000);

      const imageKey =
        peopleNormalizeMessageImageId(
          imageId
        );

      if (
        !cleanText &&
        !imageKey
      ) {
        return;
      }

      try {
        const saved =
          await peopleServerSaveMessage(
            serverId,
            senderId,
            username,
            cleanText,
            imageKey,
            replyToId
          );

        if (!saved) {
          return;
        }

        io.to(
          peopleServerRoom(
            serverId
          )
        ).emit(
          "chat-message",
          saved
        );
      } catch (err) {
        console.error(
          "[People server message/save]",
          err
        );

        socket.emit(
          "system-message",
          {
            text:
              err?.code ===
                "IMAGE_INVALID"
                ? "Cette image n'est plus disponible. Réessaie de la sélectionner."
                : err?.code ===
                    "REPLY_INVALID"
                  ? "Le message auquel tu réponds n'est plus disponible."
                  : "Le message n'a pas pu être sauvegardé.",
            time:
              Date.now()
          }
        );
      }
    }
  );

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

        if (
          !senderId ||
          !serverId
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
              String(id)
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
        muted,
        camera
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
            ) === sid
          ) {
            await socket.join(
              peopleVoiceRoom(
                sid
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
              roster,
              voiceRooms:
                peopleVoiceAccountServerIds(
                  aid
                ).size
            });
          }

          return ack({
            ok: false,
            code:
              "VOICE_TAB_BUSY",
            error:
              "Tu es déjà dans un vocal. Quitte-le avant d'en rejoindre un autre."
          });
        }

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

        if (
          !currentRooms.has(
            sid
          ) &&
          peopleAccountReservedVoiceCount(
            aid
          ) >=
            PEOPLE_MAX_SIMULTANEOUS_VOICES
        ) {
          return ack({
            ok: false,
            code:
              "VOICE_LIMIT",
            error:
              "Tu es déjà dans un vocal ou un appel. Quitte-en un avant d'en rejoindre un autre."
          });
        }

        voiceUsers.set(
          socket.id,
          {
            serverId:
              sid,
            accountId:
              aid,
            username,
            muted:
              Boolean(
                muted
              ),
            camera:
              Boolean(
                camera
              )
          }
        );

        await socket.join(
          peopleVoiceRoom(
            sid
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
              user.id !==
              socket.id
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
          roster,
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
          String(other.serverId)
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

const PORT = Number(process.env.PORT) || 3000;

peopleInitAccounts()
  .then(() => peopleInitSocial())
  .then(() => peopleInitServersV1())
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