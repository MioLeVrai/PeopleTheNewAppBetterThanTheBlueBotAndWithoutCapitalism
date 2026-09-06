const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 700,
  reconnectionDelayMax: 3000
});

const joinScreen = document.getElementById("joinScreen");
const joinForm = document.getElementById("joinForm");
const usernameInput = document.getElementById("usernameInput");
const passwordInput = document.getElementById("passwordInput");
const loginTab = document.getElementById("loginTab");
const registerTab = document.getElementById("registerTab");
const authSubmit = document.getElementById("authSubmit");
const authError = document.getElementById("authError");
const authSubtitle = document.getElementById("authSubtitle");
const logoutButton = document.getElementById("logoutButton");
const profileName = document.getElementById("profileName");
const avatar = document.getElementById("avatar");
const userCount = document.getElementById("userCount");

const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const messages = document.getElementById("messages");

const voiceButton = document.getElementById("voiceButton");
const voiceStatus = document.getElementById("voiceStatus");
const voiceUsers = document.getElementById("voiceUsers");
const voiceCount = document.getElementById("voiceCount");
const muteButton = document.getElementById("muteButton");
const cameraButton = document.getElementById("cameraButton");
const leaveVoiceQuickButton = document.getElementById("leaveVoiceQuickButton");
const micState = document.getElementById("micState");
const audioContainer = document.getElementById("audioContainer");
const videoStage = document.getElementById("videoStage");
const videoGrid = document.getElementById("videoGrid");

let username = "";
let localStream = null;
let cameraTrack = null;
let micMuted = false;
let cameraEnabled = false;
let voiceJoined = false;
let lastVoiceRoster = [];

const peers = new Map();
const pendingCandidates = new Map();
const reconnectTimers = new Map();

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" }
  ],
  iceCandidatePoolSize: 10
};

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

function timeText(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function scrollBottom() {
  messages.scrollTop = messages.scrollHeight;
}

// === PEOPLE_GENERAL_HISTORY_V1_START ===
function renderChatHistory(history) {
  const items =
    Array.isArray(history)
      ? history
      : [];

  messages
    .querySelectorAll(
      ".message, .system-message"
    )
    .forEach(
      (element) => element.remove()
    );

  for (const item of items) {
    addChatMessage(item);
  }

  scrollBottom();
}
// === PEOPLE_GENERAL_HISTORY_V1_END ===

function addSystemMessage(data) {
  const div = document.createElement("div");
  div.className = "system-message";
  div.textContent = `${data.text} • ${timeText(data.time)}`;
  messages.appendChild(div);
  scrollBottom();
}

function addChatMessage(data) {
  const row = document.createElement("div");
  row.className = "message";

  const av = document.createElement("div");
  av.className = "avatar";
  av.textContent = initials(data.username);

  const body = document.createElement("div");
  const head = document.createElement("div");
  head.className = "message-head";

  const strong = document.createElement("strong");
  strong.textContent = data.username;

  const time = document.createElement("time");
  time.textContent = timeText(data.time);

  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = data.text;

  head.append(strong, time);
  body.append(head, text);
  row.append(av, body);
  messages.appendChild(row);
  scrollBottom();
}

function getVoiceUser(peerId) {
  return lastVoiceRoster.find(user => user.id === peerId) || null;
}

function renderVoiceUsers(roster) {
  lastVoiceRoster = Array.isArray(roster) ? roster : [];
  voiceCount.textContent = lastVoiceRoster.length ? `(${lastVoiceRoster.length})` : "";
  voiceUsers.innerHTML = "";

  if (!lastVoiceRoster.length) {
    const empty = document.createElement("div");
    empty.className = "voice-empty";
    empty.textContent = "Personne dans le vocal";
    voiceUsers.appendChild(empty);
    syncVideoTilesWithRoster();
    return;
  }

  for (const user of lastVoiceRoster) {
    const row = document.createElement("div");
    row.className = "voice-user";
    if (user.id === socket.id) row.classList.add("you");

    const av = document.createElement("div");
    av.className = "voice-user-avatar";
    av.textContent = initials(user.username);

    const name = document.createElement("div");
    name.className = "voice-user-name";
    name.textContent = user.id === socket.id
      ? `${user.username} (toi)`
      : user.username;

    const icons = document.createElement("div");
    icons.className = "voice-media-icons";

    if (user.camera) {
      const cam = document.createElement("span");
      cam.title = "Caméra activée";
      cam.textContent = "📹";
      icons.appendChild(cam);
    }

    const mic = document.createElement("span");
    mic.title = user.muted ? "Micro coupé" : "Micro activé";
    mic.textContent = user.muted ? "🔇" : "🎙️";
    icons.appendChild(mic);

    row.append(av, name, icons);
    voiceUsers.appendChild(row);
  }

  syncVideoTilesWithRoster();
}

function ensureVideoTile(peerId, displayName, isLocal = false) {
  const tileId = isLocal ? "video-local" : `video-${peerId}`;
  let tile = document.getElementById(tileId);

  if (!tile) {
    tile = document.createElement("div");
    tile.id = tileId;
    tile.className = `video-tile${isLocal ? " local" : ""}`;
    tile.dataset.peerId = peerId;

    const placeholder = document.createElement("div");
    placeholder.className = "video-placeholder";

    const bigAvatar = document.createElement("div");
    bigAvatar.className = "big-avatar";
    bigAvatar.textContent = initials(displayName);
    placeholder.appendChild(bigAvatar);

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) video.muted = true;

    const label = document.createElement("div");
    label.className = "video-label";

    tile.append(placeholder, video, label);
    videoGrid.appendChild(tile);
  }

  const label = tile.querySelector(".video-label");
  const bigAvatar = tile.querySelector(".big-avatar");
  if (label) label.textContent = isLocal ? `${displayName} (toi)` : displayName;
  if (bigAvatar) bigAvatar.textContent = initials(displayName);

  return tile;
}

