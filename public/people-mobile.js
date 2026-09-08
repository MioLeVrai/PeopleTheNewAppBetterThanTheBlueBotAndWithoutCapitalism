(() => {
  "use strict";

  const shell =
    document.getElementById(
      "peopleAppShell"
    );

  if (!shell) {
    return;
  }

  const joinScreen =
    document.getElementById(
      "joinScreen"
    );

  const mobileQuery =
    window.matchMedia(
      "(max-width: 780px)"
    );

  const toggle =
    document.createElement(
      "button"
    );

  toggle.id =
    "peopleMobileSidebarToggle";

  toggle.className =
    "people-mobile-sidebar-toggle";

  toggle.type =
    "button";

  toggle.textContent =
    "☰";

  toggle.title =
    "Ouvrir la navigation";

  toggle.setAttribute(
    "aria-label",
    "Ouvrir la navigation"
  );

  toggle.setAttribute(
    "aria-expanded",
    "false"
  );

  const backdrop =
    document.createElement(
      "div"
    );

  backdrop.id =
    "peopleMobileSidebarBackdrop";

  backdrop.className =
    "people-mobile-sidebar-backdrop";

  backdrop.setAttribute(
    "aria-hidden",
    "true"
  );

  document.body.append(
    backdrop,
    toggle
  );

  let lastAvailable = null;
  let lastOpen = null;
  let responsiveFrame = 0;
  let navigationTimer = 0;

  function isMobile() {
    return mobileQuery.matches;
  }

  function authIsVisible() {
    if (!joinScreen) {
      return false;
    }

    return !joinScreen.classList
      .contains(
        "hidden"
      );
  }

  function sidebarIsOpen() {
    return shell.classList
      .contains(
        "people-mobile-sidebar-open"
      );
  }

  function updateToggle() {
    const available =
      isMobile() &&
      !authIsVisible();

    const open =
      available &&
      sidebarIsOpen();

    /*
      Évite de réécrire les mêmes styles/attributs
      à chaque resize ou mutation sans changement réel.
    */
    if (available !== lastAvailable) {
      toggle.style.display =
        available
          ? "grid"
          : "none";

      lastAvailable =
        available;
    }

    if (open !== lastOpen) {
      backdrop.style.display =
        open
          ? "block"
          : "none";

      toggle.textContent =
        open
          ? "×"
          : "☰";

      toggle.title =
        open
          ? "Fermer la navigation"
          : "Ouvrir la navigation";

      toggle.setAttribute(
        "aria-label",
        toggle.title
      );

      toggle.setAttribute(
        "aria-expanded",
        open
          ? "true"
          : "false"
      );

      lastOpen =
        open;
    }
  }

  function closeSidebar() {
    if (!sidebarIsOpen()) {
      updateToggle();
      return;
    }

    shell.classList.remove(
      "people-mobile-sidebar-open"
    );

    updateToggle();
  }

  function openSidebar() {
    if (
      !isMobile() ||
      authIsVisible()
    ) {
      return;
    }

    /*
      Une seule navigation latérale à la fois :
      ouvrir la gauche ferme le panneau membres.
    */
    shell.classList.remove(
      "people-online-open"
    );

    if (!sidebarIsOpen()) {
      shell.classList.add(
        "people-mobile-sidebar-open"
      );
    }

    updateToggle();
  }

  function toggleSidebar() {
    if (sidebarIsOpen()) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  function scheduleNavigation(
    callback,
    delay
  ) {
    if (navigationTimer) {
      clearTimeout(
        navigationTimer
      );
    }

    navigationTimer =
      window.setTimeout(
        () => {
          navigationTimer = 0;
          callback();
        },
        delay
      );
  }

  toggle.addEventListener(
    "click",
    toggleSidebar
  );

  backdrop.addEventListener(
    "click",
    closeSidebar
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key ===
          "Escape" &&
        sidebarIsOpen()
      ) {
        closeSidebar();
      }
    }
  );

  /*
    Clic sur Accueil / un serveur :
    sur mobile on ouvre immédiatement la liste
    des salons ou des MP correspondants.
  */
  document.addEventListener(
    "click",
    (event) => {
      if (!isMobile()) {
        return;
      }

      const target =
        event.target instanceof
        Element
          ? event.target
          : null;

      if (!target) {
        return;
      }

      const railButton =
        target.closest(
          "#homeRailButton, .dynamic-server-button"
        );

      if (railButton) {
        scheduleNavigation(
          openSidebar,
          30
        );

        return;
      }

      /*
        Après avoir choisi une destination,
        on redonne tout l'écran au contenu.
      */
      const destination =
        target.closest(
          ".channel, .dm-conversation-row, #friendsNavButton"
        );

      if (destination) {
        scheduleNavigation(
          closeSidebar,
          40
        );

        return;
      }

      /*
        Le panneau des membres est le tiroir droit.
        On ferme donc le tiroir gauche avant.
      */
      if (
        target.closest(
          "#onlinePanelToggle"
        )
      ) {
        if (navigationTimer) {
          clearTimeout(
            navigationTimer
          );
          navigationTimer = 0;
        }

        closeSidebar();
      }
    },
    true
  );

  function closeOnMainInteraction(
    event
  ) {
    if (
      !isMobile() ||
      !sidebarIsOpen()
    ) {
      return;
    }

    const target =
      event.target instanceof
      Element
        ? event.target
        : null;

    if (
      target?.closest(
        ".sidebar, .people-mobile-sidebar-toggle"
      )
    ) {
      return;
    }

    closeSidebar();
  }

  document
    .getElementById(
      "peopleMain"
    )
    ?.addEventListener(
      "pointerdown",
      closeOnMainInteraction,
      { passive: true }
    );

  document
    .getElementById(
      "homeMain"
    )
    ?.addEventListener(
      "pointerdown",
      closeOnMainInteraction,
      { passive: true }
    );

  function syncResponsiveState() {
    responsiveFrame = 0;

    if (!isMobile()) {
      shell.classList.remove(
        "people-mobile-sidebar-open"
      );

      if (navigationTimer) {
        clearTimeout(
          navigationTimer
        );
        navigationTimer = 0;
      }
    }

    updateToggle();
  }

  function scheduleResponsiveState() {
    if (responsiveFrame) {
      return;
    }

    responsiveFrame =
      requestAnimationFrame(
        syncResponsiveState
      );
  }

  mobileQuery.addEventListener?.(
    "change",
    scheduleResponsiveState
  );

  /*
    Certains WebViews émettent beaucoup de resize
    pendant la rotation ou l'ouverture du clavier.
    On coalesce tout à une mise à jour par frame.
  */
  window.addEventListener(
    "resize",
    scheduleResponsiveState,
    { passive: true }
  );

  if (joinScreen) {
    const observer =
      new MutationObserver(
        updateToggle
      );

    observer.observe(
      joinScreen,
      {
        attributes: true,
        attributeFilter: [
          "class"
        ]
      }
    );
  }

  window.PeopleMobileUI = {
    openSidebar,
    closeSidebar,
    isMobile
  };

  syncResponsiveState();
})();
