(() => {
  "use strict";

  const peopleSocket =
    (typeof socket !== "undefined" && socket) ||
    window.peopleSocket ||
    null;

  if (!peopleSocket) {
    console.error("[People extras] Socket.IO introuvable.");
    return;
  }

  const audioContainer = document.getElementById("audioContainer");
  const joinForm = document.getElementById("joinForm");
  const profileName = document.getElementById("profileName");
  const messages = document.getElementById("messages");
  const voiceUsers = document.getElementById("voiceUsers");

  let latestRoster = [];
  let pingAudioContext = null;

  // Cache mémoire : évite JSON.parse(localStorage) à chaque refresh / mouvement de slider.
  const prefCache = new Map();
  const pendingPrefWrites = new Map();

  let pendingRoster = null;
  let rosterRenderTimer = 0;
  let prefsApplyFrame = 0;

  let cachedMentionName = "";
  let cachedMentionRegex = null;

  let audioUnlockBound = false;

  function currentUsername() {
    const name = (profileName?.textContent || "").trim();
    return name && name !== "Invité" ? name : "";
  }

  function normalizeName(displayName) {
    return String(displayName || "").trim().toLowerCase();
  }

  function prefKey(displayName) {
    return `people-local-audio:${normalizeName(displayName)}`;
  }

  function sanitizePref(pref) {
    return {
      volume: Math.max(0, Math.min(100, Number(pref?.volume ?? 100))),
      muted: Boolean(pref?.muted)
    };
  }

  function loadPref(displayName) {
    const key = normalizeName(displayName);
    if (!key) return { volume: 100, muted: false };

    const cached = prefCache.get(key);
    if (cached) return cached;

    let pref = { volume: 100, muted: false };

    try {
      const raw = localStorage.getItem(prefKey(displayName));
      if (raw) pref = sanitizePref(JSON.parse(raw));
    } catch {}

    prefCache.set(key, pref);
    return pref;
  }

  function writePref(displayName) {
    const key = normalizeName(displayName);
    if (!key) return;

    const pref = prefCache.get(key);
    if (!pref) return;

    try {
      localStorage.setItem(prefKey(displayName), JSON.stringify(pref));
    } catch {}
  }

  function savePref(displayName, pref, { immediate = false } = {}) {
    const key = normalizeName(displayName);
    if (!key) return;

    prefCache.set(key, sanitizePref(pref));

    const oldTimer = pendingPrefWrites.get(key);
    if (oldTimer) {
      clearTimeout(oldTimer);
      pendingPrefWrites.delete(key);
    }

    if (immediate) {
      writePref(displayName);
      return;
    }

    // Un slider peut émettre énormément de "input". On regroupe les écritures disque.
    const timer = setTimeout(() => {
      pendingPrefWrites.delete(key);
      writePref(displayName);
    }, 160);

    pendingPrefWrites.set(key, timer);
  }

  function flushPref(displayName) {
    const key = normalizeName(displayName);
    if (!key) return;

    const timer = pendingPrefWrites.get(key);
    if (timer) {
      clearTimeout(timer);
      pendingPrefWrites.delete(key);
    }

    writePref(displayName);
  }

  function audioForPeer(peerId) {
    return document.getElementById(`audio-${peerId}`);
  }

  function applyPref(user) {
    if (!user || user.id === peopleSocket.id) return;

    const pref = loadPref(user.username);
    const audio = audioForPeer(user.id);
    if (!audio) return;

    const nextVolume = pref.volume / 100;
    if (audio.volume !== nextVolume) audio.volume = nextVolume;
    if (audio.muted !== pref.muted) audio.muted = pref.muted;
  }

  function applyAllPrefs() {
    for (const user of latestRoster) applyPref(user);
  }

  function scheduleApplyAllPrefs() {
    if (prefsApplyFrame) return;

    prefsApplyFrame = requestAnimationFrame(() => {
      prefsApplyFrame = 0;
      applyAllPrefs();
    });
  }

  function updateControlsUi(controls, user) {
    if (!controls || !user) return;

    const pref = loadPref(user.username);
    const mute = controls.querySelector(".people-local-mute");
    const range = controls.querySelector(".people-local-volume");
    const percent = controls.querySelector(".people-local-volume-value");

    if (mute) {
      const nextText = pref.muted ? "🔇" : "🔊";
      if (mute.textContent !== nextText) mute.textContent = nextText;
      mute.classList.toggle("is-muted", pref.muted);
    }

    if (range && range.value !== String(pref.volume)) {
      range.value = String(pref.volume);
    }

    if (percent) {
      const nextText = `${Math.round(pref.volume)}%`;
      if (percent.textContent !== nextText) percent.textContent = nextText;
    }

    applyPref(user);
  }

  function createControls(user) {
    const controls = document.createElement("div");
    controls.className = "people-local-audio-controls";
    controls.title = "Ce réglage ne change le son que pour toi";

    const mute = document.createElement("button");
    mute.type = "button";
    mute.className = "people-local-mute";

    const range = document.createElement("input");
    range.type = "range";
    range.className = "people-local-volume";
    range.min = "0";
    range.max = "100";
    range.step = "1";

    const percent = document.createElement("span");
    percent.className = "people-local-volume-value";

    controls.append(mute, range, percent);
    bindControlsToUser(controls, user);
    return controls;
  }

  function bindControlsToUser(controls, user) {
    controls.dataset.peopleLocalPeerId = String(user.id ?? "");
    controls.dataset.peopleLocalUsername = String(user.username ?? "");
    controls.dataset.peopleLocalUsernameKey = normalizeName(user.username);

    const mute = controls.querySelector(".people-local-mute");
    const range = controls.querySelector(".people-local-volume");

    if (mute) {
      mute.setAttribute("aria-label", `Mute local de ${user.username}`);
    }
    if (range) {
      range.setAttribute("aria-label", `Volume local de ${user.username}`);
    }

    updateControlsUi(controls, user);
  }

  function renderLocalControls(roster) {
    latestRoster = Array.isArray(roster) ? roster : [];

    const rows = voiceUsers
      ? [...voiceUsers.querySelectorAll(".voice-user")]
      : [...document.querySelectorAll("#voiceUsers .voice-user")];

    latestRoster.forEach((user, index) => {
      const row = rows[index];
      if (!row) return;

      const existing = row.querySelector(".people-local-audio-controls");

      if (user.id === peopleSocket.id) {
        existing?.remove();
        return;
      }

      const userKey = normalizeName(user.username);
      let controls = existing;

      // Réutilise le contrôle existant tant qu'il représente toujours le même pair.
      if (
        !controls ||
        controls.dataset.peopleLocalPeerId !== String(user.id ?? "") ||
        controls.dataset.peopleLocalUsernameKey !== userKey
      ) {
        controls?.remove();
        controls = createControls(user);
        row.appendChild(controls);
      } else {
        bindControlsToUser(controls, user);
      }
    });

    scheduleApplyAllPrefs();
  }

  function scheduleRosterRender(roster) {
    pendingRoster = Array.isArray(roster) ? roster : [];

    if (rosterRenderTimer) return;

    // Laisse le gestionnaire principal reconstruire les lignes, mais fusionne
    // plusieurs voice-state arrivés dans la même rafale.
    rosterRenderTimer = setTimeout(() => {
      rosterRenderTimer = 0;
      const rosterToRender = pendingRoster;
      pendingRoster = null;
      renderLocalControls(rosterToRender);
    }, 0);
  }

  function userFromControls(controls) {
    if (!controls) return null;

    return {
      id: controls.dataset.peopleLocalPeerId || "",
      username: controls.dataset.peopleLocalUsername || ""
    };
  }

  if (voiceUsers) {
    // Un seul gestionnaire pour tous les sliders.
    voiceUsers.addEventListener("input", (event) => {
      const range = event.target.closest?.(".people-local-volume");
      if (!range || !voiceUsers.contains(range)) return;

      event.stopPropagation();

      const controls = range.closest(".people-local-audio-controls");
      const user = userFromControls(controls);
      if (!user?.username) return;

      const pref = { ...loadPref(user.username), volume: Number(range.value) };
      savePref(user.username, pref);
      updateControlsUi(controls, user);
    });

    voiceUsers.addEventListener("change", (event) => {
      const range = event.target.closest?.(".people-local-volume");
      if (!range || !voiceUsers.contains(range)) return;

      const controls = range.closest(".people-local-audio-controls");
      const user = userFromControls(controls);
      if (user?.username) flushPref(user.username);
    });

    // Capture : bloque le clic avant qu'une éventuelle ligne vocale le traite.
    voiceUsers.addEventListener(
      "click",
      (event) => {
        const mute = event.target.closest?.(".people-local-mute");
        const range = event.target.closest?.(".people-local-volume");
        if (!mute && !range) return;

        event.stopPropagation();

        if (!mute) return;

        event.preventDefault();

        const controls = mute.closest(".people-local-audio-controls");
        const user = userFromControls(controls);
        if (!user?.username) return;

        const pref = loadPref(user.username);
        savePref(
          user.username,
          { ...pref, muted: !pref.muted },
          { immediate: true }
        );
        updateControlsUi(controls, user);
      },
      true
    );
  }

  peopleSocket.on("voice-state", scheduleRosterRender);

  if (audioContainer) {
    const observer = new MutationObserver(scheduleApplyAllPrefs);
    observer.observe(audioContainer, { childList: true, subtree: true });
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function mentionRegexForMe() {
    const me = currentUsername();
    if (!me) return null;

    if (me !== cachedMentionName) {
      cachedMentionName = me;
      cachedMentionRegex = new RegExp(
        `(^|\\s)@${escapeRegex(me)}(?=$|\\s|[.,!?;:])`,
        "i"
      );
    }

    return cachedMentionRegex;
  }

  function isMentionForMe(text) {
    if (!text) return false;
    const regex = mentionRegexForMe();
    return regex ? regex.test(String(text)) : false;
  }

  function unbindAudioUnlock() {
    if (!audioUnlockBound) return;
    document.removeEventListener("click", ensurePingAudio);
    audioUnlockBound = false;
  }

  function bindAudioUnlock() {
    if (audioUnlockBound) return;
    document.addEventListener("click", ensurePingAudio, { passive: true });
    audioUnlockBound = true;
  }

  function ensurePingAudio() {
    try {
      if (!pingAudioContext) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) pingAudioContext = new AudioCtx();
      }

      if (!pingAudioContext) return;

      if (pingAudioContext.state === "running") {
        unbindAudioUnlock();
        return;
      }

      if (pingAudioContext.state === "suspended") {
        pingAudioContext
          .resume()
          .then(() => {
            if (pingAudioContext?.state === "running") unbindAudioUnlock();
          })
          .catch(() => bindAudioUnlock());
      }
    } catch {}
  }

  function playPingSound() {
    if (window.PeopleSounds?.playNotification?.()) return;

    try {
      ensurePingAudio();
      if (!pingAudioContext) return;

      const now = pingAudioContext.currentTime;

      function beep(start, frequency) {
        const osc = pingAudioContext.createOscillator();
        const gain = pingAudioContext.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(frequency, start);

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.16, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);

        osc.connect(gain);
        gain.connect(pingAudioContext.destination);

        osc.start(start);
        osc.stop(start + 0.18);
      }

      beep(now, 880);
      beep(now + 0.12, 1175);
    } catch (err) {
      console.warn("[People ping] Son impossible", err);
      bindAudioUnlock();
    }
  }

  function showToast(sender, text) {
    let host = document.getElementById("peoplePingToasts");

    if (!host) {
      host = document.createElement("div");
      host.id = "peoplePingToasts";
      host.className = "people-ping-toasts";
      document.body.appendChild(host);
    }

    const toast = document.createElement("div");
    toast.className = "people-ping-toast";

    const title = document.createElement("strong");
    title.textContent = `@ Ping de ${sender}`;

    const body = document.createElement("span");
    body.textContent = String(text).slice(0, 180);

    toast.append(title, body);
    host.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("show"));

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 250);
    }, 5000);
  }

  let notificationRequestPromise = null;
  let notificationUnlockBound = false;
  let notificationDeniedLogged = false;

  function notificationPermission() {
    try {
      if (window.PeopleDesktopNotifications?.available) {
        return "desktop-native";
      }

      if (!("Notification" in window)) return "unsupported";
      return Notification.permission || "default";
    } catch {
      return "unsupported";
    }
  }

  function requestNotificationPermission() {
    const permission = notificationPermission();

    if (
      permission === "desktop-native" ||
      permission === "granted" ||
      permission === "denied" ||
      permission === "unsupported"
    ) {
      return Promise.resolve(permission);
    }

    if (notificationRequestPromise) return notificationRequestPromise;

    try {
      notificationRequestPromise = Promise.resolve(Notification.requestPermission())
        .then((result) => {
          console.log("[People notifications] Permission :", result);
          return result;
        })
        .catch((error) => {
          console.warn("[People notifications] Demande de permission impossible", error);
          return notificationPermission();
        })
        .finally(() => {
          notificationRequestPromise = null;
        });

      return notificationRequestPromise;
    } catch (error) {
      console.warn("[People notifications] Demande de permission impossible", error);
      notificationRequestPromise = null;
      return Promise.resolve(notificationPermission());
    }
  }

  function unbindNotificationUnlock() {
    if (!notificationUnlockBound) return;
    notificationUnlockBound = false;
    document.removeEventListener("pointerdown", requestNotificationFromGesture, true);
    document.removeEventListener("keydown", requestNotificationFromGesture, true);
  }

  function requestNotificationFromGesture() {
    unbindNotificationUnlock();
    requestNotificationPermission().then((permission) => {
      // Si l'utilisateur a simplement fermé le prompt, on pourra retenter
      // lors d'une future interaction, sans boucle ni polling.
      if (permission === "default") bindNotificationUnlock();
    });
  }

  function bindNotificationUnlock() {
    if (notificationUnlockBound || notificationPermission() !== "default") return;

    notificationUnlockBound = true;
    document.addEventListener("pointerdown", requestNotificationFromGesture, {
      capture: true,
      passive: true
    });
    document.addEventListener("keydown", requestNotificationFromGesture, true);
  }

  function showSystemNotification(sender, text) {
    if (window.PeopleDesktopNotifications?.show) {
      try {
        window.PeopleDesktopNotifications.show({
          title: `People — ${sender} t'a ping`,
          body: String(text).slice(0, 220),
          silent: true
        });
        return;
      } catch (error) {
        console.warn(
          "[People notifications] Bridge desktop indisponible, fallback navigateur",
          error
        );
      }
    }

    const permission = notificationPermission();

    if (permission === "default") {
      bindNotificationUnlock();
      return;
    }

    if (permission !== "granted") {
      if (permission === "denied" && !notificationDeniedLogged) {
        notificationDeniedLogged = true;
        console.warn(
          "[People notifications] Notifications système refusées. " +
          "Réactive-les dans les permissions de l'app/site ou dans Windows."
        );
      }
      return;
    }

    try {
      const notification = new Notification(`People — ${sender} t'a ping`, {
        body: String(text).slice(0, 220),
        icon: "people-favicon.png",
        tag: `people-ping-${sender}-${Date.now()}`,
        silent: true
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      notification.onerror = (event) => {
        console.warn("[People notifications] Notification système refusée par l'environnement", event);
      };

      setTimeout(() => notification.close(), 7000);
    } catch (error) {
      console.warn("[People notifications] Création de notification impossible", error);
    }
  }

  if (joinForm) {
    joinForm.addEventListener("submit", () => {
      ensurePingAudio();
      requestNotificationPermission();
    });
  }

  bindAudioUnlock();
  bindNotificationUnlock();

  window.addEventListener("people-authenticated", bindNotificationUnlock);

  peopleSocket.on("chat-message", (data) => {
    const me = currentUsername();
    if (!me || !data || data.username === me) return;
    if (!isMentionForMe(data.text)) return;

    playPingSound();
    showToast(data.username || "Quelqu'un", data.text || "");
    showSystemNotification(data.username || "Quelqu'un", data.text || "");

    // app.js a déjà ajouté le message : accès direct au dernier enfant,
    // sans scanner tout l'historique.
    setTimeout(() => {
      const last = messages?.lastElementChild;
      if (last?.classList?.contains("message")) {
        last.classList.add("people-message-pinged");
      }
    }, 0);
  });

  window.addEventListener(
    "pagehide",
    () => {
      for (const user of latestRoster) {
        if (user?.username) flushPref(user.username);
      }
    },
    { once: true }
  );

  window.PeopleNotifications = {
    get permission() {
      return notificationPermission();
    },
    request: requestNotificationPermission,
    test() {
      const permission = notificationPermission();
      console.log("[People notifications] Mode actuel :", permission);

      if (window.PeopleDesktopNotifications?.test) {
        try {
          return Boolean(window.PeopleDesktopNotifications.test());
        } catch (error) {
          console.warn("[People notifications] Test desktop impossible", error);
          return false;
        }
      }

      if (permission !== "granted") return false;

      try {
        const notification = new Notification("People — test", {
          body: "Les notifications système fonctionnent.",
          icon: "people-favicon.png",
          tag: `people-test-${Date.now()}`
        });
        setTimeout(() => notification.close(), 5000);
        return true;
      } catch (error) {
        console.warn("[People notifications] Test impossible", error);
        return false;
      }
    }
  };

  console.log(
    "[People] Volume local, mute local et pings activés. Notification :",
    notificationPermission()
  );
})();