function removeVideoTile(peerId, isLocal = false) {
  const tileId = isLocal ? "video-local" : `video-${peerId}`;
  const tile = document.getElementById(tileId);
  if (!tile) return;

  const video = tile.querySelector("video");
  if (video) {
    try { video.srcObject = null; } catch {}
  }
  tile.remove();
}

function syncVideoStageVisibility() {
  videoStage.classList.toggle("hidden", videoGrid.children.length === 0);
}

function syncVideoTilesWithRoster() {
  const cameraUsers = new Set(
    lastVoiceRoster.filter(user => user.camera).map(user => user.id)
  );

  if (cameraEnabled && voiceJoined) {
    ensureVideoTile(socket.id || "local", username || "Moi", true);
  } else {
    removeVideoTile(socket.id || "local", true);
  }

  for (const user of lastVoiceRoster) {
    if (user.id === socket.id) continue;

    if (user.camera) {
      ensureVideoTile(user.id, user.username, false);
    } else {
      removeVideoTile(user.id, false);
    }
  }

  for (const tile of [...videoGrid.querySelectorAll(".video-tile:not(.local)")]) {
    const peerId = tile.dataset.peerId;
    if (!cameraUsers.has(peerId)) tile.remove();
  }

  syncVideoStageVisibility();
}

function attachLocalPreview() {
  if (!cameraEnabled || !cameraTrack) return;

  const tile = ensureVideoTile(socket.id || "local", username || "Moi", true);
  const video = tile.querySelector("video");
  const placeholder = tile.querySelector(".video-placeholder");

  if (video) {
    video.srcObject = new MediaStream([cameraTrack]);
    video.play().catch(() => {});
  }
  if (placeholder) placeholder.style.display = "none";

  syncVideoStageVisibility();
}

