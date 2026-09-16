(() => {
  "use strict";

  // === PEOPLE_NOTIFICATION_PREFS_CLIENT_V1_START ===

  const STORAGE_PREFIX = "people-notification-prefs-v1:";
  const SAVE_DELAY = 350;

  const MODE_OPTIONS = [
    ["inherit", "Hériter"],
    ["all", "Tous les messages"],
    ["mentions", "Mentions seulement"],
    ["none", "Rien"]
  ];

  const DEFAULT_MODE_OPTIONS = [
    ["all", "Tous les messages"],
    ["mentions", "Mentions seulement"],
    ["none", "Rien"]
  ];

  const SOUND_OPTIONS = [
    ["inherit", "Son global People"],
    ["classic", "People classique"],
    ["soft", "Doux"],
    ["digital", "Digital"],
    ["pop", "Pop"],
    ["silent", "Silencieux"]
  ];

  const MUTE_OPTIONS = [
    [15 * 60 * 1000, "15 min"],
    [60 * 60 * 1000, "1 h"],
    [8 * 60 * 60 * 1000, "8 h"],
    [24 * 60 * 60 * 1000, "24 h"],
    [7 * 24 * 60 * 60 * 1000, "7 jours"]
  ];

  const DEFAULT_PREFS = Object.freeze({
    version: 1,
    defaults: {
      dm: { mode: "all", sound: "inherit" },
      server: { mode: "mentions", sound: "inherit" }
    },
    dms: {},
    servers: {},
    channels: {}
  });

  let accountId = "";
  let prefs = clone(DEFAULT_PREFS);
  let saveTimer = null;
  let dirty = false;
  let modal = null;
  let currentScope = null;
  let contextTarget = null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cleanMode(value, fallback = "inherit") {
    const mode = String(value || "").trim().toLowerCase();
    return ["inherit", "all", "mentions", "none"].includes(mode)
      ? mode
      : fallback;
  }

  function cleanSound(value, fallback = "inherit") {
    const sound = String(value || "").trim().toLowerCase();
    return ["inherit", "classic", "soft", "digital", "pop", "silent"].includes(sound)
      ? sound
      : fallback;
  }

  function cleanMute(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > Date.now() ? n : null;
  }

  function cleanOverride(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      mode: cleanMode(source.mode, "inherit"),
      sound: cleanSound(source.sound, "inherit"),
      mutedUntil: cleanMute(source.mutedUntil)
    };
  }

  function cleanMap(value, limit = 1200) {
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
    const out = {};
    let count = 0;
    for (const [rawKey, rawValue] of Object.entries(source)) {
      if (count >= limit) break;
      const key = String(rawKey || "").trim();
      if (!key || key.length > 120) continue;
      out[key] = cleanOverride(rawValue);
      count += 1;
    }
    return out;
  }

  function normalize(value) {
    const source = value && typeof value === "object" ? value : {};
    const defaults = source.defaults && typeof source.defaults === "object"
      ? source.defaults
      : {};
    const dm = defaults.dm && typeof defaults.dm === "object" ? defaults.dm : {};
    const server = defaults.server && typeof defaults.server === "object" ? defaults.server : {};

    const dmMode = cleanMode(dm.mode, "all");
    const serverMode = cleanMode(server.mode, "mentions");

    return {
      version: 1,
      defaults: {
        dm: {
          mode: dmMode === "inherit" ? "all" : dmMode,
          sound: cleanSound(dm.sound, "inherit")
        },
        server: {
          mode: serverMode === "inherit" ? "mentions" : serverMode,
          sound: cleanSound(server.sound, "inherit")
        }
      },
      dms: cleanMap(source.dms, 300),
      servers: cleanMap(source.servers, 300),
      channels: cleanMap(source.channels, 1200)
    };
  }

  function dmKey(username) {
    return String(username || "").normalize("NFKC").trim().toLocaleLowerCase("fr-FR");
  }

  function storageKey() {
    return STORAGE_PREFIX + (accountId || "session");
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (raw) prefs = normalize(JSON.parse(raw));
    } catch {}
  }

  function saveLocal() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(prefs));
    } catch {}
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
    if (!response.ok) {
      const error = new Error(data?.error || `Erreur HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function syncFromServer() {
    try {
      const data = await api("/api/notification-preferences");
      if (data?.prefs) {
        prefs = normalize(data.prefs);
        saveLocal();
        refreshUi();
        decorateMuted();
      }
      dirty = false;
      return true;
    } catch (error) {
      if (error?.status !== 401) {
        console.warn("[People notification prefs] Chargement serveur impossible", error);
      }
      return false;
    }
  }

  async function pushToServer() {
    if (!dirty) return true;
    if (!navigator.onLine) return false;

    try {
      const data = await api("/api/notification-preferences", {
        method: "PUT",
        body: JSON.stringify({ prefs })
      });
      if (data?.prefs) prefs = normalize(data.prefs);
      saveLocal();
      dirty = false;
      refreshUi();
      decorateMuted();
      return true;
    } catch (error) {
      console.warn("[People notification prefs] Sauvegarde serveur impossible", error);
      return false;
    }
  }

  function scheduleSave() {
    prefs = normalize(prefs);
    dirty = true;
    saveLocal();
    refreshUi();
    decorateMuted();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void pushToServer(), SAVE_DELAY);
  }

  async function attachAccount(id) {
    const next = String(id || "").trim();
    if (!next || next === accountId) {
      if (next) await syncFromServer();
      return;
    }

    accountId = next;
    prefs = clone(DEFAULT_PREFS);
    loadLocal();
    refreshUi();
    decorateMuted();
    await syncFromServer();
  }

  function activeMute(value) {
    const until = cleanMute(value);
    return until && until > Date.now() ? until : null;
  }

  function applyOverride(base, override) {
    const next = { ...base };
    if (!override) return next;
    if (override.mode && override.mode !== "inherit") next.mode = override.mode;
    if (override.sound && override.sound !== "inherit") next.sound = override.sound;
    const mute = activeMute(override.mutedUntil);
    if (mute) next.mutedUntil = Math.max(Number(next.mutedUntil || 0), mute);
    return next;
  }

  function resolved(scope = {}) {
    const kind = String(scope.kind || "");

    if (kind === "dm") {
      let out = {
        mode: prefs.defaults.dm.mode,
        sound: prefs.defaults.dm.sound,
        mutedUntil: null
      };
      out = applyOverride(out, prefs.dms[dmKey(scope.username)]);
      return out;
    }

    let out = {
      mode: prefs.defaults.server.mode,
      sound: prefs.defaults.server.sound,
      mutedUntil: null
    };

    const serverId = String(scope.serverId || "").trim();
    const channelId = String(scope.channelId || "").trim();
    if (serverId) out = applyOverride(out, prefs.servers[serverId]);
    if (channelId) out = applyOverride(out, prefs.channels[channelId]);
    return out;
  }

  function decide(scope = {}) {
    const config = resolved(scope);
    const muted = Boolean(activeMute(config.mutedUntil));
    const mentioned = Boolean(scope.mentioned);
    const allowed = !muted && (
      config.mode === "all" ||
      (config.mode === "mentions" && mentioned)
    );

    return {
      allowed,
      muted,
      mode: config.mode,
      sound: config.sound || "inherit"
    };
  }

  function scopeMap(scope) {
    if (scope.kind === "dm") return [prefs.dms, dmKey(scope.username)];
    if (scope.kind === "server") return [prefs.servers, String(scope.serverId || "")];
    return [prefs.channels, String(scope.channelId || "")];
  }

  function getOverride(scope) {
    const [map, key] = scopeMap(scope);
    return cleanOverride(map[key]);
  }

  function setOverride(scope, patch) {
    const [map, key] = scopeMap(scope);
    if (!key) return;
    map[key] = cleanOverride({ ...map[key], ...patch });
    scheduleSave();
  }

  function clearOverride(scope) {
    const [map, key] = scopeMap(scope);
    if (!key) return;
    delete map[key];
    scheduleSave();
  }

  function muteLabel(until) {
    const value = activeMute(until);
    if (!value) return "Pas en sourdine";
    const delta = value - Date.now();
    if (delta < 60 * 60 * 1000) return `Sourdine encore ${Math.max(1, Math.ceil(delta / 60000))} min`;
    if (delta < 24 * 60 * 60 * 1000) return `Sourdine encore ${Math.ceil(delta / 3600000)} h`;
    return `Sourdine jusqu'au ${new Date(value).toLocaleString("fr-FR")}`;
  }

  function optionMarkup(options, selected) {
    return options.map(([value, label]) =>
      `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`
    ).join("");
  }

  function ensureModal() {
    if (modal?.isConnected) return modal;

    modal = document.createElement("div");
    modal.className = "people-notif-modal hidden";
    modal.innerHTML = `
      <div class="people-notif-backdrop" data-notif-close="1"></div>
      <section class="people-notif-card" role="dialog" aria-modal="true" aria-label="Notifications">
        <button class="people-notif-close" type="button" data-notif-close="1">✕</button>
        <div class="people-notif-head">
          <span>NOTIFICATIONS</span>
          <h2 id="peopleNotifTitle">Notifications</h2>
          <p id="peopleNotifSubtitle"></p>
        </div>
        <label class="people-notif-field">
          <span>Recevoir</span>
          <select id="peopleNotifMode"></select>
        </label>
        <label class="people-notif-field">
          <span>Son</span>
          <div class="people-notif-sound-row">
            <select id="peopleNotifSound"></select>
            <button id="peopleNotifPreview" type="button">▶ Tester</button>
          </div>
        </label>
        <div class="people-notif-field">
          <span>Sourdine temporaire</span>
          <small id="peopleNotifMuteStatus"></small>
          <div class="people-notif-mute-grid" id="peopleNotifMuteGrid"></div>
        </div>
        <div class="people-notif-actions">
          <button id="peopleNotifReset" class="people-notif-secondary" type="button">Réinitialiser l'exception</button>
          <button class="people-notif-primary" type="button" data-notif-close="1">Terminé</button>
        </div>
      </section>
    `;
    document.body.appendChild(modal);

    modal.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest("[data-notif-close='1']")) closeDialog();
    });

    modal.querySelector("#peopleNotifMode")?.addEventListener("change", (event) => {
      if (!currentScope) return;
      setOverride(currentScope, { mode: event.target.value });
      renderDialog();
    });

    modal.querySelector("#peopleNotifSound")?.addEventListener("change", (event) => {
      if (!currentScope) return;
      setOverride(currentScope, { sound: event.target.value });
      renderDialog();
    });

    modal.querySelector("#peopleNotifPreview")?.addEventListener("click", () => {
      if (!currentScope) return;
      const sound = resolved(currentScope).sound;
      if (sound === "silent") return;
      window.PeopleSounds?.playNotification?.(sound === "inherit" ? "" : sound);
    });

    modal.querySelector("#peopleNotifReset")?.addEventListener("click", () => {
      if (!currentScope) return;
      clearOverride(currentScope);
      renderDialog();
    });

    const muteGrid = modal.querySelector("#peopleNotifMuteGrid");
    for (const [duration, label] of MUTE_OPTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => {
        if (!currentScope) return;
        setOverride(currentScope, { mutedUntil: Date.now() + duration });
        renderDialog();
      });
      muteGrid.appendChild(button);
    }

    const clearMute = document.createElement("button");
    clearMute.type = "button";
    clearMute.textContent = "Retirer";
    clearMute.className = "people-notif-unmute";
    clearMute.addEventListener("click", () => {
      if (!currentScope) return;
      setOverride(currentScope, { mutedUntil: null });
      renderDialog();
    });
    muteGrid.appendChild(clearMute);

    return modal;
  }

  function renderDialog() {
    if (!currentScope) return;
    const box = ensureModal();
    const override = getOverride(currentScope);
    const effective = resolved(currentScope);

    box.querySelector("#peopleNotifTitle").textContent = currentScope.label || "Notifications";
    box.querySelector("#peopleNotifSubtitle").textContent =
      currentScope.kind === "dm"
        ? "Réglages pour cette conversation privée."
        : currentScope.kind === "server"
          ? "Réglages pour tout ce serveur. Les salons peuvent avoir leur propre exception."
          : "Réglages pour ce salon. Ils remplacent ceux du serveur.";

    box.querySelector("#peopleNotifMode").innerHTML = optionMarkup(MODE_OPTIONS, override.mode);
    box.querySelector("#peopleNotifSound").innerHTML = optionMarkup(SOUND_OPTIONS, override.sound);
    box.querySelector("#peopleNotifMuteStatus").textContent = muteLabel(effective.mutedUntil);

    const reset = box.querySelector("#peopleNotifReset");
    reset.disabled = !(
      override.mode !== "inherit" ||
      override.sound !== "inherit" ||
      activeMute(override.mutedUntil)
    );
  }

  function openDialog(scope) {
    currentScope = { ...scope };
    const box = ensureModal();
    renderDialog();
    box.classList.remove("hidden");
    document.documentElement.classList.add("people-notif-open");
  }

  function closeDialog() {
    modal?.classList.add("hidden");
    document.documentElement.classList.remove("people-notif-open");
    currentScope = null;
  }

  function injectSettings() {
    const settings = document.getElementById("peopleSettingsModal");
    if (!settings) return false;
    if (settings.querySelector("[data-settings-tab='notifications-v9']")) return true;

    const nav = settings.querySelector(".people-settings-nav");
    const content = settings.querySelector(".people-settings-content");
    if (!nav || !content) return false;

    const tab = document.createElement("button");
    tab.className = "people-settings-tab";
    tab.type = "button";
    tab.dataset.settingsTab = "notifications-v9";
    tab.innerHTML = "<span>🔔</span>Notifications";
    nav.appendChild(tab);

    const page = document.createElement("section");
    page.className = "people-settings-page people-notif-settings-page";
    page.dataset.settingsPage = "notifications-v9";
    page.innerHTML = `
      <div class="people-settings-page-head">
        <span>NOTIFICATIONS</span>
        <h2>Notifications</h2>
        <p>Choisis ce qui te prévient. Les exceptions se règlent aussi avec clic droit sur un MP, un serveur ou un salon.</p>
      </div>
      <div class="people-settings-section people-notif-settings-section">
        <div class="people-settings-section-title"><div><strong>Notifications système</strong><span id="peopleNotifPermissionText">Vérification…</span></div></div>
        <button id="peopleNotifPermissionButton" class="people-settings-secondary" type="button">Autoriser les notifications</button>
      </div>
      <div class="people-settings-section people-notif-settings-section">
        <div class="people-settings-section-title"><div><strong>Messages privés — valeur par défaut</strong><span>S'applique aux MP sans exception individuelle.</span></div></div>
        <div class="people-notif-default-grid">
          <label><span>Recevoir</span><select id="peopleNotifDefaultDmMode"></select></label>
          <label><span>Son</span><select id="peopleNotifDefaultDmSound"></select></label>
        </div>
      </div>
      <div class="people-settings-section people-notif-settings-section">
        <div class="people-settings-section-title"><div><strong>Serveurs — valeur par défaut</strong><span>Les réglages d'un serveur, puis d'un salon, prennent priorité.</span></div></div>
        <div class="people-notif-default-grid">
          <label><span>Recevoir</span><select id="peopleNotifDefaultServerMode"></select></label>
          <label><span>Son</span><select id="peopleNotifDefaultServerSound"></select></label>
        </div>
      </div>
      <div class="people-settings-section people-notif-settings-section">
        <div class="people-settings-section-title"><div><strong>Exceptions</strong><span>Réinitialise tous les réglages spécifiques MP / serveurs / salons.</span></div></div>
        <button id="peopleNotifResetAll" class="people-settings-secondary" type="button">Réinitialiser toutes les exceptions</button>
      </div>
    `;

    content.appendChild(page);

    const bindDefault = (selector, getter, setter) => {
      const select = page.querySelector(selector);
      select.addEventListener("change", () => {
        setter(select.value);
        scheduleSave();
      });
      return select;
    };

    bindDefault(
      "#peopleNotifDefaultDmMode",
      () => prefs.defaults.dm.mode,
      (value) => { prefs.defaults.dm.mode = cleanMode(value, "all"); }
    );
    bindDefault(
      "#peopleNotifDefaultDmSound",
      () => prefs.defaults.dm.sound,
      (value) => { prefs.defaults.dm.sound = cleanSound(value, "inherit"); }
    );
    bindDefault(
      "#peopleNotifDefaultServerMode",
      () => prefs.defaults.server.mode,
      (value) => { prefs.defaults.server.mode = cleanMode(value, "mentions"); }
    );
    bindDefault(
      "#peopleNotifDefaultServerSound",
      () => prefs.defaults.server.sound,
      (value) => { prefs.defaults.server.sound = cleanSound(value, "inherit"); }
    );

    page.querySelector("#peopleNotifPermissionButton")?.addEventListener("click", async () => {
      try {
        await window.PeopleNotifications?.request?.();
      } catch {}
      refreshUi();
    });

    page.querySelector("#peopleNotifResetAll")?.addEventListener("click", () => {
      if (!confirm("Réinitialiser toutes les exceptions de notifications ?")) return;
      prefs.dms = {};
      prefs.servers = {};
      prefs.channels = {};
      scheduleSave();
    });

    refreshUi();
    return true;
  }

  function permissionText() {
    const permission = window.PeopleNotifications?.permission;
    if (permission === "desktop-native") return "Gérées par l'application de bureau.";
    if (permission === "granted") return "Autorisées sur cet appareil.";
    if (permission === "denied") return "Bloquées par le navigateur / système.";
    if (permission === "unsupported") return "Non prises en charge dans cet environnement.";
    return "Autorisation nécessaire pour les notifications système.";
  }

  function refreshUi() {
    const settings = document.getElementById("peopleSettingsModal");
    if (!settings) return;

    const dmMode = settings.querySelector("#peopleNotifDefaultDmMode");
    const dmSound = settings.querySelector("#peopleNotifDefaultDmSound");
    const serverMode = settings.querySelector("#peopleNotifDefaultServerMode");
    const serverSound = settings.querySelector("#peopleNotifDefaultServerSound");
    const permission = settings.querySelector("#peopleNotifPermissionText");

    if (dmMode) dmMode.innerHTML = optionMarkup(DEFAULT_MODE_OPTIONS, prefs.defaults.dm.mode);
    if (dmSound) dmSound.innerHTML = optionMarkup(SOUND_OPTIONS, prefs.defaults.dm.sound);
    if (serverMode) serverMode.innerHTML = optionMarkup(DEFAULT_MODE_OPTIONS, prefs.defaults.server.mode);
    if (serverSound) serverSound.innerHTML = optionMarkup(SOUND_OPTIONS, prefs.defaults.server.sound);
    if (permission) permission.textContent = permissionText();
  }

  function mutedForScope(scope) {
    return Boolean(activeMute(resolved(scope).mutedUntil));
  }

  function setMutedBadge(element, muted) {
    if (!element) return;
    let badge = element.querySelector(":scope > .people-notif-muted-badge");
    if (muted && !badge) {
      badge = document.createElement("span");
      badge.className = "people-notif-muted-badge";
      badge.textContent = "🔕";
      badge.title = "Notifications en sourdine";
      element.appendChild(badge);
    } else if (!muted && badge) {
      badge.remove();
    }
  }

  function decorateMuted() {
    for (const row of document.querySelectorAll(".dm-conversation-row[data-username]")) {
      setMutedBadge(row, mutedForScope({ kind: "dm", username: row.dataset.username }));
    }

    for (const button of document.querySelectorAll(".dynamic-server-button[data-server-id]")) {
      setMutedBadge(button, mutedForScope({ kind: "server", serverId: button.dataset.serverId }));
    }

    const channelState = window.PeopleServerChannels?.getState?.();
    const serverId = String(channelState?.serverId || window.PeopleServers?.getActiveServer?.()?.id || "");
    for (const button of document.querySelectorAll(".people-server-channel[data-channel-id]")) {
      setMutedBadge(button, mutedForScope({
        kind: "channel",
        serverId,
        channelId: button.dataset.channelId
      }));
    }
  }

  function scopeFromContextTarget(target) {
    const dm = target?.closest?.(".dm-conversation-row[data-username]");
    if (dm) {
      return {
        kind: "dm",
        username: dm.dataset.username,
        label: `MP — ${dm.dataset.username}`,
        menuSelector: ".people-dm-context-menu",
        itemClass: "people-dm-context-item"
      };
    }

    const server = target?.closest?.(".dynamic-server-button[data-server-id]");
    if (server) {
      return {
        kind: "server",
        serverId: server.dataset.serverId,
        label: `Serveur — ${server.title || "Serveur"}`,
        menuSelector: ".people-server-context-menu",
        itemClass: "people-server-context-item"
      };
    }

    const channel = target?.closest?.(".people-server-channel[data-channel-id]");
    if (channel) {
      const state = window.PeopleServerChannels?.getState?.();
      const serverId = String(state?.serverId || window.PeopleServers?.getActiveServer?.()?.id || "");
      const name = channel.querySelector(".people-server-channel-name")?.textContent?.trim() || "salon";
      return {
        kind: "channel",
        serverId,
        channelId: channel.dataset.channelId,
        label: `Salon — #${name}`,
        menuSelector: ".people-channel-context-menu",
        itemClass: "people-channel-menu-item"
      };
    }

    return null;
  }

  function positionMenu(menu, x, y) {
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
  }

  function attachContextAction(scope, x, y) {
    let menu = document.querySelector(scope.menuSelector);

    if (!menu && scope.kind === "channel") {
      menu = document.createElement("div");
      menu.className = "people-channel-context-menu people-notif-owned-menu";
      positionMenu(menu, x, y);
    }

    if (!menu || menu.querySelector(".people-notif-context-action")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = `${scope.itemClass} people-notif-context-action`;
    button.textContent = mutedForScope(scope)
      ? "🔕 Notifications (sourdine)"
      : "🔔 Notifications";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      menu.remove();
      openDialog(scope);
    });

    if (scope.kind === "dm") {
      menu.prepend(button);
    } else {
      menu.appendChild(button);
    }
  }

  document.addEventListener(
    "contextmenu",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const scope = scopeFromContextTarget(target);
      if (!scope) return;
      event.preventDefault();
      contextTarget = scope;
      const x = event.clientX;
      const y = event.clientY;
      setTimeout(() => {
        if (contextTarget !== scope) return;
        attachContextAction(scope, x, y);
      }, 0);
    },
    true
  );

  document.addEventListener("pointerdown", (event) => {
    const owned = document.querySelector(".people-notif-owned-menu");
    if (owned && !owned.contains(event.target)) owned.remove();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.querySelector(".people-notif-owned-menu")?.remove();
      closeDialog();
    }
  });

  const observer = new MutationObserver(() => {
    injectSettings();
    decorateMuted();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("people-authenticated", (event) => {
    void attachAccount(event.detail?.id);
  });

  window.addEventListener("online", () => {
    void pushToServer();
    void syncFromServer();
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey() || !event.newValue) return;
    try {
      prefs = normalize(JSON.parse(event.newValue));
      refreshUi();
      decorateMuted();
    } catch {}
  });

  window.PeopleNotificationPrefs = {
    decide,
    resolved,
    open: openDialog,
    get prefs() {
      return clone(prefs);
    },
    refresh: syncFromServer,
    save: pushToServer
  };

  injectSettings();
  decorateMuted();

  fetch("/api/auth/me", { credentials: "same-origin" })
    .then((response) => response.ok ? response.json() : null)
    .then((data) => {
      if (data?.user?.id) void attachAccount(data.user.id);
    })
    .catch(() => {});

  // === PEOPLE_NOTIFICATION_PREFS_CLIENT_V1_END ===
})();
