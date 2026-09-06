const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 700,
  reconnectionDelayMax: 3000
});

const joinScreen = document.getElementById("joinScreen");
const joinForm = document.getElementById("joinForm");
const usernameInput = document.getElementById("usernameInput");
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
const micState = document.getElementById("micState");
const audioContainer = document.getElementById("audioContainer");

let username = "";
let localStream = null;
let micMuted = true;
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

function renderVoiceUsers(roster) {
  lastVoiceRoster = Array.isArray(roster) ? roster : [];
  voiceCount.textContent = lastVoiceRoster.length ? `(${lastVoiceRoster.length})` : "";
  voiceUsers.innerHTML = "";

  if (!lastVoiceRoster.length) {
    const empty = document.createElement("div");
    empty.className = "voice-empty";
    empty.textContent = "Personne dans le vocal";
    voiceUsers.appendChild(empty);
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

    const mic = document.createElement("div");
    mic.className = "voice-mic";
    mic.title = user.muted ? "Micro coupé" : "Micro activé";
    mic.textContent = user.muted ? "🔇" : "🎙️";

    row.append(av, name, mic);
    voiceUsers.appendChild(row);
  }
}

joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  username = usernameInput.value.trim().slice(0, 24) || "Invité";
  profileName.textContent = username;
  avatar.textContent = initials(username);
  joinScreen.classList.add("hidden");
  socket.emit("join", { username });
  messageInput.focus();
});

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
      socket.emit("voice-join", { muted: micMuted });
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

socket.on("chat-message", addChatMessage);
socket.on("system-message", addSystemMessage);
socket.on("user-count", count => userCount.textContent = count);
socket.on("voice-state", renderVoiceUsers);

async function ensureLocalAudio() {
  if (localStream && localStream.active) return localStream;

  localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    },
    video: false
  });

  micMuted = false;
  updateMicUi();
  return localStream;
}

function updateMicUi() {
  if (!voiceJoined || !localStream) {
    muteButton.textContent = "🎙️";
    micState.textContent = "hors du vocal";
    return;
  }

  for (const track of localStream.getAudioTracks()) {
    track.enabled = !micMuted;
  }

  muteButton.textContent = micMuted ? "🔇" : "🎙️";
  micState.textContent = micMuted ? "micro coupé" : "micro activé";

  socket.emit("voice-mute", { muted: micMuted });
}

async function joinVoice() {
  if (voiceJoined) return;

  try {
    voiceStatus.textContent = "Connexion au vocal...";
    await ensureLocalAudio();

    voiceJoined = true;
    updateMicUi();

    voiceStatus.textContent = "Connecté au vocal";
    voiceStatus.classList.add("connected");
    voiceButton.childNodes[0].nodeValue = "🔊 quitter le vocal ";
    socket.emit("voice-join", { muted: micMuted });
  } catch (err) {
    console.error(err);
    voiceJoined = false;
    voiceStatus.classList.remove("connected");

    if (err && err.name === "NotAllowedError") {
      voiceStatus.textContent = "Autorise le micro dans le navigateur";
    } else {
      voiceStatus.textContent = "Micro indisponible";
    }
  }
}

function leaveVoice() {
  if (!voiceJoined) return;

  socket.emit("voice-leave");
  voiceJoined = false;

  closeAllPeers();

  if (localStream) {
    for (const track of localStream.getTracks()) track.stop();
    localStream = null;
  }

  micMuted = true;
  voiceStatus.textContent = "Pas connecté";
  voiceStatus.classList.remove("connected");
  voiceButton.childNodes[0].nodeValue = "🔊 vocal ";
  voiceCount.textContent = lastVoiceRoster.length ? `(${lastVoiceRoster.length})` : "";
  micState.textContent = "hors du vocal";
  muteButton.textContent = "🎙️";
}

voiceButton.addEventListener("click", () => {
  if (voiceJoined) leaveVoice();
  else joinVoice();
});

muteButton.addEventListener("click", async () => {
  if (!voiceJoined) {
    await joinVoice();
    return;
  }

  micMuted = !micMuted;
  updateMicUi();
});

function addRemoteAudio(peerId, stream) {
  let audio = document.getElementById(`audio-${peerId}`);

  if (!audio) {
    audio = document.createElement("audio");
    audio.id = `audio-${peerId}`;
    audio.autoplay = true;
    audio.playsInline = true;
    audio.muted = false;
    audioContainer.appendChild(audio);
  }

  audio.srcObject = stream;

  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      // Le clic sur "vocal" débloque normalement l'audio.
      // Si le navigateur bloque encore, un clic n'importe où réessaie.
      const retry = () => {
        audio.play().catch(() => {});
        document.removeEventListener("click", retry);
      };
      document.addEventListener("click", retry, { once: true });
    });
  }
}

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

  // Une seule des deux personnes relance l'offre pour éviter deux offres simultanées.
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
    if (stream) addRemoteAudio(peerId, stream);
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
    offerToReceiveAudio: true
  });

  await pc.setLocalDescription(offer);

  socket.emit("webrtc-offer", {
    target: peerId,
    sdp: pc.localDescription
  });
}

socket.on("voice-peers", async (existingPeers) => {
  if (!voiceJoined) return;

  // Le nouvel arrivant appelle tous ceux qui étaient déjà dans le vocal.
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
    // Garde les candidats ICE qui auraient pu arriver juste avant l'offre.
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
});

window.addEventListener("beforeunload", () => {
  if (voiceJoined) socket.emit("voice-leave");
});


// Garde la connexion temps réel active pendant que la page est ouverte.
setInterval(() => {
  if (socket.connected) {
    socket.emit("keepalive");
  }
}, 5 * 60 * 1000);