function attachRemoteMedia(peerId, stream) {
  const audioTracks = stream.getAudioTracks();
  let audio = document.getElementById(`audio-${peerId}`);

  if (audioTracks.length) {
    if (!audio) {
      audio = document.createElement("audio");
      audio.id = `audio-${peerId}`;
      audio.autoplay = true;
      audio.playsInline = true;
      audioContainer.appendChild(audio);
    }

    audio.srcObject = new MediaStream(audioTracks);
    const audioPlay = audio.play();
    if (audioPlay && typeof audioPlay.catch === "function") {
      audioPlay.catch(() => {
        const retry = () => {
          audio.play().catch(() => {});
          document.removeEventListener("click", retry);
        };
        document.addEventListener("click", retry, { once: true });
      });
    }
  }

  const videoTracks = stream.getVideoTracks();
  if (videoTracks.length) {
    const user = getVoiceUser(peerId);
    const tile = ensureVideoTile(peerId, user?.username || "Caméra", false);
    const video = tile.querySelector("video");
    const placeholder = tile.querySelector(".video-placeholder");

    if (video) {
      video.srcObject = new MediaStream(videoTracks);
      video.play().catch(() => {});
    }
    if (placeholder) placeholder.style.display = "none";

    for (const track of videoTracks) {
      track.addEventListener("ended", () => {
        const latest = getVoiceUser(peerId);
        if (!latest?.camera) removeVideoTile(peerId, false);
        syncVideoStageVisibility();
      }, { once: true });
    }
  }

  syncVideoStageVisibility();
}

let authMode = "login";

function setAuthMode(mode) {
  authMode = mode === "register" ? "register" : "login";

  loginTab?.classList.toggle(
    "active",
    authMode === "login"
  );

  registerTab?.classList.toggle(
    "active",
    authMode === "register"
  );

  if (authSubmit) {
    authSubmit.textContent =
      authMode === "register"
        ? "Creer mon compte"
        : "Se connecter";
  }

  if (authSubtitle) {
    authSubtitle.textContent =
      authMode === "register"
        ? "Choisis un pseudo unique et un mot de passe."
        : "Connecte-toi avec ton pseudo.";
  }

  if (passwordInput) {
    passwordInput.autocomplete =
      authMode === "register"
        ? "new-password"
        : "current-password";
  }

  if (authError) authError.textContent = "";
}

function applyAuthenticatedUser(user) {
  username = String(user?.username || "").trim();

  if (!username) return false;

  profileName.textContent = username;
  avatar.textContent = initials(username);
  joinScreen.classList.add("hidden");
  window.dispatchEvent(new CustomEvent("people-authenticated", { detail: user }));
  return true;
}

async function reconnectSocketAfterAuth() {
  if (socket.connected) {
    socket.disconnect();
  }

  socket.connect();
}

async function bootstrapAuth() {
  try {
    const response = await fetch("/api/auth/me", {
      credentials: "same-origin"
    });

    if (!response.ok) {
      joinScreen.classList.remove("hidden");
      return;
    }

    const data = await response.json();

    if (!applyAuthenticatedUser(data.user)) {
      joinScreen.classList.remove("hidden");
      return;
    }

    if (socket.connected) {
      socket.emit("join", { reconnect: true });
    }
  } catch {
    joinScreen.classList.remove("hidden");
  }
}

loginTab?.addEventListener(
  "click",
  () => setAuthMode("login")
);

registerTab?.addEventListener(
  "click",
  () => setAuthMode("register")
);

joinForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const wantedUsername = usernameInput.value.trim();
  const password = passwordInput.value;

  if (authError) {
    authError.textContent =
      authMode === "register"
        ? "Creation du compte..."
        : "Connexion...";
  }

  try {
    const response = await fetch(
      authMode === "register"
        ? "/api/auth/register"
        : "/api/auth/login",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "same-origin",
        body: JSON.stringify({
          username: wantedUsername,
          password
        })
      }
    );

    const data = await response
      .json()
      .catch(() => ({}));

    if (!response.ok || !data.ok) {
      if (authError) {
        authError.textContent =
          data.error || "Impossible de se connecter.";
      }
      return;
    }

    if (!applyAuthenticatedUser(data.user)) {
      if (authError) {
        authError.textContent = "Compte invalide.";
      }
      return;
    }

    passwordInput.value = "";
    await reconnectSocketAfterAuth();
    messageInput.focus();
  } catch {
    if (authError) {
      authError.textContent = "Serveur indisponible.";
    }
  }
});

logoutButton?.addEventListener("click", async () => {
  try {
    if (voiceJoined) leaveVoice();

    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin"
    });
  } catch {}

  location.reload();
});

socket.on("auth-required", () => {
  username = "";
  joinScreen.classList.remove("hidden");

  if (authError) {
    authError.textContent =
      "Ta session a expire. Reconnecte-toi.";
  }
});

