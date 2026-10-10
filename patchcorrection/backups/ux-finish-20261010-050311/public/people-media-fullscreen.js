/* === PEOPLE_MEDIA_FULLSCREEN_V1 === */
(() => {
  "use strict";

  if (window.PeopleMediaFullscreen?.version) return;

  const VERSION = "1.0.0";
  const BUTTON_CLASS = "people-media-fullscreen-button";
  const DM_WIDTH_VAR = "--people-dm-call-inline-media-width";

  let syncQueued = false;

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  async function enterFullscreen(element) {
    if (!element) return false;

    try {
      if (fullscreenElement() === element) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        return true;
      }

      if (fullscreenElement()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }

      if (element.requestFullscreen) {
        await element.requestFullscreen({ navigationUI: "hide" });
        return true;
      }

      if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
        return true;
      }
    } catch (error) {
      console.warn("[People plein écran] impossible d'ouvrir le média en plein écran", error);
    }

    return false;
  }

  function makeButton(label = "Plein écran") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = '<span aria-hidden="true">⛶</span>';
    return button;
  }

  function mediaIsLive(video) {
    if (!(video instanceof HTMLVideoElement)) return false;
    if (video.classList.contains("hidden")) return false;

    const stream = video.srcObject;
    if (!(stream instanceof MediaStream)) return false;

    return stream.getVideoTracks().some((track) => track.readyState === "live");
  }

  function ensureServerTile(tile) {
    if (!(tile instanceof HTMLElement)) return;
    if (tile.querySelector(":scope > .people-media-server-fullscreen")) return;

    const video = tile.querySelector("video");
    if (!video) return;

    const button = makeButton("Mettre cette caméra / ce stream en plein écran");
    button.classList.add("people-media-server-fullscreen");

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void enterFullscreen(tile);
    });

    tile.appendChild(button);
  }

  function dmMainVideo() {
    const remote = document.getElementById("peopleDmCallRemoteVideo");
    if (mediaIsLive(remote)) return remote;

    const local = document.getElementById("peopleDmCallLocalVideo");
    if (mediaIsLive(local)) return local;

    return null;
  }

  function ensureDmStage() {
    const stage = document.querySelector(".people-dm-call-stage");
    if (!(stage instanceof HTMLElement)) return;

    let button = stage.querySelector(":scope > .people-media-dm-fullscreen");
    if (!button) {
      button = makeButton("Mettre la caméra / le stream en plein écran");
      button.classList.add("people-media-dm-fullscreen");

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const remote = document.getElementById("peopleDmCallRemoteVideo");
        const local = document.getElementById("peopleDmCallLocalVideo");
        const target = mediaIsLive(remote)
          ? stage
          : (mediaIsLive(local) ? local : null);

        void enterFullscreen(target);
      });

      stage.appendChild(button);
    }

    button.classList.toggle("hidden", !dmMainVideo());
  }

  function ensureDmPip() {
    const pip = document.getElementById("peopleDmCallVideoPip");
    if (!(pip instanceof HTMLElement)) return;

    const header = pip.querySelector(".people-dm-call-video-pip-header");
    const video = pip.querySelector(".people-dm-call-video-pip-video");
    if (!(header instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) return;

    let button = header.querySelector(".people-media-pip-fullscreen");
    if (!button) {
      button = makeButton("Mettre la caméra en plein écran");
      button.classList.add("people-media-pip-fullscreen");
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void enterFullscreen(video);
      });

      const close = header.querySelector(".people-dm-call-video-pip-close");
      header.insertBefore(button, close || null);
    }

    button.classList.toggle("hidden", !mediaIsLive(video));
  }

  function readInlineHeight(card) {
    const raw = getComputedStyle(card)
      .getPropertyValue("--people-dm-call-inline-height")
      .trim();

    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;

    const rect = card.getBoundingClientRect();
    return rect.height > 0 ? rect.height : 300;
  }

  function syncDmInlineWidth() {
    const overlay = document.getElementById("peopleDmCallOverlay");
    const card = overlay?.querySelector(".people-dm-call-card");
    if (!(overlay instanceof HTMLElement) || !(card instanceof HTMLElement)) return;

    if (!overlay.classList.contains("people-dm-call-docked")) {
      card.style.removeProperty(DM_WIDTH_VAR);
      return;
    }

    /*
      Le panneau ne dépend plus de la largeur de la fenêtre.
      Sa largeur suit la hauteur choisie par l'utilisateur dans le MP.
      2.15 donne un cadre confortable pour les contrôles sans recréer
      l'énorme bande ultra-large qui recadrait la caméra en cover.
    */
    const height = readInlineHeight(card);
    const desired = Math.round(Math.max(620, Math.min(1100, height * 2.15)));
    const next = `${desired}px`;

    if (card.style.getPropertyValue(DM_WIDTH_VAR).trim() !== next) {
      card.style.setProperty(DM_WIDTH_VAR, next);
    }
  }

  function syncButtons() {
    document.querySelectorAll(".video-tile").forEach(ensureServerTile);
    ensureDmStage();
    ensureDmPip();
    syncDmInlineWidth();
  }

  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      syncButtons();
    });
  }

  document.addEventListener("dblclick", (event) => {
    const video = event.target instanceof Element ? event.target.closest("video") : null;
    if (!(video instanceof HTMLVideoElement) || !mediaIsLive(video)) return;

    const tile = video.closest(".video-tile");
    const stage = video.closest(".people-dm-call-stage");
    const pip = video.closest(".people-dm-call-video-pip");

    if (!tile && !stage && !pip) return;

    event.preventDefault();
    event.stopPropagation();
    void enterFullscreen(tile || stage || video);
  }, true);

  document.addEventListener("play", scheduleSync, true);
  document.addEventListener("emptied", scheduleSync, true);
  document.addEventListener("loadedmetadata", scheduleSync, true);
  document.addEventListener("fullscreenchange", scheduleSync);
  document.addEventListener("webkitfullscreenchange", scheduleSync);
  window.addEventListener("resize", scheduleSync, { passive: true });

  const observer = new MutationObserver(scheduleSync);

  function start() {
    if (document.body) {
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "style"]
      });
      syncButtons();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.PeopleMediaFullscreen = Object.freeze({
    version: VERSION,
    sync: scheduleSync,
    open: enterFullscreen
  });
})();
