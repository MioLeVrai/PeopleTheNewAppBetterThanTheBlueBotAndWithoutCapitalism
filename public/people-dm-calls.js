/* ===== people-dm-calls.js — version stable d'origine ===== */
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
    iceServers:
      Array.isArray(
        window.PEOPLE_RTC_ICE_SERVERS
      ) &&
      window.PEOPLE_RTC_ICE_SERVERS.length
        ? window.PEOPLE_RTC_ICE_SERVERS
        : [
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
  let joinableCall = null;
  let peer = null;
  let localStream = null;
  let remoteStream = null;
  let cameraTrack = null;
  let screenTrack = null;
  let micMuted = false;
  let cameraEnabled = false;
  let screenEnabled = false;
  let pendingIce = [];
  let localAudioRequest = null;
  let connectionWatchTimer = null;
  let iceRestartTimer = null;

  let audioContext = null;
  let ringingTimer = null;
  let ringingKind = null;

  // === PEOPLE_DM_CALL_EVENT_SOUNDS_V5_START ===
  function peopleDmPlayCallEventSound(
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
  // === PEOPLE_DM_CALL_EVENT_SOUNDS_V5_END ===

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
          id="peopleDmCallEffects"
          class="people-dm-call-control people-dm-effects-control"
          type="button"
          title="Effets de visage"
          disabled
        >
          <span>✨</span>
          <small>Effets</small>
        </button>

        <button
          id="peopleDmCallScreen"
          class="people-dm-call-control"
          type="button"
          title="Partager l'écran"
        >
          <span>🖥️</span>
          <small>Écran</small>
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

  // Face Effects V1.1: garde-fou UI si les contrôles sont reconstruits.
  window.PeopleCameraEffects?.ensureControls?.();

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

  const effectsButton =
    document.getElementById(
      "peopleDmCallEffects"
    );

  const screenButton =
    document.getElementById(
      "peopleDmCallScreen"
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
        ),
      screen:
        Boolean(
          screenEnabled
        ),
      remoteScreen:
        Boolean(
          call?.remoteScreen
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

  function sameDmUsername(
    left,
    right
  ) {
    return (
      String(left || "")
        .trim()
        .toLocaleLowerCase() ===
      String(right || "")
        .trim()
        .toLocaleLowerCase()
    );
  }

  function updateCallButtonLabel() {
    const dmUsername =
      currentDmUsername();

    const canRejoin =
      Boolean(
        dmUsername &&
        joinableCall &&
        sameDmUsername(
          joinableCall.username,
          dmUsername
        )
      );

    const label =
      canRejoin
        ? "Rejoindre"
        : "Appeler";

    callButton.title = label;

    callButton.setAttribute(
      "aria-label",
      label
    );

    const strong =
      callButton.querySelector(
        "strong"
      );

    if (strong) {
      strong.textContent = label;
    }
  }

  // === PEOPLE_DM_CAMERA_FACE_EFFECTS_V1_START ===
  function peopleDmCameraOutputTrack() {
    if (!cameraTrack) return null;
    try {
      return window.PeopleCameraEffects?.getOutputTrack?.(cameraTrack) || cameraTrack;
    } catch {
      return cameraTrack;
    }
  }

  function peopleDmUpdateEffectsButton() {
    if (!effectsButton) return;
    const selected = window.PeopleCameraEffects?.getSelectedEffect?.() || "none";
    const info = window.PeopleCameraEffects?.getSelectedEffectInfo?.();
    effectsButton.disabled = !cameraEnabled;
    effectsButton.classList.toggle("people-face-effects-active", selected !== "none");
    effectsButton.title = cameraEnabled
      ? `Effets de visage${selected !== "none" ? ` • ${info?.label || selected}` : ""}`
      : "Active la caméra pour utiliser les effets";
  }

  async function peopleDmInstallCameraOutputTrack(track) {
    if (!cameraEnabled || !localStream) return;

    for (const current of [...localStream.getVideoTracks()]) {
      if (current === track) continue;
      try { localStream.removeTrack(current); } catch {}
    }

    if (track && !localStream.getVideoTracks().includes(track)) {
      try { localStream.addTrack(track); } catch {}
    }

    syncLocalPreview();

    if (peer && !screenEnabled) {
      try {
        await peopleDmSetOutgoingVideo(track || null);
      } catch (err) {
        console.warn("[People effets caméra/MP]", err);
      }
    }
  }

  window.addEventListener("people-camera-effect-changed", peopleDmUpdateEffectsButton);
  window.addEventListener("people-camera-effect-track-changed", (event) => {
    if (!call || !cameraEnabled) return;
    const track = event?.detail?.track || peopleDmCameraOutputTrack();
    void peopleDmInstallCameraOutputTrack(track);
  });
  // === PEOPLE_DM_CAMERA_FACE_EFFECTS_V1_END ===

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

    screenButton.classList.toggle(
      "active",
      screenEnabled
    );

    screenButton.querySelector(
      "span"
    ).textContent =
      screenEnabled
        ? "🛑"
        : "🖥️";

    screenButton.querySelector(
      "small"
    ).textContent =
      screenEnabled
        ? "Stop"
        : "Écran";

    screenButton.title =
      screenEnabled
        ? "Arrêter le partage d'écran"
        : "Partager l'écran";

    peopleDmUpdateEffectsButton();
    peopleDmCallPublishState();
  }

  function syncLocalPreview() {
    const previewTrack =
      screenEnabled && screenTrack
        ? screenTrack
        : (
            cameraEnabled &&
            cameraTrack
              ? peopleDmCameraOutputTrack()
              : null
          );

    if (previewTrack) {
      localVideo.srcObject =
        new MediaStream(
          [previewTrack]
        );

      localVideo.style.objectFit =
        screenEnabled
          ? "contain"
          : "cover";

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

    void window.PeopleAudioDevices
      ?.applyOutput?.(
        remoteAudio
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
      videoTracks.length
    ) {
      remoteVideo.srcObject =
        new MediaStream(
          videoTracks
        );

      remoteVideo.style.objectFit =
        call?.remoteScreen
          ? "contain"
          : "cover";

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

  function ensureEmptyLocalStream() {
    if (!localStream) {
      localStream =
        new MediaStream();
    }

    return localStream;
  }

  function scheduleAudioRenegotiation() {
    if (
      !call ||
      !peer ||
      !peer.localDescription ||
      !peer.remoteDescription
    ) {
      return;
    }

    setTimeout(
      () => {
        if (
          !call ||
          !peer ||
          peer.signalingState !==
            "stable"
        ) {
          return;
        }

        void sendOffer().catch(
          (err) => {
            console.warn(
              "[People appel MP/renegociation audio]",
              err
            );
          }
        );
      },
      0
    );
  }

  function requestLocalAudio() {
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

      return Promise.resolve(
        localStream
      );
    }

    if (localAudioRequest) {
      return localAudioRequest;
    }

    localAudioRequest =
      (async () => {
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

          ensureEmptyLocalStream();

          let addedToPeer = false;

          for (
            const track of
            stream.getAudioTracks()
          ) {
            track.enabled =
              !micMuted;

            const duplicate =
              localStream
                .getAudioTracks()
                .some(
                  (current) =>
                    current.id ===
                    track.id
                );

            if (duplicate) {
              continue;
            }

            localStream.addTrack(
              track
            );

            if (peer) {
              const currentSender =
                peer
                  .getSenders()
                  .find(
                    (sender) =>
                      sender.track
                        ?.kind ===
                      "audio"
                  );

              if (currentSender) {
                await currentSender
                  .replaceTrack(
                    track
                  );
              } else {
                peer.addTrack(
                  track,
                  localStream
                );

                addedToPeer = true;
              }
            }
          }

          if (addedToPeer) {
            scheduleAudioRenegotiation();
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

          return ensureEmptyLocalStream();
        } finally {
          localAudioRequest = null;
        }
      })();

    return localAudioRequest;
  }

  async function ensureLocalAudio(
    timeoutMs = 4500
  ) {
    const request =
      requestLocalAudio();

    if (
      !Number.isFinite(
        timeoutMs
      ) ||
      timeoutMs <= 0
    ) {
      return request;
    }

    let timer = null;

    try {
      const result =
        await Promise.race([
          request.then(
            (stream) => ({
              done: true,
              stream
            })
          ),
          new Promise(
            (resolve) => {
              timer = setTimeout(
                () =>
                  resolve({
                    done: false,
                    stream: null
                  }),
                timeoutMs
              );
            }
          )
        ]);

      if (result.done) {
        return result.stream;
      }

      console.warn(
        "[People appel MP/micro] délai dépassé, connexion sans attendre le micro"
      );

      setStatus(
        "Connexion… micro en attente"
      );

      return ensureEmptyLocalStream();
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
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

    let videoTransceiver = peer.getTransceivers().find(transceiver =>
      transceiver.sender?.track?.kind === "video" ||
      transceiver.receiver?.track?.kind === "video"
    );
    if (!videoTransceiver) {
      videoTransceiver = peer.addTransceiver("video", { direction: "recvonly" });
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

        const candidate =
          typeof event.candidate
            .toJSON ===
          "function"
            ? event.candidate
                .toJSON()
            : event.candidate;

        socket.emit(
          "dm-call-webrtc-ice",
          {
            callId:
              call.id,
            target:
              call.peerSocketId,
            candidate
          }
        );
      };

    peer.onicecandidateerror =
      (event) => {
        console.warn(
          "[People appel MP/ICE candidate]",
          event?.errorCode ||
            "",
          event?.errorText ||
            ""
        );
      };

    peer.oniceconnectionstatechange =
      () => {
        if (!peer) {
          return;
        }

        console.info(
          "[People appel MP/ICE]",
          peer.iceConnectionState
        );
      };

    peer.onconnectionstatechange =
      () => {
        if (!peer) {
          return;
        }

        const state =
          peer.connectionState;

        console.info(
          "[People appel MP/connexion]",
          state
        );

        if (
          state ===
          "connected"
        ) {
          if (connectionWatchTimer) {
            clearTimeout(
              connectionWatchTimer
            );
            connectionWatchTimer = null;
          }

          setStatus(
            "Appel en cours"
          );
        }

        if (
          state ===
            "failed"
        ) {
          setStatus(
            "Connexion impossible — nouvelle tentative…"
          );

          if (
            call?.initiator &&
            !iceRestartTimer
          ) {
            iceRestartTimer =
              setTimeout(
                () => {
                  iceRestartTimer = null;

                  if (
                    !call ||
                    !peer ||
                    peer.signalingState !==
                      "stable"
                  ) {
                    return;
                  }

                  void sendOffer(
                    true
                  ).catch(
                    (err) => {
                      console.warn(
                        "[People appel MP/ICE restart]",
                        err
                      );
                    }
                  );
                },
                500
              );
          }
        } else if (
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

  async function sendOffer(
    iceRestart = false
  ) {
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
        offerToReceiveVideo: true,
        iceRestart:
          Boolean(
            iceRestart
          )
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
        sdp: {
          type:
            pc.localDescription
              .type,
          sdp:
            pc.localDescription
              .sdp
        }
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
          sdp: {
            type:
              pc.localDescription
                .type,
            sdp:
              pc.localDescription
                .sdp
          }
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

  function findVideoSender(
    pc = peer
  ) {
    if (!pc) {
      return null;
    }

    const activeSender =
      pc
        .getSenders()
        .find(
          (item) =>
            item.track?.kind ===
            "video"
        );

    if (activeSender) {
      return activeSender;
    }

    return (
      pc
        .getTransceivers?.()
        .find(
          (item) =>
            item.receiver?.track?.kind ===
              "video"
        )
        ?.sender ||
      null
    );
  }

  // === PEOPLE_STREAM_INTEROP_V4_DM_START ===
  function peopleDmVideoTransceiver(pc = peer) {
    if (!pc) return null;
    return pc.getTransceivers().find(transceiver =>
      transceiver.sender?.track?.kind === "video" ||
      transceiver.receiver?.track?.kind === "video"
    ) || null;
  }

  function peopleDmPreferCompatibleVideoCodec(transceiver) {
    try {
      if (!transceiver?.setCodecPreferences || typeof RTCRtpSender?.getCapabilities !== "function") return;
      const codecs = RTCRtpSender.getCapabilities("video")?.codecs || [];
      const preferred = [
        ...codecs.filter(codec => String(codec.mimeType || "").toLowerCase() === "video/vp8"),
        ...codecs.filter(codec => String(codec.mimeType || "").toLowerCase() !== "video/vp8")
      ];
      if (preferred.length) transceiver.setCodecPreferences(preferred);
    } catch (err) {
      console.warn("[People appel MP/codec]", err);
    }
  }

  async function peopleDmSetOutgoingVideo(track) {
    const pc = createPeer();
    let transceiver = peopleDmVideoTransceiver(pc);
    if (!transceiver) {
      transceiver = pc.addTransceiver("video", { direction: track ? "sendrecv" : "recvonly" });
    }
    peopleDmPreferCompatibleVideoCodec(transceiver);
    if (transceiver.sender.track !== track) {
      await transceiver.sender.replaceTrack(track || null);
    }
    transceiver.direction = track ? "sendrecv" : "recvonly";
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

      let outgoingTrack = cameraTrack;
      try {
        outgoingTrack =
          await window.PeopleCameraEffects?.attachSource?.(cameraTrack) || cameraTrack;
      } catch (err) {
        console.warn("[People effets caméra/activation MP]", err);
        outgoingTrack = cameraTrack;
      }

      localStream.addTrack(
        outgoingTrack
      );

      if (
        peer &&
        !screenEnabled
      ) {
        await peopleDmSetOutgoingVideo(
          outgoingTrack
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
            true,
          screen:
            screenEnabled
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
    const oldOutput =
      peopleDmCameraOutputTrack();

    cameraEnabled =
      false;

    if (
      peer &&
      oldTrack &&
      !screenEnabled
    ) {
      await peopleDmSetOutgoingVideo(
        null
      );
    }

    if (localStream) {
      for (const current of [...localStream.getVideoTracks()]) {
        try { localStream.removeTrack(current); } catch {}
      }
    }

    try { window.PeopleCameraEffects?.detachSource?.(oldTrack); } catch {}
    cameraTrack = null;

    if (
      oldTrack &&
      !alreadyEnded
    ) {
      try {
        oldTrack.stop();
      } catch {}
    }

    if (oldOutput && oldOutput !== oldTrack) {
      try { oldOutput.stop(); } catch {}
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
          false,
        screen:
          screenEnabled
      }
    );

    await sendOffer();
  }

  async function enableScreenShare() {
    if (screenEnabled) {
      return;
    }

    if (!call || call.phase !== "active") {
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatus(
        "Partage d'écran indisponible"
      );
      return;
    }

    try {
      const stream =
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
        stream.getVideoTracks()[0];

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
            void disableScreenShare(
              true
            );
          }
        },
        { once: true }
      );

      await peopleDmSetOutgoingVideo(
        screenTrack
      );

      await sendOffer();

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
            cameraEnabled,
          screen:
            true
        }
      );

      setStatus(
        "Appel en cours • partage d'écran"
      );
    } catch (err) {
      console.warn(
        "[People appel MP/partage écran]",
        err
      );

      screenTrack = null;
      screenEnabled = false;
      updateMediaButtons();

      if (err?.name !== "NotAllowedError") {
        setStatus(
          "Partage d'écran indisponible"
        );
      }
    }
  }

  async function disableScreenShare(
    alreadyEnded = false
  ) {
    if (
      !screenEnabled &&
      !screenTrack
    ) {
      return;
    }

    const oldTrack =
      screenTrack;

    screenEnabled = false;
    screenTrack = null;

    if (
      oldTrack &&
      !alreadyEnded
    ) {
      try {
        oldTrack.stop();
      } catch {}
    }

    if (peer) {
      await peopleDmSetOutgoingVideo(
        cameraEnabled && cameraTrack
          ? peopleDmCameraOutputTrack()
          : null
      );
      await sendOffer();
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
          cameraEnabled,
        screen:
          false
      }
    );

    setStatus(
      "Appel en cours"
    );
  }

  // === PEOPLE_STREAM_INTEROP_V4_DM_END ===

  async function toggleMute() {
    await ensureLocalAudio();

    micMuted =
      !micMuted;

    peopleDmPlayCallEventSound(
      micMuted
        ? "mute"
        : "unmute"
    );

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
          cameraEnabled,
        screen:
          screenEnabled
      }
    );
  }

  function resetPeerConnectionOnly() {
    if (connectionWatchTimer) {
      clearTimeout(
        connectionWatchTimer
      );
      connectionWatchTimer = null;
    }

    if (iceRestartTimer) {
      clearTimeout(
        iceRestartTimer
      );
      iceRestartTimer = null;
    }

    if (peer) {
      try {
        peer.ontrack = null;
        peer.onicecandidate = null;
        peer.onconnectionstatechange = null;
        peer.close();
      } catch {}
    }

    peer = null;
    pendingIce = [];

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

    try {
      remoteVideo.srcObject =
        null;
      remoteAudio.srcObject =
        null;
    } catch {}

    remoteVideo.classList.add(
      "hidden"
    );

    identity.classList.remove(
      "with-video"
    );
  }

  function stopMedia() {
    if (connectionWatchTimer) {
      clearTimeout(
        connectionWatchTimer
      );
      connectionWatchTimer = null;
    }

    if (iceRestartTimer) {
      clearTimeout(
        iceRestartTimer
      );
      iceRestartTimer = null;
    }

    if (peer) {
      try {
        peer.ontrack = null;
        peer.onicecandidate = null;
        peer.onconnectionstatechange = null;
        peer.close();
      } catch {}
    }

    peer = null;

    if (cameraTrack) {
      const rawCameraTrack = cameraTrack;
      try { window.PeopleCameraEffects?.detachSource?.(rawCameraTrack); } catch {}
      try { rawCameraTrack.stop(); } catch {}
    }

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

    if (screenTrack) {
      try {
        screenTrack.stop();
      } catch {}
    }

    screenTrack = null;
    screenEnabled = false;
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
      left:
        "Tu as quitté l'appel",
      empty:
        "Appel terminé",
      "alone-timeout":
        "Appel fermé après 3 min seul",
      disconnected:
        "Connexion quittée",
      unavailable:
        "Appel indisponible",
      limit:
        "Tu es déjà dans un vocal ou un appel",
      "joined-elsewhere":
        "Appel rejoint ailleurs",
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

    if (
      [
        "left",
        "disconnected"
      ].includes(
        String(
          reason ||
          ""
        )
      )
    ) {
      peopleDmPlayCallEventSound(
        "leave"
      );
    }

    stopMedia();

    const oldCall =
      call;

    const keepJoinable =
      Boolean(
        oldCall &&
        [
          "left",
          "declined",
          "disconnected"
        ].includes(
          String(reason || "")
        )
      );

    if (keepJoinable) {
      joinableCall = {
        id: oldCall.id,
        username: oldCall.username
      };
    } else if (
      joinableCall &&
      oldCall &&
      String(joinableCall.id) ===
        String(oldCall.id)
    ) {
      joinableCall = null;
    }

    call = null;
    updateCallButtonLabel();

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

    joinableCall = {
      id: String(
        payload?.callId ||
        ""
      ),
      username: String(
        payload?.caller?.username ||
        "Utilisateur"
      )
    };

    updateCallButtonLabel();

    call = {
      id:
        String(
          payload?.callId ||
          ""
        ),
      role:
        "joiner",
      username:
        String(
          payload?.caller?.username ||
          "Utilisateur"
        ),
      peerSocketId:
        null,
      remoteCamera:
        false,
      remoteScreen:
        false,
      soundPeerPresent:
        false,
      rejoin:
        Boolean(
          payload?.rejoin
        )
    };

    setCallPerson(
      call.username
    );

    setStatus(
      call.rejoin
        ? "Appel en cours • tu peux rejoindre"
        : "Appel entrant…"
    );

    showMode(
      "incoming"
    );

    showOverlay();

    if (!payload?.silent) {
      startRinging(
        "incoming"
      );
    }

    try {
      if (
        !payload?.silent &&
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

    const previousPeerSocketId =
      String(
        call.peerSocketId ||
        ""
      );

    const nextPeerSocketId =
      String(
        payload?.peerSocketId ||
        ""
      );

    const shouldPlayJoinSound =
      Boolean(
        nextPeerSocketId
      ) &&
      !Boolean(
        call.soundPeerPresent
      );

    if (
      peer &&
      previousPeerSocketId &&
      nextPeerSocketId &&
      previousPeerSocketId !==
        nextPeerSocketId
    ) {
      resetPeerConnectionOnly();
    }

    call.peerSocketId =
      nextPeerSocketId;

    call.soundPeerPresent =
      Boolean(
        nextPeerSocketId
      );

    if (shouldPlayJoinSound) {
      peopleDmPlayCallEventSound(
        "join"
      );
    }

    if (
      payload?.peerUsername
    ) {
      call.username =
        String(
          payload.peerUsername
        );

      setCallPerson(
        call.username
      );
    }

    call.remoteMuted =
      Boolean(
        payload?.peerMuted
      );

    call.remoteCamera =
      Boolean(
        payload?.peerCamera
      );

    call.remoteScreen =
      Boolean(
        payload?.peerScreen
      );

    call.initiator =
      Boolean(
        payload?.initiator
      );

    showMode(
      "active"
    );

    showOverlay();

    await ensureLocalAudio(
      4500
    );

    socket.emit(
      "dm-call-media-state",
      {
        callId:
          call.id,
        muted:
          micMuted,
        camera:
          cameraEnabled,
        screen:
          screenEnabled
      }
    );

    if (!call.peerSocketId) {
      setStatus(
        "En attente de " +
        call.username +
        "… • fermeture après 3 min seul"
      );

      return;
    }

    stopRinging();

    setStatus(
      "Connexion…"
    );

    createPeer();

    if (
      screenEnabled &&
      screenTrack
    ) {
      await peopleDmSetOutgoingVideo(
        screenTrack
      );
    } else if (
      cameraEnabled &&
      cameraTrack
    ) {
      await peopleDmSetOutgoingVideo(
        peopleDmCameraOutputTrack()
      );
    }

    if (connectionWatchTimer) {
      clearTimeout(
        connectionWatchTimer
      );
    }

    connectionWatchTimer =
      setTimeout(
        () => {
          if (
            call &&
            call.peerSocketId &&
            peer &&
            peer.connectionState !==
              "connected"
          ) {
            setStatus(
              "Connexion réseau impossible — vérifie le réseau/TURN"
            );

            console.warn(
              "[People appel MP] connexion non établie",
              {
                connectionState:
                  peer.connectionState,
                iceConnectionState:
                  peer.iceConnectionState,
                iceGatheringState:
                  peer.iceGatheringState,
                signalingState:
                  peer.signalingState
              }
            );
          }
        },
        12000
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

        joinableCall = null;
        updateCallButtonLabel();

        call = {
          id:
            String(
              response.callId
            ),
          role:
            "member",
          username:
            String(
              response.peerUsername ||
              response.target?.username ||
              targetUsername
            ),
          peerSocketId:
            String(
              response.peerSocketId ||
              ""
            ),
          remoteMuted:
            Boolean(
              response.peerMuted
            ),
          remoteCamera:
            Boolean(
              response.peerCamera
            ),
          remoteScreen:
            Boolean(
              response.peerScreen
            ),
          soundPeerPresent:
            false
        };

        setCallPerson(
          call.username
        );

        showOverlay();

        if (
          response.created &&
          !response.peerSocketId
        ) {
          startRinging(
            "outgoing"
          );
        }

        void beginActiveCall({
          callId:
            call.id,
          peerSocketId:
            response.peerSocketId,
          peerUsername:
            call.username,
          peerMuted:
            response.peerMuted,
          peerCamera:
            response.peerCamera,
          peerScreen:
            response.peerScreen,
          initiator:
            response.initiator
        });
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
          "joiner"
      ) {
        return;
      }

      stopRinging();

      setStatus(
        "Connexion…"
      );

      acceptButton.disabled =
        true;

      /*
        Ne jamais bloquer l'acceptation de l'appel sur
        getUserMedia(). Une permission micro lente pouvait
        laisser l'autre client sonner indéfiniment.
      */
      void requestLocalAudio();

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

            return;
          }

          if (call) {
            joinableCall = null;
            updateCallButtonLabel();

            call.role =
              "member";

            void beginActiveCall({
              callId:
                call.id,
              peerSocketId:
                response.peerSocketId,
              peerUsername:
                response.peerUsername ||
                call.username,
              peerMuted:
                response.peerMuted,
              peerCamera:
                response.peerCamera,
              peerScreen:
                response.peerScreen,
              initiator:
                response.initiator
            });
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
          "joiner"
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

  effectsButton?.addEventListener(
    "click",
    () => {
      if (!cameraEnabled) return;
      window.PeopleCameraEffects?.togglePicker?.(effectsButton);
    }
  );

  screenButton.addEventListener(
    "click",
    () => {
      if (screenEnabled) {
        void disableScreenShare();
      } else {
        void enableScreenShare();
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
      if (
        call &&
        String(
          payload?.callId ||
          ""
        ) === call.id
      ) {
        joinableCall = null;
        updateCallButtonLabel();

        call.role =
          "member";
      }

      void beginActiveCall(
        payload
      );
    }
  );

  socket.on(
    "dm-call-ring-ended",
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

      stopRinging();

      if (call.peerSocketId) {
        return;
      }

      setStatus(
        call.role === "joiner"
          ? "Appel en cours • tu peux rejoindre"
          : "En attente de " +
            call.username +
            "… • fermeture après 3 min seul"
      );
    }
  );

  socket.on(
    "dm-call-peer-left",
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

      stopRinging();
      resetPeerConnectionOnly();

      call.peerSocketId =
        "";
      call.soundPeerPresent =
        false;

      peopleDmPlayCallEventSound(
        "leave"
      );

      call.remoteMuted =
        false;
      call.remoteCamera =
        false;
      call.remoteScreen =
        false;
      call.initiator =
        false;

      syncRemoteMedia();
      showMode(
        "active"
      );
      showOverlay();

      setStatus(
        call.username +
        " a quitté • fermeture dans 3 min s'il ne revient pas"
      );
    }
  );

  socket.on(
    "dm-call-peer-declined",
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

      stopRinging();

      if (!call.peerSocketId) {
        setStatus(
          call.username +
          " a refusé • tu restes dans l'appel jusqu'à 3 min"
        );
      }
    }
  );

  socket.on(
    "dm-call-left",
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
        "left",
        {
          immediate: true
        }
      );
    }
  );

  socket.on(
    "dm-call-ended",
    (payload) => {
      const endedCallId =
        String(
          payload?.callId ||
          ""
        );

      if (
        joinableCall &&
        endedCallId ===
          String(
            joinableCall.id ||
            ""
          )
      ) {
        joinableCall = null;
        updateCallButtonLabel();
      }

      if (
        !call ||
        endedCallId !== call.id
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

      call.remoteScreen =
        Boolean(
          payload?.screen
        );

      syncRemoteMedia();

      if (payload?.screen) {
        setStatus(
          payload?.muted
            ? "Appel en cours • partage d'écran • micro distant coupé"
            : "Appel en cours • partage d'écran"
        );
      } else if (
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

  const callButtonContextObserver =
    new MutationObserver(
      updateCallButtonLabel
    );

  callButtonContextObserver.observe(
    dmView,
    {
      attributes: true,
      attributeFilter: [
        "class"
      ]
    }
  );

  callButtonContextObserver.observe(
    dmHeaderName,
    {
      childList: true,
      subtree: true,
      characterData: true
    }
  );

  updateCallButtonLabel();

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

    openEffects(anchor = effectsButton) {
      if (!call || !cameraEnabled) {
        return false;
      }
      window.PeopleCameraEffects?.togglePicker?.(anchor || effectsButton);
      return true;
    },

    async toggleScreen() {
      if (!call || call.phase !== "active") {
        return false;
      }

      if (screenEnabled) {
        await disableScreenShare();
      } else {
        await enableScreenShare();
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

/* ===== people-dm-calls-v2.js — version stable d'origine ===== */
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
    overlay,
    {
      attributes: true,
      attributeFilter: [
        "class"
      ]
    }
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

  function loadPref() {
    try {
      const raw =
        localStorage.getItem(
          prefKey()
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

  function savePref(pref) {
    try {
      localStorage.setItem(
        prefKey(),
        JSON.stringify(
          pref
        )
      );
    } catch {}
  }

  function applyPref() {
    const pref =
      loadPref();

    remoteAudio.volume =
      Math.max(
        0,
        Math.min(
          1,
          pref.volume /
          100
        )
      );

    remoteAudio.muted =
      pref.muted;

    volumeRange.value =
      String(
        pref.volume
      );

    volumeValue.textContent =
      Math.round(
        pref.volume
      ) + "%";

    volumeMute.textContent =
      pref.muted
        ? "🔇"
        : "🔊";

    volumeMute.classList.toggle(
      "is-muted",
      pref.muted
    );

    volumeMute.title =
      pref.muted
        ? "Réactiver le son de la personne"
        : "Couper le son de la personne";
  }

  volumeMute.addEventListener(
    "click",
    () => {
      const pref =
        loadPref();

      pref.muted =
        !pref.muted;

      savePref(
        pref
      );

      applyPref();
    }
  );

  volumeRange.addEventListener(
    "input",
    () => {
      const pref =
        loadPref();

      pref.volume =
        Number(
          volumeRange.value
        );

      savePref(
        pref
      );

      applyPref();
    }
  );

  const nameObserver =
    new MutationObserver(
      () => {
        applyPref();
        syncPlacement();
      }
    );

  nameObserver.observe(
    callName,
    {
      childList: true,
      subtree: true,
      characterData: true
    }
  );

  const audioObserver =
    new MutationObserver(
      applyPref
    );

  audioObserver.observe(
    remoteAudio,
    {
      attributes: true,
      attributeFilter: [
        "src"
      ]
    }
  );

  /*
    WebRTC peut réattribuer srcObject sans mutation DOM.
    On réapplique donc le réglage très légèrement.
  */
  setInterval(
    () => {
      if (
        overlayVisible()
      ) {
        applyPref();
      }
    },
    1200
  );

  applyPref();
  syncPlacement();

  // === PEOPLE_DM_CALLS_V2_CLIENT_END ===
})();

/* ===== people-dm-calls-v3.js — version stable d'origine ===== */
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

      const next =
        resizeState.startHeight +
        (
          event.clientY -
          resizeState.startY
        );

      applyHeight(
        next
      );
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

    const currentHeight =
      card
        .getBoundingClientRect()
        .height;

    applyHeight(
      currentHeight,
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

  function syncPipVideoSource() {
    const source =
      remoteVideo.srcObject;

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
    }

    if (!source) {
      try {
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

    syncPipVideoSource();

    const shouldShow =
      remoteCamera &&
      !currentDmMatchesCall() &&
      !pipDismissed;

    pip.classList.toggle(
      "hidden",
      !shouldShow
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
          rect.top
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
            event.clientX -
            dragState.offsetX
          )
        );

      const top =
        Math.max(
          8,
          Math.min(
            maxTop,
            event.clientY -
            dragState.offsetY
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

  for (
    const element of [
      overlay,
      dmView,
      activeActions,
      remoteVideo
    ]
  ) {
    stateObserver.observe(
      element,
      {
        attributes: true,
        attributeFilter: [
          "class"
        ]
      }
    );
  }

  stateObserver.observe(
    dmHeaderName,
    {
      childList: true,
      subtree: true,
      characterData: true
    }
  );

  stateObserver.observe(
    callName,
    {
      childList: true,
      subtree: true,
      characterData: true
    }
  );

  /*
    srcObject n'est pas un attribut DOM.
    Vérification légère uniquement pendant l'appel.
  */
  setInterval(
    () => {
      if (
        !overlay.classList
          .contains(
            "hidden"
          )
      ) {
        syncPip();
      }
    },
    700
  );

  scheduleSync();

  // === PEOPLE_DM_CALLS_V3_CLIENT_END ===
})();