bootstrapAuth();

messageForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  socket.emit("chat-message", { text });
  messageInput.value = "";
});

socket.on("connect", () => {
  if (!username) return;

  socket.emit("join", {
    username,
    reconnect: true
  });

  if (voiceJoined && localStream) {
    closeAllPeers();
    setTimeout(() => {
      socket.emit("voice-join", {
        muted: micMuted,
        camera: cameraEnabled
      });
    }, 150);
  }
});

socket.on("disconnect", () => {
  if (voiceJoined) {
    voiceStatus.textContent = "Reconnexion...";
    voiceStatus.classList.remove("connected");
  }
  closeAllPeers();
});

socket.on("chat-history", renderChatHistory);
socket.on("chat-message", addChatMessage);
socket.on("system-message", addSystemMessage);
socket.on("user-count", count => userCount.textContent = count);
socket.on("voice-state", renderVoiceUsers);

async function ensureLocalAudio() {
  if (localStream && localStream.getAudioTracks().some(track => track.readyState === "live")) {
    return localStream;
  }

  localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    },
    video: false
  });

  updateMicUi();
  return localStream;
}

function updateMicUi() {
  if (!voiceJoined || !localStream) {
    muteButton.textContent = micMuted ? "🔇" : "🎙️";
    micState.textContent = micMuted
      ? "micro coupé"
      : "";
    muteButton.title = micMuted
      ? "Réactiver le micro avant de rejoindre"
      : "Couper le micro avant de rejoindre";
    return;
  }

  for (const track of localStream.getAudioTracks()) {
    track.enabled = !micMuted;
  }

  muteButton.textContent = micMuted ? "🔇" : "🎙️";
  micState.textContent = micMuted ? "micro coupé" : "micro activé";

  socket.emit("voice-mute", { muted: micMuted });
}

function updateCameraUi() {
  cameraButton.textContent = cameraEnabled ? "📹" : "📷";
  cameraButton.classList.toggle("active", cameraEnabled);

  const cameraAllowed = voiceJoined || cameraEnabled;
  cameraButton.disabled = !cameraAllowed;
  cameraButton.setAttribute(
    "aria-disabled",
    cameraAllowed ? "false" : "true"
  );

  if (!voiceJoined && !cameraEnabled) {
    cameraButton.title = "Rejoins le vocal pour activer la caméra";
  } else {
    cameraButton.title = cameraEnabled
      ? "Couper la caméra"
      : "Activer la caméra";
  }
}

async function joinVoice() {
  if (voiceJoined) return true;

  try {
    voiceStatus.textContent = "Connexion au vocal...";
    await ensureLocalAudio();

    voiceJoined = true;
    if (leaveVoiceQuickButton) {
      leaveVoiceQuickButton.disabled = false;
    }
    updateMicUi();
    updateCameraUi();

    voiceStatus.textContent = "Connecté au vocal";
    voiceStatus.classList.add("connected");
    voiceButton.childNodes[0].nodeValue = "🔊 quitter le vocal ";
    socket.emit("voice-join", {
      muted: micMuted,
      camera: cameraEnabled
    });
    return true;
  } catch (err) {
    console.error(err);
    voiceJoined = false;
    voiceStatus.classList.remove("connected");

    if (err && err.name === "NotAllowedError") {
      voiceStatus.textContent = "Autorise le micro dans le navigateur";
    } else {
      voiceStatus.textContent = "Micro indisponible";
    }
    return false;
  }
}

async function enableCamera() {
  if (cameraEnabled) return;

  if (!voiceJoined) {
    voiceStatus.textContent = "Rejoins le vocal pour activer la caméra";
    updateCameraUi();
    return;
  }

  try {
    cameraButton.textContent = "…";

    const cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 }
      }
    });

    const track = cameraStream.getVideoTracks()[0];
    if (!track) throw new Error("Aucune caméra disponible");

    cameraTrack = track;
    cameraEnabled = true;
    localStream.addTrack(cameraTrack);

    cameraTrack.addEventListener("ended", () => {
      if (cameraEnabled) disableCamera({ trackAlreadyEnded: true });
    }, { once: true });

    attachLocalPreview();
    updateCameraUi();
    socket.emit("voice-camera", { camera: true });

    await rebuildPeersForMediaChange();
  } catch (err) {
    console.error(err);
    cameraEnabled = false;
    cameraTrack = null;
    updateCameraUi();

    if (err && err.name === "NotAllowedError") {
      voiceStatus.textContent = "Autorise la caméra dans le navigateur";
    } else if (err && err.name === "NotFoundError") {
      voiceStatus.textContent = "Aucune caméra trouvée";
    } else {
      voiceStatus.textContent = "Caméra indisponible";
    }
  }
}

