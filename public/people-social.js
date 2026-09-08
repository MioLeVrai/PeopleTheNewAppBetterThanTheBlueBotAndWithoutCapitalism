(() => {
  "use strict";

  const shell = document.getElementById("peopleAppShell");
  const homeRailButton = document.getElementById("homeRailButton");
  const peopleRailButton = document.getElementById("peopleRailButton");
  const homeUnreadBadge = document.getElementById("homeUnreadBadge");
  const homeSidebar = document.getElementById("homeSidebar");
  const peopleSidebar = document.getElementById("peopleSidebar");
  const peopleMain = document.getElementById("peopleMain");
  const homeMain = document.getElementById("homeMain");
  const friendsNavButton = document.getElementById("friendsNavButton");
  const dmConversationList = document.getElementById("dmConversationList");
  const friendsView = document.getElementById("friendsView");
  const dmView = document.getElementById("dmView");
  const peopleSearchInput = document.getElementById("peopleSearchInput");
  const friendsList = document.getElementById("friendsList");
  const friendsCount = document.getElementById("friendsCount");
// === PEOPLE_FRIEND_REQUESTS_CLIENT_V2_START ===
  const friendRequestsCount =
    document.getElementById("friendRequestsCount");
  const incomingFriendRequests =
    document.getElementById("incomingFriendRequests");
  const outgoingFriendRequests =
    document.getElementById("outgoingFriendRequests");
  // === PEOPLE_FRIEND_REQUESTS_CLIENT_V2_END ===
  const peopleDirectory = document.getElementById("peopleDirectory");
  const peopleDirectorySection =
    document.getElementById(
      "peopleDirectorySection"
    );
  const homeMainTitle = document.getElementById("homeMainTitle");
  const homeMainSubtitle = document.getElementById("homeMainSubtitle");

  const dmBackButton = document.getElementById("dmBackButton");
  const dmProfileButton = document.getElementById("dmProfileButton");
  const dmHeaderAvatar = document.getElementById("dmHeaderAvatar");
  const dmHeaderName = document.getElementById("dmHeaderName");
  const dmHeaderStatus = document.getElementById("dmHeaderStatus");
  const dmMessages = document.getElementById("dmMessages");
  const dmWelcomeTitle = document.getElementById("dmWelcomeTitle");
  const dmForm = document.getElementById("dmForm");
  const dmInput = document.getElementById("dmInput");
  const dmImageButton =
    document.getElementById(
      "dmImageButton"
    );

  const dmImageInput =
    document.getElementById(
      "dmImageInput"
    );

  const dmImagePreview =
    document.getElementById(
      "dmImagePreview"
    );

  const peopleDmImagePicker =
    window.PeopleRichContent
      ?.createImagePicker({
        button:
          dmImageButton,
        input:
          dmImageInput,
        preview:
          dmImagePreview,
        pasteTarget:
          dmInput
      });

// === PEOPLE_DM_MESSAGE_ACTIONS_V1_START ===
  const peopleDmReplyController =
    window.PeopleMessageActions
      ?.createReplyController({
        form:
          dmForm,
        input:
          dmInput
      });

  async function peopleDeleteDmMessage(
    id
  ) {
    await api(
      "/api/dm/message/" +
        encodeURIComponent(id),
      {
        method:
          "DELETE"
      }
    );
  }
  // === PEOPLE_DM_MESSAGE_ACTIONS_V1_END ===

  const profileModal = document.getElementById("profileModal");
  const profileModalClose = document.getElementById("profileModalClose");
  const profileModalAvatar = document.getElementById("profileModalAvatar");
  const profileAvatarEditWrap =
    document.getElementById(
      "profileAvatarEditWrap"
    );

  const profileAvatarUploadButton =
    document.getElementById(
      "profileAvatarUploadButton"
    );

  const profileAvatarInput =
    document.getElementById(
      "profileAvatarInput"
    );
  const profileModalName = document.getElementById("profileModalName");
  const profileModalOnline = document.getElementById("profileModalOnline");
  const profileDescriptionText = document.getElementById("profileDescriptionText");
  const profileEditWrap = document.getElementById("profileEditWrap");
  const profileDescriptionInput = document.getElementById("profileDescriptionInput");
  const profileDescriptionCount = document.getElementById("profileDescriptionCount");
  const profileSaveButton = document.getElementById("profileSaveButton");
  const profileCreatedAt = document.getElementById("profileCreatedAt");
  const profileActions = document.getElementById("profileActions");
  const profileDmButton = document.getElementById("profileDmButton");
  const profileFriendButton = document.getElementById("profileFriendButton");
  const avatarButton = document.getElementById("avatar");
  const profileInfoButton = document.getElementById("profileInfoButton");

  let me = null;
  let activeDmUser = null;
  let currentProfile = null;
  let conversations = [];
  let directoryTimer = null;
  let socialReady = false;
  const PEOPLE_DATE_TIME_FORMATTER =
    new Intl.DateTimeFormat(
      "fr-FR",
      {
        dateStyle: "short",
        timeStyle: "short"
      }
    );

  const PEOPLE_DATE_FORMATTER =
    new Intl.DateTimeFormat(
      "fr-FR",
      {
        day: "numeric",
        month: "long",
        year: "numeric"
      }
    );

  const PEOPLE_AVATAR_ACCEPTED_TYPES =
    new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif"
    ]);

  let conversationsRefreshPromise = null;
  let conversationsRefreshQueued = false;
  let friendSurfacesRefreshPromise = null;
  let friendSurfacesRefreshQueued = false;
  let onlineUsersRefreshTimer = null;
  let directoryRequestVersion = 0;
  let conversationsByUsername = new Map();

  function esc(value) {
    return String(value || "");
  }

  function initialsSocial(value) {
    const clean = String(value || "?").trim();
    return clean.slice(0, 2).toUpperCase() || "?";
  }

  function formatDate(value, withTime = false) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return (
      withTime
        ? PEOPLE_DATE_TIME_FORMATTER
        : PEOPLE_DATE_FORMATTER
    ).format(date);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });

    const data = await response
      .json()
      .catch(() => ({}));

    if (!response.ok || data.ok === false) {
      throw new Error(
        data.error || "Une erreur est survenue."
      );
    }

    return data;
  }

  function setMode(mode) {
    const home = mode === "home";

    shell?.classList.toggle("people-home-mode", home);
    shell?.classList.toggle("people-server-mode", !home);

    homeSidebar?.classList.toggle("hidden", !home);
    peopleSidebar?.classList.toggle("hidden", home);
    homeMain?.classList.toggle("hidden", !home);
    peopleMain?.classList.toggle("hidden", home);

    homeRailButton?.classList.toggle("active", home);
    peopleRailButton?.classList.toggle("active", !home);

    const onlinePanel = document.getElementById("onlinePanel");
    if (home && onlinePanel) {
      shell?.classList.remove("people-online-open");
    }

    try {
      localStorage.setItem(
        "people-main-mode",
        home ? "home" : "server"
      );
    } catch {}
  }

  // === PEOPLE_BROWSER_HISTORY_SOCIAL_V1 ===
  function peopleRecordBrowserNavigation(
    entry,
    options = null
  ) {
    if (
      options?.history ===
        false
    ) {
      return;
    }

    window
      .PeopleNavigationHistory
      ?.push?.(
        entry
      );
  }

  function showFriends(options = null) {
    setMode("home");
    homeMain?.classList.remove("dm-open");
    activeDmUser = null;

    friendsView?.classList.remove("hidden");
    dmView?.classList.add("hidden");

    if (homeMainTitle) homeMainTitle.textContent = "Amis";
    if (homeMainSubtitle) {
      homeMainSubtitle.textContent = "Tes contacts People";
    }

    document
      .querySelectorAll(".dm-conversation-row.active")
      .forEach((row) => row.classList.remove("active"));

    peopleRecordBrowserNavigation(
      {
        view:
          "friends"
      },
      options
    );

    if (options?.refresh === false) {
      return;
    }

    void refreshFriendRequests();
    void refreshFriends();
    void refreshDirectory(
      peopleSearchInput?.value || ""
    );
  }

  window.PeopleSocialNavigation = {
    setMode,
    showFriends,
    openDm
  };

  // === PEOPLE_PROFILE_SOCIAL_EVERYWHERE_V3_START ===
  function peopleSocialProfileUsername(
    value
  ) {
    const username =
      String(
        value ||
        ""
      ).trim();

    if (
      !username ||
      username.toLocaleLowerCase(
        "fr-FR"
      ) ===
        "système" ||
      username.toLocaleLowerCase(
        "fr-FR"
      ) ===
        "systeme"
    ) {
      return "";
    }

    return username;
  }

  function peopleBindSocialProfileUi(
    element,
    username,
    kind =
      "name"
  ) {
    const clean =
      peopleSocialProfileUsername(
        username
      );

    if (
      !element ||
      !clean
    ) {
      return;
    }

    element.dataset.peopleProfileUsername =
      clean;

    element.classList.add(
      "people-profile-trigger"
    );

    element.classList.toggle(
      "people-profile-name-trigger",
      kind ===
        "name"
    );

    element.classList.toggle(
      "people-profile-avatar-trigger",
      kind ===
        "avatar"
    );

    if (
      element.dataset.peopleProfileClickBound ===
        "1"
    ) {
      return;
    }

    element.dataset.peopleProfileClickBound =
      "1";

    if (
      element.tagName !==
        "BUTTON"
    ) {
      element.setAttribute(
        "role",
        "button"
      );

      element.setAttribute(
        "tabindex",
        "0"
      );
    }

    element.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();

        void openProfile(
          element.dataset.peopleProfileUsername
        );
      }
    );

    if (
      element.tagName !==
        "BUTTON"
    ) {
      element.addEventListener(
        "keydown",
        (event) => {
          if (
            event.key !==
              "Enter" &&
            event.key !==
              " "
          ) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          void openProfile(
            element.dataset.peopleProfileUsername
          );
        }
      );
    }
  }

  window.addEventListener(
    "people-open-profile",
    (event) => {
      const username =
        peopleSocialProfileUsername(
          event?.detail?.username
        );

      if (username) {
        void openProfile(
          username
        );
      }
    }
  );
  // === PEOPLE_PROFILE_SOCIAL_EVERYWHERE_V3_END ===

  function updateUnreadBadge(total) {
    const count = Math.max(0, Number(total || 0));

    if (!homeUnreadBadge) return;

    homeUnreadBadge.textContent =
      count > 99 ? "99+" : String(count);

    homeUnreadBadge.classList.remove("hidden");
    homeUnreadBadge.classList.toggle(
      "has-unread",
      count > 0
    );
  }

  function makePersonCard(person, inFriends = false) {
    const row = document.createElement("div");
    row.className = "people-card";
    row.dataset.username = person.username;

    const av = document.createElement("button");
    av.type = "button";
    av.className = "people-card-avatar";
    av.dataset.peopleSocialAction = "profile";
    window.PeopleAvatars?.apply(
      av,
      person.username
    );
    av.title = "Ouvrir le profil";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "people-card-copy";
    copy.dataset.peopleSocialAction = "profile";

    const name = document.createElement("strong");
    name.textContent = person.username;

    // === PEOPLE_CARD_PROFILE_V3 ===
    peopleBindSocialProfileUi(
      av,
      person.username,
      "avatar"
    );

    peopleBindSocialProfileUi(
      name,
      person.username,
      "name"
    );

    const status = document.createElement("span");
    status.textContent =
      person.online
        ? "● En ligne"
        : "Hors ligne";

    copy.append(name, status);

    const dm = document.createElement("button");
    dm.type = "button";
    dm.className = "people-card-action";
    dm.textContent = "MP";
    dm.dataset.peopleSocialAction = "dm";

    const friend = document.createElement("button");
    friend.type = "button";
    friend.className =
      "people-card-action secondary";

    const isFriend =
      Boolean(person.isFriend || inFriends);

    if (isFriend) {
      friend.textContent = "Retirer";
      friend.dataset.peopleSocialAction =
        "remove-friend";
    } else if (
      person.friendRequest === "incoming"
    ) {
      friend.textContent = "Accepter";
      friend.dataset.peopleSocialAction =
        "accept-friend";
      friend.dataset.requestId =
        String(person.friendRequestId || "");
    } else if (
      person.friendRequest === "outgoing"
    ) {
      friend.textContent = "En attente";
      friend.disabled = true;
    } else {
      friend.textContent = "Ajouter";
      friend.dataset.peopleSocialAction =
        "add-friend";
    }

    row.append(av, copy, dm, friend);
    return row;
  }

  function makeFriendRequestRow(
    request,
    direction
  ) {
    const row = document.createElement("div");
    row.className = "friend-request-row";
    row.dataset.username =
      request.user.username;
    row.dataset.requestId =
      String(request.id || "");

    const av = document.createElement("button");
    av.type = "button";
    av.className = "friend-request-avatar";
    av.dataset.friendRequestAction = "profile";
    window.PeopleAvatars?.apply(
      av,
      request.user.username
    );

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "friend-request-copy";
    copy.dataset.friendRequestAction = "profile";

    const name = document.createElement("strong");
    name.textContent = request.user.username;

    // === PEOPLE_FRIEND_REQUEST_PROFILE_V3 ===
    peopleBindSocialProfileUi(
      av,
      request.user.username,
      "avatar"
    );

    peopleBindSocialProfileUi(
      name,
      request.user.username,
      "name"
    );

    const status = document.createElement("span");
    status.textContent =
      direction === "incoming"
        ? "Veut devenir ton ami"
        : "En attente de sa réponse";

    copy.append(name, status);

    const actions = document.createElement("div");
    actions.className = "friend-request-actions";

    if (direction === "incoming") {
      const accept = document.createElement("button");
      accept.type = "button";
      accept.className = "friend-request-accept";
      accept.textContent = "Accepter";
      accept.dataset.friendRequestAction = "accept";

      const refuse = document.createElement("button");
      refuse.type = "button";
      refuse.className = "friend-request-refuse";
      refuse.textContent = "Refuser";
      refuse.dataset.friendRequestAction = "delete";

      actions.append(accept, refuse);
    } else {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "friend-request-refuse";
      cancel.textContent = "Annuler";
      cancel.dataset.friendRequestAction = "delete";

      actions.appendChild(cancel);
    }

    row.append(av, copy, actions);
    return row;
  }


  async function handlePersonCardClick(event) {
    const actionButton =
      event.target?.closest?.(
        "[data-people-social-action]"
      );

    if (!actionButton) return;

    const row =
      actionButton.closest(
        ".people-card"
      );

    const username =
      String(
        row?.dataset?.username ||
        ""
      ).trim();

    if (!username) return;

    const action =
      actionButton.dataset
        .peopleSocialAction;

    if (action === "profile") {
      void openProfile(username);
      return;
    }

    if (action === "dm") {
      void openDm(username);
      return;
    }

    if (actionButton.disabled) {
      return;
    }

    actionButton.disabled = true;

    try {
      if (action === "remove-friend") {
        await api(
          "/api/social/friends/" +
            encodeURIComponent(username),
          { method: "DELETE" }
        );
      } else if (action === "accept-friend") {
        const requestId =
          actionButton.dataset.requestId;

        if (!requestId) return;

        await api(
          "/api/social/friend-requests/" +
            encodeURIComponent(requestId) +
            "/accept",
          { method: "POST" }
        );
      } else if (action === "add-friend") {
        await api(
          "/api/social/friends/" +
            encodeURIComponent(username),
          { method: "POST" }
        );
      } else {
        return;
      }

      await refreshFriendSurfaces();

      if (
        currentProfile &&
        currentProfile.username ===
          username
      ) {
        await openProfile(username);
      }
    } catch (err) {
      alert(err.message);
      await refreshFriendSurfaces();
    } finally {
      if (actionButton.isConnected) {
        actionButton.disabled = false;
      }
    }
  }

  async function handleFriendRequestClick(
    event
  ) {
    const actionButton =
      event.target?.closest?.(
        "[data-friend-request-action]"
      );

    if (!actionButton) return;

    const row =
      actionButton.closest(
        ".friend-request-row"
      );

    const username =
      String(
        row?.dataset?.username ||
        ""
      ).trim();

    const requestId =
      String(
        row?.dataset?.requestId ||
        ""
      ).trim();

    const action =
      actionButton.dataset
        .friendRequestAction;

    if (
      action === "profile"
    ) {
      if (username) {
        void openProfile(username);
      }
      return;
    }

    if (
      !requestId ||
      actionButton.disabled
    ) {
      return;
    }

    actionButton.disabled = true;

    try {
      if (action === "accept") {
        await api(
          "/api/social/friend-requests/" +
            encodeURIComponent(requestId) +
            "/accept",
          { method: "POST" }
        );
      } else if (action === "delete") {
        await api(
          "/api/social/friend-requests/" +
            encodeURIComponent(requestId),
          { method: "DELETE" }
        );
      } else {
        return;
      }

      await refreshFriendSurfaces();
    } catch (err) {
      alert(err.message);
    } finally {
      if (actionButton.isConnected) {
        actionButton.disabled = false;
      }
    }
  }

  friendsList?.addEventListener(
    "click",
    handlePersonCardClick
  );

  peopleDirectory?.addEventListener(
    "click",
    handlePersonCardClick
  );

  incomingFriendRequests?.addEventListener(
    "click",
    handleFriendRequestClick
  );

  outgoingFriendRequests?.addEventListener(
    "click",
    handleFriendRequestClick
  );

  // === PEOPLE_AVATAR_PRELOAD_SOCIAL_V1 ===
  function peoplePreloadSocialAvatars(
    usernames
  ) {
    void window.PeopleAvatars
      ?.preloadMany(
        usernames
      );
  }

  async function refreshFriendRequests() {
    if (
      !socialReady ||
      !incomingFriendRequests ||
      !outgoingFriendRequests
    ) {
      return;
    }

    try {
      const data = await api(
        "/api/social/friend-requests"
      );

      const incoming =
        Array.isArray(data.incoming)
          ? data.incoming
          : [];

      const outgoing =
        Array.isArray(data.outgoing)
          ? data.outgoing
          : [];

      peoplePreloadSocialAvatars(
        [
          ...incoming,
          ...outgoing
        ].map(
          (request) =>
            request?.user?.username
        )
      );

      if (friendRequestsCount) {
        friendRequestsCount.textContent =
          String(incoming.length);
      }

      const incomingFragment =
        document.createDocumentFragment();
      const outgoingFragment =
        document.createDocumentFragment();

      if (!incoming.length) {
        const empty = document.createElement("div");
        empty.className = "home-empty";
        empty.textContent =
          "Aucune demande reçue.";
        incomingFragment.appendChild(empty);
      } else {
        for (const request of incoming) {
          incomingFragment.appendChild(
            makeFriendRequestRow(
              request,
              "incoming"
            )
          );
        }
      }

      if (!outgoing.length) {
        const empty = document.createElement("div");
        empty.className = "home-empty";
        empty.textContent =
          "Aucune demande en attente.";
        outgoingFragment.appendChild(empty);
      } else {
        for (const request of outgoing) {
          outgoingFragment.appendChild(
            makeFriendRequestRow(
              request,
              "outgoing"
            )
          );
        }
      }

      incomingFriendRequests.replaceChildren(
        incomingFragment
      );
      outgoingFriendRequests.replaceChildren(
        outgoingFragment
      );
    } catch (err) {
      const empty = document.createElement("div");
      empty.className = "home-empty";
      empty.textContent = err.message;

      incomingFriendRequests.replaceChildren(
        empty
      );
      outgoingFriendRequests.replaceChildren();
    }
  }

  async function refreshFriendSurfaces() {
    if (friendSurfacesRefreshPromise) {
      friendSurfacesRefreshQueued = true;
      return friendSurfacesRefreshPromise;
    }

    friendSurfacesRefreshPromise =
      (async () => {
        do {
          friendSurfacesRefreshQueued = false;

          await Promise.all([
            refreshFriendRequests(),
            refreshFriends(),
            refreshDirectory(
              peopleSearchInput?.value || ""
            )
          ]);
        } while (
          friendSurfacesRefreshQueued &&
          socialReady
        );
      })();

    try {
      await friendSurfacesRefreshPromise;
    } finally {
      friendSurfacesRefreshPromise = null;
    }
  }

  async function refreshFriends() {
    if (!socialReady || !friendsList) return;

    try {
      const data = await api("/api/social/friends");
      const list = Array.isArray(data.friends)
        ? data.friends
        : [];

      peoplePreloadSocialAvatars(
        list.map(
          (person) =>
            person?.username
        )
      );

      if (friendsCount) {
        friendsCount.textContent = String(list.length);
      }

      const fragment =
        document.createDocumentFragment();

      if (!list.length) {
        const empty = document.createElement("div");
        empty.className = "home-empty";
        empty.textContent =
          "Aucun ami pour l'instant. Cherche quelqu'un juste au-dessus.";
        fragment.appendChild(empty);
      } else {
        for (const person of list) {
          fragment.appendChild(
            makePersonCard(person, true)
          );
        }
      }

      friendsList.replaceChildren(fragment);
    } catch (err) {
      const empty = document.createElement("div");
      empty.className = "home-empty";
      empty.textContent = err.message;
      friendsList.replaceChildren(empty);
    }
  }

  async function refreshDirectory(query = "") {
    if (!socialReady || !peopleDirectory) return;

    const cleanQuery =
      String(query || "")
        .trim()
        .slice(0, 50);

    const requestVersion =
      ++directoryRequestVersion;

    try {
      const data = await api(
        "/api/social/people?q=" +
          encodeURIComponent(
            cleanQuery
          )
      );

      if (
        requestVersion !==
        directoryRequestVersion
      ) {
        return;
      }

      const list =
        Array.isArray(data.people)
          ? data.people
          : [];

      peoplePreloadSocialAvatars(
        list.map(
          (person) =>
            person?.username
        )
      );

      if (!list.length) {
        if (!cleanQuery) {
          if (peopleDirectorySection) {
            peopleDirectorySection
              .style.display = "none";
          }

          peopleDirectory.replaceChildren();
          return;
        }

        if (peopleDirectorySection) {
          peopleDirectorySection
            .style.display = "";
        }

        const empty =
          document.createElement(
            "div"
          );

        empty.className =
          "home-empty";

        empty.textContent =
          "Aucun compte trouvé.";

        peopleDirectory.replaceChildren(
          empty
        );

        return;
      }

      if (peopleDirectorySection) {
        peopleDirectorySection
          .style.display = "";
      }

      const fragment =
        document.createDocumentFragment();

      for (const person of list) {
        fragment.appendChild(
          makePersonCard(
            person
          )
        );
      }

      peopleDirectory.replaceChildren(
        fragment
      );
    } catch (err) {
      if (
        requestVersion !==
        directoryRequestVersion
      ) {
        return;
      }

      if (peopleDirectorySection) {
        peopleDirectorySection
          .style.display =
          cleanQuery
            ? ""
            : "none";
      }

      if (!cleanQuery) {
        peopleDirectory.replaceChildren();
        return;
      }

      const empty =
        document.createElement(
          "div"
        );

      empty.className =
        "home-empty";

      empty.textContent =
        err.message;

      peopleDirectory.replaceChildren(
        empty
      );
    }
  }

  // === PEOPLE_DM_CLOSE_CLIENT_V1_START ===
  let peopleDmContextMenu =
    null;

  function closeDmContextMenu() {
    peopleDmContextMenu
      ?.remove();

    peopleDmContextMenu =
      null;
  }

  function positionDmContextMenu(
    menu,
    x,
    y
  ) {
    const margin =
      8;

    const rect =
      menu.getBoundingClientRect();

    const left =
      Math.max(
        margin,
        Math.min(
          window.innerWidth -
            rect.width -
            margin,
          x
        )
      );

    const top =
      Math.max(
        margin,
        Math.min(
          window.innerHeight -
            rect.height -
            margin,
          y
        )
      );

    menu.style.left =
      left + "px";

    menu.style.top =
      top + "px";
  }

  async function closeDmForMe(
    username
  ) {
    const wanted =
      String(
        username ||
        ""
      ).trim();

    if (!wanted) {
      return;
    }

    await api(
      "/api/dm/" +
        encodeURIComponent(
          wanted
        ) +
        "/close",
      {
        method:
          "POST"
      }
    );

    if (
      activeDmUser &&
      activeDmUser.username ===
        wanted
    ) {
      showFriends();
    }

    await refreshConversations();
  }

  function showDmContextMenu(
    conversation,
    x,
    y
  ) {
    closeDmContextMenu();

    const menu =
      document.createElement(
        "div"
      );

    menu.className =
      "people-dm-context-menu";

    const closeButton =
      document.createElement(
        "button"
      );

    closeButton.type =
      "button";

    closeButton.className =
      "people-dm-context-item danger";

    closeButton.textContent =
      "Fermer le MP";

    closeButton.addEventListener(
      "click",
      async () => {
        closeDmContextMenu();

        try {
          await closeDmForMe(
            conversation.user.username
          );
        } catch (err) {
          alert(
            err?.message ||
            "Impossible de fermer ce MP."
          );
        }
      }
    );

    menu.appendChild(
      closeButton
    );

    document.body.appendChild(
      menu
    );

    peopleDmContextMenu =
      menu;

    positionDmContextMenu(
      menu,
      x,
      y
    );
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (
        peopleDmContextMenu &&
        !peopleDmContextMenu
          .contains(
            event.target
          )
      ) {
        closeDmContextMenu();
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key ===
        "Escape"
      ) {
        closeDmContextMenu();
      }
    }
  );
  // === PEOPLE_DM_CLOSE_CLIENT_V1_END ===

  function renderConversationList() {
    if (!dmConversationList) return;

    const fragment =
      document.createDocumentFragment();

    if (!conversations.length) {
      const empty = document.createElement("div");
      empty.className = "dm-sidebar-empty";
      empty.textContent = "Aucun MP pour l'instant";
      fragment.appendChild(empty);
      dmConversationList.replaceChildren(fragment);
      return;
    }

    for (const conversation of conversations) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "dm-conversation-row";
      row.dataset.username =
        conversation.user.username;

      if (
        activeDmUser &&
        activeDmUser.username ===
          conversation.user.username
      ) {
        row.classList.add("active");
      }

      const av = document.createElement("span");
      av.className = "dm-sidebar-avatar";
      window.PeopleAvatars?.apply(
        av,
        conversation.user.username
      );

      const copy = document.createElement("span");
      copy.className = "dm-sidebar-copy";

      const name = document.createElement("strong");
      name.textContent = conversation.user.username;

      const preview = document.createElement("small");
      preview.textContent =
        conversation.lastMessage || "Message privé";

      // === PEOPLE_DM_SIDEBAR_MP_PRIORITY_V1 ===
      /*
        Dans la liste des MP, PP + pseudo font partie de la ligne
        de conversation : tout clic ouvre le MP.
        Les profils restent cliquables ailleurs dans People.
      */
      copy.append(name, preview);

      row.append(av, copy);

      if (conversation.unreadCount > 0) {
        const badge = document.createElement("span");
        badge.className = "dm-unread-badge";
        badge.textContent =
          conversation.unreadCount > 99
            ? "99+"
            : String(conversation.unreadCount);
        row.appendChild(badge);
      }

      fragment.appendChild(row);
    }

    dmConversationList.replaceChildren(
      fragment
    );
  }


  dmConversationList?.addEventListener(
    "click",
    (event) => {
      const row =
        event.target?.closest?.(
          ".dm-conversation-row"
        );

      const username =
        String(
          row?.dataset?.username ||
          ""
        ).trim();

      if (username) {
        void openDm(username);
      }
    }
  );

  dmConversationList?.addEventListener(
    "contextmenu",
    (event) => {
      const row =
        event.target?.closest?.(
          ".dm-conversation-row"
        );

      const username =
        String(
          row?.dataset?.username ||
          ""
        ).trim();

      if (!username) return;

      const conversation =
        conversationsByUsername.get(
          username
        );

      if (!conversation) return;

      event.preventDefault();
      event.stopPropagation();

      showDmContextMenu(
        conversation,
        event.clientX,
        event.clientY
      );
    }
  );

  async function refreshConversations() {
    if (!socialReady) return;

    if (conversationsRefreshPromise) {
      conversationsRefreshQueued = true;
      return conversationsRefreshPromise;
    }

    conversationsRefreshPromise =
      (async () => {
        do {
          conversationsRefreshQueued = false;

          try {
            const data = await api(
              "/api/dm/conversations"
            );

            conversations =
              Array.isArray(data.conversations)
                ? data.conversations
                : [];

            conversationsByUsername =
              new Map(
                conversations.map(
                  (conversation) => [
                    String(
                      conversation?.user?.username ||
                      ""
                    ),
                    conversation
                  ]
                )
              );

            peoplePreloadSocialAvatars(
              conversations.map(
                (conversation) =>
                  conversation?.user?.username
              )
            );

            updateUnreadBadge(
              data.unreadTotal || 0
            );
            renderConversationList();
          } catch {}
        } while (
          conversationsRefreshQueued &&
          socialReady
        );
      })();

    try {
      await conversationsRefreshPromise;
    } finally {
      conversationsRefreshPromise = null;
    }
  }

