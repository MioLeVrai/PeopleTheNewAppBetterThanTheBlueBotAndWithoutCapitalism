(() => {
  "use strict";

  const DB_NAME = "people-offline-v1";
  const DB_VERSION = 1;
  const SECURE_STORE = "secure";
  const QUEUE_STORE = "queue";
  const KEY_RECORD = "__people_offline_device_key__";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let dbPromise = null;
  let keyPromise = null;
  let flushPromise = null;
  let dmSender = null;
  let banner = null;
  let pendingCount = 0;
  let activeAccountId = "";

  function b64url(bytes) {
    let binary = "";
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function fromB64url(value) {
    let text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    while (text.length % 4) text += "=";
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SECURE_STORE)) {
          db.createObjectStore(SECURE_STORE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          const store = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB indisponible."));
    });
    return dbPromise;
  }

  async function transaction(storeName, mode, work) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try {
        result = work(store);
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB erreur."));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB annulé."));
    });
  }

  async function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB erreur."));
    });
  }

  async function deviceKey() {
    if (keyPromise) return keyPromise;
    keyPromise = (async () => {
      const db = await openDb();
      const existing = await new Promise((resolve, reject) => {
        const tx = db.transaction(SECURE_STORE, "readonly");
        const req = tx.objectStore(SECURE_STORE).get(KEY_RECORD);
        req.onsuccess = () => resolve(req.result?.value || null);
        req.onerror = () => reject(req.error || new Error("Clé locale indisponible."));
      });
      if (existing) return existing;

      const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );

      await transaction(SECURE_STORE, "readwrite", (store) => {
        store.put({ key: KEY_RECORD, kind: "key", value: key, updatedAt: Date.now() });
      });
      return key;
    })();
    return keyPromise;
  }

  async function seal(value) {
    const key = await deviceKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = encoder.encode(JSON.stringify(value));
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
    return { iv: b64url(iv), cipher: b64url(new Uint8Array(cipher)) };
  }

  async function unseal(record) {
    if (!record?.iv || !record?.cipher) return null;
    const key = await deviceKey();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(record.iv) },
      key,
      fromB64url(record.cipher)
    );
    return JSON.parse(decoder.decode(plain));
  }

  async function putSecure(key, value) {
    const sealed = await seal(value);
    await transaction(SECURE_STORE, "readwrite", (store) => {
      store.put({ key, kind: "secure", ...sealed, updatedAt: Date.now() });
    });
  }

  async function getSecure(key) {
    const db = await openDb();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(SECURE_STORE, "readonly");
      const req = tx.objectStore(SECURE_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error("Cache local indisponible."));
    });
    if (!record || record.kind !== "secure") return null;
    try {
      return await unseal(record);
    } catch (err) {
      console.warn("[People offline] cache illisible", key, err);
      return null;
    }
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function usernameKey(value) {
    return clean(value).toLocaleLowerCase("fr-FR");
  }

  function accountId() {
    return clean(activeAccountId);
  }

  function accountKey(suffix) {
    const id = accountId();
    if (!id) return "";
    return `account:${id}:${suffix}`;
  }

  function mergeById(items, extras) {
    const map = new Map();
    for (const item of [...(Array.isArray(items) ? items : []), ...(Array.isArray(extras) ? extras : [])]) {
      const id = clean(item?.id || item?.clientId);
      const fallback = [item?.time, item?.createdAt, item?.username, item?.senderId, item?.text, item?.body].join("\u001f");
      map.set(id || fallback, item);
    }
    return [...map.values()].sort((a, b) => {
      const ta = new Date(a?.createdAt || a?.time || 0).getTime();
      const tb = new Date(b?.createdAt || b?.time || 0).getTime();
      return ta - tb;
    }).slice(-250);
  }

  async function queueRecords() {
    const db = await openDb();
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, "readonly");
      const req = tx.objectStore(QUEUE_STORE).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error || new Error("File hors ligne indisponible."));
    });
    const out = [];
    const currentAccountId = accountId();
    for (const record of records.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))) {
      if (!currentAccountId || clean(record.accountId) !== currentAccountId) continue;
      try {
        out.push({ ...record, payload: await unseal(record) });
      } catch (err) {
        console.warn("[People offline] entrée illisible", record?.id, err);
      }
    }
    return out;
  }

  async function updatePendingCount() {
    try {
      pendingCount = (await queueRecords()).length;
    } catch {
      pendingCount = 0;
    }
    renderBanner();
    window.dispatchEvent(new CustomEvent("people-offline-queue-changed", { detail: { count: pendingCount } }));
  }

  function ensureBanner() {
    if (banner?.isConnected) return banner;
    banner = document.createElement("div");
    banner.id = "peopleOfflineBanner";
    banner.className = "people-offline-banner";
    banner.setAttribute("role", "status");
    document.body.appendChild(banner);
    return banner;
  }

  function renderBanner() {
    if (!document.body) return;
    const el = ensureBanner();
    const offline = navigator.onLine === false;
    if (!offline && pendingCount <= 0) {
      el.classList.remove("show");
      return;
    }
    if (offline) {
      el.textContent = pendingCount > 0
        ? `Hors ligne • ${pendingCount} message${pendingCount > 1 ? "s" : ""} en attente`
        : "Hors ligne • les messages texte seront envoyés à la reconnexion";
      el.classList.add("offline");
    } else {
      el.textContent = pendingCount > 0
        ? `Reconnexion • envoi de ${pendingCount} message${pendingCount > 1 ? "s" : ""}…`
        : "Connexion rétablie";
      el.classList.remove("offline");
    }
    el.classList.add("show");
  }

  async function enqueue(type, payload) {
    const currentAccountId = accountId();
    if (!currentAccountId) throw new Error("Compte People indisponible pour le mode hors ligne.");
    const id = clean(payload?.clientId) || `${type}-${Date.now().toString(36)}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
    const sealed = await seal({ ...payload, clientId: id });
    await transaction(QUEUE_STORE, "readwrite", (store) => {
      store.put({ id, type, accountId: currentAccountId, createdAt: Date.now(), attempts: 0, lastError: "", ...sealed });
    });
    await updatePendingCount();
    return id;
  }

  async function removeQueue(id) {
    await transaction(QUEUE_STORE, "readwrite", (store) => store.delete(id));
    await updatePendingCount();
  }

  async function updateQueueError(record, err) {
    const next = {
      ...record,
      attempts: Number(record.attempts || 0) + 1,
      lastError: String(err?.message || err || "Erreur d'envoi").slice(0, 500)
    };
    delete next.payload;
    await transaction(QUEUE_STORE, "readwrite", (store) => store.put(next));
  }

  async function sendServer(payload) {
    const response = await fetch(
      `/api/servers/${encodeURIComponent(payload.serverId)}/channels/${encodeURIComponent(payload.channelId)}/messages`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: payload.text || "",
          replyToId: payload.replyToId || null,
          clientId: payload.clientId || null
        })
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || "Impossible d'envoyer le message serveur.");
    }
    if (data?.message) {
      await appendServerMessage(payload.serverId, payload.channelId, data.message);
    }
    return data;
  }

  async function flush() {
    if (flushPromise) return flushPromise;
    if (navigator.onLine === false) return false;
    flushPromise = (async () => {
      const records = await queueRecords();
      for (const record of records) {
        if (navigator.onLine === false) break;
        try {
          let result;
          if (record.type === "server") {
            result = await sendServer(record.payload);
          } else if (record.type === "dm") {
            if (typeof dmSender !== "function") break;
            result = await dmSender(record.payload);
          } else {
            await removeQueue(record.id);
            continue;
          }
          await removeQueue(record.id);
          window.dispatchEvent(new CustomEvent("people-offline-message-sent", {
            detail: { id: record.id, type: record.type, payload: record.payload, result }
          }));
        } catch (err) {
          await updateQueueError(record, err);
          window.dispatchEvent(new CustomEvent("people-offline-message-error", {
            detail: { id: record.id, type: record.type, error: String(err?.message || err) }
          }));
          if (err instanceof TypeError || navigator.onLine === false) break;
          // On s'arrête aussi sur une erreur HTTP : l'ordre des messages est conservé.
          break;
        }
      }
      await updatePendingCount();
      return true;
    })().finally(() => {
      flushPromise = null;
      renderBanner();
    });
    return flushPromise;
  }

  async function pendingServer(serverId, channelId) {
    const sid = clean(serverId);
    const cid = clean(channelId);
    const rows = await queueRecords();
    return rows
      .filter((row) => row.type === "server" && clean(row.payload?.serverId) === sid && clean(row.payload?.channelId) === cid)
      .map((row) => ({
        id: "",
        channelId: cid,
        username: row.payload.username || "Moi",
        text: row.payload.text || "",
        imageId: null,
        replyTo: row.payload.replySnapshot || null,
        time: row.payload.createdAt || row.createdAt,
        clientId: row.id,
        pending: true,
        offlinePending: true
      }));
  }

  async function pendingDm(username) {
    const wanted = usernameKey(username);
    const rows = await queueRecords();
    return rows
      .filter((row) => row.type === "dm" && usernameKey(row.payload?.username) === wanted)
      .map((row) => ({
        id: "",
        senderId: row.payload.senderId || "",
        recipientId: row.payload.recipientId || "",
        body: row.payload.body || "",
        imageId: null,
        replyTo: row.payload.replySnapshot || null,
        createdAt: new Date(row.payload.createdAt || row.createdAt).toISOString(),
        _peopleOfflineQueueId: row.id
      }));
  }

  async function cacheServerPayload(serverId, payload) {
    const sid = clean(serverId);
    if (!accountId() || !sid || !payload) return;
    const activeChannelId = clean(payload.activeChannelId);
    const meta = {
      ...payload,
      history: undefined,
      online: [],
      voice: [],
      activeChannelId,
      cachedAt: Date.now()
    };
    await putSecure(accountKey(`server:${sid}:meta`), meta);
    if (activeChannelId && Array.isArray(payload.history)) {
      await putSecure(accountKey(`server:${sid}:channel:${activeChannelId}`), {
        history: payload.history.slice(-250),
        cachedAt: Date.now()
      });
    }
  }

  async function getServerChannel(serverId, channelId) {
    const sid = clean(serverId);
    const cid = clean(channelId);
    if (!accountId()) return null;
    const cached = await getSecure(accountKey(`server:${sid}:channel:${cid}`));
    const pending = await pendingServer(sid, cid);
    if (!cached && !pending.length) return null;
    return mergeById(cached?.history || [], pending);
  }

  async function getServerPayload(serverId) {
    const sid = clean(serverId);
    if (!accountId()) return null;
    const meta = await getSecure(accountKey(`server:${sid}:meta`));
    if (!meta) return null;
    const cid = clean(meta.activeChannelId);
    return {
      ...meta,
      ok: true,
      offline: true,
      history: cid ? await getServerChannel(sid, cid) : [],
      online: [],
      voice: []
    };
  }

  async function appendServerMessage(serverId, channelId, message) {
    const sid = clean(serverId);
    const cid = clean(channelId);
    if (!accountId() || !sid || !cid || !message) return;
    const cached = await getSecure(accountKey(`server:${sid}:channel:${cid}`));
    const history = mergeById(cached?.history || [], [message]).filter((item) => !item?.offlinePending);
    await putSecure(accountKey(`server:${sid}:channel:${cid}`), { history, cachedAt: Date.now() });
  }

  async function cacheDmView(username, view) {
    const key = usernameKey(username);
    if (!accountId() || !key || !view) return;
    const messages = (Array.isArray(view.messages) ? view.messages : [])
      .filter((message) => !message?._peopleOfflineQueueId)
      .slice(-250);
    await putSecure(accountKey(`dm:${key}`), { ...view, messages, cachedAt: Date.now() });
  }

  async function getDmView(username) {
    const key = usernameKey(username);
    if (!accountId() || !key) return null;
    const cached = await getSecure(accountKey(`dm:${key}`));
    if (!cached) return null;
    const pending = await pendingDm(username);
    return { ...cached, messages: mergeById(cached.messages || [], pending) };
  }

  async function cacheConversations(conversations, unreadTotal = 0) {
    if (!accountId()) return;
    await putSecure(accountKey("dm:conversations"), {
      conversations: Array.isArray(conversations) ? conversations : [],
      unreadTotal: Number(unreadTotal || 0),
      cachedAt: Date.now()
    });
  }

  async function getConversations() {
    if (!accountId()) return null;
    return getSecure(accountKey("dm:conversations"));
  }

  async function cacheServers(servers) {
    if (!accountId()) return;
    await putSecure(accountKey("servers:list"), {
      servers: Array.isArray(servers) ? servers : [],
      cachedAt: Date.now()
    });
  }

  async function getServers() {
    if (!accountId()) return null;
    return getSecure(accountKey("servers:list"));
  }

  async function cacheAuth(user) {
    if (!user?.id || !user?.username) return;
    activeAccountId = String(user.id);
    await putSecure("auth:user", { id: String(user.id), username: String(user.username), cachedAt: Date.now() });
    await updatePendingCount();
  }

  async function getAuth() {
    const user = await getSecure("auth:user");
    if (user?.id) {
      activeAccountId = String(user.id);
      await updatePendingCount();
    }
    return user;
  }

  async function clearAuth() {
    activeAccountId = "";
    await transaction(SECURE_STORE, "readwrite", (store) => store.delete("auth:user"));
    await updatePendingCount();
  }

  function registerDmSender(fn) {
    dmSender = typeof fn === "function" ? fn : null;
    if (dmSender && navigator.onLine !== false) void flush();
  }

  async function queueServer(payload) {
    return enqueue("server", payload);
  }

  async function queueDm(payload) {
    return enqueue("dm", payload);
  }

  function isOffline() {
    return navigator.onLine === false;
  }

  window.addEventListener("online", () => {
    renderBanner();
    setTimeout(() => void flush(), 250);
  });
  window.addEventListener("offline", renderBanner);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void updatePendingCount();
      renderBanner();
    }, { once: true });
  } else {
    void updatePendingCount();
    renderBanner();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/people-notifications-sw.js?v=people-roles-render-fix-v3-20260919", { scope: "/" }).catch(() => {});
    }, { once: true });
  }

  window.PeopleOffline = {
    isOffline,
    cacheAuth,
    getAuth,
    clearAuth,
    cacheServers,
    getServers,
    cacheServerPayload,
    getServerPayload,
    getServerChannel,
    appendServerMessage,
    cacheDmView,
    getDmView,
    cacheConversations,
    getConversations,
    queueServer,
    queueDm,
    pendingServer,
    pendingDm,
    registerDmSender,
    flush,
    refreshStatus: updatePendingCount
  };
})();