async function disableCamera({ trackAlreadyEnded = false } = {}) {
  if (!cameraEnabled && !cameraTrack) return;

  const oldTrack = cameraTrack;
  cameraEnabled = false;
  cameraTrack = null;

  if (localStream && oldTrack) {
    try { localStream.removeTrack(oldTrack); } catch {}
  }

  if (oldTrack && !trackAlreadyEnded) {
    try { oldTrack.stop(); } catch {}
  }

  removeVideoTile(socket.id || "local", true);
  updateCameraUi();
  socket.emit("voice-camera", { camera: false });
  syncVideoStageVisibility();

  if (voiceJoined) {
    await rebuildPeersForMediaChange();
  }
}

function leaveVoice() {
  if (!voiceJoined) return;

  socket.emit("voice-leave");
  voiceJoined = false;

  if (leaveVoiceQuickButton) {
    leaveVoiceQuickButton.disabled = true;
  }

  closeAllPeers();

  if (cameraTrack) {
    try { cameraTrack.stop(); } catch {}
    cameraTrack = null;
  }
  cameraEnabled = false;

  if (localStream) {
    for (const track of localStream.getTracks()) track.stop();
    localStream = null;
  }

  removeVideoTile(socket.id || "local", true);
  micMuted = false;
  voiceStatus.textContent = "Pas connecté";
  voiceStatus.classList.remove("connected");
  voiceButton.childNodes[0].nodeValue = "🔊 vocal ";
  voiceCount.textContent = lastVoiceRoster.length ? `(${lastVoiceRoster.length})` : "";
  updateMicUi();
  updateCameraUi();
  syncVideoStageVisibility();
}

voiceButton.addEventListener("click", () => {
  if (voiceJoined) leaveVoice();
  else joinVoice();
});

leaveVoiceQuickButton?.addEventListener(
  "click",
  () => {
    if (voiceJoined) {
      leaveVoice();
    }
  }
);

leaveVoiceQuickButton?.addEventListener(
  "click",
  () => {
    if (voiceJoined) {
      leaveVoice();
    }
  }
);

muteButton.addEventListener("click", () => {
  micMuted = !micMuted;
  updateMicUi();
});

cameraButton.addEventListener("click", async () => {
  if (!voiceJoined && !cameraEnabled) {
    voiceStatus.textContent = "Rejoins le vocal pour activer la caméra";
    updateCameraUi();
    return;
  }

  if (cameraEnabled) await disableCamera();
  else await enableCamera();
});

function queueCandidate(peerId, candidate) {
  if (!pendingCandidates.has(peerId)) {
    pendingCandidates.set(peerId, []);
  }
  pendingCandidates.get(peerId).push(candidate);
}

async function flushCandidates(peerId, pc) {
  const queued = pendingCandidates.get(peerId) || [];

  for (const candidate of queued) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn("ICE candidate ignoré", err);
    }
  }

  pendingCandidates.delete(peerId);
}

function closePeer(peerId) {
  const timer = reconnectTimers.get(peerId);
  if (timer) clearTimeout(timer);
  reconnectTimers.delete(peerId);

  const pc = peers.get(peerId);
  if (pc) {
    try { pc.onconnectionstatechange = null; } catch {}
    try { pc.close(); } catch {}
  }

  peers.delete(peerId);
  pendingCandidates.delete(peerId);

  const audio = document.getElementById(`audio-${peerId}`);
  if (audio) {
    try { audio.srcObject = null; } catch {}
    audio.remove();
  }

  const user = getVoiceUser(peerId);
  if (!user?.camera) removeVideoTile(peerId, false);
}

function closeAllPeers() {
  for (const peerId of [...peers.keys()]) {
    closePeer(peerId);
  }
  pendingCandidates.clear();
}

