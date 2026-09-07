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
const messageImageButton =
  document.getElementById(
    "messageImageButton"
  );

const messageImageInput =
  document.getElementById(
    "messageImageInput"
  );

const messageImagePreview =
  document.getElementById(
    "messageImagePreview"
  );

const peopleGeneralImagePicker =
  window.PeopleRichContent
    ?.createImagePicker({
      button:
        messageImageButton,
      input:
        messageImageInput,
      preview:
        messageImagePreview
    });
const messages = document.getElementById("messages");

// === PEOPLE_GENERAL_MESSAGE_ACTIONS_V1_START ===
const peopleGeneralReplyController =
  window.PeopleMessageActions
    ?.createReplyController({
      form:
        messageForm,
      input:
        messageInput
    });

function peopleGeneralOwnMessage(
  data
) {
  return (
    String(
      data?.username || ""
    ).toLocaleLowerCase("fr-FR") ===
    String(
      username || ""
    ).toLocaleLowerCase("fr-FR")
  );
}

function peopleDeleteGeneralMessageFromServer(
  id
) {
  return new Promise(
    (resolve, reject) => {
      socket.emit(
        "chat-message-delete",
        { id },
        (response) => {
          if (!response?.ok) {
            reject(
              new Error(
                response?.error ||
                "Suppression impossible."
              )
            );

            return;
          }

          resolve();
        }
      );
    }
  );
}

function peopleRemoveGeneralMessageFromDom(
  id
) {
  const wanted =
    String(id || "");

  const unit =
    Array.from(
      messages.querySelectorAll(
        "[data-message-id]"
      )
    ).find(
      (element) =>
        String(
          element.dataset
            .messageId || ""
        ) === wanted
    );

  window.PeopleMessageActions
    ?.markDeleted(wanted);

  peopleGeneralReplyController
    ?.clearIfId(wanted);

  if (!unit) return;

  const row =
    unit.closest(
      ".message"
    );

  const body =
    unit.closest(
      ".people-message-group-body"
    );

  unit.remove();

  if (
    body &&
    !body.querySelector(
      ".people-message-unit"
    )
  ) {
    row?.remove();
  }

  peopleResetGeneralGroup();
}
// === PEOPLE_GENERAL_MESSAGE_ACTIONS_V1_END ===

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

  peopleResetGeneralGroup();

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
  peopleResetGeneralGroup();
  const div = document.createElement("div");
  div.className = "system-message";
  div.textContent = `${data.text} • ${timeText(data.time)}`;
  messages.appendChild(div);
  scrollBottom();
}

// === PEOPLE_MESSAGE_GROUPING_V1_START ===
const PEOPLE_GROUP_MAX_MESSAGES = 10;
const PEOPLE_GROUP_MAX_GAP_MS =
  10 * 60 * 1000;

let peopleGeneralGroup = null;

function peopleResetGeneralGroup() {
  peopleGeneralGroup = null;
}

function peopleMessageTime(value) {
  const time =
    new Date(value).getTime();

  return Number.isFinite(time)
    ? time
    : Date.now();
}

function peopleGeneralTextLine(
  data,
  grouped = false
) {
  const unit =
    document.createElement("div");

  unit.className =
    "people-message-unit";

  const messageId =
    String(
      data?.id || ""
    );

  if (messageId) {
    unit.dataset.messageId =
      messageId;
  }

  const replyPreview =
    window.PeopleMessageActions
      ?.createReplyPreview(
        data?.replyTo
      );

  if (replyPreview) {
    unit.appendChild(
      replyPreview
    );
  }

  const text =
    document.createElement("div");

  text.className =
    grouped
      ? "message-text people-grouped-message-line"
      : "message-text";

  if (window.PeopleRichContent) {
    window.PeopleRichContent.render(
      text,
      {
        text:
          data.text,
        imageId:
          data.imageId
      }
    );
  } else {
    text.textContent =
      String(data.text || "");
  }

  if (grouped) {
    text.title =
      timeText(data.time);
  }

  unit.appendChild(text);

  if (messageId) {
    window.PeopleMessageActions
      ?.bindContext(
        unit,
        {
          message: {
            id:
              messageId,
            username:
              data.username,
            text:
              data.text,
            imageId:
              data.imageId
          },
          canDelete:
            peopleGeneralOwnMessage(
              data
            ),
          onReply:
            () =>
              peopleGeneralReplyController
                ?.set({
                  id:
                    messageId,
                  username:
                    data.username,
                  text:
                    data.text,
                  imageId:
                    data.imageId
                }),
          onDelete:
            () =>
              peopleDeleteGeneralMessageFromServer(
                messageId
              )
        }
      );
  }

  return unit;
}

