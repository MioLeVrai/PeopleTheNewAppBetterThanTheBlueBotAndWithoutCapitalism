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