function peerIsStillInVoice(peerId) {
  return lastVoiceRoster.some(user => user.id === peerId);
}

function requestPeerRecovery(peerId) {
  if (!voiceJoined || !peerIsStillInVoice(peerId)) return;

  socket.emit("voice-peer-reconnect", { target: peerId });
  recoverPeer(peerId);
}

function recoverPeer(peerId) {
  closePeer(peerId);

  if (!voiceJoined || !peerIsStillInVoice(peerId) || !socket.id) return;

  if (socket.id.localeCompare(peerId) > 0) {
    const timer = setTimeout(() => {
      reconnectTimers.delete(peerId);
      makeOffer(peerId).catch(console.error);
    }, 350);

    reconnectTimers.set(peerId, timer);
  }
}

function createPeer(peerId) {
  if (peers.has(peerId)) return peers.get(peerId);

  const pc = new RTCPeerConnection(rtcConfig);

  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  pc.onicecandidate = (event) => {
    if (!event.candidate) return;

    socket.emit("webrtc-ice-candidate", {
      target: peerId,
      candidate: event.candidate
    });
  };

  pc.ontrack = (event) => {
    const stream = event.streams && event.streams[0];
    if (stream) attachRemoteMedia(peerId, stream);
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;

    if (state === "failed") {
      requestPeerRecovery(peerId);
      return;
    }

    if (state === "disconnected") {
      if (reconnectTimers.has(peerId)) return;

      const timer = setTimeout(() => {
        reconnectTimers.delete(peerId);

        if (
          peers.get(peerId) === pc &&
          pc.connectionState === "disconnected"
        ) {
          requestPeerRecovery(peerId);
        }
      }, 5000);

      reconnectTimers.set(peerId, timer);
      return;
    }

    if (state === "connected") {
      const timer = reconnectTimers.get(peerId);
      if (timer) clearTimeout(timer);
      reconnectTimers.delete(peerId);
    }

    if (state === "closed") {
      closePeer(peerId);
    }
  };

  peers.set(peerId, pc);
  return pc;
}

async function makeOffer(peerId) {
  if (!voiceJoined || !localStream || !peerIsStillInVoice(peerId)) return;

  closePeer(peerId);
  const pc = createPeer(peerId);

  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
  });

  await pc.setLocalDescription(offer);

  socket.emit("webrtc-offer", {
    target: peerId,
    sdp: pc.localDescription
  });
}

async function rebuildPeersForMediaChange() {
  if (!voiceJoined) return;

  const peerIds = lastVoiceRoster
    .map(user => user.id)
    .filter(peerId => peerId && peerId !== socket.id);

  await Promise.allSettled(peerIds.map(peerId => makeOffer(peerId)));
}

socket.on("voice-peers", async (existingPeers) => {
  if (!voiceJoined) return;

  for (const peer of existingPeers) {
    if (!peer || !peer.id || peer.id === socket.id) continue;

    try {
      await makeOffer(peer.id);
    } catch (err) {
      console.error("Impossible de créer l'offre", err);
    }
  }
});

socket.on("webrtc-offer", async ({ from, sdp }) => {
  if (!voiceJoined || !from || !sdp) return;

  try {
    const queuedBeforeOffer = pendingCandidates.get(from) || [];
    closePeer(from);
    if (queuedBeforeOffer.length) {
      pendingCandidates.set(from, queuedBeforeOffer);
    }

    const pc = createPeer(from);

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await flushCandidates(from, pc);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("webrtc-answer", {
      target: from,
      sdp: pc.localDescription
    });
  } catch (err) {
    console.error("Erreur offre WebRTC", err);
    requestPeerRecovery(from);
  }
});

socket.on("webrtc-answer", async ({ from, sdp }) => {
  if (!from || !sdp) return;

  const pc = peers.get(from);
  if (!pc) return;

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await flushCandidates(from, pc);
  } catch (err) {
    console.error("Erreur réponse WebRTC", err);
    requestPeerRecovery(from);
  }
});

socket.on("webrtc-ice-candidate", async ({ from, candidate }) => {
  if (!from || !candidate || !voiceJoined) return;

  const pc = peers.get(from);

  if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
    queueCandidate(from, candidate);
    return;
  }

  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.warn("ICE candidate refusé", err);
  }
});