function addChatMessage(data) {
  const messageTime =
    peopleMessageTime(data.time);

  const sameGroup =
    peopleGeneralGroup &&
    peopleGeneralGroup.username ===
      String(data.username || "") &&
    peopleGeneralGroup.count <
      PEOPLE_GROUP_MAX_MESSAGES &&
    messageTime -
      peopleGeneralGroup.lastTime <
      PEOPLE_GROUP_MAX_GAP_MS;

  if (sameGroup) {
    peopleGeneralGroup.body.appendChild(
      peopleGeneralTextLine(
        data,
        true
      )
    );

    peopleGeneralGroup.lastTime =
      messageTime;

    peopleGeneralGroup.count += 1;

    scrollBottom();
    return;
  }

  const row =
    document.createElement("div");

  row.className = "message";

  const av =
    document.createElement("div");

  av.className = "avatar";

  window.PeopleAvatars?.apply(
    av,
    data.username
  );

  const body =
    document.createElement("div");

  body.className =
    "people-message-group-body";

  const head =
    document.createElement("div");

  head.className =
    "message-head";

  const strong =
    document.createElement("strong");

  strong.textContent =
    data.username;

  const time =
    document.createElement("time");

  time.textContent =
    timeText(data.time);

  head.append(
    strong,
    time
  );

  body.append(
    head,
    peopleGeneralTextLine(
      data,
      false
    )
  );

  row.append(
    av,
    body
  );

  messages.appendChild(row);

  peopleGeneralGroup = {
    username:
      String(data.username || ""),
    lastTime: messageTime,
    count: 1,
    body
  };

  scrollBottom();
}
// === PEOPLE_MESSAGE_GROUPING_V1_END ===

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
    window.PeopleAvatars?.apply(
    av,
    user.username
  );

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
    window.PeopleAvatars?.apply(
      bigAvatar,
      displayName
    );
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
  if (bigAvatar) {
    window.PeopleAvatars?.apply(
      bigAvatar,
      displayName
    );
  }

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

// === PEOPLE_SERVER_RUNTIME_V1_START ===
let peopleActiveServerId = null;

function peopleApplySelectedServerPayload(
  payload
) {
  renderChatHistory(
    payload?.history || []
  );

  peopleRenderOnlineUsers(
    payload?.online || []
  );

  userCount.textContent =
    String(
      (
        payload?.online ||
        []
      ).length
    );

  renderVoiceUsers(
    payload?.voice || []
  );
}

function peopleSelectServerSocket(
  serverId
) {
  return new Promise(
    (resolve) => {
      socket.emit(
        "server-select",
        {
          serverId:
            String(serverId)
        },
        (response) => {
          resolve(
            response || {
              ok: false,
              error:
                "Le serveur n'a pas répondu."
            }
          );
        }
      );
    }
  );
}

window.PeopleServerRuntime = {
  clearSelection() {
    if (voiceJoined) {
      leaveVoice();
    }

    closeAllPeers();

    peopleActiveServerId =
      null;

    renderChatHistory(
      []
    );

    peopleRenderOnlineUsers(
      []
    );

    userCount.textContent =
      "0";

    renderVoiceUsers(
      []
    );
  },

  async selectServer(server) {
    if (!server?.id) {
      return {
        ok: false,
        error:
          "Serveur invalide."
      };
    }

    if (voiceJoined) {
      leaveVoice();
    }

    closeAllPeers();

    const response =
      await peopleSelectServerSocket(
        server.id
      );

    if (!response?.ok) {
      return response;
    }

    peopleActiveServerId =
      String(server.id);

    peopleGeneralReplyController
      ?.clear();

    peopleGeneralImagePicker
      ?.clear();

    peopleApplySelectedServerPayload(
      response
    );

    return response;
  },

  async reselect() {
    if (!peopleActiveServerId) {
      return;
    }

    const response =
      await peopleSelectServerSocket(
        peopleActiveServerId
      );

    if (!response?.ok) {
      peopleActiveServerId =
        null;

      window.dispatchEvent(
        new CustomEvent(
          "people-server-invalid"
        )
      );

      return;
    }

    peopleApplySelectedServerPayload(
      response
    );

    if (
      voiceJoined &&
      localStream
    ) {
      socket.emit(
        "voice-join",
        {
          muted:
            micMuted,
          camera:
            cameraEnabled
        }
      );
    }
  },

  getActiveServerId() {
    return peopleActiveServerId;
  }
};
socket.on(
  "server-membership-left",
  ({ serverId } = {}) => {
    if (
      String(
        window.PeopleServerRuntime
          ?.getActiveServerId() ||
        ""
      ) !==
      String(serverId || "")
    ) {
      return;
    }

    window.PeopleServerRuntime
      ?.clearSelection();

    window.dispatchEvent(
      new CustomEvent(
        "people-server-invalid"
      )
    );
  }
);

