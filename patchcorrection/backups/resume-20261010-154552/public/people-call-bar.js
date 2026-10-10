/* Global call presentation. Navigation never owns or tears down a call. */
(() => {
  "use strict";
  let showNames = false;
  let selected = "";
  let second = null;
  let joining = false;
  let primarySoundMuted = false;
  const bar = document.createElement("nav");
  bar.id = "peopleCallBar";
  bar.setAttribute("aria-label", ("" + window.PeopleI18n.t("ui_57e59d440b") + ""));
  bar.hidden = true;
  document.body.append(bar);
  document.body.classList.add("people-global-calls");
  document.querySelectorAll(".people-dm-call-card").forEach(card => card.setAttribute("aria-modal", "false"));

  const notify = () => window.dispatchEvent(new Event("people-global-call-state"));
  const request = (connection, event, payload) => new Promise((resolve, reject) => {
    connection.timeout(10000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result));
  });
  // The existing server protocol keeps one voice per socket. A second voice has
  // its own authenticated transport and media, subject to the same account quota.
  function createSecondVoice(serverId, channelId, name) {
    const connection = io({ autoConnect: false });
    const pcs = new Map(), candidates = new Map(), media = new Map();
    let stream, videoTrack, roster = [], ended = false, generation = 0, videoBusy = false;
    const state = { id: "server-secondary", serverId, channelId, name, phase: "connecting", muted: false, soundMuted: false, camera: false, screen: false };
    const outgoingVideo = () => state.camera ? (window.PeopleCameraEffects?.getOutputTrack?.(videoTrack) || videoTrack) : videoTrack;
    function closePeer(id) {
      const pc = pcs.get(id);
      pcs.delete(id); pc?.close(); candidates.delete(id);
      media.get(id)?.remove(); media.delete(id);
    }
    function closePeers() { for (const id of [...pcs.keys()]) closePeer(id); }
    function peer(id) {
      if (pcs.has(id)) return pcs.get(id);
      const pc = new RTCPeerConnection(rtcConfig);
      for (const track of stream?.getAudioTracks() || []) pc.addTrack(track, stream);
      const transceiver = pc.addTransceiver("video", { direction: videoTrack ? "sendrecv" : "recvonly" });
      peoplePreferCompatibleVideoCodec(pc, transceiver);
      if (videoTrack) void transceiver.sender.replaceTrack(outgoingVideo());
      pc.onicecandidate = event => { if (event.candidate) connection.emit("webrtc-ice-candidate", { target: id, candidate: event.candidate }); };
      pc.ontrack = event => {
        let node = media.get(id);
        if (!node) {
          node = document.createElement("video"); node.autoplay = true; node.playsInline = true;
          node.className = "people-global-remote-media"; node.dataset.peerId = id;
          document.body.append(node); media.set(id, node);
        }
        const remote = node.srcObject || new MediaStream();
        if (!remote.getTracks().includes(event.track)) remote.addTrack(event.track);
        node.srcObject = remote; node.muted = state.soundMuted;
        void window.PeopleAudioDevices?.applyOutput?.(node);
        void window.PeopleCallMedia?.play(node);
        notify();
      };
      let recovery;
      pc.onconnectionstatechange = () => {
        clearTimeout(recovery);
        if (["failed", "disconnected"].includes(pc.connectionState)) recovery = setTimeout(() => {
          if (ended || pcs.get(id) !== pc) return;
          closePeer(id); connection.emit("voice-peer-reconnect", { target: id });
          if (connection.id.localeCompare(id) > 0) void offer(id).catch(console.warn);
        }, 3000);
      };
      pcs.set(id, pc); return pc;
    }
    async function flush(id, pc) {
      for (const candidate of candidates.get(id) || []) await pc.addIceCandidate(candidate);
      candidates.delete(id);
    }
    async function offer(id) {
      if (ended || !connection.connected || !roster.some(user => user.id === id)) return;
      const pc = peer(id);
      if (pc.signalingState !== "stable") return;
      await pc.setLocalDescription(await pc.createOffer());
      connection.emit("webrtc-offer", { target: id, sdp: pc.localDescription });
    }
    const safe = fn => data => { void Promise.resolve().then(() => fn(data)).catch(error => { if (!ended) console.warn(("" + window.PeopleI18n.t("ui_6e8492f83f") + ""), error); }); };
    connection.on("webrtc-offer", safe(async ({ from, sdp }) => {
      if (ended || !stream) return;
      const pc = peer(from);
      if (pc.signalingState === "have-local-offer") await pc.setLocalDescription({ type: "rollback" });
      await pc.setRemoteDescription(sdp); await flush(from, pc);
      await pc.setLocalDescription(await pc.createAnswer());
      connection.emit("webrtc-answer", { target: from, sdp: pc.localDescription });
    }));
    connection.on("webrtc-answer", safe(async ({ from, sdp }) => {
      const pc = pcs.get(from); if (!pc) return;
      await pc.setRemoteDescription(sdp); await flush(from, pc);
    }));
    connection.on("webrtc-ice-candidate", safe(async ({ from, candidate }) => {
      const pc = pcs.get(from);
      if (pc?.remoteDescription) await pc.addIceCandidate(candidate);
      else candidates.set(from, [...(candidates.get(from) || []), candidate]);
    }));
    connection.on("peer-left", closePeer);
    connection.on("voice-peer-reconnect", safe(async ({ from }) => {
      closePeer(from); if (connection.id.localeCompare(from) > 0) await offer(from);
    }));
    connection.on("voice-state", payload => {
      if (String(payload?.serverId) !== String(serverId)) return;
      roster = (payload.users || payload.roster || []).filter(user => String(user.channelId) === String(channelId));
      notify();
      for (const id of pcs.keys()) if (!roster.some(user => user.id === id)) closePeer(id);
    });
    connection.on("disconnect", () => { if (!ended) { generation++; state.phase = "reconnecting"; closePeers(); notify(); } });
    connection.on("connect", () => connection.emit("join"));
    connection.on("people-ready", safe(async () => {
      const version = ++generation;
      const result = await request(connection, "voice-join", { serverId, channelId, muted: state.muted, camera: state.camera, screen: state.screen });
      if (ended || version !== generation) return;
      if (!result?.ok) { window.alert(result?.error || ("" + window.PeopleI18n.t("ui_ea9b754ec7") + "")); controller.end(); return; }
      roster = result.roster || [];
      state.muted = Boolean(roster.find(user => user.id === connection.id)?.muted);
      for (const track of stream.getAudioTracks()) track.enabled = !state.muted;
      state.phase = "active"; notify();
      await Promise.allSettled(roster.filter(user => user.id !== connection.id).map(user => offer(user.id)));
    }));
    connection.on("voice-disconnected-by-admin", () => controller.end());
    connection.on("server-membership-left", payload => { if (String(payload.serverId) === String(serverId)) controller.end(); });
    async function video(kind) {
      if (ended || state.phase !== "active" || videoBusy) return;
      videoBusy = true;
      try {
      const stopping = state[kind];
      const next = stopping ? null : await (kind === "screen"
        ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        : navigator.mediaDevices.getUserMedia({ video: window.PeopleAudioDevices?.getCameraConstraints?.() || true, audio: false }));
      if (ended) { next?.getTracks().forEach(track => track.stop()); return; }
      if (state.camera) window.PeopleCameraEffects?.detachSource?.(videoTrack);
      videoTrack?.stop(); videoTrack = next?.getVideoTracks()[0] || null;
      state.camera = kind === "camera" && Boolean(videoTrack); state.screen = kind === "screen" && Boolean(videoTrack);
      if (state.camera) await window.PeopleCameraEffects?.attachSource?.(videoTrack);
      if (videoTrack) videoTrack.onended = () => { if (!ended) void video(kind).catch(console.warn); };
      connection.emit("voice-camera", { camera: state.camera }); connection.emit("voice-screen", { screen: state.screen });
      for (const [id, pc] of pcs) {
        const transceiver = peopleFindVideoTransceiver(pc);
        await transceiver.sender.replaceTrack(outgoingVideo()); transceiver.direction = videoTrack ? "sendrecv" : "recvonly";
        await offer(id);
      }
      notify();
      } finally { videoBusy = false; }
    }
    const controller = {
      state,
      getMedia: () => [...media.values()],
      getLocalAudio: () => stream,
      getAudioSamples: () => [{ username, stream }, ...roster.filter(user => user.id !== connection.id).map(user => ({ username: user.username, stream: media.get(user.id)?.srcObject }))],
      getRoster: () => roster,
      getLocalVideo: () => outgoingVideo() ? new MediaStream([outgoingVideo()]) : null,
      getSocketId: () => connection.id,
      reconnect() { if (!ended) { connection.disconnect(); connection.connect(); } },
      async move(nextServerId, nextChannelId, nextName) {
        const result = await request(connection, "voice-join", { serverId: nextServerId, channelId: nextChannelId, muted: state.muted, camera: state.camera, screen: state.screen });
        if (!result?.ok) throw new Error(result?.error || ("" + window.PeopleI18n.t("ui_7a5b41dfe0") + ""));
        if (ended) return;
        closePeers(); serverId = nextServerId; channelId = nextChannelId;
        Object.assign(state, { serverId, channelId, name: nextName, phase: "active" });
        roster = result.roster || []; notify();
        await Promise.allSettled(roster.filter(user => user.id !== connection.id).map(user => offer(user.id)));
      },
      async start() {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: window.PeopleAudioDevices?.getInputConstraints?.() || true, video: false });
          if (ended) { stream.getTracks().forEach(track => track.stop()); return; }
          connection.connect();
        } catch (error) { controller.end(); throw error; }
      },
      mute() { state.muted = !state.muted; stream?.getAudioTracks().forEach(track => { track.enabled = !state.muted; }); connection.emit("voice-mute", { muted: state.muted }); notify(); },
      sound() { state.soundMuted = !state.soundMuted; for (const node of media.values()) node.muted = state.soundMuted; notify(); },
      camera: () => video("camera"), screen: () => video("screen"),
      end() {
        ended = true; generation++;
        window.removeEventListener("people-camera-effect-track-changed", refreshEffects);
        window.removeEventListener("people-camera-input-device-changed", switchCamera);
        if (state.camera) window.PeopleCameraEffects?.detachSource?.(videoTrack);
        connection.emit("voice-leave"); connection.disconnect(); closePeers();
        stream?.getTracks().forEach(track => track.stop()); videoTrack?.stop();
        if (second === controller) second = null; notify();
      }
    };
    function refreshEffects() {
      if (ended || !state.camera || videoBusy) return;
      void Promise.allSettled([...pcs].map(async ([id, pc]) => {
        await peopleFindVideoTransceiver(pc).sender.replaceTrack(outgoingVideo());
        await offer(id);
      })).then(notify);
    }
    window.addEventListener("people-camera-effect-track-changed", refreshEffects);
    async function switchCamera() {
      if (ended || !state.camera || videoBusy) return;
      videoBusy = true;
      let replacement;
      const previous = videoTrack;
      try {
        replacement = await navigator.mediaDevices.getUserMedia({ video: window.PeopleAudioDevices?.getCameraConstraints?.() || true, audio: false });
        if (ended) { replacement.getTracks().forEach(track => track.stop()); return; }
        const next = replacement.getVideoTracks()[0];
        if (!next) throw new Error("Camera unavailable.");
        videoTrack = next;
        await window.PeopleCameraEffects?.attachSource?.(next);
        for (const pc of pcs.values()) await peopleFindVideoTransceiver(pc).sender.replaceTrack(outgoingVideo());
        previous?.stop();
        next.onended = () => { if (!ended && videoTrack === next) void video("camera"); };
        notify();
      } catch (error) {
        videoTrack = previous; replacement?.getTracks().forEach(track => track.stop());
        if (previous) await window.PeopleCameraEffects?.attachSource?.(previous);
        for (const pc of pcs.values()) await peopleFindVideoTransceiver(pc).sender.replaceTrack(outgoingVideo()).catch(() => {});
        window.alert("Unable to switch camera. The previous camera is still selected.");
      } finally { videoBusy = false; }
    }
    window.addEventListener("people-camera-input-device-changed", switchCamera);
    return controller;
  }

  const primary = {
    getLocalAudio: () => localStream,
    getAudioSamples: () => [{ username, stream: localStream }, ...activeVoiceRoster.filter(user => user.id !== socket.id).map(user => ({ username: user.username, stream: document.getElementById("audio-" + user.id)?.srcObject }))],
    mute() { micMuted = !micMuted; localStream?.getAudioTracks().forEach(track => { track.enabled = !micMuted; }); socket.emit("voice-mute", { muted: micMuted }); updateMicUi(); notify(); },
    sound() {
      primarySoundMuted = !primarySoundMuted;
      for (const id of peers.keys()) {
        const node = document.getElementById("audio-" + id);
        if (!node) continue;
        if (primarySoundMuted) node.dataset.peopleCallPreviousMuted = String(node.muted);
        node.muted = primarySoundMuted || node.dataset.peopleCallPreviousMuted === "true";
      }
      notify();
    },
    camera: () => cameraEnabled ? disableCamera() : enableCamera(),
    async move(serverId, channelId) {
      const result = await peopleVoiceJoinRequest(serverId, channelId);
      if (!result?.ok) throw new Error(result?.error || ("" + window.PeopleI18n.t("ui_7a5b41dfe0") + ""));
      for (const id of [...peers.keys()]) closePeer(id);
      activeVoiceServerId = String(serverId); activeVoiceChannelId = String(channelId);
      peopleSetActiveVoiceRoster(result.roster || []);
      await peopleConnectActiveVoicePeers(); notify();
    },
    screen: () => screenEnabled ? disableScreenShare() : enableScreenShare(),
    end: () => { leaveVoice(); primarySoundMuted = false; notify(); }
  };
  function states() {
    const calls = (window.PeopleDmCalls?.getStates() || []).filter(state => state.exists).map(state => ({ ...state, id: state.callId, type: "dm", name: state.username }));
    if (voiceJoined) calls.push({ id: "server-primary", type: "server", serverId: activeVoiceServerId, channelId: activeVoiceChannelId, phase: socket.connected ? "active" : "reconnecting", muted: micMuted, camera: cameraEnabled, screen: screenEnabled, soundMuted: primarySoundMuted, name: peopleCachedServerPayload(activeVoiceServerId)?.channels?.find(channel => String(channel.id) === String(activeVoiceChannelId))?.name || ("" + window.PeopleI18n.t("ui_63ff7c0170") + "") });
    if (second) calls.push({ ...second.state, type: "server" });
    return calls;
  }
  function button(label, action, pressed) {
    const node = document.createElement("button"); node.type = "button"; node.textContent = label;
    if (pressed !== undefined) node.setAttribute("aria-pressed", String(pressed));
    node.onclick = () => { void Promise.resolve().then(action).catch(error => window.alert(error.message)); };
    return node;
  }
  function render() {
    const calls = states();
    bar.hidden = !calls.length;
    document.body.classList.toggle("people-has-calls", Boolean(calls.length));
    // Reconcile by id: preserve keyboard focus and buttons through state changes.
    for (const node of [...bar.children]) if (!calls.some(call => call.id === node.dataset.callId)) node.remove();
    calls.forEach((call, index) => {
      let node = [...bar.children].find(node => node.dataset.callId === call.id);
      if (!node) { node = button("", () => open(call.id)); node.dataset.callId = call.id; bar.append(node); }
      const label = showNames ? call.name : `${call.type === "dm" ? ("" + window.PeopleI18n.t("ui_73acbe0e7e") + "") : ("" + window.PeopleI18n.t("ui_5f552459ac") + "")} ${index + 1}`;
      const status = { active: "En cours", incoming: "Entrant", outgoing: "Sonnerie", connecting: ("" + window.PeopleI18n.t("ui_d403c686f6") + ""), reconnecting: "Reconnexion" }[call.phase] || ("" + window.PeopleI18n.t("ui_d403c686f6") + "");
      const text = `● ${label} · ${status}${call.muted ? (" " + window.PeopleI18n.t("ui_8906221d20") + "") : ""}`;
      if (node.textContent !== text) node.textContent = text;
      node.title = text; node.setAttribute("aria-expanded", String(selected === call.id));
      const slot = window.PeopleDmCalls.getStates().findIndex(state => state.callId === call.id);
      node.setAttribute("aria-controls", call.type === "server" ? (call.id === "server-primary" ? "videoStage" : "videoStageSecond") : "peopleDmCallOverlay" + (slot ? "Second" : ""));
    });
    if (selected && !calls.some(call => call.id === selected)) close();
    window.PeopleServerVoiceUi?.sync();
  }
  function close() { selected = ""; render(); }
  let navigationVersion = 0;
  async function open(id) {
    const version = ++navigationVersion;
    const call = states().find(call => call.id === id);
    if (!call) return;
    selected = id;
    document.getElementById("peopleSettingsModal")?.classList.add("hidden");
    if (call.type === "dm") {
      await window.PeopleSocialNavigation.openDm(call.username);
      if (version !== navigationVersion) return;
      window.PeopleDmCalls.getSlot(id)?.show();
      window.dispatchEvent(new CustomEvent("people-call-restore", { detail: call }));
    } else {
      if (String(peopleActiveServerId) !== String(call.serverId) || document.getElementById("peopleMain").classList.contains("hidden")) {
        const response = await fetch("/api/servers");
        const data = await response.json();
        if (version !== navigationVersion) return;
        const server = data.servers?.find(server => String(server.id) === String(call.serverId));
        if (!server) return;
        await window.PeopleServers.openServer(server);
      }
      if (version !== navigationVersion) return;
      window.PeopleServerVoiceUi.show(call.serverId, call.channelId);
    }
    render();
  }
  window.PeopleCallBar = {
    get selectedCallId() { return selected; }, getStates: states, open, close,
    isServerSoundMuted: () => primarySoundMuted,
    getServerController: id => id === "server-primary" ? primary : second,
    hasSecondary: (serverId, channelId) => second && String(second.state.serverId) === String(serverId) && String(second.state.channelId) === String(channelId),
    reconnectSecond: () => second?.reconnect(),
    async joinServer(serverId, channelId) {
      if (joining) return false;
      if (second && String(second.state.serverId) === String(serverId) && String(second.state.channelId) === String(channelId)) { open(second.state.id); return true; }
      if (states().filter(call => call.phase !== "incoming").length >= 2) { window.alert("Tu as atteint la limite de 2 appels simultanés. Raccroche un appel pour continuer."); return false; }
      joining = true;
      try {
        const name = window.PeopleServerRuntime.getChannels().find(channel => String(channel.id) === String(channelId))?.name || ("" + window.PeopleI18n.t("ui_63ff7c0170") + "");
        second = createSecondVoice(serverId, channelId, name); render(); await second.start(); window.PeopleServerVoiceUi.show(serverId, channelId); return true;
      } finally { joining = false; }
    }
  };
  for (const event of ["people-dm-call-state", "people-global-call-state", "people-server-channel-state"]) window.addEventListener(event, render);
  socket.on("disconnect", render); socket.on("connect", render);
  socket.on("people-call-privacy", data => { showNames = data.showInterlocutors === true; render(); });
  async function privacy() {
    showNames = false; render();
    try { const response = await fetch("/api/call-privacy"); if (response.ok) showNames = (await response.json()).showInterlocutors === true; } catch {}
    render();
  }
  window.addEventListener("people-authenticated", privacy); void privacy();
  socket.on("connect", privacy);
  document.getElementById("logoutButton")?.addEventListener("click", () => { second?.end(); for (const state of window.PeopleDmCalls.getStates()) if (state.exists) window.PeopleDmCalls.getSlot(state.callId)?.end(); close(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  // Only observe the original runtime's controls, never the bar itself.
  const observer = new MutationObserver(render);
  for (const id of ["voiceStatus", "muteButton", "cameraButton", "screenButton", "leaveVoiceQuickButton"]) {
    const node = document.getElementById(id); if (node) observer.observe(node, { attributes: true, childList: true, subtree: true, characterData: true });
  }
  window.addEventListener("beforeunload", () => second?.end());
  render();
})();
