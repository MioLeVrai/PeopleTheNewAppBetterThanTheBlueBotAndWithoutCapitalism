(() => {
  "use strict";

  // V11A prépare uniquement la distribution des clés de salon.
  // Le texte des salons reste inchangé jusqu'à V11B.
  const PROTOCOL = "people-server-sender-key-v1";
  const SUITE = "P256-HKDF-SHA256-AES256GCM";
  const DB_NAME = "people-server-e2ee-v1";
  const DB_VERSION = 1;
  const KEY_STORE = "channelKeys";
  const STATE_STORE = "channelState";
  const encoder = new TextEncoder();

  let dbPromise = null;
  const running = new Map();
  const memoryRaw = new Map();
  const stateCache = new Map();

  function bridge() {
    const value = window.PeopleE2EEDevice;
    if (!value?.ensureDevice || !window.crypto?.subtle || !window.indexedDB) {
      throw new Error("E2EE People indisponible sur cet appareil.");
    }
    return value;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      const error = new Error(data?.error || "Erreur E2EE serveur.");
      error.code = data?.code || "E2EE_SERVER_ERROR";
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(KEY_STORE)) {
          db.createObjectStore(KEY_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STATE_STORE)) {
          db.createObjectStore(STATE_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB E2EE serveur indisponible."));
    });
    return dbPromise;
  }

  async function dbGet(storeName, id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbPut(storeName, record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function stateId(accountId, serverId, channelId) {
    return [String(accountId), String(serverId), String(channelId)].join("|");
  }

  function keyId(accountId, serverId, channelId, epoch) {
    return [String(accountId), String(serverId), String(channelId), String(epoch)].join("|");
  }

  async function saveState(accountId, serverId, channelId, state) {
    const id = stateId(accountId, serverId, channelId);
    const record = {
      id,
      accountId: String(accountId),
      serverId: String(serverId),
      channelId: String(channelId),
      epoch: Number(state?.epoch || 0),
      status: String(state?.status || "pending"),
      protocol: String(state?.protocol || PROTOCOL),
      suite: String(state?.suite || SUITE),
      updatedAt: Date.now()
    };
    stateCache.set(id, record);
    await dbPut(STATE_STORE, record);
    dispatchStatus(record);
    return record;
  }

  async function readState(accountId, serverId, channelId) {
    const id = stateId(accountId, serverId, channelId);
    if (stateCache.has(id)) return stateCache.get(id);
    const record = await dbGet(STATE_STORE, id);
    if (record) stateCache.set(id, record);
    return record;
  }

  async function saveKey(accountId, serverId, channelId, epoch, key) {
    await dbPut(KEY_STORE, {
      id: keyId(accountId, serverId, channelId, epoch),
      accountId: String(accountId),
      serverId: String(serverId),
      channelId: String(channelId),
      epoch: Number(epoch),
      key,
      createdAt: Date.now()
    });
  }

  async function readKey(accountId, serverId, channelId, epoch) {
    const record = await dbGet(KEY_STORE, keyId(accountId, serverId, channelId, epoch));
    return record?.key || null;
  }

  function dispatchStatus(detail) {
    window.dispatchEvent(new CustomEvent("people-server-e2ee-status", { detail }));
  }

  function bytesToBase64Url(bytes) {
    return bridge().bytesToBase64Url(bytes);
  }

  function base64UrlToBytes(value) {
    return bridge().base64UrlToBytes(value);
  }

  function serverSalt(serverId, channelId, epoch) {
    return encoder.encode(
      `People E2EE Server salt v1|${serverId}|${channelId}|${epoch}`
    );
  }

  function serverInfo(serverId, channelId, epoch, senderDeviceId, targetUserId, targetDeviceId) {
    return encoder.encode(
      `People E2EE Server wrap v1|${serverId}|${channelId}|${epoch}|${senderDeviceId}|${targetUserId}|${targetDeviceId}`
    );
  }

  function serverAad(serverId, channelId, epoch, senderUserId, senderDeviceId, targetUserId, targetDeviceId) {
    return encoder.encode(
      `People E2EE Server key v1|${serverId}|${channelId}|${epoch}|${senderUserId}|${senderDeviceId}|${targetUserId}|${targetDeviceId}`
    );
  }

  async function deriveWrapKey(device, peerPublicJwk, context) {
    const peerPublic = await bridge().importPublicKey(peerPublicJwk);
    const sharedBits = await crypto.subtle.deriveBits(
      { name: "ECDH", public: peerPublic },
      device.privateKey,
      256
    );
    const hkdfKey = await crypto.subtle.importKey(
      "raw",
      sharedBits,
      "HKDF",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: serverSalt(context.serverId, context.channelId, context.epoch),
        info: serverInfo(
          context.serverId,
          context.channelId,
          context.epoch,
          context.senderDeviceId,
          context.targetUserId,
          context.targetDeviceId
        )
      },
      hkdfKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function keyCommitment(rawKey) {
    const digest = await crypto.subtle.digest("SHA-256", rawKey);
    return bytesToBase64Url(new Uint8Array(digest));
  }

  async function importChannelKey(rawKey) {
    return crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function wrapChannelKey(rawKey, device, recipient, context) {
    const wrapKey = await deriveWrapKey(device, recipient.publicJwk, {
      ...context,
      targetUserId: recipient.userId,
      targetDeviceId: recipient.deviceId
    });
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: serverAad(
          context.serverId,
          context.channelId,
          context.epoch,
          device.accountId,
          device.deviceId,
          recipient.userId,
          recipient.deviceId
        )
      },
      wrapKey,
      rawKey
    );
    return {
      userId: String(recipient.userId),
      deviceId: String(recipient.deviceId),
      iv: bytesToBase64Url(iv),
      ct: bytesToBase64Url(new Uint8Array(encrypted))
    };
  }

  async function unwrapChannelKey(payload, device, state, serverId, channelId) {
    if (!payload?.iv || !payload?.ct || !state?.sender?.publicJwk) {
      throw new Error("Enveloppe E2EE du salon incomplète.");
    }
    const wrapKey = await deriveWrapKey(device, state.sender.publicJwk, {
      serverId,
      channelId,
      epoch: state.epoch,
      senderDeviceId: state.sender.deviceId,
      targetUserId: device.accountId,
      targetDeviceId: device.deviceId
    });
    const raw = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(payload.iv),
        additionalData: serverAad(
          serverId,
          channelId,
          state.epoch,
          state.sender.userId,
          state.sender.deviceId,
          device.accountId,
          device.deviceId
        )
      },
      wrapKey,
      base64UrlToBytes(payload.ct)
    );
    const commitment = await keyCommitment(raw);
    if (!state.commitment || commitment !== String(state.commitment)) {
      throw new Error("La clé E2EE du salon ne correspond pas à son engagement cryptographique.");
    }
    return importChannelKey(raw);
  }

  async function loadRecipients(serverId, channelId, epoch, deviceId) {
    const output = [];
    let cursor = "0";
    for (let page = 0; page < 100000; page += 1) {
      const data = await api(
        `/api/servers/${encodeURIComponent(serverId)}/e2ee/channels/${encodeURIComponent(channelId)}/recipients?` +
        new URLSearchParams({
          epoch: String(epoch),
          deviceId: String(deviceId),
          cursor,
          limit: "100"
        }).toString()
      );
      output.push(...(Array.isArray(data.recipients) ? data.recipients : []));
      if (!data.nextCursor) return output;
      cursor = String(data.nextCursor);
    }
    throw new Error("Pagination E2EE anormalement longue.");
  }

  async function uploadPackages(serverId, channelId, epoch, device, rawKey) {
    const recipients = await loadRecipients(serverId, channelId, epoch, device.deviceId);
    if (!recipients.length) throw new Error("Aucun appareil E2EE autorisé dans ce salon.");

    for (let offset = 0; offset < recipients.length; offset += 25) {
      const page = recipients.slice(offset, offset + 25);
      const packages = [];
      for (const recipient of page) {
        packages.push(await wrapChannelKey(rawKey, device, recipient, {
          serverId,
          channelId,
          epoch,
          senderDeviceId: device.deviceId
        }));
      }
      await api(
        `/api/servers/${encodeURIComponent(serverId)}/e2ee/channels/${encodeURIComponent(channelId)}/packages`,
        {
          method: "POST",
          body: JSON.stringify({
            epoch,
            senderDeviceId: device.deviceId,
            packages
          })
        }
      );
    }
  }

  async function claimAndBuild(serverId, channelId, device, currentState) {
    const pendingId = keyId(device.accountId, serverId, channelId, currentState.epoch);
    const hadMemoryKey = memoryRaw.has(pendingId);
    const sameSender = currentState?.sender?.userId === device.accountId &&
      currentState?.sender?.deviceId === device.deviceId;

    let rawKey = memoryRaw.get(pendingId);
    if (!rawKey) {
      rawKey = crypto.getRandomValues(new Uint8Array(32));
      memoryRaw.set(pendingId, rawKey);
    }
    const commitment = await keyCommitment(rawKey);

    let claimed;
    try {
      claimed = await api(
        `/api/servers/${encodeURIComponent(serverId)}/e2ee/channels/${encodeURIComponent(channelId)}/claim`,
        {
          method: "POST",
          body: JSON.stringify({
            deviceId: device.deviceId,
            commitment,
            // Après un reload, une ancienne claim du même appareil n'a plus
            // la clé brute nécessaire pour envelopper les destinataires.
            restart: Boolean(sameSender && !hadMemoryKey)
          })
        }
      );
    } catch (err) {
      if (err?.code === "CLAIMED" || err?.code === "NOT_PENDING") {
        memoryRaw.delete(pendingId);
        return null;
      }
      memoryRaw.delete(pendingId);
      throw err;
    }

    const epoch = Number(claimed.epoch || currentState.epoch);
    const rawId = keyId(device.accountId, serverId, channelId, epoch);
    if (rawId !== pendingId) {
      memoryRaw.delete(pendingId);
      rawKey = crypto.getRandomValues(new Uint8Array(32));
      memoryRaw.set(rawId, rawKey);
      throw new Error("L'epoch E2EE a changé pendant la réservation de clé.");
    }
    const key = await importChannelKey(rawKey);
    await saveKey(device.accountId, serverId, channelId, epoch, key);

    try {
      await uploadPackages(serverId, channelId, epoch, device, rawKey);
      const ready = await api(
        `/api/servers/${encodeURIComponent(serverId)}/e2ee/channels/${encodeURIComponent(channelId)}/finalize`,
        {
          method: "POST",
          body: JSON.stringify({ epoch, senderDeviceId: device.deviceId })
        }
      );
      await saveState(device.accountId, serverId, channelId, ready);
      return { state: ready, key: await readKey(device.accountId, serverId, channelId, epoch) };
    } catch (err) {
      if (err?.code === "RECIPIENT_SET_CHANGED" || err?.code === "CLAIM_LOST") {
        scheduleEnsure(serverId, channelId, 120);
        return null;
      }
      throw err;
    } finally {
      memoryRaw.delete(rawId);
    }
  }

  async function ensureChannelInner(serverId, channelId) {
    const sid = String(serverId || "");
    const cid = String(channelId || "");
    if (!sid || !cid) return null;

    const device = await bridge().ensureDevice();
    if (!device.accountId || !device.deviceId || !device.privateKey) {
      throw new Error("Appareil E2EE invalide.");
    }

    if (navigator.onLine === false) {
      const localState = await readState(device.accountId, sid, cid);
      if (!localState?.epoch) return null;
      const localKey = await readKey(device.accountId, sid, cid, localState.epoch);
      return localKey ? { state: localState, key: localKey, offline: true } : null;
    }

    let remote = await api(
      `/api/servers/${encodeURIComponent(sid)}/e2ee/channels/${encodeURIComponent(cid)}/state?` +
      new URLSearchParams({ deviceId: device.deviceId }).toString()
    );
    await saveState(device.accountId, sid, cid, remote);

    if (remote.protocol !== PROTOCOL || remote.suite !== SUITE) {
      throw new Error("Version E2EE de salon non prise en charge.");
    }

    if (remote.status === "ready") {
      let key = await readKey(device.accountId, sid, cid, remote.epoch);
      if (key) return { state: remote, key };

      if (remote.package) {
        key = await unwrapChannelKey(remote.package, device, remote, sid, cid);
        await saveKey(device.accountId, sid, cid, remote.epoch, key);
        return { state: remote, key };
      }

      // Nouvel appareil : il ne reçoit pas silencieusement une ancienne clé.
      // On demande un nouvel epoch distribué à l'ensemble des appareils
      // actuellement autorisés.
      remote = await api(
        `/api/servers/${encodeURIComponent(sid)}/e2ee/channels/${encodeURIComponent(cid)}/request-sync`,
        {
          method: "POST",
          body: JSON.stringify({ deviceId: device.deviceId })
        }
      );
      await saveState(device.accountId, sid, cid, remote);
    }

    if (remote.status === "pending") {
      const built = await claimAndBuild(sid, cid, device, remote);
      if (built) return built;

      // Un autre appareil a gagné la course. On conserve l'état pending et
      // l'événement socket "server-e2ee-key-ready" relancera ensureChannel.
      return null;
    }

    return null;
  }

  function ensureChannel(serverId, channelId) {
    const id = `${serverId}|${channelId}`;
    if (running.has(id)) return running.get(id);
    const promise = ensureChannelInner(serverId, channelId)
      .catch((err) => {
        console.warn("[People server E2EE]", err);
        dispatchStatus({
          serverId: String(serverId || ""),
          channelId: String(channelId || ""),
          status: "error",
          error: err?.message || "Erreur E2EE"
        });
        return null;
      })
      .finally(() => {
        if (running.get(id) === promise) running.delete(id);
      });
    running.set(id, promise);
    return promise;
  }

  async function getChannelKey(serverId, channelId) {
    const result = await ensureChannel(serverId, channelId);
    if (result?.key && result?.state?.epoch) {
      return {
        key: result.key,
        epoch: Number(result.state.epoch),
        protocol: result.state.protocol || PROTOCOL,
        suite: result.state.suite || SUITE
      };
    }
    return null;
  }

  async function getCachedChannelKey(serverId, channelId) {
    try {
      const device = await bridge().ensureDevice();
      const state = await readState(device.accountId, serverId, channelId);
      if (!state?.epoch) return null;
      const key = await readKey(device.accountId, serverId, channelId, state.epoch);
      return key ? { key, epoch: Number(state.epoch), protocol: state.protocol, suite: state.suite } : null;
    } catch {
      return null;
    }
  }

  function scheduleEnsure(serverId, channelId, delay = 0) {
    if (!serverId || !channelId) return;
    setTimeout(() => void ensureChannel(serverId, channelId), Math.max(0, delay));
  }

  window.addEventListener("people-server-channel-state", (event) => {
    const detail = event.detail || {};
    const serverId = String(detail.serverId || "");
    const channelId = String(detail.activeTextChannelId || "");
    if (serverId && channelId) scheduleEnsure(serverId, channelId, 0);
  });

  window.addEventListener("online", () => {
    const state = window.PeopleServerChannels?.getState?.();
    if (state?.serverId && state?.activeTextChannelId) {
      scheduleEnsure(state.serverId, state.activeTextChannelId, 50);
    }
  });

  const socket = window.peopleSocket;
  socket?.on?.("server-e2ee-rotation-needed", (payload) => {
    scheduleEnsure(payload?.serverId, payload?.channelId, 20);
  });
  socket?.on?.("server-e2ee-key-ready", (payload) => {
    scheduleEnsure(payload?.serverId, payload?.channelId, 20);
  });

  window.PeopleServerE2EE = Object.freeze({
    protocol: PROTOCOL,
    suite: SUITE,
    ensureChannel,
    getChannelKey,
    getCachedChannelKey,
    async getState(serverId, channelId) {
      const device = await bridge().ensureDevice();
      return readState(device.accountId, serverId, channelId);
    }
  });
})();
