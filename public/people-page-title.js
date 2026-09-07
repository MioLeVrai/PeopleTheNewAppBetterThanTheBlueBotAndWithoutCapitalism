(() => {
  "use strict";

  const BRAND = "People";

  function clean(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  function visible(element) {
    if (!element) {
      return false;
    }

    if (
      element.classList.contains(
        "hidden"
      )
    ) {
      return false;
    }

    return (
      element.getAttribute(
        "aria-hidden"
      ) !== "true"
    );
  }

  function setTitle(...parts) {
    const values =
      parts
        .flat()
        .map(clean)
        .filter(Boolean);

    if (
      values[
        values.length - 1
      ] !== BRAND
    ) {
      values.push(BRAND);
    }

    const title =
      values.join(" • ");

    if (
      document.title !== title
    ) {
      document.title =
        title;
    }
  }

  function detectView() {
    const appShell =
      document.getElementById(
        "peopleAppShell"
      );

    /*
      Écran connexion / inscription :
      on laisse simplement People.
    */
    if (
      !appShell ||
      appShell.classList.contains(
        "hidden"
      )
    ) {
      setTitle(BRAND);
      return;
    }

    const peopleMain =
      document.getElementById(
        "peopleMain"
      );

    const homeMain =
      document.getElementById(
        "homeMain"
      );

    /*
      SERVEUR
    */
    if (
      visible(peopleMain)
    ) {
      const activeServerName =
        clean(
          document
            .getElementById(
              "activeServerName"
            )
            ?.textContent
        );

      if (
        activeServerName &&
        activeServerName !==
          "Serveur"
      ) {
        setTitle(
          activeServerName
        );

        return;
      }

      setTitle(
        "Serveur"
      );

      return;
    }

    /*
      ACCUEIL / AMIS / MP
    */
    if (
      visible(homeMain)
    ) {
      const dmView =
        document.getElementById(
          "dmView"
        );

      const friendsView =
        document.getElementById(
          "friendsView"
        );

      if (
        visible(dmView)
      ) {
        const dmName =
          clean(
            document
              .getElementById(
                "dmHeaderName"
              )
              ?.textContent
          );

        if (
          dmName &&
          dmName !==
            "Message privé"
        ) {
          setTitle(
            dmName,
            "MP"
          );
        } else {
          setTitle(
            "MP"
          );
        }

        return;
      }

      if (
        visible(friendsView)
      ) {
        setTitle(
          "Amis"
        );

        return;
      }

      const homeTitle =
        clean(
          document
            .getElementById(
              "homeMainTitle"
            )
            ?.textContent
        );

      if (homeTitle) {
        setTitle(
          homeTitle
        );
      } else {
        setTitle(
          "Accueil"
        );
      }

      return;
    }

    setTitle(
      "Accueil"
    );
  }

  let pending =
    false;

  function scheduleDetect() {
    if (pending) {
      return;
    }

    pending = true;

    requestAnimationFrame(
      () => {
        pending = false;
        detectView();
      }
    );
  }

  const observer =
    new MutationObserver(
      scheduleDetect
    );

  function start() {
    observer.observe(
      document.body,
      {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
        attributeFilter: [
          "class",
          "aria-hidden"
        ]
      }
    );

    document.addEventListener(
      "click",
      scheduleDetect,
      true
    );

    window.addEventListener(
      "people-authenticated",
      scheduleDetect
    );

    window.addEventListener(
      "people-server-selected",
      scheduleDetect
    );

    window.addEventListener(
      "people-server-invalid",
      scheduleDetect
    );

    window.addEventListener(
      "popstate",
      scheduleDetect
    );

    scheduleDetect();

    setTimeout(
      scheduleDetect,
      100
    );

    setTimeout(
      scheduleDetect,
      400
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      {
        once: true
      }
    );
  } else {
    start();
  }

  window.PeoplePageTitle = {
    refresh:
      scheduleDetect,
    detect:
      detectView
  };
})();

