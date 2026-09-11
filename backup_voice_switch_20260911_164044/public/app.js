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
const screenButton = document.getElementById("screenButton");
const leaveVoiceQuickButton = document.getElementById("leaveVoiceQuickButton");
const micState = document.getElementById("micState");
const audioContainer = document.getElementById("audioContainer");
const videoStage = document.getElementById("videoStage");
const videoGrid = document.getElementById("videoGrid");

let username = "";
let localStream = null;
let cameraTrack = null;
let screenTrack = null;
let micMuted = false;
let cameraEnabled = false;
let screenEnabled = false;
let voiceJoined = false;
let lastVoiceRoster = [];

/*
  lastVoiceRoster   = vocal du serveur actuellement AFFICHÉ
  activeVoiceRoster = vocal WebRTC réellement rejoint par cet onglet
*/
let activeVoiceRoster = [];
let activeVoiceServerId = null;

// === PEOPLE_CALL_EVENT_SOUNDS_V5_START ===
function peoplePlayCallEventSound(
  kind
) {
  try {
    return Boolean(
      window.PeopleSounds
        ?.playCallEvent?.(
          kind
        )
    );
  } catch {
    return false;
  }
}
// === PEOPLE_CALL_EVENT_SOUNDS_V5_END ===


// === PEOPLE_CAMERA_FACE_EFFECTS_V1_START ===
function peopleCameraOutputTrack() {
  if (!cameraTrack) return null;
  try {
    return window.PeopleCameraEffects?.getOutputTrack?.(cameraTrack) || cameraTrack;
  } catch {
    return cameraTrack;
  }
}

async function peopleInstallCameraOutputTrack(track) {
  if (!cameraEnabled || !localStream) return;

  for (const current of [...localStream.getVideoTracks()]) {
    if (current === track) continue;
    try { localStream.removeTrack(current); } catch {}
  }

  if (track && !localStream.getVideoTracks().includes(track)) {
    try { localStream.addTrack(track); } catch {}
  }

  attachLocalPreview();

  if (!screenEnabled) {
    for (const pc of peers.values()) {
      try { await peopleSyncOutgoingVideo(pc); } catch (err) {
        console.warn("[People effets caméra/vocal]", err);
      }
    }
  }
}

function peopleUpdateServerEffectsButton() {
  const button = document.getElementById("peopleServerVideoEffects");
  if (!button) return;
  const selected = window.PeopleCameraEffects?.getSelectedEffect?.() || "none";
  const info = window.PeopleCameraEffects?.getSelectedEffectInfo?.();
  button.classList.toggle("people-face-effects-active", selected !== "none");
  button.classList.toggle("hidden", !cameraEnabled || screenEnabled);
  button.title = `Effets de visage${selected !== "none" ? ` • ${info?.label || selected}` : ""}`;
}

