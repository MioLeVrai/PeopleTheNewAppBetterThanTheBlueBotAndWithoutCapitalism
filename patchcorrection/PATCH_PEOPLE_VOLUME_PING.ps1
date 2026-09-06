$ErrorActionPreference = "Stop"

$root = "D:\crack\Discord 2"
$public = Join-Path $root "public"
$indexPath = Join-Path $public "index.html"
$stylePath = Join-Path $public "style.css"
$appPath = Join-Path $public "app.js"
$extrasPath = Join-Path $public "people-local-controls.js"

Write-Host ""
Write-Host "============================================================"
Write-Host "       PEOPLE - VOLUME LOCAL + MUTE LOCAL + PINGS"
Write-Host "============================================================"
Write-Host ""

foreach ($p in @($indexPath, $stylePath, $appPath)) {
    if (-not (Test-Path -LiteralPath $p)) {
        Write-Host "[ERREUR] Fichier introuvable :" -ForegroundColor Red
        Write-Host $p
        exit 1
    }
}

$index = [IO.File]::ReadAllText($indexPath)
$app = [IO.File]::ReadAllText($appPath)

if ($index -notmatch 'voiceUsers' -or $app -notmatch 'voice-state') {
    Write-Host "[ERREUR] Ce dossier ne ressemble pas a la version actuelle de People." -ForegroundColor Red
    Write-Host "Verifie que le projet est bien dans D:\crack\Discord 2"
    exit 1
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item -LiteralPath $indexPath -Destination "$indexPath.backup_$stamp" -Force
Copy-Item -LiteralPath $stylePath -Destination "$stylePath.backup_$stamp" -Force
if (Test-Path -LiteralPath $extrasPath) {
    Copy-Item -LiteralPath $extrasPath -Destination "$extrasPath.backup_$stamp" -Force
}

Write-Host "[OK] Sauvegardes creees."

$utf8 = New-Object System.Text.UTF8Encoding($false)

$jsText = @'
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

'@

[IO.File]::WriteAllText($extrasPath, $jsText, $utf8)
Write-Host "[OK] people-local-controls.js installe."

$index = [IO.File]::ReadAllText($indexPath)
if ($index -notmatch 'people-local-controls\.js') {
    $needle = '<script src="app.js"></script>'

    if ($index.Contains($needle)) {
        $index = $index.Replace(
            $needle,
            $needle + "`r`n  <script src=""people-local-controls.js""></script>"
        )
    } else {
        $index = $index.Replace(
            '</body>',
            '  <script src="people-local-controls.js"></script>' + "`r`n</body>"
        )
    }

    [IO.File]::WriteAllText($indexPath, $index, $utf8)
    Write-Host "[OK] Script ajoute a index.html."
} else {
    Write-Host "[OK] Script deja reference dans index.html."
}

$cssPatch = @'
/* === PEOPLE_LOCAL_AUDIO_AND_PING_START === */

.people-local-audio-controls {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) 40px;
  gap: 7px;
  align-items: center;
  width: 100%;
  padding: 4px 2px 2px 38px;
}

.people-local-mute {
  width: 28px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 13px;
}

.people-local-mute:hover {
  background: var(--hover);
}

.people-local-mute.is-muted {
  background: rgba(218, 55, 60, 0.2);
}

.people-local-volume {
  width: 100%;
  min-width: 0;
  height: 4px;
  accent-color: var(--brand);
  cursor: pointer;
}

.people-local-volume-value {
  color: #949ba4;
  font-size: 10px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.people-message-pinged {
  background: rgba(250, 168, 26, 0.12) !important;
  border-left: 3px solid #faa81a;
  padding-left: 8px;
  margin-left: -11px;
}

.people-ping-toasts {
  position: fixed;
  top: 18px;
  right: 18px;
  z-index: 9999;
  width: min(360px, calc(100vw - 36px));
  display: grid;
  gap: 8px;
  pointer-events: none;
}

.people-ping-toast {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #111214;
  color: #f2f3f5;
  box-shadow: 0 12px 38px rgba(0,0,0,.38);
  border-left: 4px solid #faa81a;
  opacity: 0;
  transform: translateY(-8px);
  transition: opacity .18s ease, transform .18s ease;
}

.people-ping-toast.show {
  opacity: 1;
  transform: translateY(0);
}

.people-ping-toast strong {
  font-size: 13px;
}

.people-ping-toast span {
  color: #dbdee1;
  font-size: 12px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .people-local-audio-controls {
    padding-left: 0;
    grid-template-columns: 26px minmax(35px, 1fr);
  }

  .people-local-volume-value {
    display: none;
  }
}

/* === PEOPLE_LOCAL_AUDIO_AND_PING_END === */

'@

$style = [IO.File]::ReadAllText($stylePath)
$pattern = '(?s)/\* === PEOPLE_LOCAL_AUDIO_AND_PING_START === \*/.*?/\* === PEOPLE_LOCAL_AUDIO_AND_PING_END === \*/'

if ([regex]::IsMatch($style, $pattern)) {
    $style = [regex]::Replace($style, $pattern, $cssPatch.Trim())
    Write-Host "[OK] Ancien style du patch remplace."
} else {
    $style = $style.TrimEnd() + "`r`n`r`n" + $cssPatch
    Write-Host "[OK] Style du patch ajoute."
}

[IO.File]::WriteAllText($stylePath, $style, $utf8)

$indexCheck = [IO.File]::ReadAllText($indexPath)
$extrasCheck = [IO.File]::ReadAllText($extrasPath)
$styleCheck = [IO.File]::ReadAllText($stylePath)

$ok = $true
if ($indexCheck -notmatch 'people-local-controls\.js') { $ok = $false }
if ($extrasCheck -notmatch 'people-local-volume') { $ok = $false }
if ($extrasCheck -notmatch 'Notification') { $ok = $false }
if ($extrasCheck -notmatch 'chat-message') { $ok = $false }
if ($styleCheck -notmatch 'PEOPLE_LOCAL_AUDIO_AND_PING_START') { $ok = $false }

if (-not $ok) {
    Write-Host ""
    Write-Host "[ERREUR] Verification finale echouee." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "============================================================"
Write-Host "                    PATCH INSTALLE"
Write-Host "============================================================"
Write-Host ""
Write-Host "[OK] Volume individuel local : 0 a 100 %"
Write-Host "[OK] Mute individuel local"
Write-Host "[OK] Reglages memorises dans le navigateur"
Write-Host "[OK] Ping sonore avec @Pseudo"
Write-Host "[OK] Notification navigateur si autorisee"
Write-Host "[OK] Notification interne People"
Write-Host ""
Write-Host "Teste ensuite People en local."
Write-Host "Puis lance ton BAT de mise a jour GitHub."
Write-Host ""
