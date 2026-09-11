/* === PEOPLE_SERVER_VOICE_UI_V1 === */
(() => {
  "use strict";

  if (window.PeopleServerVoiceUi?.version) return;

  const VERSION = "1.0.0";
  let syncQueued = false;

  const CONTROL_SPECS = Object.freeze([
    { key: "mute", sourceId: "muteButton", icon: "🎙️", label: "Micro" },
    { key: "camera", sourceId: "cameraButton", icon: "📷", label: "Caméra" },
    { key: "screen", sourceId: "screenButton", icon: "🖥️", label: "Écran" },
    { key: "leave", sourceId: "leaveVoiceQuickButton", icon: "📞", label: "Raccrocher", danger: true }
  ]);

  function controlBar() {
    return document.getElementById("peopleServerCallControls");
  }

  function createControl(spec) {
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
      const source = document.getElementById(spec.sourceId);
      if (!(source instanceof HTMLButtonElement) || source.disabled) return;
      source.click();
      queueSync();
    });

    return button;
  }

  function ensureControlBar() {
    const stage = document.getElementById("videoStage");
    const grid = document.getElementById("videoGrid");
    if (!(stage instanceof HTMLElement) || !(grid instanceof HTMLElement)) return null;

    let bar = controlBar();
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "peopleServerCallControls";
      bar.className = "people-server-call-controls";
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", "Contrôles du vocal");

      for (const spec of CONTROL_SPECS) bar.appendChild(createControl(spec));
      stage.appendChild(bar);
    }

    return bar;
  }

  function syncOneControl(spec, bar) {
    const source = document.getElementById(spec.sourceId);
    const target = bar?.querySelector(`[data-people-server-call-control="${spec.key}"]`);
    if (!(target instanceof HTMLButtonElement)) return;

    if (!(source instanceof HTMLButtonElement)) {
      target.hidden = true;
      return;
    }

    target.hidden = false;
    target.disabled = source.disabled;
    target.title = source.title || spec.label;
    target.setAttribute("aria-label", source.title || spec.label);

    const icon = target.querySelector(".people-server-call-control-icon");
    if (icon) {
      if (spec.key === "mute") {
        icon.textContent = /🔇/.test(source.textContent || "") ? "🔇" : "🎙️";
      } else if (spec.key === "camera") {
        icon.textContent = source.classList.contains("active") ? "📹" : "📷";
      } else if (spec.key === "screen") {
        icon.textContent = source.classList.contains("active") ? "🛑" : "🖥️";
      } else {
        icon.textContent = spec.icon;
      }
    }

    const isActive = spec.key === "mute"
      ? /🔇/.test(source.textContent || "")
      : source.classList.contains("active");

    target.classList.toggle("active", isActive && !spec.danger);
    target.classList.toggle("muted", spec.key === "mute" && isActive);
  }

  function syncControlBar() {
    const bar = ensureControlBar();
    if (!bar) return;
    CONTROL_SPECS.forEach((spec) => syncOneControl(spec, bar));
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

  function sync() {
    decorateStage();
    swapMediaButtons();
    syncControlBar();
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

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "disabled", "title", "style"]
    });

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

  window.PeopleServerVoiceUi = Object.freeze({ version: VERSION, sync: queueSync });
})();
