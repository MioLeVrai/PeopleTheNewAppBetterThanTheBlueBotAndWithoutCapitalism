(() => {
  "use strict";

  // === PEOPLE_DM_CALLS_V1_START ===

  const dmView =
    document.getElementById(
      "dmView"
    );

  const dmHeader =
    dmView?.querySelector(
      ".dm-header"
    );

  const dmHeaderName =
    document.getElementById(
      "dmHeaderName"
    );

  if (
    !dmView ||
    !dmHeader ||
    !dmHeaderName ||
    typeof socket === "undefined"
  ) {
    return;
  }

  const rtcConfig = {
    iceServers: [
      {
        urls:
          "stun:stun.l.google.com:19302"
      },
      {
        urls:
          "stun:stun1.l.google.com:19302"
      },
      {
        urls:
          "stun:stun.cloudflare.com:3478"
      }
    ],
    iceCandidatePoolSize: 10
  };

  let call = null;
  let peer = null;
  let localStream = null;
  let remoteStream = null;
  let cameraTrack = null;
  let micMuted = false;
  let cameraEnabled = false;
  let pendingIce = [];

  let audioContext = null;
  let ringingTimer = null;
  let ringingKind = null;

  const callButton =
    document.createElement(
      "button"
    );

  callButton.id =
    "peopleDmCallButton";

  callButton.className =
    "people-dm-call-button";

  callButton.type =
    "button";

  callButton.title =
    "Appeler";

  callButton.setAttribute(
    "aria-label",
    "Appeler"
  );

  callButton.innerHTML =
    "<span>📞</span><strong>Appeler</strong>";

  dmHeader.appendChild(
    callButton
  );

  const overlay =
    document.createElement(
      "div"
    );

  overlay.id =
    "peopleDmCallOverlay";

  overlay.className =
    "people-dm-call-overlay hidden";

  overlay.innerHTML = `
    <section
      class="people-dm-call-card"
      role="dialog"
      aria-modal="true"
      aria-label="Appel People"
    >
      <div class="people-dm-call-glow"></div>

      <div class="people-dm-call-stage">
        <video
          id="peopleDmCallRemoteVideo"
          class="people-dm-call-remote-video hidden"
          autoplay
          playsinline
        ></video>

        <audio
          id="peopleDmCallRemoteAudio"
          autoplay
        ></audio>

        <div
          id="peopleDmCallIdentity"
          class="people-dm-call-identity"
        >
          <div
            id="peopleDmCallAvatar"
            class="people-dm-call-avatar"
          >?</div>

          <strong
            id="peopleDmCallName"
          >Appel People</strong>

          <span
            id="peopleDmCallStatus"
          >Connexion…</span>
        </div>

        <video
          id="peopleDmCallLocalVideo"
          class="people-dm-call-local-video hidden"
          autoplay
          muted
          playsinline
        ></video>
      </div>

      <div
        id="peopleDmCallIncomingActions"
        class="people-dm-call-incoming-actions hidden"
      >
        <button
          id="peopleDmCallDecline"
          class="people-dm-call-big-action decline"
          type="button"
        >
          <span>📵</span>
          <small>Refuser</small>
        </button>

        <button
          id="peopleDmCallAccept"
          class="people-dm-call-big-action accept"
          type="button"
        >
          <span>📞</span>
          <small>Accepter</small>
        </button>
      </div>

      <div
        id="peopleDmCallOutgoingActions"
        class="people-dm-call-outgoing-actions hidden"
      >
        <button
          id="peopleDmCallCancel"
          class="people-dm-call-big-action decline"
          type="button"
        >
          <span>📵</span>
          <small>Annuler</small>
        </button>
      </div>

      <div
        id="peopleDmCallActiveActions"
        class="people-dm-call-active-actions hidden"
      >
        <button
          id="peopleDmCallMute"
          class="people-dm-call-control"
          type="button"
          title="Couper le micro"
        >
          <span>🎙️</span>
          <small>Micro</small>
        </button>

        <button
          id="peopleDmCallCamera"
          class="people-dm-call-control"
          type="button"
          title="Activer la caméra"
        >
          <span>📷</span>
          <small>Caméra</small>
        </button>

        <button
          id="peopleDmCallHangup"
          class="people-dm-call-control danger"
          type="button"
          title="Raccrocher"
        >
          <span>📞</span>
          <small>Raccrocher</small>
        </button>
      </div>
    </section>
  `;

  document.body.appendChild(
    overlay
  );

  const remoteVideo =
    document.getElementById(
      "peopleDmCallRemoteVideo"
    );

  const remoteAudio =
    document.getElementById(
      "peopleDmCallRemoteAudio"
    );

  const localVideo =
    document.getElementById(
      "peopleDmCallLocalVideo"
    );

  const identity =
    document.getElementById(
      "peopleDmCallIdentity"
    );

  const avatar =
    document.getElementById(
      "peopleDmCallAvatar"
    );

  const callName =
    document.getElementById(
      "peopleDmCallName"
    );

  const callStatus =
    document.getElementById(
      "peopleDmCallStatus"
    );

  const incomingActions =
    document.getElementById(
      "peopleDmCallIncomingActions"
    );

  const outgoingActions =
    document.getElementById(
      "peopleDmCallOutgoingActions"
    );

  const activeActions =
    document.getElementById(
      "peopleDmCallActiveActions"
    );

  const acceptButton =
    document.getElementById(
      "peopleDmCallAccept"
    );

  const declineButton =
    document.getElementById(
      "peopleDmCallDecline"
    );

  const cancelButton =
    document.getElementById(
      "peopleDmCallCancel"
    );

  const muteButton =
    document.getElementById(
      "peopleDmCallMute"
    );

  const cameraButton =
    document.getElementById(
      "peopleDmCallCamera"
    );

  const hangupButton =
    document.getElementById(
      "peopleDmCallHangup"
    );

  function unlockCallAudio() {
    try {
      if (!audioContext) {
        audioContext =
          new (
            window.AudioContext ||
            window.webkitAudioContext
          )();
      }

      if (
        audioContext.state ===
        "suspended"
      ) {
        audioContext
          .resume()
          .catch(() => {});
      }
    } catch {}
  }

  document.addEventListener(
    "pointerdown",
    unlockCallAudio,
    {
      passive: true
    }
  );

  document.addEventListener(
    "keydown",
    unlockCallAudio
  );

  function playTone(
    frequency,
    delay = 0,
    duration = 0.18,
    volume = 0.065
  ) {
    unlockCallAudio();

    if (
      !audioContext ||
      audioContext.state !==
        "running"
    ) {
      return;
    }

    const start =
      audioContext.currentTime +
      delay;

    const oscillator =
      audioContext.createOscillator();

    const gain =
      audioContext.createGain();

    oscillator.type =
      "sine";

    oscillator.frequency.setValueAtTime(
      frequency,
      start
    );

    gain.gain.setValueAtTime(
      0.0001,
      start
    );

    gain.gain.exponentialRampToValueAtTime(
      volume,
      start + 0.018
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      start + duration
    );

    oscillator.connect(
      gain
    );

    gain.connect(
      audioContext.destination
    );

    oscillator.start(
      start
    );

    oscillator.stop(
      start +
      duration +
      0.03
    );
  }

  function ringPulse(kind) {
    // === PEOPLE_SETTINGS_RINGTONE_HOOK_V1 ===
    if (
      window.PeopleSounds
        ?.playRingtonePulse?.(
          kind
        )
    ) {
      return;
    }

    if (
      kind ===
      "incoming"
    ) {
      playTone(
        784,
        0,
        0.18,
        0.075
      );

      playTone(
        988,
        0.24,
        0.2,
        0.075
      );

      playTone(
        784,
        0.52,
        0.18,
        0.065
      );

      return;
    }

    playTone(
      440,
      0,
      0.14,
      0.045
    );

    playTone(
      554,
      0.2,
      0.14,
      0.045
    );
  }

  function startRinging(kind) {
    stopRinging();

    ringingKind =
      kind;

    ringPulse(
      ringingKind
    );

    ringingTimer =
      setInterval(
        () => {
          ringPulse(
            ringingKind
          );
        },
        kind === "incoming"
          ? 1700
          : 2200
      );
  }

  function stopRinging() {
    if (ringingTimer) {
      clearInterval(
        ringingTimer
      );
    }

    ringingTimer = null;
    ringingKind = null;
  }

  function showOverlay() {
    overlay.classList.remove(
      "hidden"
    );

    requestAnimationFrame(
      () => {
        overlay.classList.add(
          "visible"
        );
      }
    );
  }

  function hideOverlay() {
    overlay.classList.remove(
      "visible"
    );

    setTimeout(
      () => {
        if (!call) {
          overlay.classList.add(
            "hidden"
          );
        }
      },
      190
    );
  }

  function setCallPerson(
    username
  ) {
    const name =
      String(
        username ||
        "Utilisateur"
      );

    callName.textContent =
      name;

    avatar.textContent =
      name
        .trim()
        .slice(0, 2)
        .toUpperCase() ||
      "?";

    window.PeopleAvatars
      ?.apply(
        avatar,
        name
      );
  }

  function setStatus(
    text
  ) {
    callStatus.textContent =
      String(
        text ||
        ""
      );
  }

  // === PEOPLE_DM_CALL_GLOBAL_BRIDGE_V3 ===
  function peopleDmCallPublicState() {
    return {
      exists:
        Boolean(call),
      phase:
        call?.phase ||
        "none",
      username:
        String(
          call?.username ||
          ""
        ),
      muted:
        Boolean(
          micMuted
        ),
      camera:
        Boolean(
          cameraEnabled
        )
    };
  }

  function peopleDmCallPublishState() {
    window.dispatchEvent(
      new CustomEvent(
        "people-dm-call-state",
        {
          detail:
            peopleDmCallPublicState()
        }
      )
    );
  }

  function showMode(
    mode
  ) {
    incomingActions
      .classList.toggle(
        "hidden",
        mode !== "incoming"
      );

    outgoingActions
      .classList.toggle(
        "hidden",
        mode !== "outgoing"
      );

    activeActions
      .classList.toggle(
        "hidden",
        mode !== "active"
      );

    identity.classList.toggle(
      "with-video",
      mode === "active" &&
      !remoteVideo.classList
        .contains("hidden")
    );

    if (call) {
      call.phase =
        mode;
    }

    peopleDmCallPublishState();
  }

  function currentDmUsername() {
    if (
      dmView.classList
        .contains(
          "hidden"
        )
    ) {
      return "";
    }

    const username =
      String(
        dmHeaderName
          .textContent ||
        ""
      ).trim();

    if (
      !username ||
      username ===
        "Message privé"
    ) {
      return "";
    }

    return username;
  }

  function updateMediaButtons() {
    muteButton.classList.toggle(
      "active",
      micMuted
    );

    muteButton.querySelector(
      "span"
    ).textContent =
      micMuted
        ? "🔇"
        : "🎙️";

    muteButton.querySelector(
      "small"
    ).textContent =
      micMuted
        ? "Muet"
        : "Micro";

    muteButton.title =
      micMuted
        ? "Réactiver le micro"
        : "Couper le micro";

    cameraButton.classList.toggle(
      "active",
      cameraEnabled
    );

    cameraButton.querySelector(
      "span"
    ).textContent =
      cameraEnabled
        ? "📹"
        : "📷";

    cameraButton.querySelector(
      "small"
    ).textContent =
      cameraEnabled
        ? "Cam active"
        : "Caméra";

    cameraButton.title =
      cameraEnabled
        ? "Couper la caméra"
        : "Activer la caméra";

    peopleDmCallPublishState();
  }

  function syncLocalPreview() {
    if (
      cameraEnabled &&
      cameraTrack &&
      localStream
    ) {
      localVideo.srcObject =
        new MediaStream(
          [cameraTrack]
        );

      localVideo.classList.remove(
        "hidden"
      );

      localVideo
        .play()
        .catch(() => {});

      return;
    }

    try {
      localVideo.srcObject =
        null;
    } catch {}

    localVideo.classList.add(
      "hidden"
    );
  }

  function syncRemoteMedia() {
    if (!remoteStream) {
      return;
    }

    const audioTracks =
      remoteStream
        .getAudioTracks()
        .filter(
          (track) =>
            track.readyState ===
            "live"
        );

    remoteAudio.srcObject =
      new MediaStream(
        audioTracks
      );

    remoteAudio
      .play()
      .catch(() => {});

    const videoTracks =
      remoteStream
        .getVideoTracks()
        .filter(
          (track) =>
            track.readyState ===
            "live"
        );

    if (
      videoTracks.length &&
      call?.remoteCamera
    ) {
      remoteVideo.srcObject =
        new MediaStream(
          videoTracks
        );

      remoteVideo.classList.remove(
        "hidden"
      );

      remoteVideo
        .play()
        .catch(() => {});

      identity.classList.add(
        "with-video"
      );
    } else {
      try {
        remoteVideo.srcObject =
          null;
      } catch {}

      remoteVideo.classList.add(
        "hidden"
      );

      identity.classList.remove(
        "with-video"
      );
    }
  }

  async function ensureLocalAudio() {
    const liveAudio =
      localStream
        ?.getAudioTracks()
        .find(
          (track) =>
            track.readyState ===
            "live"
        );

    if (liveAudio) {
      liveAudio.enabled =
        !micMuted;

      return localStream;
    }

    try {
      const stream =
        await navigator
          .mediaDevices
          .getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1
            },
            video: false
          });

      if (!localStream) {
        localStream =
          new MediaStream();
      }

      for (
        const track of
        stream.getAudioTracks()
      ) {
        track.enabled =
          !micMuted;

        localStream.addTrack(
          track
        );

        if (peer) {
          peer.addTrack(
            track,
            localStream
          );
        }
      }

      return localStream;
    } catch (err) {
      console.warn(
        "[People appel MP/micro]",
        err
      );

      setStatus(
        "Micro indisponible — tu peux quand même écouter"
      );

      if (!localStream) {
        localStream =
          new MediaStream();
      }

      return localStream;
    }
  }

  function createPeer() {
    if (peer) {
      return peer;
    }

    peer =
      new RTCPeerConnection(
        rtcConfig
      );

    if (localStream) {
      for (
        const track of
        localStream.getTracks()
      ) {
        peer.addTrack(
          track,
          localStream
        );
      }
    }

    remoteStream =
      new MediaStream();

    peer.ontrack =
      (event) => {
        const track =
          event.track;

        if (
          !remoteStream
            .getTracks()
            .some(
              (current) =>
                current.id ===
                track.id
            )
        ) {
          remoteStream.addTrack(
            track
          );
        }

        track.addEventListener(
          "ended",
          syncRemoteMedia,
          {
            once: true
          }
        );

        syncRemoteMedia();
      };

    peer.onicecandidate =
      (event) => {
        if (
          !event.candidate ||
          !call?.id ||
          !call?.peerSocketId
        ) {
          return;
        }

        socket.emit(
          "dm-call-webrtc-ice",
          {
            callId:
              call.id,
            target:
              call.peerSocketId,
            candidate:
              event.candidate
          }
        );
      };

    peer.onconnectionstatechange =
      () => {
        if (!peer) {
          return;
        }

        const state =
          peer.connectionState;

        if (
          state ===
          "connected"
        ) {
          setStatus(
            "Appel en cours"
          );
        }

        if (
          state ===
            "failed" ||
          state ===
            "disconnected"
        ) {
          setStatus(
            "Connexion instable…"
          );
        }
      };

    return peer;
  }

  async function flushIce() {
    if (
      !peer ||
      !peer.remoteDescription
    ) {
      return;
    }

    const queued =
      pendingIce;

    pendingIce = [];

    for (
      const candidate of queued
    ) {
      try {
        await peer.addIceCandidate(
          new RTCIceCandidate(
            candidate
          )
        );
      } catch {}
    }
  }

  async function sendOffer() {
    if (
      !call?.id ||
      !call?.peerSocketId
    ) {
      return;
    }

    const pc =
      createPeer();

    if (
      pc.signalingState !==
      "stable"
    ) {
      return;
    }

    const offer =
      await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

    await pc.setLocalDescription(
      offer
    );

    socket.emit(
      "dm-call-webrtc-offer",
      {
        callId:
          call.id,
        target:
          call.peerSocketId,
        sdp:
          pc.localDescription
      }
    );
  }

  async function handleRemoteOffer(
    payload
  ) {
    if (
      !call ||
      payload?.callId !==
        call.id ||
      !payload?.sdp
    ) {
      return;
    }

    call.peerSocketId =
      payload.from ||
      call.peerSocketId;

    await ensureLocalAudio();

    const pc =
      createPeer();

    try {
      if (
        pc.signalingState !==
        "stable"
      ) {
        try {
          await pc.setLocalDescription({
            type: "rollback"
          });
        } catch {}
      }

      await pc.setRemoteDescription(
        new RTCSessionDescription(
          payload.sdp
        )
      );

      await flushIce();

      const answer =
        await pc.createAnswer();

      await pc.setLocalDescription(
        answer
      );

      socket.emit(
        "dm-call-webrtc-answer",
        {
          callId:
            call.id,
          target:
            call.peerSocketId,
          sdp:
            pc.localDescription
        }
      );
    } catch (err) {
      console.error(
        "[People appel MP/offre]",
        err
      );
    }
  }

  async function handleRemoteAnswer(
    payload
  ) {
    if (
      !call ||
      payload?.callId !==
        call.id ||
      !payload?.sdp ||
      !peer
    ) {
      return;
    }

    try {
      await peer.setRemoteDescription(
        new RTCSessionDescription(
          payload.sdp
        )
      );

      await flushIce();
    } catch (err) {
      console.error(
        "[People appel MP/reponse]",
        err
      );
    }
  }

  async function enableCamera() {
    if (
      cameraEnabled
    ) {
      return;
    }

    await ensureLocalAudio();

    try {
      const stream =
        await navigator
          .mediaDevices
          .getUserMedia({
            audio: false,
            video: {
              width: {
                ideal: 1280
              },
              height: {
                ideal: 720
              }
            }
          });

      const track =
        stream
          .getVideoTracks()[0];

      if (!track) {
        throw new Error(
          "Aucune caméra disponible."
        );
      }

      cameraTrack =
        track;

      cameraEnabled =
        true;

      localStream.addTrack(
        cameraTrack
      );

      if (peer) {
        peer.addTrack(
          cameraTrack,
          localStream
        );
      }

      cameraTrack.addEventListener(
        "ended",
        () => {
          if (
            cameraEnabled
          ) {
            void disableCamera(
              true
            );
          }
        },
        {
          once: true
        }
      );

      syncLocalPreview();
      updateMediaButtons();

      socket.emit(
        "dm-call-media-state",
        {
          callId:
            call?.id,
          muted:
            micMuted,
          camera:
            true
        }
      );

      await sendOffer();
    } catch (err) {
      console.warn(
        "[People appel MP/camera]",
        err
      );

      setStatus(
        "Caméra indisponible"
      );
    }
  }

  async function disableCamera(
    alreadyEnded = false
  ) {
    if (
      !cameraEnabled &&
      !cameraTrack
    ) {
      return;
    }

    const oldTrack =
      cameraTrack;

    cameraEnabled =
      false;

    cameraTrack =
      null;

    if (
      peer &&
      oldTrack
    ) {
      const sender =
        peer
          .getSenders()
          .find(
            (item) =>
              item.track ===
              oldTrack
          );

      if (sender) {
        try {
          peer.removeTrack(
            sender
          );
        } catch {}
      }
    }

    if (
      localStream &&
      oldTrack
    ) {
      try {
        localStream.removeTrack(
          oldTrack
        );
      } catch {}
    }

    if (
      oldTrack &&
      !alreadyEnded
    ) {
      try {
        oldTrack.stop();
      } catch {}
    }

    syncLocalPreview();
    updateMediaButtons();

    socket.emit(
      "dm-call-media-state",
      {
        callId:
          call?.id,
        muted:
          micMuted,
        camera:
          false
      }
    );

    await sendOffer();
  }

  async function toggleMute() {
    await ensureLocalAudio();

    micMuted =
      !micMuted;

    for (
      const track of
      localStream
        ?.getAudioTracks() ||
      []
    ) {
      track.enabled =
        !micMuted;
    }

    updateMediaButtons();

    socket.emit(
      "dm-call-media-state",
      {
        callId:
          call?.id,
        muted:
          micMuted,
        camera:
          cameraEnabled
      }
    );
  }

  function stopMedia() {
    if (peer) {
      try {
        peer.ontrack = null;
        peer.onicecandidate = null;
        peer.onconnectionstatechange = null;
        peer.close();
      } catch {}
    }

    peer = null;

    if (localStream) {
      for (
        const track of
        localStream.getTracks()
      ) {
        try {
          track.stop();
        } catch {}
      }
    }

    localStream = null;
    cameraTrack = null;
    cameraEnabled = false;
    micMuted = false;

    if (remoteStream) {
      for (
        const track of
        remoteStream.getTracks()
      ) {
        try {
          track.stop();
        } catch {}
      }
    }

    remoteStream = null;
    pendingIce = [];

    try {
      remoteVideo.srcObject =
        null;
      remoteAudio.srcObject =
        null;
      localVideo.srcObject =
        null;
    } catch {}

    remoteVideo.classList.add(
      "hidden"
    );

    localVideo.classList.add(
      "hidden"
    );

    identity.classList.remove(
      "with-video"
    );

    updateMediaButtons();
  }

  function reasonText(
    reason
  ) {
    const map = {
      declined:
        "Appel refusé",
      cancelled:
        "Appel annulé",
      timeout:
        "Pas de réponse",
      hangup:
        "Appel terminé",
      disconnected:
        "Appel interrompu",
      unavailable:
        "Utilisateur hors ligne",
      "answered-elsewhere":
        "Appel pris sur un autre onglet"
    };

    return (
      map[
        String(
          reason ||
          ""
        )
      ] ||
      "Appel terminé"
    );
  }

  function finishCall(
    reason,
    {
      immediate = false
    } = {}
  ) {
    stopRinging();
    stopMedia();

    const oldCall =
      call;

    call = null;

    showMode(
      "none"
    );

    setStatus(
      reasonText(
        reason
      )
    );

    const close =
      () => {
        hideOverlay();
      };

    if (
      immediate ||
      !oldCall
    ) {
      close();
    } else {
      setTimeout(
        close,
        1100
      );
    }
  }

  function showIncoming(
    payload
  ) {
    if (call) {
      return;
    }

    call = {
      id:
        String(
          payload?.callId ||
          ""
        ),
      role:
        "callee",
      username:
        String(
          payload?.caller?.username ||
          "Utilisateur"
        ),
      peerSocketId:
        null,
      remoteCamera:
        false
    };

    setCallPerson(
      call.username
    );

    setStatus(
      "Appel entrant…"
    );

    showMode(
      "incoming"
    );

    showOverlay();
    startRinging(
      "incoming"
    );

    try {
      if (
        "Notification" in
          window &&
        Notification.permission ===
          "granted"
      ) {
        new Notification(
          "People — appel entrant",
          {
            body:
              call.username +
              " t'appelle",
            tag:
              "people-call-" +
              call.id
          }
        );
      }
    } catch {}
  }

  async function beginActiveCall(
    payload
  ) {
    if (
      !call ||
      String(
        payload?.callId ||
        ""
      ) !== call.id
    ) {
      return;
    }

    stopRinging();

    call.peerSocketId =
      String(
        payload?.peerSocketId ||
        ""
      );

    call.remoteCamera =
      Boolean(
        payload?.peerCamera
      );

    setStatus(
      "Connexion…"
    );

    showMode(
      "active"
    );

    await ensureLocalAudio();

    createPeer();

    socket.emit(
      "dm-call-media-state",
      {
        callId:
          call.id,
        muted:
          micMuted,
        camera:
          cameraEnabled
      }
    );

    if (
      payload?.initiator
    ) {
      try {
        await sendOffer();
      } catch (err) {
        console.error(
          "[People appel MP/demarrage]",
          err
        );
      }
    }
  }

  function startCall() {
    if (call) {
      showOverlay();
      return;
    }

    const targetUsername =
      currentDmUsername();

    if (!targetUsername) {
      return;
    }

    unlockCallAudio();

    callButton.disabled =
      true;

    socket.emit(
      "dm-call-start",
      {
        targetUsername
      },
      (response) => {
        callButton.disabled =
          false;

        if (
          !response?.ok
        ) {
          const message =
            response?.error ||
            "Impossible de lancer l'appel.";

          setCallPerson(
            targetUsername
          );

          setStatus(
            message
          );

          showMode(
            "none"
          );

          showOverlay();

          setTimeout(
            () => {
              if (!call) {
                hideOverlay();
              }
            },
            1600
          );

          return;
        }

        call = {
          id:
            String(
              response.callId
            ),
          role:
            "caller",
          username:
            String(
              response.target?.username ||
              targetUsername
            ),
          peerSocketId:
            null,
          remoteCamera:
            false
        };

        setCallPerson(
          call.username
        );

        setStatus(
          "Appel en cours…"
        );

        showMode(
          "outgoing"
        );

        showOverlay();
        startRinging(
          "outgoing"
        );
      }
    );
  }

  callButton.addEventListener(
    "click",
    startCall
  );

  acceptButton.addEventListener(
    "click",
    async () => {
      if (
        !call ||
        call.role !==
          "callee"
      ) {
        return;
      }

      stopRinging();

      setStatus(
        "Connexion…"
      );

      acceptButton.disabled =
        true;

      await ensureLocalAudio();

      socket.emit(
        "dm-call-answer",
        {
          callId:
            call.id
        },
        (response) => {
          acceptButton.disabled =
            false;

          if (
            !response?.ok
          ) {
            finishCall(
              response?.reason ||
              "unavailable"
            );
          }
        }
      );
    }
  );

  declineButton.addEventListener(
    "click",
    () => {
      if (
        !call ||
        call.role !==
          "callee"
      ) {
        return;
      }

      socket.emit(
        "dm-call-decline",
        {
          callId:
            call.id
        }
      );
    }
  );

  cancelButton.addEventListener(
    "click",
    () => {
      if (
        !call ||
        call.role !==
          "caller"
      ) {
        return;
      }

      socket.emit(
        "dm-call-cancel",
        {
          callId:
            call.id
        }
      );
    }
  );

  hangupButton.addEventListener(
    "click",
    () => {
      if (!call) {
        return;
      }

      socket.emit(
        "dm-call-hangup",
        {
          callId:
            call.id
        }
      );
    }
  );

  muteButton.addEventListener(
    "click",
    () => {
      void toggleMute();
    }
  );

  cameraButton.addEventListener(
    "click",
    () => {
      if (
        cameraEnabled
      ) {
        void disableCamera();
      } else {
        void enableCamera();
      }
    }
  );

  socket.on(
    "dm-call-incoming",
    showIncoming
  );

  socket.on(
    "dm-call-accepted",
    (payload) => {
      void beginActiveCall(
        payload
      );
    }
  );

  socket.on(
    "dm-call-ended",
    (payload) => {
      if (
        !call ||
        String(
          payload?.callId ||
          ""
        ) !== call.id
      ) {
        return;
      }

      finishCall(
        payload?.reason ||
        "hangup"
      );
    }
  );

  socket.on(
    "dm-call-webrtc-offer",
    (payload) => {
      void handleRemoteOffer(
        payload
      );
    }
  );

  socket.on(
    "dm-call-webrtc-answer",
    (payload) => {
      void handleRemoteAnswer(
        payload
      );
    }
  );

  socket.on(
    "dm-call-webrtc-ice",
    async (payload) => {
      if (
        !call ||
        String(
          payload?.callId ||
          ""
        ) !== call.id ||
        !payload?.candidate
      ) {
        return;
      }

      call.peerSocketId =
        payload.from ||
        call.peerSocketId;

      if (
        !peer ||
        !peer.remoteDescription
      ) {
        pendingIce.push(
          payload.candidate
        );

        return;
      }

      try {
        await peer.addIceCandidate(
          new RTCIceCandidate(
            payload.candidate
          )
        );
      } catch {}
    }
  );

  socket.on(
    "dm-call-media-state",
    (payload) => {
      if (
        !call ||
        String(
          payload?.callId ||
          ""
        ) !== call.id
      ) {
        return;
      }

      call.remoteCamera =
        Boolean(
          payload?.camera
        );

      syncRemoteMedia();

      if (
        payload?.muted
      ) {
        setStatus(
          "Appel en cours • micro distant coupé"
        );
      } else {
        setStatus(
          "Appel en cours"
        );
      }
    }
  );

  window.addEventListener(
    "beforeunload",
    () => {
      if (!call?.id) {
        return;
      }

      socket.emit(
        "dm-call-hangup",
        {
          callId:
            call.id
        }
      );
    }
  );

  window.PeopleDmCalls = {
    getState() {
      return peopleDmCallPublicState();
    },

    async toggleMute() {
      if (!call) {
        return false;
      }

      await toggleMute();

      return true;
    },

    async toggleCamera() {
      if (!call) {
        return false;
      }

      if (cameraEnabled) {
        await disableCamera();
      } else {
        await enableCamera();
      }

      return true;
    },

    end() {
      if (!call?.id) {
        return false;
      }

      const phase =
        call.phase ||
        "active";

      if (
        phase ===
        "incoming"
      ) {
        socket.emit(
          "dm-call-decline",
          {
            callId:
              call.id
          }
        );

        return true;
      }

      if (
        phase ===
        "outgoing"
      ) {
        socket.emit(
          "dm-call-cancel",
          {
            callId:
              call.id
          }
        );

        return true;
      }

      socket.emit(
        "dm-call-hangup",
        {
          callId:
            call.id
        }
      );

      return true;
    }
  };

  updateMediaButtons();
  peopleDmCallPublishState();

  // === PEOPLE_DM_CALLS_V1_END ===
})();
