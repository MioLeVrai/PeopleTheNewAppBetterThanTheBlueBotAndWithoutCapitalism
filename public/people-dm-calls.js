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

  const muteButtonIcon =
    muteButton.querySelector("span");

  const muteButtonLabel =
    muteButton.querySelector("small");

  const cameraButtonIcon =
    cameraButton.querySelector("span");

  const cameraButtonLabel =
    cameraButton.querySelector("small");

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

    peopleDmCallPublishState();

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
          peopleDmCallPublishState();
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

    peopleDmCallPublishState();
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
        ),
      remoteCamera:
        Boolean(
          call?.remoteCamera
        ),
      visible:
        !overlay.classList.contains(
          "hidden"
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

    muteButtonIcon.textContent =
      micMuted
        ? "🔇"
        : "🎙️";

    muteButtonLabel.textContent =
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

    cameraButtonIcon.textContent =
      cameraEnabled
        ? "📹"
        : "📷";

    cameraButtonLabel.textContent =
      cameraEnabled
        ? "Cam active"
        : "Caméra";

    cameraButton.title =
      cameraEnabled
        ? "Couper la caméra"
        : "Activer la caméra";

    peopleDmCallPublishState();
  }

  function mediaElementHasTracks(
    element,
    tracks
  ) {
    const current =
      element.srcObject
        ?.getTracks?.() ||
      [];

    if (
      current.length !==
      tracks.length
    ) {
      return false;
    }

    const currentIds =
      new Set(
        current.map(
          (track) => track.id
        )
      );

    return tracks.every(
      (track) =>
        currentIds.has(
          track.id
        )
    );
  }

  function setMediaElementTracks(
    element,
    tracks
  ) {
    if (!tracks.length) {
      if (element.srcObject) {
        try {
          element.srcObject =
            null;
        } catch {}
        return true;
      }

      return false;
    }

    if (
      mediaElementHasTracks(
        element,
        tracks
      )
    ) {
      return false;
    }

    element.srcObject =
      new MediaStream(
        tracks
      );

    return true;
  }

  function syncLocalPreview() {
    if (
      cameraEnabled &&
      cameraTrack &&
      localStream
    ) {
      const changed =
        setMediaElementTracks(
          localVideo,
          [cameraTrack]
        );

      localVideo.classList.remove(
        "hidden"
      );

      if (
        changed ||
        localVideo.paused
      ) {
        localVideo
          .play()
          .catch(() => {});
      }

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
      setMediaElementTracks(
        remoteAudio,
        []
      );
      setMediaElementTracks(
        remoteVideo,
        []
      );

      remoteVideo.classList.add(
        "hidden"
      );
      identity.classList.remove(
        "with-video"
      );

      peopleDmCallPublishState();
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

    const audioChanged =
      setMediaElementTracks(
        remoteAudio,
        audioTracks
      );

    void window.PeopleAudioDevices
      ?.applyOutput?.(
        remoteAudio
      );

    if (
      audioTracks.length &&
      (
        audioChanged ||
        remoteAudio.paused
      )
    ) {
      remoteAudio
        .play()
        .catch(() => {});
    }

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
      const videoChanged =
        setMediaElementTracks(
          remoteVideo,
          videoTracks
        );

      remoteVideo.classList.remove(
        "hidden"
      );

      if (
        videoChanged ||
        remoteVideo.paused
      ) {
        remoteVideo
          .play()
          .catch(() => {});
      }

      identity.classList.add(
        "with-video"
      );
    } else {
      setMediaElementTracks(
        remoteVideo,
        []
      );

      remoteVideo.classList.add(
        "hidden"
      );

      identity.classList.remove(
        "with-video"
      );
    }

    peopleDmCallPublishState();
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

  // === PEOPLE_DM_INPUT_SWITCH_V1 ===
  async function peopleDmSwitchInputDevice() {
    if (
      !call ||
      !localStream ||
      !localStream
        .getAudioTracks()
        .some(
          (track) =>
            track.readyState ===
            "live"
        )
    ) {
      return;
    }

    try {
      const replacement =
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
        replacement
          .getAudioTracks()[0];

      if (!newTrack) {
        return;
      }

      newTrack.enabled =
        !micMuted;

      const oldTracks =
        localStream
          .getAudioTracks();

      const sender =
        peer
          ?.getSenders()
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

      if (
        peer &&
        !sender
      ) {
        peer.addTrack(
          newTrack,
          localStream
        );
      }

      setStatus(
        "Micro changé ✓"
      );

      setTimeout(
        () => {
          if (
            call &&
            call.phase ===
              "active"
          ) {
            setStatus(
              "Appel en cours"
            );
          }
        },
        900
      );

      updateMediaButtons();
    } catch (err) {
      console.warn(
        "[People changement micro MP]",
        err
      );

      setStatus(
        "Impossible d'utiliser ce micro"
      );
    }
  }

  window.addEventListener(
    "people-audio-input-device-changed",
    () => {
      void peopleDmSwitchInputDevice();
    }
  );

  window.addEventListener(
    "people-audio-output-device-changed",
    () => {
      void window.PeopleAudioDevices
        ?.applyOutput?.(
          remoteAudio
        );
    }
  );

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
      limit:
        "Limite de 2 vocaux/appels atteinte",
      "answered-elsewhere":
        "Appel pris ailleurs"
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

/* ===== UI V2 intégrée ===== */
(() => {
  "use strict";

  // === PEOPLE_DM_CALLS_V2_CLIENT_START ===

  const overlay =
    document.getElementById(
      "peopleDmCallOverlay"
    );

  const card =
    overlay?.querySelector(
      ".people-dm-call-card"
    );

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

  const callName =
    document.getElementById(
      "peopleDmCallName"
    );

  const activeActions =
    document.getElementById(
      "peopleDmCallActiveActions"
    );

  const remoteAudio =
    document.getElementById(
      "peopleDmCallRemoteAudio"
    );

  if (
    !overlay ||
    !card ||
    !dmView ||
    !dmHeader ||
    !dmHeaderName ||
    !callName ||
    !activeActions ||
    !remoteAudio
  ) {
    return;
  }

  /*
    Le V1 utilisait un vrai modal.
    V2 garde le même moteur WebRTC mais
    transforme l'affichage en panneau non bloquant.
  */
  card.removeAttribute(
    "aria-modal"
  );

  card.setAttribute(
    "role",
    "region"
  );

  const inlineDock =
    document.createElement(
      "div"
    );

  inlineDock.id =
    "peopleDmCallInlineDock";

  inlineDock.className =
    "people-dm-call-inline-dock hidden";

  dmHeader.insertAdjacentElement(
    "afterend",
    inlineDock
  );

  const floatingDock =
    document.createElement(
      "div"
    );

  floatingDock.id =
    "peopleDmCallFloatingDock";

  floatingDock.className =
    "people-dm-call-floating-dock";

  document.body.appendChild(
    floatingDock
  );

  function normalized(value) {
    return String(
      value || ""
    )
      .trim()
      .toLocaleLowerCase(
        "fr-FR"
      );
  }

  function overlayVisible() {
    return !overlay.classList
      .contains(
        "hidden"
      );
  }

  function currentDmMatchesCall() {
    if (
      dmView.classList
        .contains(
          "hidden"
        )
    ) {
      return false;
    }

    const current =
      normalized(
        dmHeaderName.textContent
      );

    const partner =
      normalized(
        callName.textContent
      );

    return (
      current &&
      partner &&
      current !==
        "message privé" &&
      current ===
        partner
    );
  }

  function syncPlacement() {
    if (
      !overlayVisible()
    ) {
      dmView.classList.remove(
        "people-dm-call-inline"
      );

      inlineDock.classList.add(
        "hidden"
      );

      return;
    }

    if (
      currentDmMatchesCall()
    ) {
      if (
        overlay.parentElement !==
        inlineDock
      ) {
        inlineDock.appendChild(
          overlay
        );
      }

      overlay.classList.add(
        "people-dm-call-docked"
      );

      overlay.classList.remove(
        "people-dm-call-floating"
      );

      inlineDock.classList.remove(
        "hidden"
      );

      dmView.classList.add(
        "people-dm-call-inline"
      );

      return;
    }

    if (
      overlay.parentElement !==
      floatingDock
    ) {
      floatingDock.appendChild(
        overlay
      );
    }

    overlay.classList.remove(
      "people-dm-call-docked"
    );

    overlay.classList.add(
      "people-dm-call-floating"
    );

    inlineDock.classList.add(
      "hidden"
    );

    dmView.classList.remove(
      "people-dm-call-inline"
    );
  }

  /*
    PEOPLE_DM_CALLS_V2_PLACEMENT_FIX

    IMPORTANT :
    on ne surveille surtout PAS tout document.body.

    L'ancien observateur global pouvait se réveiller sur
    chaque mutation de People, puis modifier lui-même des
    classes DOM, ce qui pouvait créer une boucle de travail
    et figer complètement l'interface.

    On surveille uniquement les 3 états réellement utiles :
    - appel visible/caché ;
    - MP visible/caché ;
    - pseudo du MP actuellement ouvert.

    La signature évite aussi toute boucle quand syncPlacement()
    modifie ses propres classes docked/floating.
  */
  let placementScheduled =
    false;

  let lastPlacementSignature =
    "";

  function placementSignature() {
    return [
      overlay.classList
        .contains(
          "hidden"
        )
        ? "0"
        : "1",
      dmView.classList
        .contains(
          "hidden"
        )
        ? "0"
        : "1",
      normalized(
        dmHeaderName.textContent
      )
    ].join(
      "|"
    );
  }

  function schedulePlacement() {
    if (
      placementScheduled
    ) {
      return;
    }

    placementScheduled =
      true;

    requestAnimationFrame(
      () => {
        placementScheduled =
          false;

        const signature =
          placementSignature();

        if (
          signature ===
          lastPlacementSignature
        ) {
          return;
        }

        lastPlacementSignature =
          signature;

        syncPlacement();
      }
    );
  }

  const placementObserver =
    new MutationObserver(
      schedulePlacement
    );

  placementObserver.observe(
    dmView,
    {
      attributes: true,
      attributeFilter: [
        "class"
      ]
    }
  );

  placementObserver.observe(
    dmHeaderName,
    {
      childList: true,
      subtree: true,
      characterData: true
    }
  );

  schedulePlacement();

  // ==========================================================
  // VOLUME LOCAL DE LA PERSONNE EN FACE
  // Même stockage que les vocaux serveur.
  // ==========================================================

  const volumeWrap =
    document.createElement(
      "div"
    );

  volumeWrap.className =
    "people-dm-call-volume-wrap";

  const volumeMute =
    document.createElement(
      "button"
    );

  volumeMute.type =
    "button";

  volumeMute.className =
    "people-dm-call-volume-mute";

  const volumeRange =
    document.createElement(
      "input"
    );

  volumeRange.type =
    "range";

  volumeRange.className =
    "people-dm-call-volume";

  volumeRange.min =
    "0";

  volumeRange.max =
    "100";

  volumeRange.step =
    "1";

  const volumeValue =
    document.createElement(
      "span"
    );

  volumeValue.className =
    "people-dm-call-volume-value";

  volumeWrap.append(
    volumeMute,
    volumeRange,
    volumeValue
  );

  activeActions.insertBefore(
    volumeWrap,
    activeActions.lastElementChild
  );

  function prefKey() {
    return (
      "people-local-audio:" +
      normalized(
        callName.textContent ||
        "utilisateur"
      )
    );
  }

  function readPref(key) {
    try {
      const raw =
        localStorage.getItem(
          key
        );

      if (!raw) {
        return {
          volume: 100,
          muted: false
        };
      }

      const parsed =
        JSON.parse(
          raw
        );

      return {
        volume:
          Math.max(
            0,
            Math.min(
              100,
              Number(
                parsed.volume ??
                100
              )
            )
          ),
        muted:
          Boolean(
            parsed.muted
          )
      };
    } catch {
      return {
        volume: 100,
        muted: false
      };
    }
  }

  let currentPrefKey =
    prefKey();

  let currentPref =
    readPref(
      currentPrefKey
    );

  function saveCurrentPref() {
    try {
      localStorage.setItem(
        currentPrefKey,
        JSON.stringify(
          currentPref
        )
      );
    } catch {}
  }

  function applyPref() {
    remoteAudio.volume =
      Math.max(
        0,
        Math.min(
          1,
          currentPref.volume /
          100
        )
      );

    remoteAudio.muted =
      currentPref.muted;

    volumeRange.value =
      String(
        currentPref.volume
      );

    volumeValue.textContent =
      Math.round(
        currentPref.volume
      ) + "%";

    volumeMute.textContent =
      currentPref.muted
        ? "🔇"
        : "🔊";

    volumeMute.classList.toggle(
      "is-muted",
      currentPref.muted
    );

    volumeMute.title =
      currentPref.muted
        ? "Réactiver le son de la personne"
        : "Couper le son de la personne";
  }

  function refreshPrefForPartner() {
    const nextKey =
      prefKey();

    if (
      nextKey !==
      currentPrefKey
    ) {
      currentPrefKey =
        nextKey;

      currentPref =
        readPref(
          currentPrefKey
        );
    }

    applyPref();
  }

  volumeMute.addEventListener(
    "click",
    () => {
      currentPref.muted =
        !currentPref.muted;

      saveCurrentPref();
      applyPref();
    }
  );

  volumeRange.addEventListener(
    "input",
    () => {
      currentPref.volume =
        Number(
          volumeRange.value
        );

      remoteAudio.volume =
        Math.max(
          0,
          Math.min(
            1,
            currentPref.volume /
            100
          )
        );

      volumeValue.textContent =
        Math.round(
          currentPref.volume
        ) + "%";
    }
  );

  volumeRange.addEventListener(
    "change",
    saveCurrentPref
  );

  window.addEventListener(
    "people-dm-call-state",
    () => {
      refreshPrefForPartner();
      schedulePlacement();
    }
  );

  /*
    volume/muted restent attachés au même élément <audio>
    quand WebRTC remplace srcObject. Le polling périodique
    de V2 n'est donc pas nécessaire.
  */

  refreshPrefForPartner();
  syncPlacement();

  // === PEOPLE_DM_CALLS_V2_CLIENT_END ===
})();

/* ===== UI V3 intégrée ===== */
(() => {
  "use strict";

  // === PEOPLE_DM_CALLS_V3_CLIENT_START ===

  const overlay =
    document.getElementById(
      "peopleDmCallOverlay"
    );

  const card =
    overlay?.querySelector(
      ".people-dm-call-card"
    );

  const dmView =
    document.getElementById(
      "dmView"
    );

  const dmHeaderName =
    document.getElementById(
      "dmHeaderName"
    );

  const callName =
    document.getElementById(
      "peopleDmCallName"
    );

  const activeActions =
    document.getElementById(
      "peopleDmCallActiveActions"
    );

  const remoteVideo =
    document.getElementById(
      "peopleDmCallRemoteVideo"
    );

  if (
    !overlay ||
    !card ||
    !dmView ||
    !dmHeaderName ||
    !callName ||
    !activeActions ||
    !remoteVideo
  ) {
    return;
  }

  function normalized(value) {
    return String(
      value || ""
    )
      .trim()
      .toLocaleLowerCase(
        "fr-FR"
      );
  }

  function currentDmMatchesCall() {
    if (
      dmView.classList
        .contains(
          "hidden"
        )
    ) {
      return false;
    }

    const current =
      normalized(
        dmHeaderName.textContent
      );

    const partner =
      normalized(
        callName.textContent
      );

    return (
      current &&
      partner &&
      current !==
        "message privé" &&
      current ===
        partner
    );
  }

  function callIsActive() {
    return (
      !overlay.classList
        .contains(
          "hidden"
        ) &&
      !activeActions.classList
        .contains(
          "hidden"
        )
    );
  }

  function remoteCameraIsActive() {
    return (
      callIsActive() &&
      !remoteVideo.classList
        .contains(
          "hidden"
        ) &&
      Boolean(
        remoteVideo.srcObject
      )
    );
  }

  // ==========================================================
  // 1. HAUTEUR RÉGLABLE DU PANNEAU DANS LE MP
  // ==========================================================

  const resizeHandle =
    document.createElement(
      "div"
    );

  resizeHandle.id =
    "peopleDmCallResizeHandle";

  resizeHandle.className =
    "people-dm-call-resize-handle";

  resizeHandle.title =
    "Glisser pour régler la hauteur de l'appel";

  resizeHandle.setAttribute(
    "aria-label",
    "Régler la hauteur de l'appel"
  );

  const resizeGrip =
    document.createElement(
      "span"
    );

  resizeHandle.appendChild(
    resizeGrip
  );

  card.appendChild(
    resizeHandle
  );

  const HEIGHT_KEY =
    "people-dm-call-inline-height-v1";

  function maxInlineHeight() {
    return Math.max(
      260,
      Math.min(
        680,
        Math.round(
          window.innerHeight *
          0.72
        )
      )
    );
  }

  function clampHeight(value) {
    return Math.max(
      200,
      Math.min(
        maxInlineHeight(),
        Math.round(
          Number(value) ||
          300
        )
      )
    );
  }

  function loadHeight() {
    try {
      return clampHeight(
        Number(
          localStorage.getItem(
            HEIGHT_KEY
          )
        ) || 300
      );
    } catch {
      return 300;
    }
  }

  let currentInlineHeight =
    300;

  function applyHeight(
    value,
    {
      save = false
    } = {}
  ) {
    const height =
      clampHeight(
        value
      );

    currentInlineHeight =
      height;

    card.style.setProperty(
      "--people-dm-call-inline-height",
      height + "px"
    );

    if (save) {
      try {
        localStorage.setItem(
          HEIGHT_KEY,
          String(height)
        );
      } catch {}
    }
  }

  applyHeight(
    loadHeight()
  );

  let resizeState = null;
  let resizeFrame = 0;
  let pendingResizeHeight = null;

  function flushResizeFrame() {
    resizeFrame = 0;

    if (
      pendingResizeHeight ===
      null
    ) {
      return;
    }

    const next =
      pendingResizeHeight;

    pendingResizeHeight =
      null;

    applyHeight(
      next
    );
  }

  resizeHandle.addEventListener(
    "pointerdown",
    (event) => {
      if (
        !overlay.classList
          .contains(
            "people-dm-call-docked"
          )
      ) {
        return;
      }

      event.preventDefault();

      resizeState = {
        pointerId:
          event.pointerId,
        startY:
          event.clientY,
        startHeight:
          card
            .getBoundingClientRect()
            .height
      };

      resizeHandle.setPointerCapture?.(
        event.pointerId
      );

      document.body.classList.add(
        "people-dm-call-resizing"
      );
    }
  );

  resizeHandle.addEventListener(
    "pointermove",
    (event) => {
      if (
        !resizeState ||
        resizeState.pointerId !==
          event.pointerId
      ) {
        return;
      }

      pendingResizeHeight =
        resizeState.startHeight +
        (
          event.clientY -
          resizeState.startY
        );

      if (!resizeFrame) {
        resizeFrame =
          requestAnimationFrame(
            flushResizeFrame
          );
      }
    }
  );

  function endResize(event) {
    if (!resizeState) {
      return;
    }

    if (
      event &&
      resizeState.pointerId !==
        event.pointerId
    ) {
      return;
    }

    if (resizeFrame) {
      cancelAnimationFrame(
        resizeFrame
      );
      resizeFrame = 0;
    }

    if (
      pendingResizeHeight !==
      null
    ) {
      applyHeight(
        pendingResizeHeight
      );
      pendingResizeHeight =
        null;
    }

    applyHeight(
      currentInlineHeight,
      {
        save: true
      }
    );

    try {
      resizeHandle.releasePointerCapture?.(
        resizeState.pointerId
      );
    } catch {}

    resizeState = null;

    document.body.classList.remove(
      "people-dm-call-resizing"
    );
  }

  resizeHandle.addEventListener(
    "pointerup",
    endResize
  );

  resizeHandle.addEventListener(
    "pointercancel",
    endResize
  );

  resizeHandle.addEventListener(
    "dblclick",
    () => {
      applyHeight(
        300,
        {
          save: true
        }
      );
    }
  );

  window.addEventListener(
    "resize",
    () => {
      applyHeight(
        loadHeight()
      );

      constrainPip();
    }
  );

  // ==========================================================
  // 2. PLUS DE PANNEAU D'APPEL FLOTTANT UNE FOIS CONNECTÉ
  // ==========================================================

  function syncAwayCallPanel() {
    const away =
      callIsActive() &&
      !currentDmMatchesCall();

    overlay.classList.toggle(
      "people-dm-call-away-active",
      away
    );
  }

  // ==========================================================
  // 3. MINI VIDÉO FLOTTANTE UNIQUEMENT SI LA CAM DISTANTE EST ON
  // ==========================================================

  const pip =
    document.createElement(
      "section"
    );

  pip.id =
    "peopleDmCallVideoPip";

  pip.className =
    "people-dm-call-video-pip hidden";

  const pipHeader =
    document.createElement(
      "header"
    );

  pipHeader.className =
    "people-dm-call-video-pip-header";

  const pipTitle =
    document.createElement(
      "strong"
    );

  pipTitle.textContent =
    "Caméra";

  const pipClose =
    document.createElement(
      "button"
    );

  pipClose.type =
    "button";

  pipClose.className =
    "people-dm-call-video-pip-close";

  pipClose.title =
    "Masquer la caméra";

  pipClose.setAttribute(
    "aria-label",
    "Masquer la caméra"
  );

  pipClose.textContent =
    "×";

  pipHeader.append(
    pipTitle,
    pipClose
  );

  const pipVideo =
    document.createElement(
      "video"
    );

  pipVideo.className =
    "people-dm-call-video-pip-video";

  pipVideo.autoplay =
    true;

  pipVideo.muted =
    true;

  pipVideo.playsInline =
    true;

  pip.append(
    pipHeader,
    pipVideo
  );

  document.body.appendChild(
    pip
  );

  let pipDismissed =
    false;

  let previousRemoteCamera =
    false;

  let dragState = null;
  let dragFrame = 0;
  let pendingDragPosition = null;

  function flushDragFrame() {
    dragFrame = 0;

    if (!pendingDragPosition) {
      return;
    }

    const {
      left,
      top
    } =
      pendingDragPosition;

    pendingDragPosition =
      null;

    pip.style.left =
      left + "px";

    pip.style.top =
      top + "px";

    pip.style.right =
      "auto";

    pip.style.bottom =
      "auto";
  }

  function syncPipVideoSource(
    enabled
  ) {
    const source =
      enabled
        ? remoteVideo.srcObject
        : null;

    if (
      source &&
      pipVideo.srcObject !==
        source
    ) {
      pipVideo.srcObject =
        source;

      pipVideo
        .play()
        .catch(() => {});
      return;
    }

    if (
      !source &&
      pipVideo.srcObject
    ) {
      try {
        pipVideo.pause();
        pipVideo.srcObject =
          null;
      } catch {}
    }
  }

  function constrainPip() {
    if (
      pip.classList
        .contains(
          "hidden"
        )
    ) {
      return;
    }

    const rect =
      pip.getBoundingClientRect();

    const maxLeft =
      Math.max(
        8,
        window.innerWidth -
        rect.width -
        8
      );

    const maxTop =
      Math.max(
        8,
        window.innerHeight -
        rect.height -
        8
      );

    const left =
      Math.max(
        8,
        Math.min(
          maxLeft,
          rect.left
        )
      );

    const top =
      Math.max(
        8,
        Math.min(
          maxTop,
          rect.top
        )
      );

    pip.style.left =
      left + "px";

    pip.style.top =
      top + "px";

    pip.style.right =
      "auto";

    pip.style.bottom =
      "auto";
  }

  function resetPipPosition() {
    pip.style.left =
      "";

    pip.style.top =
      "";

    pip.style.right =
      "";

    pip.style.bottom =
      "";
  }

  function syncPip() {
    const remoteCamera =
      remoteCameraIsActive();

    if (
      remoteCamera &&
      !previousRemoteCamera
    ) {
      /*
        Nouvelle activation de caméra :
        même si l'ancien popup avait été fermé,
        on le repropose.
      */
      pipDismissed =
        false;

      resetPipPosition();
    }

    previousRemoteCamera =
      remoteCamera;

    const shouldShow =
      remoteCamera &&
      !currentDmMatchesCall() &&
      !pipDismissed;

    pip.classList.toggle(
      "hidden",
      !shouldShow
    );

    /*
      Important perf : quand le PIP est caché, on ne garde pas
      une deuxième balise <video> en train de décoder le même
      flux distant que la vidéo principale.
    */
    syncPipVideoSource(
      shouldShow
    );

    pipTitle.textContent =
      callName.textContent
        ? (
            "Caméra • " +
            callName.textContent
          )
        : "Caméra";

    if (shouldShow) {
      requestAnimationFrame(
        constrainPip
      );
    }
  }

  pipClose.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();

      pipDismissed =
        true;

      syncPip();
    }
  );

  pipHeader.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.target ===
        pipClose
      ) {
        return;
      }

      const rect =
        pip.getBoundingClientRect();

      dragState = {
        pointerId:
          event.pointerId,
        offsetX:
          event.clientX -
          rect.left,
        offsetY:
          event.clientY -
          rect.top,
        width:
          rect.width,
        height:
          rect.height
      };

      pipHeader.setPointerCapture?.(
        event.pointerId
      );

      pip.classList.add(
        "dragging"
      );

      event.preventDefault();
    }
  );

  pipHeader.addEventListener(
    "pointermove",
    (event) => {
      if (
        !dragState ||
        dragState.pointerId !==
          event.pointerId
      ) {
        return;
      }

      const maxLeft =
        Math.max(
          8,
          window.innerWidth -
          dragState.width -
          8
        );

      const maxTop =
        Math.max(
          8,
          window.innerHeight -
          dragState.height -
          8
        );

      pendingDragPosition = {
        left:
          Math.max(
            8,
            Math.min(
              maxLeft,
              event.clientX -
              dragState.offsetX
            )
          ),
        top:
          Math.max(
            8,
            Math.min(
              maxTop,
              event.clientY -
              dragState.offsetY
            )
          )
      };

      if (!dragFrame) {
        dragFrame =
          requestAnimationFrame(
            flushDragFrame
          );
      }
    }
  );

  function endDrag(event) {
    if (
      !dragState ||
      (
        event &&
        dragState.pointerId !==
          event.pointerId
      )
    ) {
      return;
    }

    if (dragFrame) {
      cancelAnimationFrame(
        dragFrame
      );
      dragFrame = 0;
    }

    flushDragFrame();

    try {
      pipHeader.releasePointerCapture?.(
        dragState.pointerId
      );
    } catch {}

    dragState = null;

    pip.classList.remove(
      "dragging"
    );
  }

  pipHeader.addEventListener(
    "pointerup",
    endDrag
  );

  pipHeader.addEventListener(
    "pointercancel",
    endDrag
  );

  // ==========================================================
  // 4. OBSERVATEURS CIBLÉS UNIQUEMENT
  // ==========================================================

  let scheduled =
    false;

  function syncAll() {
    scheduled =
      false;

    syncAwayCallPanel();
    syncPip();
  }

  function scheduleSync() {
    if (scheduled) {
      return;
    }

    scheduled =
      true;

    requestAnimationFrame(
      syncAll
    );
  }

  const stateObserver =
    new MutationObserver(
      scheduleSync
    );

  /*
    Les changements internes de l'appel sont publiés par V1 via
    people-dm-call-state. Ici on observe seulement la navigation
    dans les MP, car elle appartient au reste de l'application.
  */
  stateObserver.observe(
    dmView,
    {
      attributes: true,
      attributeFilter: [
        "class"
      ]
    }
  );

  stateObserver.observe(
    dmHeaderName,
    {
      childList: true,
      subtree: true,
      characterData: true
    }
  );

  window.addEventListener(
    "people-dm-call-state",
    scheduleSync
  );

  scheduleSync();

  // === PEOPLE_DM_CALLS_V3_CLIENT_END ===
})();