window.addEventListener("people-camera-effect-changed", peopleUpdateServerEffectsButton);
window.addEventListener("people-camera-effect-track-changed", (event) => {
  if (!voiceJoined || !cameraEnabled) return;
  const track = event?.detail?.track || peopleCameraOutputTrack();
  void peopleInstallCameraOutputTrack(track);
});
// === PEOPLE_CAMERA_FACE_EFFECTS_V1_END ===

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
  if (
    data?.channelId &&
    peopleActiveTextChannelId &&
    String(data.channelId) !== String(peopleActiveTextChannelId)
  ) {
    return;
  }

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

  const activeChannelRoster =
    activeVoiceChannelId
      ? roster.filter((user) => String(user?.channelId || "") === String(activeVoiceChannelId))
      : roster;

  if (peopleActiveServerId && peopleVoiceSameServer(serverId, peopleActiveServerId)) {
    lastVoiceRoster = roster;
    peopleDispatchServerChannelState({ voice: roster });
  }

  if (
    activeVoiceServerId &&
    peopleVoiceSameServer(
      serverId,
      activeVoiceServerId
    )
  ) {
    // === PEOPLE_REMOTE_VOICE_SOUNDS_V5_START ===
    const localVoiceUsername =
      String(
        username ||
        ""
      )
        .trim()
        .toLocaleLowerCase();

    const isRemoteVoiceUser =
      (user) => {
        if (
          !user?.id ||
          user.id === socket.id
        ) {
          return false;
        }

        /*
          Apres une reconnexion Socket.IO, notre propre ancien
          socket peut encore etre present dans le roster local
          pendant quelques millisecondes. On l'exclut aussi par
          username pour ne pas jouer un faux son de depart.
        */
        if (
          localVoiceUsername &&
          String(
            user?.username ||
            ""
          )
            .trim()
            .toLocaleLowerCase() ===
              localVoiceUsername
        ) {
          return false;
        }

        return true;
      };

    const previousRemoteIds =
      new Set(
        activeVoiceRoster
          .filter(
            isRemoteVoiceUser
          )
          .map(
            (user) =>
              String(user.id)
          )
      );

    const nextRemoteIds =
      new Set(
        activeChannelRoster
          .filter(
            isRemoteVoiceUser
          )
          .map(
            (user) =>
              String(user.id)
          )
      );

    const someoneJoined =
      voiceJoined &&
      [...nextRemoteIds].some(
        (id) =>
          !previousRemoteIds.has(
            id
          )
      );

    const someoneLeft =
      voiceJoined &&
      [...previousRemoteIds].some(
        (id) =>
          !nextRemoteIds.has(
            id
          )
      );
    // === PEOPLE_REMOTE_VOICE_SOUNDS_V5_END ===

    peopleSetActiveVoiceRoster(
      activeChannelRoster
    );

    if (someoneJoined) {
      peoplePlayCallEventSound(
        "join"
      );
    } else if (someoneLeft) {
      peoplePlayCallEventSound(
        "leave"
      );
    }
  }

  if (
    peopleActiveServerId &&
    peopleVoiceSameServer(
      serverId,
      peopleActiveServerId
    )
  ) {
    lastVoiceRoster = roster;
    peopleDispatchServerChannelState({ voice: roster });
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
      activeVoiceServerId,
      activeVoiceChannelId
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
  activeVoiceChannelId =
    String(response.channelId || activeVoiceChannelId || "") || null;

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

    if (user.screen) {
      const screen = document.createElement("span");
      screen.title = "Partage d'écran actif";
      screen.textContent = "🖥️";
      icons.appendChild(screen);
    } else if (user.camera) {
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

    if (isLocal) {
      const effectsButton = document.createElement("button");
      effectsButton.id = "peopleServerVideoEffects";
      effectsButton.className = "people-video-effects-button";
      effectsButton.type = "button";
      effectsButton.textContent = "✨";
      effectsButton.title = "Effets de visage";
      effectsButton.setAttribute("aria-label", "Effets de visage");
      effectsButton.addEventListener("click", (event) => {
        event.stopPropagation();
        window.PeopleCameraEffects?.togglePicker?.(effectsButton);
      });
      tile.appendChild(effectsButton);
    }

    videoGrid.appendChild(tile);
    window.PeopleCameraEffects?.ensureControls?.();
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
  const videoUsers = new Set(
    activeVoiceRoster
      .filter(user => user.camera || user.screen)
      .map(user => user.id)
  );

  if ((cameraEnabled || screenEnabled) && voiceJoined) {
    const tile = ensureVideoTile(socket.id || "local", username || "Moi", true);
    tile.classList.toggle("screen-share", screenEnabled);

    const label = tile.querySelector(".video-label");
    const video = tile.querySelector("video");

    if (video) {
      video.style.objectFit =
        screenEnabled
          ? "contain"
          : "cover";
      video.style.transform =
        screenEnabled
          ? "none"
          : "";
    }

    if (label) {
      label.textContent = screenEnabled
        ? `${username || "Moi"} • partage d'écran`
        : `${username || "Moi"} (toi)`;
    }
  } else {
    removeVideoTile(socket.id || "local", true);
  }

  for (const user of activeVoiceRoster) {
    if (user.id === socket.id) continue;

    if (user.camera || user.screen) {
      const tile = ensureVideoTile(user.id, user.username, false);
      tile.classList.toggle("screen-share", Boolean(user.screen));

      const label = tile.querySelector(".video-label");
      const video = tile.querySelector("video");

      if (video) {
        video.style.objectFit =
          user.screen
            ? "contain"
            : "cover";
      }

      if (label) {
        label.textContent = user.screen
          ? `${user.username} • partage d'écran`
          : user.username;
      }
    } else {
      removeVideoTile(user.id, false);
    }
  }

  for (const tile of [...videoGrid.querySelectorAll(".video-tile:not(.local)")]) {
    const peerId = tile.dataset.peerId;
    const video = tile.querySelector("video");
    const hasLiveVideo =
      video?.srcObject instanceof MediaStream &&
      video.srcObject.getVideoTracks().some(track => track.readyState === "live");
    if (!videoUsers.has(peerId) && !hasLiveVideo) tile.remove();
  }

  syncVideoStageVisibility();
}

function attachLocalPreview() {
  const previewTrack =
    screenEnabled && screenTrack
      ? screenTrack
      : (cameraEnabled ? peopleCameraOutputTrack() : null);

  if (!previewTrack) {
    removeVideoTile(socket.id || "local", true);
    syncVideoStageVisibility();
    return;
  }

  const tile = ensureVideoTile(socket.id || "local", username || "Moi", true);
  tile.classList.toggle("screen-share", screenEnabled);

  const video = tile.querySelector("video");
  const placeholder = tile.querySelector(".video-placeholder");
  const label = tile.querySelector(".video-label");

  if (video) {
    video.srcObject = new MediaStream([previewTrack]);
    video.style.objectFit =
      screenEnabled
        ? "contain"
        : "cover";
    video.style.transform =
      screenEnabled
        ? "none"
        : "";
    video.play().catch(() => {});
  }

  if (placeholder) {
    placeholder.style.display = "none";
  }

  if (label) {
    label.textContent = screenEnabled
      ? `${username || "Moi"} • partage d'écran`
      : `${username || "Moi"} (toi)`;
  }

  peopleUpdateServerEffectsButton();
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
    tile.classList.toggle("screen-share", Boolean(user?.screen));

    const label = tile.querySelector(".video-label");
    if (label) {
      label.textContent = user?.screen
        ? `${user?.username || "Utilisateur"} • partage d'écran`
        : (user?.username || "Caméra");
    }

    const video = tile.querySelector("video");
    const placeholder = tile.querySelector(".video-placeholder");

    if (video) {
      video.srcObject = new MediaStream(videoTracks);
      video.style.objectFit =
        user?.screen
          ? "contain"
          : "cover";
      video.play().catch(() => {});
    }
    if (placeholder) placeholder.style.display = "none";

    for (const track of videoTracks) {
      track.addEventListener("ended", () => {
        const video = document.getElementById(`video-${peerId}`)?.querySelector("video");
        const currentStream = video?.srcObject;
        const stillCurrent = currentStream instanceof MediaStream && currentStream.getTracks().includes(track);
        if (!stillCurrent) return;
        const latest = getVoiceUser(peerId);
        if (!latest?.camera && !latest?.screen) removeVideoTile(peerId, false);
        syncVideoStageVisibility();
      }, { once: true });
    }
  }

  syncVideoStageVisibility();
}

