(() => {
  "use strict";

  const railList =
    document.getElementById(
      "serverRailList"
    );

  const createButton =
    document.getElementById(
      "createServerRailButton"
    );

  const homeButton =
    document.getElementById(
      "homeRailButton"
    );

  const serverName =
    document.getElementById(
      "activeServerName"
    );

  const serverIcon =
    document.getElementById(
      "activeServerIcon"
    );

  const inviteButton =
    document.getElementById(
      "serverInviteButton"
    );

  const subtitle =
    document.getElementById(
      "activeTextChannelSubtitle"
    );

  const welcomeText =
    document.getElementById(
      "serverWelcomeText"
    );

  const createModal =
    document.getElementById(
      "createServerModal"
    );

  const createClose =
    document.getElementById(
      "createServerModalClose"
    );

  const createForm =
    document.getElementById(
      "createServerForm"
    );

  const createNameInput =
    document.getElementById(
      "createServerNameInput"
    );

  const createError =
    document.getElementById(
      "createServerError"
    );

  const inviteModal =
    document.getElementById(
      "serverInviteModal"
    );

  const inviteClose =
    document.getElementById(
      "serverInviteModalClose"
    );

  const inviteIcon =
    document.getElementById(
      "inviteServerIcon"
    );

  const inviteName =
    document.getElementById(
      "inviteServerName"
    );

  const inviteMembers =
    document.getElementById(
      "inviteServerMembers"
    );

  const inviteJoin =
    document.getElementById(
      "inviteJoinButton"
    );

  const inviteError =
    document.getElementById(
      "inviteError"
    );

  let servers = [];
  let activeServer = null;
  let viewingHome = true;
  let authenticated = false;
  let inviteCode = null;
  let invitePreview = null;

  function initials(value) {
    return (
      String(value || "?")
        .trim()
        .slice(0, 2)
        .toUpperCase() ||
      "?"
    );
  }

  async function api(
    url,
    options = {}
  ) {
    const response =
      await fetch(
        url,
        {
          credentials:
            "same-origin",
          ...options,
          headers: {
            ...(options.body
              ? {
                  "Content-Type":
                    "application/json"
                }
              : {}),
            ...(options.headers || {})
          }
        }
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (
      !response.ok ||
      data.ok === false
    ) {
      throw new Error(
        data.error ||
        "Une erreur est survenue."
      );
    }

    return data;
  }

  function readInvitePath() {
    const match =
      location.pathname.match(
        /^\/invite\/([A-Za-z0-9_-]{6,80})\/?$/
      );

    inviteCode =
      match
        ? match[1]
        : null;
  }

  function renderRail() {
    if (!railList) return;

    railList.innerHTML = "";

    for (const server of servers) {
      const button =
        document.createElement(
          "button"
        );

      button.type =
        "button";

      button.className =
        "rail-button rail-server dynamic-server-button";

      button.dataset.serverId =
        String(server.id);

      button.textContent =
        initials(
          server.name
        );

      button.title =
        server.name;

      button.setAttribute(
        "aria-label",
        "Ouvrir " +
          server.name
      );

      button.classList.toggle(
        "active",
        !viewingHome &&
        activeServer &&
        String(activeServer.id) ===
          String(server.id)
      );

      button.addEventListener(
        "click",
        () =>
          openServer(
            server
          )
      );

      railList.appendChild(
        button
      );
    }

    if (!servers.length) {
      const empty =
        document.createElement(
          "span"
        );

      empty.className =
        "server-rail-empty";

      empty.textContent =
        "•";

      empty.title =
        "Tu n'as rejoint aucun serveur";

      railList.appendChild(
        empty
      );
    }
  }

  function updateServerChrome(
    server
  ) {
    if (!server) return;

    if (serverName) {
      serverName.textContent =
        server.name;
    }

    if (serverIcon) {
      serverIcon.textContent =
        initials(server.name);
    }

    if (subtitle) {
      subtitle.textContent =
        "Salon général de " +
        server.name;
    }

    if (welcomeText) {
      welcomeText.textContent =
        "Le salon texte général de " +
        server.name +
        ".";
    }

    document.title =
      server.name +
      " • People";
  }

  async function refreshServers() {
    if (!authenticated) {
      return;
    }

    const data =
      await api(
        "/api/servers"
      );

    servers =
      Array.isArray(
        data.servers
      )
        ? data.servers
        : [];

    if (
      activeServer &&
      !servers.some(
        (server) =>
          String(server.id) ===
          String(activeServer.id)
      )
    ) {
      activeServer = null;
      viewingHome = true;
    }

    renderRail();
  }

  async function openServer(
    server
  ) {
    if (!server?.id) {
      return;
    }

    try {
      const result =
        await window
          .PeopleServerRuntime
          ?.selectServer(
            server
          );

      if (
        result &&
        result.ok === false
      ) {
        throw new Error(
          result.error ||
          "Impossible d'ouvrir ce serveur."
        );
      }

      activeServer = {
        ...server
      };

      viewingHome = false;

      updateServerChrome(
        activeServer
      );

      renderRail();

      window
        .PeopleSocialNavigation
        ?.setMode(
          "server"
        );
    } catch (err) {
      alert(
        err.message
      );

      await refreshServers();
    }
  }

  function openCreateModal() {
    createError.textContent =
      "";

    createNameInput.value =
      "";

    createModal.classList.remove(
      "hidden"
    );

    setTimeout(
      () =>
        createNameInput.focus(),
      20
    );
  }

  function closeCreateModal() {
    createModal.classList.add(
      "hidden"
    );
  }

  async function createServer(
    name
  ) {
    const data =
      await api(
        "/api/servers",
        {
          method:
            "POST",
          body:
            JSON.stringify({
              name
            })
        }
      );

    await refreshServers();

    const server =
      servers.find(
        (item) =>
          String(item.id) ===
          String(
            data.server?.id
          )
      ) ||
      data.server;

    if (server) {
      await openServer(
        server
      );
    }

    closeCreateModal();
  }

  function closeInviteModal() {
    inviteModal.classList.add(
      "hidden"
    );
  }

  async function showInvite() {
    if (
      !authenticated ||
      !inviteCode
    ) {
      return;
    }

    try {
      const data =
        await api(
          "/api/servers/invite/" +
            encodeURIComponent(
              inviteCode
            )
        );

      invitePreview =
        data.server;

      inviteIcon.textContent =
        initials(
          invitePreview.name
        );

      inviteName.textContent =
        invitePreview.name;

      inviteMembers.textContent =
        String(
          invitePreview.memberCount ||
          0
        ) +
        (
          Number(
            invitePreview.memberCount ||
            0
          ) === 1
            ? " membre"
            : " membres"
        );

      inviteJoin.textContent =
        invitePreview.joined
          ? "Ouvrir le serveur"
          : "Rejoindre le serveur";

      inviteError.textContent =
        "";

      inviteModal.classList.remove(
        "hidden"
      );
    } catch (err) {
      invitePreview = null;

      inviteError.textContent =
        err.message;

      inviteModal.classList.remove(
        "hidden"
      );
    }
  }

  async function joinInvite() {
    if (
      !inviteCode ||
      !invitePreview
    ) {
      return;
    }

    inviteJoin.disabled =
      true;

    try {
      if (
        !invitePreview.joined
      ) {
        await api(
          "/api/servers/invite/" +
            encodeURIComponent(
              inviteCode
            ) +
            "/join",
          {
            method:
              "POST"
          }
        );
      }

      await refreshServers();

      const server =
        servers.find(
          (item) =>
            String(item.id) ===
            String(
              invitePreview.id
            )
        );

      if (!server) {
        throw new Error(
          "Le serveur a été rejoint mais n'a pas pu être ouvert."
        );
      }

      closeInviteModal();

      history.replaceState(
        {},
        "",
        "/"
      );

      inviteCode = null;

      await openServer(
        server
      );
    } catch (err) {
      inviteError.textContent =
        err.message;
    } finally {
      inviteJoin.disabled =
        false;
    }
  }

  async function copyInvite() {
    if (!activeServer?.id) {
      return;
    }

    try {
      const data =
        await api(
          "/api/servers/" +
            encodeURIComponent(
              activeServer.id
            ) +
            "/invite"
        );

      const link =
        location.origin +
        data.invitePath;

      try {
        await navigator
          .clipboard
          .writeText(
            link
          );

        const old =
          inviteButton.textContent;

        inviteButton.textContent =
          "✓";

        setTimeout(
          () => {
            inviteButton.textContent =
              old;
          },
          1000
        );
      } catch {
        prompt(
          "Lien d'invitation :",
          link
        );
      }
    } catch (err) {
      alert(
        err.message
      );
    }
  }

  homeButton?.addEventListener(
    "click",
    () => {
      viewingHome = true;
      renderRail();
    }
  );

  createButton?.addEventListener(
    "click",
    openCreateModal
  );

  createClose?.addEventListener(
    "click",
    closeCreateModal
  );

  createModal?.addEventListener(
    "click",
    (event) => {
      if (
        event.target ===
        createModal
      ) {
        closeCreateModal();
      }
    }
  );

  createForm?.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      createError.textContent =
        "";

      try {
        await createServer(
          createNameInput.value
        );
      } catch (err) {
        createError.textContent =
          err.message;
      }
    }
  );

  inviteClose?.addEventListener(
    "click",
    closeInviteModal
  );

  inviteJoin?.addEventListener(
    "click",
    joinInvite
  );

  inviteButton?.addEventListener(
    "click",
    copyInvite
  );

  window.addEventListener(
    "people-server-invalid",
    async () => {
      activeServer = null;
      viewingHome = true;

      await refreshServers();

      window
        .PeopleSocialNavigation
        ?.showFriends();
    }
  );

  window.addEventListener(
    "people-authenticated",
    async () => {
      authenticated = true;

      try {
        viewingHome = true;

        await refreshServers();

        window
          .PeopleSocialNavigation
          ?.showFriends();

        if (inviteCode) {
          await showInvite();
        }
      } catch (err) {
        console.error(
          "[People servers]",
          err
        );
      }
    }
  );

  readInvitePath();

  window.PeopleServers = {
    refresh:
      refreshServers,
    openServer,
    getActiveServer() {
      return activeServer;
    }
  };
})();
