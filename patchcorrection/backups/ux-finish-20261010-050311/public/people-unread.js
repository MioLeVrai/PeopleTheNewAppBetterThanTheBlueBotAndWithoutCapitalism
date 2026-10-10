(() => {
  const VERSION = "people-unread-v1";
  const unreadByServer = new Map();
  let currentServerId = "";
  let currentChannelId = "";
  let serverDividerToken = 0;
  let dmDividerState = null;
  let renderQueued = false;
  let treeObserver = null;
  let dmObserver = null;
  let wrapped = false;
  let socketBound = false;

  function clean(value) {
    return String(value || "").trim();
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || "Action impossible.");
    }
    return data;
  }

  function serverMap(serverId, create = true) {
    const sid = clean(serverId);
    if (!sid) return null;
    if (!unreadByServer.has(sid) && create) {
      unreadByServer.set(sid, new Map());
    }
    return unreadByServer.get(sid) || null;
  }

  function setServerSummary(serverId, channels) {
    const sid = clean(serverId);
    if (!sid) return;
    const map = new Map();
    for (const item of Array.isArray(channels) ? channels : []) {
      const cid = clean(item?.channelId);
      if (!cid) continue;
      map.set(cid, {
        channelId: cid,
        unreadCount: Math.max(0, Number(item?.unreadCount || 0)),
        firstUnreadMessageId: item?.firstUnreadMessageId
          ? clean(item.firstUnreadMessageId)
          : null
      });
    }
    unreadByServer.set(sid, map);
    scheduleRenderBadges();
  }

  function setChannelUnread(serverId, channelId, count, firstId = undefined) {
    const sid = clean(serverId);
    const cid = clean(channelId);
    if (!sid || !cid) return;
    const map = serverMap(sid, true);
    const previous = map.get(cid) || {
      channelId: cid,
      unreadCount: 0,
      firstUnreadMessageId: null
    };
    map.set(cid, {
      ...previous,
      unreadCount: Math.max(0, Number(count || 0)),
      firstUnreadMessageId:
        firstId === undefined
          ? previous.firstUnreadMessageId
          : (firstId ? clean(firstId) : null)
    });
    scheduleRenderBadges();
  }

  function bumpChannelUnread(serverId, channelId, messageId) {
    const sid = clean(serverId);
    const cid = clean(channelId);
    if (!sid || !cid) return;
    const map = serverMap(sid, true);
    const previous = map.get(cid) || {
      channelId: cid,
      unreadCount: 0,
      firstUnreadMessageId: null
    };
    const next = Number(previous.unreadCount || 0) + 1;
    map.set(cid, {
      channelId: cid,
      unreadCount: next,
      firstUnreadMessageId:
        previous.firstUnreadMessageId ||
        (messageId ? clean(messageId) : null)
    });
    scheduleRenderBadges();
  }

  function scheduleRenderBadges() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderServerBadges();
    });
  }

  function renderServerBadges() {
    const sid = clean(
      window.PeopleServerRuntime?.getActiveServerId?.() || currentServerId
    );
    if (!sid) return;
    const map = serverMap(sid, false);
    if (!map) return;

    document
      .querySelectorAll(".people-server-channel[data-channel-id]")
      .forEach((button) => {
        const cid = clean(button.dataset.channelId);
        const info = map.get(cid);
        const count = Math.max(0, Number(info?.unreadCount || 0));
        let badge = button.querySelector(":scope > .people-unread-channel-badge");

        button.classList.toggle("people-has-unread", count > 0);

        if (!count) {
          badge?.remove();
          return;
        }

        if (!badge) {
          badge = document.createElement("span");
          badge.className = "people-unread-channel-badge";
          button.appendChild(badge);
        }

        badge.textContent = count > 99 ? "99+" : String(count);
        badge.title = count === 1
          ? "1 message non lu"
          : `${count} messages non lus`;
      });
  }

  async function fetchServerSummary(serverId) {
    const sid = clean(serverId);
    if (!sid) return null;
    try {
      const data = await api(`/api/unread/servers/${encodeURIComponent(sid)}`);
      setServerSummary(sid, data.channels || []);
      return data;
    } catch (err) {
      console.warn("[People non lus] résumé serveur", err);
      return null;
    }
  }

  function divider(label = "Nouveaux messages") {
    const el = document.createElement("div");
    el.className = "people-unread-divider";
    el.dataset.peopleUnreadDivider = "1";
    const text = document.createElement("span");
    text.textContent = label;
    el.appendChild(text);
    return el;
  }

  function removeServerDivider() {
    document
      .querySelectorAll("#messages .people-unread-divider")
      .forEach((el) => el.remove());
  }

  function placeServerDivider(info) {
    const count = Math.max(0, Number(info?.unreadCount || 0));
    if (!count) {
      removeServerDivider();
      return false;
    }

    const container = document.getElementById("messages");
    if (!container) return false;

    removeServerDivider();

    const wanted = clean(info?.firstUnreadMessageId);
    const units = Array.from(
      container.querySelectorAll("[data-message-id]")
    );
    if (!units.length) return false;

    const target =
      units.find((unit) => clean(unit.dataset.messageId) === wanted) ||
      units[0];

    const label = count > 99
      ? "Nouveaux messages • 99+"
      : count === 1
        ? "1 nouveau message"
        : `${count} nouveaux messages`;
    const el = divider(label);
    target.parentNode?.insertBefore(el, target);

    requestAnimationFrame(() => {
      el.scrollIntoView({ block: "center", behavior: "auto" });
    });
    return true;
  }

  async function markServerRead(serverId, channelId, { keepDivider = true } = {}) {
    const sid = clean(serverId);
    const cid = clean(channelId);
    if (!sid || !cid) return;

    setChannelUnread(sid, cid, 0, null);
    if (!keepDivider) removeServerDivider();

    try {
      await api(
        `/api/unread/servers/${encodeURIComponent(sid)}/channels/${encodeURIComponent(cid)}/read`,
        { method: "POST", body: "{}" }
      );
    } catch (err) {
      console.warn("[People non lus] marquage lu", err);
    }
  }

  function activeChannelInfo(serverId, channelId) {
    return serverMap(serverId, false)?.get(clean(channelId)) || null;
  }

  function scheduleServerDivider(info, token) {
    const tryPlace = () => {
      if (token !== serverDividerToken) return;
      if (placeServerDivider(info)) return;
      setTimeout(() => {
        if (token === serverDividerToken) placeServerDivider(info);
      }, 80);
    };
    requestAnimationFrame(tryPlace);
  }

  function wrapRuntime() {
    if (wrapped) return true;
    const runtime = window.PeopleServerRuntime;
    if (!runtime?.selectServer || !runtime?.selectTextChannel) return false;
    wrapped = true;

    const originalSelectServer = runtime.selectServer.bind(runtime);
    const originalSelectTextChannel = runtime.selectTextChannel.bind(runtime);
    const originalReselect = runtime.reselect?.bind(runtime);
    const originalClear = runtime.clearSelection?.bind(runtime);

    runtime.selectServer = async (server) => {
      serverDividerToken += 1;
      removeServerDivider();
      const response = await originalSelectServer(server);
      if (!response?.ok) return response;

      currentServerId = clean(server?.id || runtime.getActiveServerId?.());
      currentChannelId = clean(response.activeChannelId || runtime.getActiveTextChannelId?.());
      const summary = await fetchServerSummary(currentServerId);
      const info = (summary?.channels || []).find(
        (item) => clean(item?.channelId) === currentChannelId
      ) || activeChannelInfo(currentServerId, currentChannelId);

      const token = ++serverDividerToken;
      if (Number(info?.unreadCount || 0) > 0) {
        scheduleServerDivider(info, token);
      }
      await markServerRead(currentServerId, currentChannelId, { keepDivider: true });
      return response;
    };

    runtime.selectTextChannel = async (channelId) => {
      serverDividerToken += 1;
      removeServerDivider();
      const response = await originalSelectTextChannel(channelId);
      if (!response?.ok) return response;

      currentServerId = clean(runtime.getActiveServerId?.());
      currentChannelId = clean(response.activeChannelId || channelId);
      const summary = await fetchServerSummary(currentServerId);
      const info = (summary?.channels || []).find(
        (item) => clean(item?.channelId) === currentChannelId
      ) || activeChannelInfo(currentServerId, currentChannelId);

      const token = ++serverDividerToken;
      if (Number(info?.unreadCount || 0) > 0) {
        scheduleServerDivider(info, token);
      }
      await markServerRead(currentServerId, currentChannelId, { keepDivider: true });
      return response;
    };

    if (originalReselect) {
      runtime.reselect = async (...args) => {
        const result = await originalReselect(...args);
        currentServerId = clean(runtime.getActiveServerId?.());
        currentChannelId = clean(runtime.getActiveTextChannelId?.());
        if (currentServerId) {
          await fetchServerSummary(currentServerId);
          if (currentChannelId && document.visibilityState === "visible") {
            await markServerRead(currentServerId, currentChannelId, { keepDivider: false });
          }
        }
        return result;
      };
    }

    if (originalClear) {
      runtime.clearSelection = (...args) => {
        serverDividerToken += 1;
        removeServerDivider();
        currentServerId = "";
        currentChannelId = "";
        return originalClear(...args);
      };
    }

    return true;
  }

  function parseVisibleUnreadCount(row) {
    const badge = row?.querySelector?.(".dm-unread-badge");
    if (!badge) return 0;
    const text = clean(badge.textContent);
    if (!text) return 0;
    if (text.includes("99")) return 99;
    return Math.max(0, Number.parseInt(text, 10) || 0);
  }

  function removeDmDivider() {
    document
      .querySelectorAll("#dmMessages .people-unread-divider")
      .forEach((el) => el.remove());
  }

  function placeDmDivider() {
    const state = dmDividerState;
    if (!state || Date.now() > state.expiresAt) return false;
    const container = document.getElementById("dmMessages");
    if (!container) return false;

    const active = document.querySelector(".dm-conversation-row.active");
    if (
      state.username &&
      clean(active?.dataset?.username).toLocaleLowerCase("fr-FR") !==
        state.username.toLocaleLowerCase("fr-FR")
    ) {
      return false;
    }

    const incoming = [];
    container.querySelectorAll(".dm-message:not(.mine)").forEach((row) => {
      row.querySelectorAll(".people-message-unit").forEach((unit) => incoming.push(unit));
    });

    if (!incoming.length) return false;

    const count = Math.max(1, Number(state.count || 1));
    const index = Math.max(0, incoming.length - count);
    const target = incoming[index];
    if (!target) return false;

    const existing = container.querySelector(".people-unread-divider");
    if (existing && existing.nextElementSibling === target) return true;
    removeDmDivider();

    const label = count >= 99
      ? "Nouveaux messages"
      : count === 1
        ? "1 nouveau message"
        : `${count} nouveaux messages`;
    const el = divider(label);
    target.parentNode?.insertBefore(el, target);

    requestAnimationFrame(() => {
      el.scrollIntoView({ block: "center", behavior: "auto" });
    });
    return true;
  }

  function scheduleDmDivider() {
    if (!dmDividerState) return;
    clearTimeout(dmDividerState.timer);
    dmDividerState.timer = setTimeout(() => {
      if (placeDmDivider()) return;
      setTimeout(placeDmDivider, 100);
    }, 25);
  }

  function bindDmUnread() {
    const list = document.getElementById("dmConversationList");
    const container = document.getElementById("dmMessages");
    if (!list || !container) return;

    list.addEventListener(
      "click",
      (event) => {
        const row = event.target?.closest?.(".dm-conversation-row");
        if (!row) return;
        removeDmDivider();
        const count = parseVisibleUnreadCount(row);
        if (!count) {
          dmDividerState = null;
          return;
        }
        dmDividerState = {
          username: clean(row.dataset.username),
          count,
          expiresAt: Date.now() + 4000,
          timer: null
        };
        scheduleDmDivider();
      },
      true
    );

    dmObserver = new MutationObserver(() => scheduleDmDivider());
    dmObserver.observe(container, { childList: true, subtree: true });
  }

  function bindServerTree() {
    const tree = document.getElementById("peopleServerChannelTree");
    if (!tree) return;
    treeObserver = new MutationObserver(() => scheduleRenderBadges());
    treeObserver.observe(tree, { childList: true, subtree: true });
  }

  function bindSocket() {
    if (socketBound) return true;
    const socket = window.peopleSocket;
    if (!socket?.on) return false;
    socketBound = true;

    socket.on("chat-message", (data = {}) => {
      const sid = clean(data.serverId);
      const cid = clean(data.channelId);
      if (!sid || !cid) return;

      const activeSid = clean(window.PeopleServerRuntime?.getActiveServerId?.());
      const activeCid = clean(window.PeopleServerRuntime?.getActiveTextChannelId?.());
      const visible = document.visibilityState === "visible" && document.hasFocus();

      if (sid === activeSid && cid === activeCid && visible) {
        setChannelUnread(sid, cid, 0, null);
        setTimeout(() => {
          void markServerRead(sid, cid, { keepDivider: false });
        }, 80);
        return;
      }

      bumpChannelUnread(sid, cid, data.id);

      if (sid === activeSid && cid === activeCid) {
        setTimeout(() => {
          const info = activeChannelInfo(sid, cid);
          if (Number(info?.unreadCount || 0) > 0) {
            placeServerDivider(info);
          }
        }, 90);
      }
    });

    return true;
  }

  function markVisibleActiveServerRead() {
    if (document.visibilityState !== "visible") return;
    const sid = clean(window.PeopleServerRuntime?.getActiveServerId?.());
    const cid = clean(window.PeopleServerRuntime?.getActiveTextChannelId?.());
    if (!sid || !cid) return;
    const hasDivider = Boolean(
      document.querySelector("#messages .people-unread-divider")
    );
    void markServerRead(sid, cid, { keepDivider: hasDivider });
  }

  window.addEventListener("people-server-channel-state", (event) => {
    const detail = event.detail || {};
    currentServerId = clean(detail.serverId || currentServerId);
    currentChannelId = clean(detail.activeTextChannelId || currentChannelId);
    scheduleRenderBadges();
  });

  document.addEventListener("visibilitychange", markVisibleActiveServerRead);
  window.addEventListener("focus", markVisibleActiveServerRead);

  function boot() {
    bindDmUnread();
    bindServerTree();

    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const runtimeReady = wrapRuntime();
      const socketReady = bindSocket();
      if ((runtimeReady && socketReady) || tries > 120) {
        clearInterval(timer);
      }
    }, 50);

    if (wrapRuntime()) {
      bindSocket();
    }

    console.log(`[People] ${VERSION} prêt.`);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