// === PEOPLE_SERVER_RUNTIME_V1_END ===

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
  window.PeopleAvatars?.apply(
    avatar,
    username
  );
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

messageForm.addEventListener(
  "submit",
  async (e) => {
    e.preventDefault();

    if (!peopleActiveServerId) {
      alert("Choisis d'abord un serveur.");
      return;
    }

    const text =
      messageInput.value.trim();

    const file =
      peopleGeneralImagePicker
        ?.getFile();

    if (
      !text &&
      !file
    ) {
      return;
    }

    const submitButton =
      messageForm.querySelector(
        'button[type="submit"]'
      );

    messageInput.disabled =
      true;

    if (submitButton) {
      submitButton.disabled =
        true;
    }

    peopleGeneralImagePicker
      ?.setBusy(true);

    try {
      let imageId =
        null;

      if (file) {
        imageId =
          await window
            .PeopleRichContent
            .uploadImage(
              file
            );
      }

      socket.emit(
        "chat-message",
        {
          text,
          imageId,
          replyToId:
            peopleGeneralReplyController
              ?.get()?.id || null
        }
      );

      peopleGeneralReplyController
        ?.clear();

      messageInput.value =
        "";

      peopleGeneralImagePicker
        ?.clear();
    } catch (err) {
      alert(
        err.message
      );
    } finally {
      messageInput.disabled =
        false;

      if (submitButton) {
        submitButton.disabled =
          false;
      }

      peopleGeneralImagePicker
        ?.setBusy(false);

      messageInput.focus();
    }
  }
);

socket.on("connect", () => {
  if (!username) return;

  socket.emit("join", {
    reconnect: true
  });

  if (
    window.PeopleServerRuntime
      ?.getActiveServerId()
  ) {
    closeAllPeers();

    setTimeout(
      () => {
        window.PeopleServerRuntime
          ?.reselect();
      },
      80
    );
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
socket.on(
  "profile-avatar-updated",
  (data) => {
    if (data?.username) {
      window.PeopleAvatars?.refresh(
        data.username
      );
    }
  }
);

// === PEOPLE_GENERAL_DELETE_CLIENT_V1_START ===
socket.on(
  "chat-message-deleted",
  ({ id } = {}) => {
    if (id) {
      peopleRemoveGeneralMessageFromDom(
        id
      );
    }
  }
);
// === PEOPLE_GENERAL_DELETE_CLIENT_V1_END ===

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

// === PEOPLE_UNIQUE_PRESENCE_CLIENT_V1_START ===
function peopleOnlineUserIsSelf(
  user
) {
  return (
    String(
      user?.username || ""
    )
      .trim()
      .toLocaleLowerCase(
        "fr-FR"
      ) ===
    String(
      username || ""
    )
      .trim()
      .toLocaleLowerCase(
        "fr-FR"
      )
  );
}
// === PEOPLE_UNIQUE_PRESENCE_CLIENT_V1_END ===

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
    if (peopleOnlineUserIsSelf(a)) return -1;
    if (peopleOnlineUserIsSelf(b)) return 1;

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
    window.PeopleAvatars?.apply(
      av,
      user.username || "?"
    );

    const info = document.createElement("div");
    info.className = "online-user-info";

    const name = document.createElement("strong");
    name.textContent =
      peopleOnlineUserIsSelf(
        user
      )
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
