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

    toggle.style.display =
      available
        ? "grid"
        : "none";

    backdrop.style.display =
      (
        available &&
        sidebarIsOpen()
      )
        ? "block"
        : "none";

    const open =
      sidebarIsOpen();

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
  }

  function closeSidebar() {
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

    shell.classList.add(
      "people-mobile-sidebar-open"
    );

    updateToggle();
  }

  function toggleSidebar() {
    if (sidebarIsOpen()) {
      closeSidebar();
    } else {
      openSidebar();
    }
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
        setTimeout(
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
        setTimeout(
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
      closeOnMainInteraction
    );

  document
    .getElementById(
      "homeMain"
    )
    ?.addEventListener(
      "pointerdown",
      closeOnMainInteraction
    );

  function syncResponsiveState() {
    if (!isMobile()) {
      shell.classList.remove(
        "people-mobile-sidebar-open"
      );
    }

    updateToggle();
  }

  mobileQuery.addEventListener?.(
    "change",
    syncResponsiveState
  );

  window.addEventListener(
    "resize",
    syncResponsiveState
  );

  window.addEventListener(
    "orientationchange",
    () => {
      setTimeout(
        syncResponsiveState,
        120
      );
    }
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