// === PEOPLE_DM_GROUPING_V1_START ===
  const PEOPLE_DM_GROUP_MAX_MESSAGES = 10;
  const PEOPLE_DM_GROUP_MAX_GAP_MS =
    10 * 60 * 1000;

  function dmMessageTimestamp(message) {
    const time =
      new Date(
        message?.createdAt ||
        Date.now()
      ).getTime();

    return Number.isFinite(time)
      ? time
      : Date.now();
  }

function dmTextLine(
    message,
    grouped = false
  ) {
    const unit =
      document.createElement("div");

    unit.className =
      "people-message-unit";

    const messageId =
      String(
        message?.id || ""
      );

    if (messageId) {
      unit.dataset.messageId =
        messageId;
    }

    const replyPreview =
      window.PeopleMessageActions
        ?.createReplyPreview(
          message?.replyTo
        );

    if (replyPreview) {
      unit.appendChild(
        replyPreview
      );
    }

    const text =
      document.createElement("div");

    text.className =
      grouped
        ? "message-text people-grouped-message-line"
        : "message-text";

    if (window.PeopleRichContent) {
      window.PeopleRichContent.render(
        text,
        {
          text:
            message.body,
          imageId:
            message.imageId
        }
      );
    } else {
      text.textContent =
        String(message.body || "");
    }

    if (grouped) {
      text.title =
        formatDate(
          message.createdAt,
          true
        );
    }

    unit.appendChild(text);

    const mine =
      me &&
      String(message.senderId) ===
        String(me.id);

    const author =
      mine
        ? me
        : activeDmUser;

    if (messageId) {
      window.PeopleMessageActions
        ?.bindContext(
          unit,
          {
            message: {
              id:
                messageId,
              username:
                author?.username ||
                "Utilisateur",
              body:
                message.body,
              imageId:
                message.imageId
            },
            canDelete:
              Boolean(mine),
            onReply:
              () =>
                peopleDmReplyController
                  ?.set({
                    id:
                      messageId,
                    username:
                      author?.username ||
                      "Utilisateur",
                    body:
                      message.body,
                    imageId:
                      message.imageId
                  }),
            onDelete:
              () =>
                peopleDeleteDmMessage(
                  messageId
                )
          }
        );
    }

    return unit;
  }

  function dmMessageElement(message) {
    const mine =
      me &&
      String(message.senderId) ===
        String(me.id);

    const row =
      document.createElement("div");

    row.className =
      "dm-message";

    row.classList.toggle(
      "mine",
      Boolean(mine)
    );

    const av =
      document.createElement("button");

    av.type = "button";
    av.className =
      "avatar dm-message-avatar";

    const author =
      mine
        ? me
        : activeDmUser;

    window.PeopleAvatars?.apply(
      av,
      author?.username || "?"
    );

    if (author?.username) {
      av.dataset.peopleProfileUsername =
        author.username;
    }

    const body =
      document.createElement("div");

    body.className =
      "people-message-group-body";

    const head =
      document.createElement("div");

    head.className =
      "message-head";

    const strong =
      document.createElement("strong");

    strong.textContent =
      author?.username ||
      "Utilisateur";

    // === PEOPLE_DM_MESSAGE_PROFILE_V3 ===
    if (
      author?.username
    ) {
      peopleBindSocialProfileUi(
        av,
        author.username,
        "avatar"
      );

      peopleBindSocialProfileUi(
        strong,
        author.username,
        "name"
      );
    }

    const time =
      document.createElement("time");

    time.textContent =
      formatDate(
        message.createdAt,
        true
      );

    head.append(
      strong,
      time
    );

    body.append(
      head,
      dmTextLine(
        message,
        false
      )
    );

    row.append(
      av,
      body
    );

    return {
      row,
      body
    };
  }



  dmMessages?.addEventListener(
    "click",
    (event) => {
      const avatar =
        event.target?.closest?.(
          ".dm-message-avatar[data-people-profile-username]"
        );

      const username =
        String(
          avatar?.dataset
            ?.peopleProfileUsername ||
          ""
        ).trim();

      if (username) {
        void openProfile(username);
      }
    }
  );

  // === PEOPLE_DM_CALL_HISTORY_V2_START ===
  function peopleParseDmCallEvent(
    body
  ) {
    const match =
      String(
        body ||
        ""
      ).match(
        /^\[\[PEOPLE_CALL_V1\|(started|ended)\|([a-zA-Z0-9-]+)\|([a-zA-Z0-9-]*)\|(\d+)\]\]$/
      );

    if (!match) {
      return null;
    }

    return {
      type:
        match[1],
      callId:
        match[2],
      reason:
        match[3] || "",
      durationSeconds:
        Math.max(
          0,
          Number(
            match[4]
          ) || 0
        )
    };
  }

  function peopleFormatCallDuration(
    seconds
  ) {
    const total =
      Math.max(
        0,
        Math.round(
          Number(
            seconds
          ) || 0
        )
      );

    if (!total) {
      return "";
    }

    const minutes =
      Math.floor(
        total / 60
      );

    const rest =
      total % 60;

    if (!minutes) {
      return (
        rest +
        " s"
      );
    }

    return (
      minutes +
      " min " +
      String(
        rest
      ).padStart(
        2,
        "0"
      ) +
      " s"
    );
  }

  function peopleDmCallHistoryText(
    message,
    event
  ) {
    const callerName =
      me &&
      String(
        message.senderId
      ) ===
      String(
        me.id
      )
        ? (
            me.username ||
            "Tu"
          )
        : (
            activeDmUser?.username ||
            "Utilisateur"
          );

    if (
      event.type ===
      "started"
    ) {
      return (
        callerName +
        " a lancé un appel"
      );
    }

    const labels = {
      declined:
        "Appel refusé",
      cancelled:
        "Appel annulé",
      timeout:
        "Appel manqué — pas de réponse",
      disconnected:
        "Appel interrompu",
      hangup:
        "Appel terminé"
    };

    let text =
      labels[
        event.reason
      ] ||
      "Appel terminé";

    const duration =
      peopleFormatCallDuration(
        event.durationSeconds
      );

    if (
      duration &&
      (
        event.reason ===
          "hangup" ||
        event.reason ===
          "disconnected"
      )
    ) {
      text +=
        " • " +
        duration;
    }

    return text;
  }

  function peopleDmCallHistoryElement(
    message,
    event
  ) {
    const row =
      document.createElement(
        "div"
      );

    row.className =
      "people-dm-call-history";

    const content =
      document.createElement(
        "div"
      );

    content.className =
      "people-dm-call-history-content";

    const icon =
      document.createElement(
        "span"
      );

    icon.textContent =
      event.type ===
        "started"
        ? "📞"
        : "☎️";

    const label =
      document.createElement(
        "strong"
      );

    label.textContent =
      peopleDmCallHistoryText(
        message,
        event
      );

    const time =
      document.createElement(
        "time"
      );

    time.textContent =
      formatDate(
        message.createdAt,
        true
      );

    content.append(
      icon,
      label,
      time
    );

    row.appendChild(
      content
    );

    return row;
  }
  // === PEOPLE_DM_CALL_HISTORY_V2_END ===

  function renderDmMessageGroups(
    list,
    target = dmMessages
  ) {
    const messagesList =
      Array.isArray(list)
        ? list
        : [];

    if (!target) return;

    let group = null;

    for (const message of messagesList) {
      const callEvent =
        peopleParseDmCallEvent(
          message.body
        );

      if (callEvent) {
        target.appendChild(
          peopleDmCallHistoryElement(
            message,
            callEvent
          )
        );

        group = null;
        continue;
      }

      const senderId =
        String(message.senderId || "");

      const time =
        dmMessageTimestamp(message);

      const sameGroup =
        group &&
        group.senderId === senderId &&
        group.count <
          PEOPLE_DM_GROUP_MAX_MESSAGES &&
        time - group.lastTime <
          PEOPLE_DM_GROUP_MAX_GAP_MS;

      if (sameGroup) {
        group.body.appendChild(
          dmTextLine(
            message,
            true
          )
        );

        group.lastTime = time;
        group.count += 1;
        continue;
      }

      const built =
        dmMessageElement(message);

      target.appendChild(
        built.row
      );

      group = {
        senderId,
        lastTime: time,
        count: 1,
        body: built.body
      };
    }
  }
  // === PEOPLE_DM_GROUPING_V1_END ===

  async function loadActiveDm() {
    if (!activeDmUser || !dmMessages) return;

    try {
      const data = await api(
        "/api/dm/" +
          encodeURIComponent(activeDmUser.username)
      );

      activeDmUser = data.user;

      peoplePreloadSocialAvatars(
        [
          activeDmUser?.username,
          me?.username
        ]
      );

      if (dmHeaderName) {
        dmHeaderName.textContent =
          activeDmUser.username;
      }

      if (dmHeaderAvatar) {
        window.PeopleAvatars?.apply(
          dmHeaderAvatar,
          activeDmUser.username
        );
      }

      // === PEOPLE_DM_HEADER_PROFILE_V3 ===
      peopleBindSocialProfileUi(
        dmHeaderAvatar,
        activeDmUser.username,
        "avatar"
      );

      peopleBindSocialProfileUi(
        dmHeaderName,
        activeDmUser.username,
        "name"
      );

      if (dmHeaderStatus) {
        dmHeaderStatus.textContent =
          activeDmUser.online
            ? "En ligne"
            : "Hors ligne";
      }

      if (dmWelcomeTitle) {
        dmWelcomeTitle.textContent =
          activeDmUser.username;
      }

      const fragment =
        document.createDocumentFragment();

      const welcome = document.createElement("div");
      welcome.className = "dm-welcome";

      const title = document.createElement("h2");
      title.textContent =
        "Début de ta conversation avec " +
        activeDmUser.username;

      const subtitle = document.createElement("p");
      subtitle.textContent =
        "Les messages privés sont enregistrés sur People.";

      welcome.append(title, subtitle);
      fragment.appendChild(welcome);

      renderDmMessageGroups(
        data.messages || [],
        fragment
      );

      dmMessages.replaceChildren(
        fragment
      );

      requestAnimationFrame(() => {
        dmMessages.scrollTop =
          dmMessages.scrollHeight;
      });

      await api(
        "/api/dm/" +
          encodeURIComponent(activeDmUser.username) +
          "/read",
        { method: "POST" }
      );

      await refreshConversations();
    } catch (err) {
      if (dmMessages) {
        const empty = document.createElement("div");
        empty.className = "home-empty";
        empty.textContent = err.message;
        dmMessages.replaceChildren(empty);
      }
    }
  }

  async function openDm(
    username,
    options = null
  ) {
    if (!username) return;

    // === PEOPLE_DM_REOPEN_CLIENT_V1 ===
    try {
      await api(
        "/api/dm/" +
          encodeURIComponent(
            username
          ) +
          "/open",
        {
          method:
            "POST"
        }
      );
    } catch {}

    setMode("home");
    homeMain?.classList.add("dm-open");
    friendsView?.classList.add("hidden");
    dmView?.classList.remove("hidden");

    activeDmUser = {
      username: String(username)
    };

    if (homeMainTitle) {
      homeMainTitle.textContent = "Message privé";
    }

    if (homeMainSubtitle) {
      homeMainSubtitle.textContent =
        "Conversation avec " + username;
    }

    await loadActiveDm();
    renderConversationList();
    dmInput?.focus();

    peopleRecordBrowserNavigation(
      {
        view:
          "dm",
        username:
          String(
            username
          )
      },
      options
    );
  }

  function closeProfile() {
    profileModal?.classList.add("hidden");
    currentProfile = null;
  }

  function profileDate(value) {
    return value
      ? formatDate(value, false)
      : "Date inconnue";
  }

  async function openProfile(username) {
    if (!username) return;

    try {
      const data = await api(
        "/api/profile/" +
          encodeURIComponent(username)
      );

      currentProfile = data.profile;

      window.PeopleAvatars?.apply(
        profileModalAvatar,
        currentProfile.username
      );

      profileModalName.textContent =
        currentProfile.username;

      profileModalOnline.textContent =
        currentProfile.online
          ? "● En ligne"
          : "Hors ligne";

      profileCreatedAt.textContent =
        profileDate(currentProfile.createdAt);

      const description =
        String(currentProfile.description || "");

      profileDescriptionText.textContent =
        description || "Aucune description.";

      profileEditWrap.classList.toggle(
        "hidden",
        !currentProfile.isSelf
      );

      profileAvatarEditWrap?.classList.toggle(
        "hidden",
        !currentProfile.isSelf
      );

      profileActions.classList.toggle(
        "hidden",
        currentProfile.isSelf
      );

      if (currentProfile.isSelf) {
        profileDescriptionInput.value = description;
        profileDescriptionCount.textContent =
          String(description.length);
} else {
        profileFriendButton.disabled = false;

        if (currentProfile.isFriend) {
          profileFriendButton.textContent =
            "Retirer des amis";
        } else if (
          currentProfile.friendRequest ===
            "incoming"
        ) {
          profileFriendButton.textContent =
            "Accepter la demande";
        } else if (
          currentProfile.friendRequest ===
            "outgoing"
        ) {
          profileFriendButton.textContent =
            "Demande envoyée";
          profileFriendButton.disabled = true;
        } else {
          profileFriendButton.textContent =
            "Ajouter en ami";
        }
      }

      profileModal.classList.remove("hidden");
    } catch (err) {
      alert(err.message);
    }
  }

  async function bootstrapSocial(userOverride = null) {
    try {
      if (userOverride?.id) {
        me = {
          id: String(userOverride.id),
          username: userOverride.username
        };
      } else {
        const data = await api("/api/auth/me");
        me = {
          id: String(data.user.id),
          username: data.user.username
        };
      }

      socialReady = true;

      await Promise.all([
        refreshConversations(),
        refreshFriendRequests(),
        refreshFriends(),
        refreshDirectory("")
      ]);

      showFriends({ refresh: false });
    } catch {
      socialReady = false;
    }
  }

  homeRailButton?.addEventListener(
    "click",
    showFriends
  );

  friendsNavButton?.addEventListener(
    "click",
    showFriends
  );

  dmBackButton?.addEventListener(
    "click",
    showFriends
  );

  dmProfileButton?.addEventListener(
    "click",
    () => {
      if (activeDmUser?.username) {
        openProfile(activeDmUser.username);
      }
    }
  );

    dmForm?.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      if (
        !activeDmUser?.username
      ) {
        return;
      }

      const body =
        String(
          dmInput?.value || ""
        ).trim();

      const file =
        peopleDmImagePicker
          ?.getFile();

      if (
        !body &&
        !file
      ) {
        return;
      }

      const submitButton =
        dmForm.querySelector(
          'button[type="submit"]'
        );

      dmInput.disabled =
        true;

      if (submitButton) {
        submitButton.disabled =
          true;
      }

      peopleDmImagePicker
        ?.setBusy(true);

      try {
        let imageId =
          null;

        if (file) {
          imageId =
            await window
              .PeopleRichContent
              .uploadImage(
                file
              );
        }

        await api(
          "/api/dm/" +
            encodeURIComponent(
              activeDmUser.username
            ),
          {
            method: "POST",
            body:
              JSON.stringify({
                body,
                imageId,
                replyToId:
                  peopleDmReplyController
                    ?.get()?.id || null
              })
          }
        );

        dmInput.value =
          "";

        peopleDmImagePicker
          ?.clear();

        peopleDmReplyController
          ?.clear();

        await loadActiveDm();
      } catch (err) {
        alert(
          err.message
        );
      } finally {
        dmInput.disabled =
          false;

        if (submitButton) {
          submitButton.disabled =
            false;
        }

        peopleDmImagePicker
          ?.setBusy(false);

        dmInput.focus();
      }
    }
  );

  peopleSearchInput?.addEventListener(
    "input",
    () => {
      clearTimeout(directoryTimer);

      directoryTimer = setTimeout(
        () =>
          refreshDirectory(
            peopleSearchInput.value
          ),
        180
      );
    }
  );

  profileModalClose?.addEventListener(
    "click",
    closeProfile
  );

  profileModal?.addEventListener(
    "click",
    (event) => {
      if (
        event.target?.dataset?.profileClose === "1"
      ) {
        closeProfile();
      }
    }
  );

  profileAvatarUploadButton?.addEventListener(
    "click",
    () => {
      if (currentProfile?.isSelf) {
        profileAvatarInput?.click();
      }
    }
  );

  profileAvatarInput?.addEventListener(
    "change",
    async () => {
      const file =
        profileAvatarInput.files?.[0];

      if (!file) return;

        const accepted =
          PEOPLE_AVATAR_ACCEPTED_TYPES;

      if (!accepted.has(file.type)) {
        alert(
          "Format non accepté. JPEG, PNG, WebP ou GIF uniquement."
        );

        profileAvatarInput.value = "";
        return;
      }

      if (
        file.size <= 0 ||
        file.size >
          25 * 1024 * 1024
      ) {
        alert(
          "L'image source doit faire moins de 25 Mo."
        );

        profileAvatarInput.value = "";
        return;
      }

      try {
        profileAvatarUploadButton.disabled = true;
        profileAvatarUploadButton.textContent =
          "Recadrage...";

        const cropped =
          await window
            .PeopleAvatarCropper
            ?.open(file);

        if (!cropped) {
          profileAvatarUploadButton.textContent =
            "Changer la photo";

          return;
        }

        profileAvatarUploadButton.textContent =
          "Compression forte...";

        const prepared =
          await window
            .PeopleAvatarUltra
            ?.prepare(
              cropped
            );

        if (
          !prepared?.base64 ||
          !prepared?.blob
        ) {
          throw new Error(
            "La compression de la PP a échoué."
          );
        }

        const kb =
          Math.max(
            1,
            Math.round(
              prepared.blob.size /
              1024
            )
          );

        profileAvatarUploadButton.textContent =
          "Envoi • " +
          kb +
          " Ko...";

        const response =
          await fetch(
            "/api/profile/avatar-ultra",
            {
              method: "PUT",
              credentials:
                "same-origin",
              headers: {
                "Content-Type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  data:
                    prepared.base64
                })
            }
          );

        let data = null;

        try {
          data =
            await response.json();
        } catch {}

        if (
          !response.ok ||
          data?.ok === false
        ) {
          throw new Error(
            data?.error ||
            "Impossible de changer la photo."
          );
        }

        if (
          data?.avatarDataUrl
        ) {
          window.PeopleAvatars
            ?.applyDataUrlEverywhere(
              currentProfile.username,
              data.avatarDataUrl
            );

          window.PeopleAvatars
            ?.applyDataUrlToElement(
              profileModalAvatar,
              currentProfile.username,
              data.avatarDataUrl
            );
        } else {
          window.PeopleAvatarUltra
            ?.applyPreview(
              currentProfile.username,
              prepared.blob
            );
        }

        profileAvatarUploadButton.textContent =
          "Photo enregistrée • " +
          kb +
          " Ko ✓";

        setTimeout(
          () => {
            profileAvatarUploadButton.textContent =
              "Changer la photo";
          },
          1600
        );
      } catch (err) {
        console.error(
          "[People PP ultra]",
          err
        );

        alert(
          err?.message ||
          "Impossible d'envoyer la photo."
        );

        profileAvatarUploadButton.textContent =
          "Changer la photo";
      } finally {
        profileAvatarUploadButton.disabled = false;
        profileAvatarInput.value = "";
      }
    }
  );

  profileDescriptionInput?.addEventListener(
    "input",
    () => {
      profileDescriptionCount.textContent =
        String(profileDescriptionInput.value.length);
    }
  );

  profileSaveButton?.addEventListener(
    "click",
    async () => {
      try {
        const data = await api(
          "/api/profile/me",
          {
            method: "PUT",
            body: JSON.stringify({
              description:
                profileDescriptionInput.value
            })
          }
        );

        currentProfile = data.profile;

        profileDescriptionText.textContent =
          currentProfile.description ||
          "Aucune description.";

        profileDescriptionCount.textContent =
          String(
            currentProfile.description.length
          );

        profileSaveButton.textContent =
          "Enregistré ✓";

        setTimeout(() => {
          profileSaveButton.textContent =
            "Enregistrer";
        }, 1200);

        refreshDirectory(
          peopleSearchInput?.value || ""
        );
      } catch (err) {
        alert(err.message);
      }
    }
  );

  profileDmButton?.addEventListener(
    "click",
    () => {
      const username =
        currentProfile?.username;

      closeProfile();

      if (username) {
        openDm(username);
      }
    }
  );

  profileFriendButton?.addEventListener(
    "click",
    async () => {
      if (
        !currentProfile?.username ||
        profileFriendButton.disabled
      ) {
        return;
      }

      try {
        if (currentProfile.isFriend) {
          await api(
            "/api/social/friends/" +
              encodeURIComponent(
                currentProfile.username
              ),
            { method: "DELETE" }
          );
        } else if (
          currentProfile.friendRequest ===
            "incoming" &&
          currentProfile.friendRequestId
        ) {
          await api(
            "/api/social/friend-requests/" +
              encodeURIComponent(
                currentProfile.friendRequestId
              ) +
              "/accept",
            { method: "POST" }
          );
        } else {
          await api(
            "/api/social/friends/" +
              encodeURIComponent(
                currentProfile.username
              ),
            { method: "POST" }
          );
        }

        const username =
          currentProfile.username;

        await refreshFriendSurfaces();
        await openProfile(username);
      } catch (err) {
        alert(err.message);
        await refreshFriendSurfaces();
      }
    }
  );

  avatarButton?.addEventListener(
    "click",
    () => {
      const username =
        me?.username ||
        document.getElementById("profileName")
          ?.textContent;

      if (username && username !== "Invité") {
        openProfile(username);
      }
    }
  );

  profileInfoButton?.addEventListener(
    "click",
    () => {
      const username =
        me?.username ||
        document.getElementById("profileName")
          ?.textContent;

      if (username && username !== "Invité") {
        openProfile(username);
      }
    }
  );

  document.addEventListener("click", (event) => {
    const row = event.target.closest(
      ".online-user-row"
    );

    if (
      row?.dataset?.username &&
      row.dataset.username !== me?.username
    ) {
      openProfile(row.dataset.username);
    }
  });

  window.addEventListener(
    "people-authenticated",
    (event) => {
      bootstrapSocial(event.detail || null);
    }
  );

  // === PEOPLE_DM_MENTION_PING_V2_START ===
  let peopleDmPingAudioContext = null;

  function peopleDmEscapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function peopleDmMentionsMe(text) {
    const username = String(me?.username || "").trim();
    if (!username || !text) return false;

    const escaped = peopleDmEscapeRegex(username);
    const mention = new RegExp(
      "(^|\\s)@" + escaped + "(?=$|\\s|[.,!?;:])",
      "i"
    );

    return mention.test(String(text));
  }

  function peopleDmUnlockPingAudio() {
    try {
      if (!peopleDmPingAudioContext) {
        const AudioCtx =
          window.AudioContext ||
          window.webkitAudioContext;

        if (AudioCtx) {
          peopleDmPingAudioContext = new AudioCtx();
        }
      }

      if (peopleDmPingAudioContext?.state === "suspended") {
        peopleDmPingAudioContext.resume().catch(() => {});
      }
    } catch {}
  }

  function peopleDmPlayPing() {
    // === PEOPLE_SETTINGS_DM_SOUND_HOOK_V1 ===
    if (
      window.PeopleSounds
        ?.playNotification?.()
    ) {
      return;
    }

    try {
      peopleDmUnlockPingAudio();
      if (!peopleDmPingAudioContext) return;

      const now = peopleDmPingAudioContext.currentTime;

      const beep = (start, frequency) => {
        const osc =
          peopleDmPingAudioContext.createOscillator();
        const gain =
          peopleDmPingAudioContext.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(frequency, start);

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(
          0.16,
          start + 0.015
        );
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          start + 0.16
        );

        osc.connect(gain);
        gain.connect(
          peopleDmPingAudioContext.destination
        );

        osc.start(start);
        osc.stop(start + 0.18);
      };

      beep(now, 880);
      beep(now + 0.12, 1175);
    } catch {}
  }

  function peopleDmShowPingToast(sender, body) {
    let host =
      document.getElementById("peoplePingToasts");

    if (!host) {
      host = document.createElement("div");
      host.id = "peoplePingToasts";
      host.className = "people-ping-toasts";
      document.body.appendChild(host);
    }

    const toast = document.createElement("div");
    toast.className = "people-ping-toast";

    const title = document.createElement("strong");
    title.textContent = "@ Ping MP de " + sender;

    const text = document.createElement("span");
    text.textContent =
      String(body || "").slice(0, 180);

    toast.append(title, text);
    host.appendChild(toast);

    requestAnimationFrame(
      () => toast.classList.add("show")
    );

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 250);
    }, 5000);
  }

  function peopleDmHandleMention(payload) {
    if (!peopleDmMentionsMe(payload?.body)) {
      return false;
    }

    const sender =
      payload?.sender?.username ||
      "Quelqu'un";

    peopleDmPlayPing();
    peopleDmShowPingToast(
      sender,
      payload.body
    );

    return true;
  }

  // === PEOPLE_DM_NOTIFICATION_V1_START ===
  function peopleDmShowMessageToast(
    sender,
    body,
    hasImage
  ) {
    let host =
      document.getElementById(
        "peoplePingToasts"
      );

    if (!host) {
      host =
        document.createElement(
          "div"
        );

      host.id =
        "peoplePingToasts";

      host.className =
        "people-ping-toasts";

      document.body.appendChild(
        host
      );
    }

    const toast =
      document.createElement(
        "div"
      );

    toast.className =
      "people-ping-toast people-dm-notification-toast";

    const title =
      document.createElement(
        "strong"
      );

    title.textContent =
      "MP de " +
      sender;

    const text =
      document.createElement(
        "span"
      );

    text.textContent =
      String(
        body ||
        (
          hasImage
            ? "🖼️ Image"
            : "Nouveau message"
        )
      ).slice(0, 180);

    toast.append(
      title,
      text
    );

    host.appendChild(
      toast
    );

    requestAnimationFrame(
      () =>
        toast.classList.add(
          "show"
        )
    );

    setTimeout(
      () => {
        toast.classList.remove(
          "show"
        );

        setTimeout(
          () => toast.remove(),
          250
        );
      },
      5000
    );
  }

  function peopleDmHandleIncomingNotification(payload) {
    /*
      Si le MP contient un vrai @ping,
      le comportement de ping existant est utilisé
      et on évite un double son / double toast.
    */
    if (
      peopleDmHandleMention(
        payload
      )
    ) {
      return;
    }

    const sender =
      payload?.sender?.username ||
      "Quelqu'un";

    peopleDmPlayPing();

    peopleDmShowMessageToast(
      sender,
      payload?.body,
      Boolean(
        payload?.imageId
      )
    );
  }
  // === PEOPLE_DM_NOTIFICATION_V1_END ===

  document.addEventListener(
    "click",
    peopleDmUnlockPingAudio,
    { passive: true }
  );
  // === PEOPLE_DM_MENTION_PING_V2_END ===