socket.on("voice-peer-reconnect", ({ from }) => {
  if (!from || !voiceJoined) return;
  recoverPeer(from);
});

socket.on("peer-left", (peerId) => {
  closePeer(peerId);
  removeVideoTile(peerId, false);
  syncVideoStageVisibility();
});

window.addEventListener("beforeunload", () => {
  if (voiceJoined) socket.emit("voice-leave");
});

setInterval(() => {
  if (socket.connected) {
    socket.emit("keepalive");
  }
}, 5 * 60 * 1000);

updateCameraUi();

// === PEOPLE_ONLINE_PANEL_V1_START ===
const peopleAppRoot = document.querySelector(".app");
const onlinePanel = document.getElementById("onlinePanel");
const onlinePanelToggle = document.getElementById("onlinePanelToggle");
const onlinePanelClose = document.getElementById("onlinePanelClose");
const onlinePanelCount = document.getElementById("onlinePanelCount");
const onlinePanelToggleCount = document.getElementById("onlinePanelToggleCount");
const onlineUsersList = document.getElementById("onlineUsersList");

let peopleOnlineRoster = [];

function peopleSetOnlinePanel(open) {
  if (!peopleAppRoot) return;

  peopleAppRoot.classList.toggle("people-online-open", Boolean(open));

  try {
    localStorage.setItem(
      "people-online-panel-open",
      open ? "1" : "0"
    );
  } catch {}

  if (onlinePanelToggle) {
    onlinePanelToggle.setAttribute(
      "aria-expanded",
      open ? "true" : "false"
    );
  }
}

function peopleRenderOnlineUsers(roster) {
  peopleOnlineRoster = Array.isArray(roster) ? roster : [];

  const count = peopleOnlineRoster.length;

  if (onlinePanelCount) {
    onlinePanelCount.textContent =
      count === 1 ? "1 personne" : count + " personnes";
  }

  if (onlinePanelToggleCount) {
    onlinePanelToggleCount.textContent = String(count);
  }

  if (!onlineUsersList) return;

  onlineUsersList.innerHTML = "";

  if (!count) {
    const empty = document.createElement("div");
    empty.className = "online-users-empty";
    empty.textContent = "Personne en ligne";
    onlineUsersList.appendChild(empty);
    return;
  }

  const sorted = [...peopleOnlineRoster].sort((a, b) => {
    if (a.id === socket.id) return -1;
    if (b.id === socket.id) return 1;

    return String(a.username || "").localeCompare(
      String(b.username || ""),
      "fr",
      { sensitivity: "base" }
    );
  });

  for (const user of sorted) {
    const row = document.createElement("div");
    row.className = "online-user-row";
    row.dataset.username = user.username;

    const av = document.createElement("div");
    av.className = "online-user-avatar";
    av.textContent = initials(user.username || "?");

    const info = document.createElement("div");
    info.className = "online-user-info";

    const name = document.createElement("strong");
    name.textContent =
      user.id === socket.id
        ? (user.username || "Invité") + " (toi)"
        : (user.username || "Invité");

    const status = document.createElement("span");
    status.textContent = "En ligne";

    const dot = document.createElement("span");
    dot.className = "online-user-dot";
    dot.setAttribute("aria-label", "En ligne");

    info.append(name, status);
    row.append(av, info, dot);
    onlineUsersList.appendChild(row);
  }
}

onlinePanelToggle?.addEventListener("click", () => {
  const isOpen =
    peopleAppRoot?.classList.contains("people-online-open");

  peopleSetOnlinePanel(!isOpen);
});

onlinePanelClose?.addEventListener("click", () => {
  peopleSetOnlinePanel(false);
});

socket.on("online-users", (roster) => {
  peopleRenderOnlineUsers(roster);
});

let peopleOnlineOpenByDefault = true;

try {
  peopleOnlineOpenByDefault =
    localStorage.getItem("people-online-panel-open") !== "0";
} catch {}

peopleSetOnlinePanel(peopleOnlineOpenByDefault);
// === PEOPLE_ONLINE_PANEL_V1_END ===