// === PEOPLE_SERVER_RUNTIME_V1_START ===
let peopleActiveServerId = null;
let peopleActiveTextChannelId = null;
let peopleServerChannels = [];
let activeVoiceChannelId = null;
let peopleRequestedVoiceChannelId = null;


function peopleServerChannelById(channelId) {
  const wanted = String(channelId || "");
  return peopleServerChannels.find((item) => String(item?.id || "") === wanted) || null;
}

function peopleDispatchServerChannelState(extra = {}) {
  window.dispatchEvent(new CustomEvent("people-server-channel-state", {
    detail: {
      serverId: peopleActiveServerId,
      activeTextChannelId: peopleActiveTextChannelId,
      activeVoiceServerId,
      activeVoiceChannelId,
      channels: Array.isArray(peopleServerChannels) ? peopleServerChannels : [],
      voice: Array.isArray(lastVoiceRoster) ? lastVoiceRoster : [],
      ...extra
    }
  }));
}

function peopleSetServerChannels(channels, activeChannelId = peopleActiveTextChannelId) {
  peopleServerChannels = Array.isArray(channels) ? channels : [];
  const wanted = String(activeChannelId || "");
  const text = peopleServerChannels.find((item) =>
    item?.type === "text" && String(item.id) === wanted
  ) || peopleServerChannels.find((item) => item?.type === "text") || null;
  peopleActiveTextChannelId = text ? String(text.id) : null;
  peopleDispatchServerChannelState();
}

// === PEOPLE_SERVER_INSTANT_OPEN_V2_START ===
// Les derniers payloads de serveurs visités restent en RAM afin que le
// changement de serveur soit visuellement immédiat, puis le socket remplace
// ce cache par l'état frais du serveur.
const PEOPLE_SERVER_VIEW_CACHE_MAX = 8;
const peopleServerViewCache = new Map();
let peopleServerSelectRequestVersion = 0;

