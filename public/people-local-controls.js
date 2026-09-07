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

  let latestRoster = [];
  let pingAudioContext = null;

  function currentUsername() {
    const name = (profileName?.textContent || "").trim();
    return name && name !== "Invité" ? name : "";
  }

  function prefKey(displayName) {
    return `people-local-audio:${displayName.toLowerCase()}`;
  }

  function loadPref(displayName) {
    try {
      const raw = localStorage.getItem(prefKey(displayName));
      if (!raw) return { volume: 100, muted: false };
      const parsed = JSON.parse(raw);
      return {
        volume: Math.max(0, Math.min(100, Number(parsed.volume ?? 100))),
        muted: Boolean(parsed.muted)
      };
    } catch {
      return { volume: 100, muted: false };
    }
  }

  function savePref(displayName, pref) {
    try {
      localStorage.setItem(prefKey(displayName), JSON.stringify(pref));
    } catch {}
  }

  function audioForPeer(peerId) {
    return document.getElementById(`audio-${peerId}`);
  }

  function applyPref(user) {
    if (!user || user.id === peopleSocket.id) return;

    const pref = loadPref(user.username);
    const audio = audioForPeer(user.id);
    if (!audio) return;

    audio.volume = Math.max(0, Math.min(1, pref.volume / 100));
    audio.muted = pref.muted;
  }

  function applyAllPrefs() {
    for (const user of latestRoster) {
      applyPref(user);
    }
  }

  function renderLocalControls(roster) {
    latestRoster = Array.isArray(roster) ? roster : [];

    const rows = [...document.querySelectorAll("#voiceUsers .voice-user")];

    latestRoster.forEach((user, index) => {
      const row = rows[index];
      if (!row || user.id === peopleSocket.id) return;

      const old = row.querySelector(".people-local-audio-controls");
      if (old) old.remove();

      const pref = loadPref(user.username);

      const controls = document.createElement("div");
      controls.className = "people-local-audio-controls";
      controls.title = "Ce réglage ne change le son que pour toi";

      const mute = document.createElement("button");
      mute.type = "button";
      mute.className = "people-local-mute";
      mute.setAttribute("aria-label", `Mute local de ${user.username}`);

      const range = document.createElement("input");
      range.type = "range";
      range.className = "people-local-volume";
      range.min = "0";
      range.max = "100";
      range.step = "1";
      range.value = String(pref.volume);
      range.setAttribute("aria-label", `Volume local de ${user.username}`);

      const percent = document.createElement("span");
      percent.className = "people-local-volume-value";

      function refreshUi() {
        const now = loadPref(user.username);
        mute.textContent = now.muted ? "🔇" : "🔊";
        mute.classList.toggle("is-muted", now.muted);
        range.value = String(now.volume);
        percent.textContent = `${Math.round(now.volume)}%`;

        const audio = audioForPeer(user.id);
        if (audio) {
          audio.volume = now.volume / 100;
          audio.muted = now.muted;
        }
      }

      mute.addEventListener("click", (event) => {
        event.stopPropagation();
        const now = loadPref(user.username);
        now.muted = !now.muted;
        savePref(user.username, now);
        refreshUi();
      });

      range.addEventListener("input", (event) => {
        event.stopPropagation();
        const now = loadPref(user.username);
        now.volume = Number(range.value);
        savePref(user.username, now);
        refreshUi();
      });

      range.addEventListener("click", (event) => event.stopPropagation());

      controls.append(mute, range, percent);
      row.appendChild(controls);
      refreshUi();
    });

    applyAllPrefs();
  }

  peopleSocket.on("voice-state", (roster) => {
    // Le gestionnaire principal de People reconstruit d'abord les lignes.
    setTimeout(() => renderLocalControls(roster), 0);
  });

  if (audioContainer) {
    const observer = new MutationObserver(() => {
      // Les <audio> WebRTC peuvent être recréés lors d'une reconnexion.
      setTimeout(applyAllPrefs, 0);
    });
    observer.observe(audioContainer, { childList: true, subtree: true });
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isMentionForMe(text) {
    const me = currentUsername();
    if (!me || !text) return false;

    const escaped = escapeRegex(me);
    const regex = new RegExp(`(^|\\s)@${escaped}(?=$|\\s|[.,!?;:])`, "i");
    return regex.test(String(text));
  }

  function ensurePingAudio() {
    try {
      if (!pingAudioContext) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) pingAudioContext = new AudioCtx();
      }
      if (pingAudioContext?.state === "suspended") {
        pingAudioContext.resume().catch(() => {});
      }
    } catch {}
  }

  function playPingSound() {
    // === PEOPLE_SETTINGS_SOUND_HOOK_V1 ===
    if (
      window.PeopleSounds
        ?.playNotification?.()
    ) {
      return;
    }

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

  function requestNotificationPermission() {
    try {
      if (!("Notification" in window)) return;
      if (Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    } catch {}
  }

  function showSystemNotification(sender, text) {
    try {
      if (!("Notification" in window)) return;
      if (Notification.permission !== "granted") return;

      const notification = new Notification(`People — ${sender} t'a ping`, {
        body: String(text).slice(0, 220),
        tag: `people-ping-${sender}-${Date.now()}`,
        silent: true
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      setTimeout(() => notification.close(), 7000);
    } catch {}
  }

  // Le submit est une action utilisateur : bon moment pour débloquer audio + notifications.
  if (joinForm) {
    joinForm.addEventListener("submit", () => {
      ensurePingAudio();
      requestNotificationPermission();
    });
  }

  // Un clic n'importe où peut aussi réveiller l'AudioContext si le navigateur l'avait suspendu.
  document.addEventListener("click", ensurePingAudio, { passive: true });

  peopleSocket.on("chat-message", (data) => {
    const me = currentUsername();
    if (!me || !data || data.username === me) return;
    if (!isMentionForMe(data.text)) return;

    playPingSound();
    showToast(data.username || "Quelqu'un", data.text || "");
    showSystemNotification(data.username || "Quelqu'un", data.text || "");

    // Le message principal a déjà été ajouté par app.js.
    setTimeout(() => {
      const allMessages = messages
        ? [...messages.querySelectorAll(".message")]
        : [];
      const last = allMessages[allMessages.length - 1];
      if (last) last.classList.add("people-message-pinged");
    }, 0);
  });

  console.log("[People] Volume local, mute local et pings activés.");
})();
