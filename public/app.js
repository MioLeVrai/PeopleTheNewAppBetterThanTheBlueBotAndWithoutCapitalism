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
        messageImagePreview,
      pasteTarget:
        messageInput
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

/*
  lastVoiceRoster   = vocal du serveur actuellement AFFICHÉ
  activeVoiceRoster = vocal WebRTC réellement rejoint par cet onglet
*/
let activeVoiceRoster = [];
let activeVoiceServerId = null;

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

let peopleScrollBottomFrame = 0;

function scrollBottom() {
  if (peopleScrollBottomFrame) {
    return;
  }

  peopleScrollBottomFrame =
    requestAnimationFrame(
      () => {
        peopleScrollBottomFrame = 0;
        messages.scrollTop =
          messages.scrollHeight;
      }
    );
}

// === PEOPLE_GENERAL_HISTORY_V1_START ===
// === PEOPLE_AVATAR_PRELOAD_APP_V1 ===
function peoplePreloadAppAvatars(
  usernames
) {
  const uniqueUsernames =
    [
      ...new Set(
        (
          Array.isArray(usernames)
            ? usernames
            : []
        )
          .map(
            (name) =>
              String(name || "").trim()
          )
          .filter(Boolean)
      )
    ];

  if (!uniqueUsernames.length) {
    return;
  }

  void window.PeopleAvatars
    ?.preloadMany(
      uniqueUsernames
    );
}

function renderChatHistory(history) {
  const items =
    Array.isArray(history)
      ? history
      : [];

  peoplePreloadAppAvatars(
    items
      .filter(
        (item) =>
          !item?.system
      )
      .map(
        (item) =>
          item?.username
      )
  );

  peopleResetGeneralGroup();

  messages
    .querySelectorAll(
      ".message, .system-message"
    )
    .forEach(
      (element) => element.remove()
    );

  const fragment =
    document.createDocumentFragment();

  for (const item of items) {
    if (item?.system) {
      addSystemMessage(
        item,
        fragment,
        false
      );
    } else {
      addChatMessage(
        item,
        fragment,
        false
      );
    }
  }

  messages.appendChild(
    fragment
  );

  scrollBottom();
}
// === PEOPLE_GENERAL_HISTORY_V1_END ===

function addSystemMessage(
  data,
  target = messages,
  shouldScroll = true
) {
  peopleResetGeneralGroup();
  const div = document.createElement("div");
  div.className = "system-message";
  div.textContent = `${data.text} • ${timeText(data.time)}`;
  target.appendChild(div);

  if (shouldScroll) {
    scrollBottom();
  }
}

// === PEOPLE_PROFILE_CLICK_EVERYWHERE_V3_START ===
function peopleProfileUsername(
  value
) {
  const username =
    String(
      value ||
      ""
    ).trim();

  if (
    !username ||
    username.toLocaleLowerCase(
      "fr-FR"
    ) ===
      "système" ||
    username.toLocaleLowerCase(
      "fr-FR"
    ) ===
      "systeme"
  ) {
    return "";
  }

  return username;
}

function peopleOpenProfileFromUi(
  username
) {
  const clean =
    peopleProfileUsername(
      username
    );

  if (!clean) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(
      "people-open-profile",
      {
        detail: {
          username:
            clean
        }
      }
    )
  );
}

function peopleBindProfileUi(
  element,
  username,
  kind =
    "name"
) {
  const clean =
    peopleProfileUsername(
      username
    );

  if (
    !element ||
    !clean
  ) {
    return;
  }

  element.dataset.peopleProfileUsername =
    clean;

  element.classList.add(
    "people-profile-trigger"
  );

  element.classList.toggle(
    "people-profile-name-trigger",
    kind ===
      "name"
  );

  element.classList.toggle(
    "people-profile-avatar-trigger",
    kind ===
      "avatar"
  );

  if (
    element.dataset.peopleProfileClickBound ===
      "1"
  ) {
    return;
  }

  element.dataset.peopleProfileClickBound =
    "1";

  element.setAttribute(
    "role",
    "button"
  );

  element.setAttribute(
    "tabindex",
    "0"
  );

  element.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();

      peopleOpenProfileFromUi(
        element.dataset.peopleProfileUsername
      );
    }
  );

  element.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key !==
          "Enter" &&
        event.key !==
          " "
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      peopleOpenProfileFromUi(
        element.dataset.peopleProfileUsername
      );
    }
  );
}
// === PEOPLE_PROFILE_CLICK_EVERYWHERE_V3_END ===

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