function peopleRememberServerPayload(serverId, payload) {
  const key = String(serverId || "");
  if (!key || !payload?.ok) return;

  peopleServerViewCache.delete(key);
  peopleServerViewCache.set(key, {
    ...payload,
    history: Array.isArray(payload.history) ? payload.history : [],
    online: Array.isArray(payload.online) ? payload.online : [],
    voice: Array.isArray(payload.voice) ? payload.voice : [],
    channels: Array.isArray(payload.channels) ? payload.channels : []
  });

  while (peopleServerViewCache.size > PEOPLE_SERVER_VIEW_CACHE_MAX) {
    const first = peopleServerViewCache.keys().next().value;
    if (first === undefined) break;
    peopleServerViewCache.delete(first);
  }
}

function peopleCachedServerPayload(serverId) {
  const key = String(serverId || "");
  const cached = peopleServerViewCache.get(key);
  if (!cached) return null;

  peopleServerViewCache.delete(key);
  peopleServerViewCache.set(key, cached);
  return cached;
}
// === PEOPLE_SERVER_INSTANT_OPEN_V2_END ===

function peopleApplySelectedServerPayload(
  payload
) {
  peopleSetServerChannels(
    payload?.channels || peopleServerChannels,
    payload?.activeChannelId || peopleActiveTextChannelId
  );

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

  lastVoiceRoster = Array.isArray(payload?.voice) ? payload.voice : [];
  peopleDispatchServerChannelState({ voice: lastVoiceRoster });
}

