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