// === PEOPLE_GENERAL_OPTIMISTIC_SEND_V1_START ===
const peopleRecentGeneralClientIds =
  new Set();

function peopleNewGeneralClientId() {
  if (
    typeof crypto?.randomUUID ===
      "function"
  ) {
    return crypto.randomUUID();
  }

  return (
    Date.now().toString(36) +
    "-" +
    Math.random()
      .toString(36)
      .slice(2)
  );
}

function peopleRememberGeneralClientId(
  clientId
) {
  const id =
    String(
      clientId || ""
    );

  if (!id) return;

  peopleRecentGeneralClientIds.add(
    id
  );

  setTimeout(
    () => {
      peopleRecentGeneralClientIds.delete(
        id
      );
    },
    15000
  );
}

function peopleFindPendingGeneralUnit(
  clientId
) {
  const wanted =
    String(
      clientId || ""
    );

  if (!wanted) {
    return null;
  }

  return (
    Array.from(
      messages.querySelectorAll(
        "[data-people-client-id]"
      )
    ).find(
      (element) =>
        String(
          element.dataset
            .peopleClientId || ""
        ) === wanted
    ) ||
    null
  );
}

function peopleConfirmPendingGeneralMessage(
  data
) {
  const clientId =
    String(
      data?.clientId || ""
    );

  if (!clientId) {
    return false;
  }

  const unit =
    peopleFindPendingGeneralUnit(
      clientId
    );

  if (!unit) {
    return false;
  }

  const grouped =
    Boolean(
      unit.querySelector(
        ".people-grouped-message-line"
      )
    );

  const row =
    unit.closest(
      ".message"
    );

  const confirmedData = {
    ...data,
    clientId:
      null,
    pending:
      false
  };

  const replacement =
    peopleGeneralTextLine(
      confirmedData,
      grouped
    );

  unit.replaceWith(
    replacement
  );

  if (
    !grouped &&
    row
  ) {
    const time =
      row.querySelector(
        "time"
      );

    if (time) {
      time.textContent =
        timeText(
          data.time
        );
    }
  }

  return true;
}