// === PEOPLE_DM_DELETE_CLIENT_V1_START ===
  socket.on(
    "dm-message-deleted",
    async (payload) => {
      if (!socialReady || !me) {
        return;
      }

      peopleDmReplyController
        ?.clearIfId(
          payload?.id
        );

      window.PeopleMessageActions
        ?.markDeleted(
          payload?.id
        );

      const ids = [
        String(
          payload?.senderId || ""
        ),
        String(
          payload?.recipientId || ""
        )
      ];

      if (
        activeDmUser &&
        ids.includes(
          String(me.id)
        ) &&
        ids.includes(
          String(
            activeDmUser.id
          )
        )
      ) {
        await loadActiveDm();
      }

      await refreshConversations();
    }
  );
  // === PEOPLE_DM_DELETE_CLIENT_V1_END ===

  socket.on("dm-message", async (payload) => {
    const senderName =
      payload?.sender?.username;

    if (!senderName) return;

    peopleDmHandleIncomingNotification(
      payload
    );

    if (
      activeDmUser &&
      activeDmUser.username === senderName &&
      !dmView.classList.contains("hidden")
    ) {
      await loadActiveDm();
    } else {
      await refreshConversations();
    }

    try {
      if (
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        new Notification(
          "People — MP de " + senderName,
          {
            body: String(payload.body || (payload.imageId ? "🖼️ Image" : "")).slice(0, 180),
            tag: "people-dm-" + senderName
          }
        );
      }
    } catch {}
  });

  socket.on(
    "dm-message-sent",
    () => refreshConversations()
  );

  socket.on(
    "dm-call-history",
    async (payload) => {
      if (
        !socialReady ||
        !me
      ) {
        return;
      }

      const ids = [
        String(
          payload?.callerId ||
          ""
        ),
        String(
          payload?.calleeId ||
          ""
        )
      ];

      if (
        activeDmUser &&
        ids.includes(
          String(
            me.id
          )
        ) &&
        ids.includes(
          String(
            activeDmUser.id
          )
        ) &&
        !dmView.classList
          .contains(
            "hidden"
          )
      ) {
        await loadActiveDm();
      } else {
        await refreshConversations();
      }
    }
  );

  socket.on("friend-state-changed", () => {
    if (socialReady) {
      refreshFriendSurfaces();
    }
  });

  function scheduleOnlineUsersRefresh() {
    if (onlineUsersRefreshTimer) {
      return;
    }

    onlineUsersRefreshTimer =
      setTimeout(
        () => {
          onlineUsersRefreshTimer = null;

          void Promise.all([
            refreshFriends(),
            refreshDirectory(
              peopleSearchInput?.value || ""
            )
          ]);
        },
        120
      );
  }

  // === PEOPLE_DM_LIVE_PRESENCE_V1_START ===
  socket.on(
    "people-presence-changed",
    (payload = {}) => {
      if (
        !socialReady ||
        !me
      ) {
        return;
      }

      const accountId =
        String(
          payload?.accountId ||
          ""
        );

      if (!accountId) {
        return;
      }

      const online =
        payload?.online ===
        true;

      /*
        MP actuellement affiché :
        pas de requête HTTP supplémentaire,
        on change directement le statut déjà chargé.
      */
      if (
        activeDmUser &&
        String(
          activeDmUser.id ||
          ""
        ) === accountId
      ) {
        activeDmUser.online =
          online;

        if (dmHeaderStatus) {
          dmHeaderStatus.textContent =
            online
              ? "En ligne"
              : "Hors ligne";
        }
      }

      /*
        Si le profil de cette même personne est ouvert,
        son indicateur suit lui aussi la présence en direct.
      */
      if (
        currentProfile &&
        String(
          currentProfile.id ||
          ""
        ) === accountId
      ) {
        currentProfile.online =
          online;

        if (profileModalOnline) {
          profileModalOnline.textContent =
            online
              ? "● En ligne"
              : "Hors ligne";
        }
      }
    }
  );
  // === PEOPLE_DM_LIVE_PRESENCE_V1_END ===

  socket.on(
    "online-users",
    () => {
      if (socialReady) {
        scheduleOnlineUsersRefresh();
      }
    }
  );

  bootstrapSocial();
})();
