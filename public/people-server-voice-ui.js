/* === PEOPLE_SERVER_VOICE_UI_V1 === */
(() => {
  "use strict";

  if (window.PeopleServerVoiceUi?.version) return;

  const VERSION = "1.0.0";
  let syncQueued = false;
  let viewed = null;
  const selections = new Map();

  const CONTROL_SPECS = Object.freeze([
    { key: "mute", sourceId: "muteButton", icon: "🎙️", label: "Micro" },
    { key: "sound", icon: "\u{1f50a}", label: "Son" },
    { key: "camera", sourceId: "cameraButton", icon: "📷", label: "Caméra" },
    { key: "screen", sourceId: "screenButton", icon: "🖥️", label: "Écran" },
    { key: "leave", sourceId: "leaveVoiceQuickButton", icon: "📞", label: "Raccrocher", danger: true }
  ]);

  function createControl(spec, bar) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "people-server-call-control";
    button.dataset.peopleServerCallControl = spec.key;
    if (spec.danger) button.classList.add("danger");

    const icon = document.createElement("span");
    icon.className = "people-server-call-control-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = spec.icon;

    const label = document.createElement("span");
    label.className = "people-server-call-control-label";
    label.textContent = spec.label;

    button.append(icon, label);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const controller = window.PeopleCallBar?.getServerController(bar.dataset.callId);
      if (!controller) return;
      const method = spec.key === "leave" ? "end" : spec.key;
      void Promise.resolve().then(() => controller[method]()).catch(error => window.alert(error.message));
      queueSync();
    });

    return button;
  }

  function ensureControlBar(stage) {
    const grid = stage.querySelector(".video-grid");
    if (!(stage instanceof HTMLElement) || !(grid instanceof HTMLElement)) return null;

    let bar = stage.querySelector(".people-server-call-controls");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "peopleServerCallControls" + (stage.id === "videoStageSecond" ? "Second" : "");
      bar.className = "people-server-call-controls";
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", "Contrôles du vocal");

      for (const spec of CONTROL_SPECS) bar.appendChild(createControl(spec, bar));
      stage.appendChild(bar);
      const move = document.createElement("select");
      move.className = "people-server-call-move";
      move.setAttribute("aria-label", "D\u00e9placer cet appel vers un salon vocal");
      const reset = () => { move.replaceChildren(new Option("D\u00e9placer cet appel...", "")); };
      reset();
      move.addEventListener("focus", async () => {
        const data = await (await fetch("/api/servers")).json();
        const results = await Promise.all((data.servers || []).map(async server => {
          const channels = await (await fetch("/api/servers/" + server.id + "/channels")).json();
          return (channels.channels || []).filter(channel => channel.type === "voice").map(channel => ({ ...channel, server }));
        }));
        reset();
        for (const channel of results.flat()) {
          const option = new Option(channel.server.name + " / " + channel.name, channel.id);
          option.dataset.serverId = channel.server.id; option.dataset.channelName = channel.name;
          move.append(option);
        }
      });
      move.addEventListener("change", () => {
        const option = move.selectedOptions[0];
        if (!option?.value) return;
        const controller = window.PeopleCallBar.getServerController(bar.dataset.callId);
        void Promise.resolve(controller.move(option.dataset.serverId, option.value, option.dataset.channelName)).then(() => {
          const call = window.PeopleCallBar.getStates().find(call => call.id === bar.dataset.callId);
          if (call) window.PeopleCallBar.open(call.id);
        }).catch(error => window.alert(error.message));
        move.value = "";
      });
      stage.append(move);
    }

    bar.dataset.callId = stage.dataset.callId;
    return bar;
  }

  function syncOneControl(spec, bar) {
    const call = window.PeopleCallBar?.getStates().find(call => call.id === bar.dataset.callId);
    const target = bar.querySelector(`[data-people-server-call-control="${spec.key}"]`);
    const active = Boolean(call?.[{ mute: "muted", sound: "soundMuted", camera: "camera", screen: "screen" }[spec.key]]);
    target.disabled = !call || (call.phase !== "active" && spec.key !== "leave");
    target.title = spec.label;
    target.setAttribute("aria-label", spec.label);
    target.setAttribute("aria-pressed", String(active));
    target.classList.toggle("active", active);
    target.classList.toggle("muted", spec.key === "mute" && active);
  }

  function swapMediaButtons() {
    document.querySelectorAll(".video-tile.local").forEach((tile) => {
      tile.classList.add("people-server-local-media-tile");
    });
  }

  function decorateStage() {
    const stage = document.getElementById("videoStage");
    if (!(stage instanceof HTMLElement)) return;

    stage.classList.add("people-server-call-stage");
    const grid = document.getElementById("videoGrid");
    if (grid instanceof HTMLElement) grid.classList.add("people-server-call-grid");
  }

  function ensureSecondStage() {
    let stage = document.getElementById("videoStageSecond");
    if (!stage) {
      stage = document.createElement("section");
      stage.id = "videoStageSecond";
      stage.className = "video-stage people-server-call-stage hidden";
      stage.setAttribute("aria-label", "Salon vocal secondaire");
      const grid = document.createElement("div");
      grid.className = "video-grid people-server-call-grid";
      stage.append(grid);
      document.getElementById("videoStage").after(stage);
    }
    return stage;
  }
  function syncStage(stage, call) {
    const visible = call && String(call.serverId) === String(peopleActiveServerId) &&
      viewed && String(viewed.serverId) === String(call.serverId) && String(viewed.channelId) === String(call.channelId);
    stage.classList.toggle("hidden", !visible);
    if (!call) {
      if (stage.id === "videoStageSecond") {
        for (const video of stage.querySelectorAll("video")) video.srcObject = null;
        stage.querySelector(".video-grid").replaceChildren();
      }
      return;
    }
    stage.dataset.callId = call.id;
    const controller = window.PeopleCallBar.getServerController(call.id);
    const roster = call.id === "server-primary" ? activeVoiceRoster : controller.getRoster();
    let participants = stage.querySelector(".people-server-call-participants");
    if (!participants) {
      participants = document.createElement("div");
      participants.className = "people-server-call-participants";
      stage.prepend(participants);
    }
    const text = call.name + " \u00b7 " + roster.map(user => user.username + (user.muted ? " (micro coup\u00e9)" : "")).join(", ");
    if (participants.textContent !== text) participants.textContent = text;
    const bar = ensureControlBar(stage);
    CONTROL_SPECS.forEach(spec => syncOneControl(spec, bar));
    if (call.id === "server-secondary") {
      const grid = stage.querySelector(".video-grid");
      const localId = controller.getSocketId();
      const localVideo = controller.getLocalVideo();
      const media = controller.getMedia();
      const wanted = new Set();
      for (const user of roster) {
        const local = user.id === localId;
        const remote = media.find(node => node.dataset.peerId === user.id);
        if (!local && !remote?.srcObject?.getVideoTracks().some(track => track.readyState === "live")) continue;
        if (local && !localVideo) continue;
        const tile = ensureVideoTile(user.id, user.username, local, grid, "secondary-");
        wanted.add(tile.id);
        const video = tile.querySelector("video");
        const source = local ? localVideo : remote.srcObject;
        if (local ? video.srcObject?.getVideoTracks()[0] !== source.getVideoTracks()[0] : video.srcObject !== source) video.srcObject = source;
        video.muted = true; // Audio keeps playing through this call's original media node.
        tile.querySelector(".video-placeholder").style.display = "none";
        tile.classList.toggle("screen-share", Boolean(user.screen));
      }
      for (const tile of [...grid.children]) if (!wanted.has(tile.id)) { tile.querySelector("video").srcObject = null; tile.remove(); }
    }
  }
  function sync() {
    decorateStage();
    swapMediaButtons();
    const calls = window.PeopleCallBar?.getStates().filter(call => call.type === "server") || [];
    if (viewed && String(viewed.serverId) !== String(peopleActiveServerId)) viewed = selections.get(String(peopleActiveServerId)) || null;
    if (!viewed) {
      const call = calls.find(call => String(call.serverId) === String(peopleActiveServerId));
      if (call) viewed = { serverId: call.serverId, channelId: call.channelId };
    }
    syncStage(document.getElementById("videoStage"), calls.find(call => call.id === "server-primary"));
    syncStage(ensureSecondStage(), calls.find(call => call.id === "server-secondary"));
  }

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      sync();
    });
  }

  const observer = new MutationObserver(queueSync);

  function start() {
    if (!document.body) return;

    for (const id of ["videoGrid", "muteButton", "cameraButton", "screenButton", "leaveVoiceQuickButton"]) {
      const node = document.getElementById(id);
      if (node) observer.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "disabled", "title"] });
    }

    document.addEventListener("fullscreenchange", queueSync);
    document.addEventListener("webkitfullscreenchange", queueSync);
    window.addEventListener("resize", queueSync, { passive: true });
    sync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.PeopleServerVoiceUi = Object.freeze({ version: VERSION, sync: queueSync,
    show(serverId, channelId) {
      viewed = { serverId, channelId };
      selections.set(String(serverId), viewed);
      queueSync();
    }
  });
  window.addEventListener("people-server-channel-state", queueSync);
  window.addEventListener("people-global-call-state", queueSync);
})();