function peopleFailPendingGeneralMessage(
  clientId
) {
  const unit =
    peopleFindPendingGeneralUnit(
      clientId
    );

  if (!unit) {
    return;
  }

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

function peopleHandleIncomingGeneralMessage(
  data
) {
  const clientId =
    String(
      data?.clientId || ""
    );

  if (
    clientId &&
    peopleRecentGeneralClientIds.has(
      clientId
    )
  ) {
    return;
  }

  if (
    clientId &&
    peopleConfirmPendingGeneralMessage(
      data
    )
  ) {
    peopleRememberGeneralClientId(
      clientId
    );

    return;
  }

  addChatMessage(
    data
  );
}
// === PEOPLE_GENERAL_OPTIMISTIC_SEND_V1_END ===

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

  const clientId =
    String(
      data?.clientId || ""
    );

  if (messageId) {
    unit.dataset.messageId =
      messageId;
  }

  if (
    clientId &&
    data?.pending
  ) {
    unit.dataset.peopleClientId =
      clientId;

    unit.classList.add(
      "people-message-pending"
    );
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

  if (
    messageId &&
    !data?.pending
  ) {
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

function addChatMessage(
  data,
  target = messages,
  shouldScroll = true
) {
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

    if (shouldScroll) {
      scrollBottom();
    }
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

  // === PEOPLE_SERVER_MESSAGE_PROFILE_V3 ===
  peopleBindProfileUi(
    av,
    data.username,
    "avatar"
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

  peopleBindProfileUi(
    strong,
    data.username,
    "name"
  );

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

  target.appendChild(row);

  peopleGeneralGroup = {
    username:
      String(data.username || ""),
    lastTime: messageTime,
    count: 1,
    body
  };

  if (shouldScroll) {
    scrollBottom();
  }
}
// === PEOPLE_MESSAGE_GROUPING_V1_END ===

function getVoiceUser(peerId) {
  return activeVoiceRoster.find(
    user =>
      user.id === peerId
  ) || null;
}

// === PEOPLE_VOICE_NAVIGATION_CLIENT_V2_START ===
function peopleSetActiveVoiceRoster(
  roster
) {
  activeVoiceRoster =
    Array.isArray(
      roster
    )
      ? roster
      : [];

  peoplePreloadAppAvatars(
    activeVoiceRoster.map(
      (user) =>
        user?.username
    )
  );

  syncVideoTilesWithRoster();
}

function peopleVoiceSameServer(
  left,
  right
) {
  return (
    String(
      left || ""
    ) ===
    String(
      right || ""
    )
  );
}

function peopleSyncVoiceVideoContext() {
  syncVideoStageVisibility();
}

function peopleSyncVoiceUiContext() {
  const selected =
    String(
      peopleActiveServerId ||
      ""
    );

  const active =
    String(
      activeVoiceServerId ||
      ""
    );

  if (
    voiceJoined &&
    active
  ) {
    if (
      selected &&
      peopleVoiceSameServer(
        selected,
        active
      )
    ) {
      voiceStatus.textContent =
        "Connecté au vocal";

      voiceStatus.classList.add(
        "connected"
      );

      voiceButton.childNodes[0].nodeValue =
        "🔊 quitter le vocal ";
    } else if (selected) {
      voiceStatus.textContent =
        "Déjà connecté à un vocal";

      voiceStatus.classList.remove(
        "connected"
      );

      voiceButton.childNodes[0].nodeValue =
        "🔊 vocal ";
    }

    if (
      leaveVoiceQuickButton
    ) {
      leaveVoiceQuickButton.disabled =
        false;
    }

    peopleSyncVoiceVideoContext();

    return;
  }

  if (selected) {
    voiceStatus.textContent =
      "Pas connecté";

    voiceStatus.classList.remove(
      "connected"
    );

    voiceButton.childNodes[0].nodeValue =
      "🔊 vocal ";
  }

  peopleSyncVoiceVideoContext();
}

function peopleHandleVoiceState(
  payload
) {
  const legacy =
    Array.isArray(
      payload
    );

  const serverId =
    legacy
      ? String(
          peopleActiveServerId ||
          activeVoiceServerId ||
          ""
        )
      : String(
          payload?.serverId ||
          ""
        );

  const roster =
    legacy
      ? payload
      : (
          Array.isArray(
            payload?.roster
          )
            ? payload.roster
            : []
        );

  if (
    activeVoiceServerId &&
    peopleVoiceSameServer(
      serverId,
      activeVoiceServerId
    )
  ) {
    peopleSetActiveVoiceRoster(
      roster
    );
  }

  if (
    peopleActiveServerId &&
    peopleVoiceSameServer(
      serverId,
      peopleActiveServerId
    )
  ) {
    renderVoiceUsers(
      roster
    );
  }
}

async function peopleConnectActiveVoicePeers() {
  if (
    !voiceJoined
  ) {
    return;
  }

  const peerIds =
    activeVoiceRoster
      .map(
        (user) =>
          user?.id
      )
      .filter(
        (peerId) =>
          peerId &&
          peerId !==
            socket.id
      );

  await Promise.allSettled(
    peerIds.map(
      (peerId) =>
        makeOffer(
          peerId
        )
    )
  );
}

async function peopleReconnectVoiceSession() {
  if (
    !voiceJoined ||
    !activeVoiceServerId ||
    !localStream
  ) {
    return;
  }

  const response =
    await peopleVoiceJoinRequest(
      activeVoiceServerId
    );

  if (
    !response?.ok
  ) {
    peopleVoiceRejectJoin(
      response
    );

    activeVoiceServerId =
      null;

    peopleSetActiveVoiceRoster(
      []
    );

    return;
  }

  activeVoiceServerId =
    String(
      response.serverId ||
      activeVoiceServerId
    );

  peopleSetActiveVoiceRoster(
    response.roster ||
    []
  );

  peopleSyncVoiceUiContext();

  await peopleConnectActiveVoicePeers();
}
// === PEOPLE_VOICE_NAVIGATION_CLIENT_V2_END ===

function renderVoiceUsers(roster) {
  lastVoiceRoster = Array.isArray(roster) ? roster : [];

  peoplePreloadAppAvatars(
    lastVoiceRoster.map(
      (user) =>
        user?.username
    )
  );
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

  const fragment =
    document.createDocumentFragment();

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

    const copy =
      document.createElement(
        "div"
      );

    copy.className =
      "voice-user-copy";

    const name = document.createElement("div");
    name.className = "voice-user-name";
    name.textContent = user.id === socket.id
      ? `${user.username} (toi)`
      : user.username;

    // === PEOPLE_VOICE_PROFILE_V3 ===
    peopleBindProfileUi(
      av,
      user.username,
      "avatar"
    );

    peopleBindProfileUi(
      name,
      user.username,
      "name"
    );

    copy.appendChild(
      name
    );

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

    row.append(
      av,
      copy,
      icons
    );

    fragment.appendChild(row);
  }

  voiceUsers.appendChild(
    fragment
  );

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

  // === PEOPLE_VIDEO_PROFILE_V3 ===
  peopleBindProfileUi(
    bigAvatar,
    displayName,
    "avatar"
  );

  peopleBindProfileUi(
    label,
    displayName,
    "name"
  );

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
  const viewingActiveVoice =
    voiceJoined &&
    activeVoiceServerId &&
    peopleActiveServerId &&
    peopleVoiceSameServer(
      activeVoiceServerId,
      peopleActiveServerId
    );

  videoStage.classList.toggle(
    "hidden",
    videoGrid.children.length === 0 ||
    !viewingActiveVoice
  );
}

function syncVideoTilesWithRoster() {
  const cameraUsers = new Set(
    activeVoiceRoster.filter(user => user.camera).map(user => user.id)
  );

  if (cameraEnabled && voiceJoined) {
    ensureVideoTile(socket.id || "local", username || "Moi", true);
  } else {
    removeVideoTile(socket.id || "local", true);
  }

  for (const user of activeVoiceRoster) {
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

    void window.PeopleAudioDevices
      ?.applyOutput?.(
        audio
      );

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
      ).filter(
        (user) =>
          user?.online !==
          false
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
    /*
      Accueil / Amis / MP n'ont plus aucun effet
      sur le vocal WebRTC actif.
    */
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

    peopleSyncVoiceUiContext();
  },

  async selectServer(server) {
    if (!server?.id) {
      return {
        ok: false,
        error:
          "Serveur invalide."
      };
    }

    /*
      On change uniquement le serveur affiché.
      Le vocal actif de cet onglet reste connecté.
    */
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

    peopleSyncVoiceUiContext();

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

    /*
      Le reselect concerne seulement le serveur TEXTE affiché.
      La reconnexion du vocal utilise activeVoiceServerId
      via l'événement people-ready.
    */
    peopleSyncVoiceUiContext();
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

    const reply =
      peopleGeneralReplyController
        ?.get() ||
      null;

    const submitButton =
      messageForm.querySelector(
        'button[type="submit"]'
      );

    /*
      Un message texte ne bloque plus le champ :
      il apparaît immédiatement et le serveur le
      confirme ensuite avec le même clientId.
      Pour une image, on garde le verrou uniquement
      pendant l'upload réel.
    */
    if (file) {
      messageInput.disabled =
        true;

      if (submitButton) {
        submitButton.disabled =
          true;
      }

      peopleGeneralImagePicker
        ?.setBusy(true);
    }

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

      const clientId =
        peopleNewGeneralClientId();

      addChatMessage({
        username,
        text,
        imageId,
        replyTo:
          reply
            ? {
                id:
                  String(
                    reply.id || ""
                  ),
                username:
                  reply.username,
                text:
                  reply.text,
                imageId:
                  reply.imageId ||
                  null,
                deleted:
                  false
              }
            : null,
        time:
          Date.now(),
        clientId,
        pending:
          true
      });

      peopleGeneralReplyController
        ?.clear();

      messageInput.value =
        "";

      peopleGeneralImagePicker
        ?.clear();

      socket.emit(
        "chat-message",
        {
          text,
          imageId,
          replyToId:
            reply?.id ||
            null,
          clientId
        },
        (response) => {
          if (
            response?.ok
          ) {
            if (
              response.message
            ) {
              peopleHandleIncomingGeneralMessage(
                response.message
              );
            }

            return;
          }

          peopleFailPendingGeneralMessage(
            clientId
          );

          /*
            En cas d'échec, on remet le texte seulement
            si l'utilisateur n'a pas déjà commencé à
            écrire autre chose.
          */
          if (
            text &&
            !messageInput.value
          ) {
            messageInput.value =
              text;
          }
        }
      );
    } catch (err) {
      alert(
        err.message
      );
    } finally {
      if (file) {
        messageInput.disabled =
          false;

        if (submitButton) {
          submitButton.disabled =
            false;
        }

        peopleGeneralImagePicker
          ?.setBusy(false);
      }

      messageInput.focus();
    }
  }
)

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

// === PEOPLE_VOICE_RECONNECT_V2 ===
socket.on(
  "people-ready",
  () => {
    if (
      voiceJoined &&
      activeVoiceServerId &&
      localStream
    ) {
      setTimeout(
        () => {
          void peopleReconnectVoiceSession();
        },
        100
      );
    }
  }
);

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

socket.on(
  "chat-message",
  peopleHandleIncomingGeneralMessage
);
socket.on("system-message", addSystemMessage);
socket.on("user-count", count => userCount.textContent = count);
socket.on(
  "voice-state",
  peopleHandleVoiceState
);

async function ensureLocalAudio() {
  if (localStream && localStream.getAudioTracks().some(track => track.readyState === "live")) {
    return localStream;
  }

  localStream = await navigator.mediaDevices.getUserMedia({
    audio:
      window.PeopleAudioDevices
        ?.getInputConstraints?.() ||
      {
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

// === PEOPLE_VOICE_INPUT_SWITCH_V1 ===
async function peopleSwitchVoiceInputDevice() {
  if (
    !voiceJoined ||
    !localStream
  ) {
    return;
  }

  try {
    const replacementStream =
      await navigator.mediaDevices
        .getUserMedia({
          audio:
            window.PeopleAudioDevices
              ?.getInputConstraints?.() ||
            {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1
            },
          video: false
        });

    const newTrack =
      replacementStream
        .getAudioTracks()[0];

    if (!newTrack) {
      return;
    }

    newTrack.enabled =
      !micMuted;

    const oldTracks =
      localStream
        .getAudioTracks();

    for (
      const pc of
      peers.values()
    ) {
      const sender =
        pc
          .getSenders()
          .find(
            (item) =>
              item.track?.kind ===
              "audio"
          );

      if (sender) {
        await sender.replaceTrack(
          newTrack
        );
      }
    }

    for (
      const oldTrack of
      oldTracks
    ) {
      try {
        localStream.removeTrack(
          oldTrack
        );
      } catch {}

      try {
        oldTrack.stop();
      } catch {}
    }

    localStream.addTrack(
      newTrack
    );

    updateMicUi();

    voiceStatus.textContent =
      "Micro changé ✓";

    if (
      activeVoiceServerId &&
      peopleActiveServerId &&
      peopleVoiceSameServer(
        activeVoiceServerId,
        peopleActiveServerId
      )
    ) {
      setTimeout(
        () => {
          peopleSyncVoiceUiContext();
        },
        900
      );
    }
  } catch (err) {
    console.warn(
      "[People changement micro vocal]",
      err
    );

    voiceStatus.textContent =
      "Impossible d'utiliser ce micro";
  }
}

window.addEventListener(
  "people-audio-input-device-changed",
  () => {
    void peopleSwitchVoiceInputDevice();
  }
);

window.addEventListener(
  "people-audio-output-device-changed",
  () => {
    void window.PeopleAudioDevices
      ?.applyOutputToAll?.();
  }
);

// === PEOPLE_UNIFIED_CALL_CONTROLS_V3_START ===
function peopleDmCallStateForControls() {
  try {
    const state =
      window.PeopleDmCalls
        ?.getState?.();

    return (
      state?.exists
        ? state
        : null
    );
  } catch {
    return null;
  }
}

function peopleSyncUnifiedCallControls() {
  const dmCall =
    peopleDmCallStateForControls();

  const inDmCall =
    Boolean(
      dmCall
    );

  muteButton.classList.toggle(
    "people-current-call-control",
    inDmCall
  );

  cameraButton.classList.toggle(
    "people-current-call-control",
    inDmCall
  );

  leaveVoiceQuickButton
    ?.classList.toggle(
      "people-current-call-danger",
      inDmCall
    );

  if (dmCall) {
    muteButton.textContent =
      dmCall.muted
        ? "🔇"
        : "🎙️";

    muteButton.title =
      dmCall.muted
        ? "Réactiver le micro de l'appel MP"
        : "Couper le micro de l'appel MP";

    micState.textContent =
      dmCall.muted
        ? "appel MP • micro coupé"
        : "appel MP";

    cameraButton.textContent =
      dmCall.camera
        ? "📹"
        : "📷";

    cameraButton.classList.toggle(
      "active",
      dmCall.camera
    );

    cameraButton.disabled =
      false;

    cameraButton.setAttribute(
      "aria-disabled",
      "false"
    );

    cameraButton.title =
      dmCall.camera
        ? "Couper la caméra de l'appel MP"
        : "Activer la caméra de l'appel MP";

    if (
      leaveVoiceQuickButton
    ) {
      leaveVoiceQuickButton.disabled =
        false;

      leaveVoiceQuickButton.title =
        dmCall.phase ===
          "incoming"
          ? "Refuser l'appel MP"
          : (
              dmCall.phase ===
                "outgoing"
                ? "Annuler l'appel MP"
                : "Raccrocher l'appel MP"
            );
    }

    return true;
  }

  if (
    leaveVoiceQuickButton
  ) {
    leaveVoiceQuickButton.disabled =
      !voiceJoined;

    leaveVoiceQuickButton.title =
      voiceJoined
        ? "Quitter le vocal"
        : "Aucun appel/vocal en cours";
  }

  return false;
}

window.addEventListener(
  "people-dm-call-state",
  () => {
    peopleSyncUnifiedCallControls();
  }
);
// === PEOPLE_UNIFIED_CALL_CONTROLS_V3_END ===

function updateMicUi() {
  if (
    peopleDmCallStateForControls()
  ) {
    peopleSyncUnifiedCallControls();
    return;
  }

  if (!voiceJoined || !localStream) {
    muteButton.textContent = micMuted ? "🔇" : "🎙️";
    micState.textContent = micMuted
      ? "micro coupé"
      : "";
    muteButton.title = micMuted
      ? "Réactiver le micro avant de rejoindre"
      : "Couper le micro avant de rejoindre";

    peopleSyncUnifiedCallControls();
    return;
  }

  for (const track of localStream.getAudioTracks()) {
    track.enabled = !micMuted;
  }

  muteButton.textContent = micMuted ? "🔇" : "🎙️";
  micState.textContent = micMuted ? "micro coupé" : "micro activé";

  socket.emit("voice-mute", { muted: micMuted });

  peopleSyncUnifiedCallControls();
}

function updateCameraUi() {
  if (
    peopleDmCallStateForControls()
  ) {
    peopleSyncUnifiedCallControls();
    return;
  }

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

  peopleSyncUnifiedCallControls();
}

function peopleVoiceJoinRequest(
  serverId =
    activeVoiceServerId ||
    peopleActiveServerId
) {
  return new Promise(
    (resolve) => {
      let finished =
        false;

      const finish =
        (response) => {
          if (finished) {
            return;
          }

          finished =
            true;

          clearTimeout(
            timer
          );

          resolve(
            response || {
              ok: false,
              error:
                "Le serveur vocal n'a pas répondu."
            }
          );
        };

      const timer =
        setTimeout(
          () => {
            finish({
              ok: false,
              error:
                "Le serveur vocal n'a pas répondu."
            });
          },
          7000
        );

      socket.emit(
        "voice-join",
        {
          serverId:
            String(
              serverId ||
              ""
            ),
          muted:
            micMuted,
          camera:
            cameraEnabled
        },
        finish
      );
    }
  );
}

function peopleVoiceRejectJoin(
  response
) {
  voiceJoined =
    false;

  closeAllPeers();

  if (cameraTrack) {
    try {
      cameraTrack.stop();
    } catch {}

    cameraTrack =
      null;
  }

  cameraEnabled =
    false;

  if (localStream) {
    for (
      const track of
      localStream.getTracks()
    ) {
      try {
        track.stop();
      } catch {}
    }

    localStream =
      null;
  }

  removeVideoTile(
    socket.id ||
    "local",
    true
  );

  voiceStatus.textContent =
    response?.error ||
    "Impossible de rejoindre le vocal.";

  voiceStatus.classList.remove(
    "connected"
  );

  voiceButton.childNodes[0].nodeValue =
    "🔊 vocal ";

  if (
    leaveVoiceQuickButton
  ) {
    leaveVoiceQuickButton.disabled =
      true;
  }

  updateMicUi();
  updateCameraUi();
  syncVideoStageVisibility();
}

async function joinVoice() {
  if (voiceJoined) return true;

  try {
    voiceStatus.textContent = "Connexion au vocal...";
    await ensureLocalAudio();

    const targetVoiceServerId =
      String(
        peopleActiveServerId ||
        ""
      );

    if (!targetVoiceServerId) {
      throw new Error(
        "Choisis un serveur avant de rejoindre son vocal."
      );
    }

    const response =
      await peopleVoiceJoinRequest(
        targetVoiceServerId
      );

    if (
      !response?.ok
    ) {
      peopleVoiceRejectJoin(
        response
      );

      return false;
    }

    voiceJoined = true;

    activeVoiceServerId =
      String(
        response.serverId ||
        targetVoiceServerId
      );

    peopleSetActiveVoiceRoster(
      response.roster ||
      []
    );

    if (leaveVoiceQuickButton) {
      leaveVoiceQuickButton.disabled = false;
    }

    updateMicUi();
    updateCameraUi();

    peopleSyncVoiceUiContext();

    await peopleConnectActiveVoicePeers();

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

  activeVoiceServerId =
    null;

  activeVoiceRoster =
    [];

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

voiceButton.addEventListener(
  "click",
  () => {
    if (!voiceJoined) {
      void joinVoice();
      return;
    }

    if (
      peopleVoiceSameServer(
        activeVoiceServerId,
        peopleActiveServerId
      )
    ) {
      leaveVoice();
      return;
    }

    voiceStatus.textContent =
      "Tu es déjà dans un vocal. Quitte-le avant d'en rejoindre un autre.";
  }
);

leaveVoiceQuickButton?.addEventListener(
  "click",
  () => {
    const dmCall =
      peopleDmCallStateForControls();

    if (dmCall) {
      window.PeopleDmCalls
        ?.end?.();

      return;
    }

    if (voiceJoined) {
      leaveVoice();
    }
  }
);

muteButton.addEventListener(
  "click",
  () => {
    const dmCall =
      peopleDmCallStateForControls();

    if (dmCall) {
      void window.PeopleDmCalls
        ?.toggleMute?.();

      return;
    }

    micMuted = !micMuted;
    updateMicUi();
  }
);

cameraButton.addEventListener(
  "click",
  async () => {
    const dmCall =
      peopleDmCallStateForControls();

    if (dmCall) {
      await window.PeopleDmCalls
        ?.toggleCamera?.();

      return;
    }

    if (!voiceJoined && !cameraEnabled) {
      voiceStatus.textContent = "Rejoins le vocal pour activer la caméra";
      updateCameraUi();
      return;
    }

    if (cameraEnabled) {
      await disableCamera();
    } else {
      await enableCamera();
    }
  }
);

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
  return activeVoiceRoster.some(
    user =>
      user.id === peerId
  );
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

  const peerIds = activeVoiceRoster
    .map(user => user.id)
    .filter(peerId => peerId && peerId !== socket.id);

  await Promise.allSettled(peerIds.map(peerId => makeOffer(peerId)));
}

socket.on("voice-peers", async (existingPeers) => {
  /*
    Pendant un join/reconnect, l'ACK peut arriver juste
    après cet event. Le roster de l'ACK reconnectera aussi
    les peers, donc on ignore seulement si aucune session
    vocale n'est en cours/prévue.
  */
  if (
    !voiceJoined &&
    !activeVoiceServerId
  ) {
    return;
  }

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

const peopleMemberNameCollator =
  new Intl.Collator(
    "fr",
    {
      sensitivity: "base"
    }
  );

function peopleRenderOnlineUsers(roster) {
  peoplePreloadAppAvatars(
    (
      Array.isArray(
        roster
      )
        ? roster
        : []
    ).map(
      (user) =>
        user?.username
    )
  );

  peopleOnlineRoster =
    Array.isArray(roster)
      ? roster.map(
          (user) => ({
            ...user,
            online:
              user?.online !==
              false
          })
        )
      : [];

  const online =
    peopleOnlineRoster.filter(
      (user) =>
        user.online
    );

  const offline =
    peopleOnlineRoster.filter(
      (user) =>
        !user.online
    );

  if (onlinePanelCount) {
    onlinePanelCount.textContent =
      `${online.length} en ligne • ${offline.length} hors ligne`;
  }

  if (onlinePanelToggleCount) {
    onlinePanelToggleCount.textContent =
      String(
        online.length
      );
  }

  if (!onlineUsersList) {
    return;
  }

  onlineUsersList.innerHTML =
    "";

  if (
    !peopleOnlineRoster.length
  ) {
    const empty =
      document.createElement(
        "div"
      );

    empty.className =
      "online-users-empty";

    empty.textContent =
      "Aucun membre";

    onlineUsersList.appendChild(
      empty
    );

    return;
  }

  const fragment =
    document.createDocumentFragment();

  function sortMembers(list) {
    return [...list].sort(
      (a, b) => {
        if (
          peopleOnlineUserIsSelf(
            a
          )
        ) {
          return -1;
        }

        if (
          peopleOnlineUserIsSelf(
            b
          )
        ) {
          return 1;
        }

        return peopleMemberNameCollator
          .compare(
            String(
              a.username || ""
            ),
            String(
              b.username || ""
            )
          );
      }
    );
  }

  function appendSection(
    label,
    list,
    isOnline
  ) {
    if (!list.length) {
      return;
    }

    const title =
      document.createElement(
        "div"
      );

    title.className =
      "online-users-section-title";

    title.textContent =
      `${label} — ${list.length}`;

    fragment.appendChild(
      title
    );

    for (
      const user
      of sortMembers(list)
    ) {
      const row =
        document.createElement(
          "div"
        );

      row.className =
        "online-user-row";

      if (!isOnline) {
        row.classList.add(
          "offline"
        );
      }

      row.dataset.username =
        user.username;

      const av =
        document.createElement(
          "div"
        );

      av.className =
        "online-user-avatar";

      window.PeopleAvatars
        ?.apply(
          av,
          user.username ||
            "?"
        );

      const info =
        document.createElement(
          "div"
        );

      info.className =
        "online-user-info";

      const name =
        document.createElement(
          "strong"
        );

      name.textContent =
        peopleOnlineUserIsSelf(
          user
        )
          ? (
              user.username ||
              "Invité"
            ) +
            " (toi)"
          : (
              user.username ||
              "Invité"
            );

      // === PEOPLE_MEMBER_PROFILE_V3 ===
      peopleBindProfileUi(
        av,
        user.username,
        "avatar"
      );

      peopleBindProfileUi(
        name,
        user.username,
        "name"
      );

      const status =
        document.createElement(
          "span"
        );

      status.textContent =
        isOnline
          ? "En ligne"
          : "Hors ligne";

      const dot =
        document.createElement(
          "span"
        );

      dot.className =
        "online-user-dot";

      if (!isOnline) {
        dot.classList.add(
          "offline"
        );
      }

      dot.setAttribute(
        "aria-label",
        isOnline
          ? "En ligne"
          : "Hors ligne"
      );

      info.append(
        name,
        status
      );

      row.append(
        av,
        info,
        dot
      );

      fragment.appendChild(
        row
      );
    }
  }

  appendSection(
    "EN LIGNE",
    online,
    true
  );

  appendSection(
    "HORS LIGNE",
    offline,
    false
  );

  onlineUsersList.appendChild(
    fragment
  );
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
