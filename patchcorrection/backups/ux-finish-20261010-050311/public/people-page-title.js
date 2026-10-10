(() => {
  "use strict";

  const BRAND = "People";
  const SPACE_RE = /\s+/g;

  let refs = {};
  let pending = false;

  function clean(value) {
    return String(value || "")
      .replace(SPACE_RE, " ")
      .trim()
      .slice(0, 80);
  }

  function visible(element) {
    return Boolean(
      element &&
      !element.classList.contains("hidden") &&
      element.getAttribute("aria-hidden") !== "true"
    );
  }

  function setTitle(...parts) {
    const values = [];

    for (const part of parts) {
      const value = clean(part);
      if (value) values.push(value);
    }

    if (values[values.length - 1] !== BRAND) {
      values.push(BRAND);
    }

    const title = values.join(" • ");

    if (document.title !== title) {
      document.title = title;
    }
  }

  function cacheRefs() {
    refs = {
      appShell: document.getElementById("peopleAppShell"),
      peopleMain: document.getElementById("peopleMain"),
      homeMain: document.getElementById("homeMain"),
      dmView: document.getElementById("dmView"),
      friendsView: document.getElementById("friendsView"),
      activeServerName: document.getElementById("activeServerName"),
      dmHeaderName: document.getElementById("dmHeaderName"),
      homeMainTitle: document.getElementById("homeMainTitle")
    };
  }

  function detectView() {
    const {
      appShell,
      peopleMain,
      homeMain,
      dmView,
      friendsView,
      activeServerName,
      dmHeaderName,
      homeMainTitle
    } = refs;

    if (!appShell || appShell.classList.contains("hidden")) {
      setTitle(BRAND);
      return;
    }

    if (visible(peopleMain)) {
      const serverName = clean(activeServerName?.textContent);

      setTitle(
        serverName && serverName !== "Serveur"
          ? serverName
          : "Serveur"
      );
      return;
    }

    if (visible(homeMain)) {
      if (visible(dmView)) {
        const dmName = clean(dmHeaderName?.textContent);

        if (dmName && dmName !== "Message privé") {
          setTitle(dmName, "MP");
        } else {
          setTitle("MP");
        }
        return;
      }

      if (visible(friendsView)) {
        setTitle("Amis");
        return;
      }

      setTitle(clean(homeMainTitle?.textContent) || "Accueil");
      return;
    }

    setTitle("Accueil");
  }

  function scheduleDetect() {
    if (pending) return;

    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      detectView();
    });
  }

  const stateObserver = new MutationObserver(scheduleDetect);
  const textObserver = new MutationObserver(scheduleDetect);

  function observeRelevantElements() {
    const stateTargets = [
      refs.appShell,
      refs.peopleMain,
      refs.homeMain,
      refs.dmView,
      refs.friendsView
    ].filter(Boolean);

    for (const target of stateTargets) {
      stateObserver.observe(target, {
        attributes: true,
        attributeFilter: ["class", "aria-hidden"]
      });
    }

    const textTargets = [
      refs.activeServerName,
      refs.dmHeaderName,
      refs.homeMainTitle
    ].filter(Boolean);

    for (const target of textTargets) {
      textObserver.observe(target, {
        subtree: true,
        childList: true,
        characterData: true
      });
    }
  }

  function start() {
    cacheRefs();
    observeRelevantElements();

    // Certains changements de vue passent uniquement par des clics.
    document.addEventListener("click", scheduleDetect, true);

    window.addEventListener("people-authenticated", scheduleDetect);
    window.addEventListener("people-server-selected", scheduleDetect);
    window.addEventListener("people-server-invalid", scheduleDetect);
    window.addEventListener("popstate", scheduleDetect);

    scheduleDetect();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.PeoplePageTitle = {
    refresh: scheduleDetect,
    detect: detectView
  };
})();