function peopleSelectServerSocket(
  serverId,
  channelId = null
) {
  return new Promise(
    (resolve) => {
      socket.emit(
        "server-select",
        {
          serverId:
            String(serverId),
          channelId:
            channelId ? String(channelId) : null
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
    peopleActiveServerId = null;
    peopleActiveTextChannelId = null;
    peopleServerChannels = [];
    peopleServerSelectRequestVersion += 1;

    renderChatHistory([]);
    peopleRenderOnlineUsers([]);
    userCount.textContent = "0";
    lastVoiceRoster = [];
    peopleDispatchServerChannelState({ voice: [] });
    peopleSyncVoiceUiContext();
  },

  async selectServer(server) {
    if (!server?.id) {
      return {
        ok: false,
        error: "Serveur invalide."
      };
    }

    const serverId = String(server.id);
    const previousId = peopleActiveServerId;
    const previousPayload = peopleCachedServerPayload(previousId);
    const requestVersion = ++peopleServerSelectRequestVersion;

    /*
      L'état visuel change immédiatement. Si le serveur a déjà été visité,
      son dernier historique apparaît sans attendre le socket. Sinon on vide
      proprement l'ancien serveur au lieu de le laisser affiché.
    */
    peopleActiveServerId = serverId;
    peopleGeneralReplyController?.clear();
    peopleGeneralImagePicker?.clear();

    const cached = peopleCachedServerPayload(serverId);
    peopleApplySelectedServerPayload(
      cached || { history: [], online: [], voice: [], channels: [] }
    );
    peopleSyncVoiceUiContext();

    const response = await peopleSelectServerSocket(serverId, peopleActiveTextChannelId);

    if (!response?.ok) {
      if (
        requestVersion === peopleServerSelectRequestVersion &&
        peopleActiveServerId === serverId
      ) {
        peopleActiveServerId = previousId || null;
        peopleApplySelectedServerPayload(
          previousPayload || { history: [], online: [], voice: [], channels: [] }
        );
        peopleSyncVoiceUiContext();
      }
      return response;
    }

    peopleRememberServerPayload(serverId, response);

    // Une réponse lente d'un ancien clic ne doit jamais écraser le serveur
    // sélectionné entre-temps.
    if (
      requestVersion === peopleServerSelectRequestVersion &&
      peopleActiveServerId === serverId
    ) {
      peopleApplySelectedServerPayload(response);
      peopleSyncVoiceUiContext();
    }

    return response;
  },

  async reselect() {
    if (!peopleActiveServerId) return;

    const serverId = String(peopleActiveServerId);
    const requestVersion = ++peopleServerSelectRequestVersion;
    const response = await peopleSelectServerSocket(serverId, peopleActiveTextChannelId);

    if (!response?.ok) {
      if (
        requestVersion === peopleServerSelectRequestVersion &&
        peopleActiveServerId === serverId
      ) {
        peopleActiveServerId = null;
        window.dispatchEvent(
          new CustomEvent("people-server-invalid")
        );
      }
      return;
    }

    peopleRememberServerPayload(serverId, response);

    if (
      requestVersion === peopleServerSelectRequestVersion &&
      peopleActiveServerId === serverId
    ) {
      peopleApplySelectedServerPayload(response);
      /*
        Le reselect concerne seulement le serveur TEXTE affiché.
        La reconnexion du vocal utilise activeVoiceServerId
        via l'événement people-ready.
      */
      peopleSyncVoiceUiContext();
    }
  },

  async selectTextChannel(channelId) {
    const sid = String(peopleActiveServerId || "");
    const cid = String(channelId || "");
    if (!sid || !cid) return { ok: false, error: "Salon invalide." };

    const response = await new Promise((resolve) => {
      socket.emit("server-channel-select", { serverId: sid, channelId: cid }, (value) => {
        resolve(value || { ok: false, error: "Le serveur n'a pas répondu." });
      });
    });

    if (!response?.ok) return response;
    peopleActiveTextChannelId = String(response.activeChannelId || cid);
    peopleGeneralReplyController?.clear();
    peopleGeneralImagePicker?.clear();
    renderChatHistory(response.history || []);

    const cached = peopleCachedServerPayload(sid) || {};
    peopleRememberServerPayload(sid, {
      ...cached,
      ok: true,
      channels: peopleServerChannels,
      activeChannelId: peopleActiveTextChannelId,
      history: response.history || []
    });

    peopleDispatchServerChannelState();
    return response;
  },

  async joinVoiceChannel(channelId) {
    const cid = String(channelId || "");
    if (!cid) return false;
    peopleRequestedVoiceChannelId = cid;
    if (voiceJoined) {
      if (
        peopleVoiceSameServer(activeVoiceServerId, peopleActiveServerId) &&
        String(activeVoiceChannelId || "") === cid
      ) {
        leaveVoice();
        return true;
      }
      voiceStatus.textContent = "Tu es déjà dans un autre vocal. Quitte-le avant d'en rejoindre un autre.";
      return false;
    }
    return await joinVoice(cid);
  },

  leaveVoiceChannel() {
    if (voiceJoined) leaveVoice();
  },

  getChannels() {
    return Array.isArray(peopleServerChannels) ? [...peopleServerChannels] : [];
  },

  getActiveTextChannelId() {
    return peopleActiveTextChannelId;
  },

  getActiveVoiceChannelId() {
    return activeVoiceChannelId;
  },

  getActiveVoiceServerId() {
    return activeVoiceServerId;
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
        channelId: peopleActiveTextChannelId,
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

socket.on("server-channels-updated", ({ serverId, channels } = {}) => {
  if (String(serverId || "") !== String(peopleActiveServerId || "")) return;
  const previous = peopleActiveTextChannelId;
  peopleSetServerChannels(channels || [], previous);
  if (previous && !peopleServerChannelById(previous) && peopleActiveTextChannelId) {
    void window.PeopleServerRuntime?.selectTextChannel?.(peopleActiveTextChannelId);
  }
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
  ({ id, channelId } = {}) => {
    if (channelId && peopleActiveTextChannelId && String(channelId) !== String(peopleActiveTextChannelId)) return;
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
socket.on("system-message", (data) => {
  if (data?.channelId && peopleActiveTextChannelId && String(data.channelId) !== String(peopleActiveTextChannelId)) return;
  addSystemMessage(data);
});
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

  screenButton?.classList.toggle(
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

    if (screenButton) {
      screenButton.textContent =
        dmCall.screen
          ? "🛑"
          : "🖥️";

      screenButton.classList.toggle(
        "active",
        Boolean(dmCall.screen)
      );

      screenButton.disabled = false;
      screenButton.setAttribute(
        "aria-disabled",
        "false"
      );

      screenButton.title =
        dmCall.screen
          ? "Arrêter le partage d'écran de l'appel MP"
          : "Partager l'écran dans l'appel MP";
    }

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

function updateScreenUi() {
  if (
    peopleDmCallStateForControls()
  ) {
    peopleSyncUnifiedCallControls();
    return;
  }

  if (!screenButton) {
    return;
  }

  screenButton.textContent =
    screenEnabled
      ? "🛑"
      : "🖥️";

  screenButton.classList.toggle(
    "active",
    screenEnabled
  );

  const allowed =
    voiceJoined ||
    screenEnabled;

  screenButton.disabled = !allowed;
  screenButton.setAttribute(
    "aria-disabled",
    allowed ? "false" : "true"
  );

  screenButton.title =
    screenEnabled
      ? "Arrêter le partage d'écran"
      : (
          voiceJoined
            ? "Partager l'écran"
            : "Rejoins le vocal pour partager ton écran"
        );
}

function peopleVoiceJoinRequest(
  serverId =
    activeVoiceServerId ||
    peopleActiveServerId,
  channelId =
    activeVoiceChannelId ||
    peopleRequestedVoiceChannelId
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
          channelId:
            channelId ? String(channelId) : null,
          muted:
            micMuted,
          camera:
            cameraEnabled,
          screen:
            screenEnabled
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
    try { window.PeopleCameraEffects?.detachSource?.(cameraTrack); } catch {}
    try {
      cameraTrack.stop();
    } catch {}

    cameraTrack =
      null;
  }

  cameraEnabled =
    false;

  if (screenTrack) {
    try {
      screenTrack.stop();
    } catch {}

    screenTrack = null;
  }

  screenEnabled = false;

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
  updateScreenUi();
  syncVideoStageVisibility();
}

async function joinVoice(channelId = peopleRequestedVoiceChannelId) {
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
        targetVoiceServerId,
        channelId
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

    peoplePlayCallEventSound(
      "join"
    );

    activeVoiceServerId =
      String(
        response.serverId ||
        targetVoiceServerId
      );

    activeVoiceChannelId =
      String(response.channelId || channelId || "") || null;
    peopleRequestedVoiceChannelId = activeVoiceChannelId;

    peopleSetActiveVoiceRoster(
      response.roster ||
      []
    );

    if (leaveVoiceQuickButton) {
      leaveVoiceQuickButton.disabled = false;
    }

    updateMicUi();
    updateCameraUi();
    updateScreenUi();

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
      video:
        window.PeopleAudioDevices
          ?.getCameraConstraints?.({
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, max: 30 }
          }) ||
        {
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

    let outgoingTrack = cameraTrack;
    try {
      outgoingTrack = await window.PeopleCameraEffects?.attachSource?.(cameraTrack) || cameraTrack;
    } catch (err) {
      console.warn("[People effets caméra/activation vocal]", err);
      outgoingTrack = cameraTrack;
    }

    localStream.addTrack(outgoingTrack);

    const activeCameraTrack = cameraTrack;

    cameraTrack.addEventListener("ended", () => {
      if (cameraEnabled && cameraTrack === activeCameraTrack) {
        disableCamera({ trackAlreadyEnded: true });
      }
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

// === PEOPLE_VOICE_CAMERA_DEVICE_SWITCH_V1_START ===
async function peopleSwitchVoiceCameraDevice() {
  if (!voiceJoined || !cameraEnabled || !cameraTrack) {
    return;
  }

  const oldTrack = cameraTrack;

  try {
    const replacementStream =
      await navigator.mediaDevices.getUserMedia({
        audio: false,
        video:
          window.PeopleAudioDevices
            ?.getCameraConstraints?.({
              facingMode: "user",
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 24, max: 30 }
            }) ||
          {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, max: 30 }
          }
      });

    const newTrack =
      replacementStream.getVideoTracks()[0];

    if (!newTrack) {
      throw new Error("Aucune caméra disponible");
    }

    cameraTrack = newTrack;

    let outgoingTrack = newTrack;

    try {
      outgoingTrack =
        await window.PeopleCameraEffects?.attachSource?.(newTrack) ||
        newTrack;
    } catch (err) {
      console.warn(
        "[People effets caméra/changement vocal]",
        err
      );
    }

    await peopleInstallCameraOutputTrack(outgoingTrack);

    newTrack.addEventListener(
      "ended",
      () => {
        if (cameraEnabled && cameraTrack === newTrack) {
          void disableCamera({ trackAlreadyEnded: true });
        }
      },
      { once: true }
    );

    try {
      oldTrack.stop();
    } catch {}

    updateCameraUi();
    voiceStatus.textContent =
      "Caméra changée ✓";
  } catch (err) {
    console.warn(
      "[People changement caméra vocal]",
      err
    );

    voiceStatus.textContent =
      "Impossible d'utiliser cette caméra";
  }
}

window.addEventListener(
  "people-camera-input-device-changed",
  () => {
    void peopleSwitchVoiceCameraDevice();
  }
);
// === PEOPLE_VOICE_CAMERA_DEVICE_SWITCH_V1_END ===

async function disableCamera({ trackAlreadyEnded = false } = {}) {
  if (!cameraEnabled && !cameraTrack) return;

  const oldTrack = cameraTrack;
  const oldOutput = peopleCameraOutputTrack();
  cameraEnabled = false;

  if (localStream) {
    for (const current of [...localStream.getVideoTracks()]) {
      try { localStream.removeTrack(current); } catch {}
    }
  }

  try { window.PeopleCameraEffects?.detachSource?.(oldTrack); } catch {}
  cameraTrack = null;

  if (oldTrack && !trackAlreadyEnded) {
    try { oldTrack.stop(); } catch {}
  }

  if (oldOutput && oldOutput !== oldTrack) {
    try { oldOutput.stop(); } catch {}
  }

  removeVideoTile(socket.id || "local", true);
  updateCameraUi();
  socket.emit("voice-camera", { camera: false });
  syncVideoStageVisibility();

  if (voiceJoined) {
    await rebuildPeersForMediaChange();
  }
}

async function enableScreenShare() {
  if (screenEnabled) return;

  if (!voiceJoined) {
    voiceStatus.textContent =
      "Rejoins le vocal pour partager ton écran";
    updateScreenUi();
    return;
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    voiceStatus.textContent =
      "Le partage d'écran n'est pas disponible ici";
    return;
  }

  try {
    if (screenButton) {
      screenButton.textContent = "…";
    }

    const displayStream =
      await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: {
            ideal: 30,
            max: 60
          }
        },
        audio: false
      });

    const track =
      displayStream.getVideoTracks()[0];

    if (!track) {
      throw new Error(
        "Aucun écran sélectionné."
      );
    }

    screenTrack = track;
    screenEnabled = true;

    screenTrack.addEventListener(
      "ended",
      () => {
        if (screenEnabled) {
          void disableScreenShare({
            trackAlreadyEnded: true
          });
        }
      },
      { once: true }
    );

    attachLocalPreview();
    updateScreenUi();

    socket.emit(
      "voice-screen",
      { screen: true }
    );

    await rebuildPeersForMediaChange();

    voiceStatus.textContent =
      "Partage d'écran actif";
  } catch (err) {
    console.warn(
      "[People partage écran vocal]",
      err
    );

    screenEnabled = false;
    screenTrack = null;
    updateScreenUi();

    if (err?.name !== "NotAllowedError") {
      voiceStatus.textContent =
        "Partage d'écran indisponible";
    }
  }
}

async function disableScreenShare({
  trackAlreadyEnded = false
} = {}) {
  if (!screenEnabled && !screenTrack) {
    return;
  }

  const oldTrack = screenTrack;
  screenEnabled = false;
  screenTrack = null;

  if (
    oldTrack &&
    !trackAlreadyEnded
  ) {
    try {
      oldTrack.stop();
    } catch {}
  }

  attachLocalPreview();
  updateScreenUi();

  socket.emit(
    "voice-screen",
    { screen: false }
  );

  if (voiceJoined) {
    await rebuildPeersForMediaChange();

    voiceStatus.textContent =
      "Connecté au vocal";
  }
}

function leaveVoice() {
  if (!voiceJoined) return;

  peoplePlayCallEventSound(
    "leave"
  );

  socket.emit("voice-leave");
  voiceJoined = false;

  activeVoiceServerId =
    null;
  activeVoiceChannelId = null;
  peopleRequestedVoiceChannelId = null;

  activeVoiceRoster =
    [];

  if (leaveVoiceQuickButton) {
    leaveVoiceQuickButton.disabled = true;
  }

  closeAllPeers();

  if (cameraTrack) {
    try { window.PeopleCameraEffects?.detachSource?.(cameraTrack); } catch {}
    try { cameraTrack.stop(); } catch {}
    cameraTrack = null;
  }
  cameraEnabled = false;

  if (screenTrack) {
    try { screenTrack.stop(); } catch {}
    screenTrack = null;
  }
  screenEnabled = false;

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
  updateScreenUi();
  syncVideoStageVisibility();
  peopleDispatchServerChannelState();
}

voiceButton.addEventListener(
  "click",
  () => {
    if (!voiceJoined) {
      const fallbackVoice = peopleServerChannels.find((item) => item?.type === "voice");
      peopleRequestedVoiceChannelId = fallbackVoice ? String(fallbackVoice.id) : null;
      void joinVoice(peopleRequestedVoiceChannelId);
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

    peoplePlayCallEventSound(
      micMuted
        ? "mute"
        : "unmute"
    );

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

screenButton?.addEventListener(
  "click",
  async () => {
    const dmCall =
      peopleDmCallStateForControls();

    if (dmCall) {
      await window.PeopleDmCalls
        ?.toggleScreen?.();

      return;
    }

    if (!voiceJoined && !screenEnabled) {
      voiceStatus.textContent =
        "Rejoins le vocal pour partager ton écran";
      updateScreenUi();
      return;
    }

    if (screenEnabled) {
      await disableScreenShare();
    } else {
      await enableScreenShare();
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
  if (!user?.camera && !user?.screen) {
    removeVideoTile(peerId, false);
  }
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

// === PEOPLE_STREAM_INTEROP_V4_APP_START ===
function peoplePreferCompatibleVideoCodec(pc, transceiver) {
  try {
    if (!transceiver?.setCodecPreferences || typeof RTCRtpSender?.getCapabilities !== "function") return;
    const codecs = RTCRtpSender.getCapabilities("video")?.codecs || [];
    const preferred = [
      ...codecs.filter(codec => String(codec.mimeType || "").toLowerCase() === "video/vp8"),
      ...codecs.filter(codec => String(codec.mimeType || "").toLowerCase() !== "video/vp8")
    ];
    if (preferred.length) transceiver.setCodecPreferences(preferred);
  } catch (err) {
    console.warn("[People stream/codec]", err);
  }
}

function peopleFindVideoTransceiver(pc) {
  if (!pc) return null;
  return pc.getTransceivers().find(transceiver =>
    transceiver.sender?.track?.kind === "video" ||
    transceiver.receiver?.track?.kind === "video"
  ) || null;
}

async function peopleSyncOutgoingVideo(pc) {
  if (!pc) return;
  const wantedTrack = screenEnabled && screenTrack
    ? screenTrack
    : (cameraEnabled && cameraTrack ? peopleCameraOutputTrack() : null);
  let transceiver = peopleFindVideoTransceiver(pc);
  if (!transceiver) {
    transceiver = pc.addTransceiver("video", { direction: wantedTrack ? "sendrecv" : "recvonly" });
  }
  peoplePreferCompatibleVideoCodec(pc, transceiver);
  const sender = transceiver.sender;
  if (sender.track !== wantedTrack) await sender.replaceTrack(wantedTrack || null);
  transceiver.direction = wantedTrack ? "sendrecv" : "recvonly";
}

function createPeer(peerId) {
  if (peers.has(peerId)) return peers.get(peerId);

  const pc = new RTCPeerConnection(rtcConfig);

  if (localStream) {
    for (const track of localStream.getTracks()) {
      if (
        track.kind === "video" &&
        screenEnabled &&
        screenTrack
      ) {
        continue;
      }

      pc.addTrack(track, localStream);
    }
  }

  if (screenEnabled && screenTrack) {
    pc.addTrack(
      screenTrack,
      new MediaStream([screenTrack])
    );
  }

  let videoTransceiver = peopleFindVideoTransceiver(pc);
  if (!videoTransceiver) {
    videoTransceiver = pc.addTransceiver("video", { direction: "recvonly" });
  }
  peoplePreferCompatibleVideoCodec(pc, videoTransceiver);

  pc.onicecandidate = (event) => {
    if (!event.candidate) return;

    socket.emit("webrtc-ice-candidate", {
      target: peerId,
      candidate: event.candidate
    });
  };

  pc.ontrack = (event) => {
    const stream = event.streams?.[0] || (event.track ? new MediaStream([event.track]) : null);
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

  const pc = createPeer(peerId);
  await peopleSyncOutgoingVideo(pc);
  if (pc.signalingState !== "stable") return;

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

  await Promise.allSettled(peerIds.map(async peerId => {
    const pc = createPeer(peerId);
    await peopleSyncOutgoingVideo(pc);
    await makeOffer(peerId);
  }));
}

// === PEOPLE_STREAM_INTEROP_V4_APP_END ===

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
    const pc = createPeer(from);
    if (pc.signalingState === "have-local-offer") {
      try { await pc.setLocalDescription({ type: "rollback" }); } catch {}
    }

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await peopleSyncOutgoingVideo(pc);
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
updateScreenUi();

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
