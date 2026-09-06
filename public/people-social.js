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
  const peopleDirectory = document.getElementById("peopleDirectory");
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

  const profileModal = document.getElementById("profileModal");
  const profileModalClose = document.getElementById("profileModalClose");
  const profileModalAvatar = document.getElementById("profileModalAvatar");
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

    return new Intl.DateTimeFormat(
      "fr-FR",
      withTime
        ? {
            dateStyle: "short",
            timeStyle: "short"
          }
        : {
            day: "numeric",
            month: "long",
            year: "numeric"
          }
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

  function showFriends() {
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

    refreshFriends();
    refreshDirectory(
      peopleSearchInput?.value || ""
    );
  }

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
    av.textContent = initialsSocial(person.username);
    av.title = "Ouvrir le profil";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "people-card-copy";

    const name = document.createElement("strong");
    name.textContent = person.username;

    const status = document.createElement("span");
    status.textContent = person.online
      ? "● En ligne"
      : person.description || "Hors ligne";

    copy.append(name, status);

    const dm = document.createElement("button");
    dm.type = "button";
    dm.className = "people-card-action";
    dm.textContent = "MP";

    const friend = document.createElement("button");
    friend.type = "button";
    friend.className = "people-card-action secondary";
    friend.textContent =
      person.isFriend || inFriends
        ? "Retirer"
        : "Ajouter";

    av.addEventListener(
      "click",
      () => openProfile(person.username)
    );

    copy.addEventListener(
      "click",
      () => openProfile(person.username)
    );

    dm.addEventListener(
      "click",
      () => openDm(person.username)
    );

    friend.addEventListener("click", async () => {
      try {
        const remove =
          person.isFriend || inFriends;

        await api(
          "/api/social/friends/" +
            encodeURIComponent(person.username),
          {
            method: remove ? "DELETE" : "POST"
          }
        );

        await Promise.all([
          refreshFriends(),
          refreshDirectory(
            peopleSearchInput?.value || ""
          )
        ]);

        if (
          currentProfile &&
          currentProfile.username === person.username
        ) {
          openProfile(person.username);
        }
      } catch (err) {
        alert(err.message);
      }
    });

    row.append(av, copy, dm, friend);
    return row;
  }

  async function refreshFriends() {
    if (!socialReady || !friendsList) return;

    try {
      const data = await api("/api/social/friends");
      const list = Array.isArray(data.friends)
        ? data.friends
        : [];

      friendsList.innerHTML = "";

      if (friendsCount) {
        friendsCount.textContent = String(list.length);
      }

      if (!list.length) {
        const empty = document.createElement("div");
        empty.className = "home-empty";
        empty.textContent =
          "Aucun ami pour l'instant. Cherche quelqu'un juste au-dessus.";
        friendsList.appendChild(empty);
        return;
      }

      for (const person of list) {
        friendsList.appendChild(
          makePersonCard(person, true)
        );
      }
    } catch (err) {
      friendsList.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "home-empty";
      empty.textContent = err.message;
      friendsList.appendChild(empty);
    }
  }

  async function refreshDirectory(query = "") {
    if (!socialReady || !peopleDirectory) return;

    try {
      const data = await api(
        "/api/social/people?q=" +
          encodeURIComponent(query)
      );

      const list = Array.isArray(data.people)
        ? data.people
        : [];

      peopleDirectory.innerHTML = "";

      if (!list.length) {
        const empty = document.createElement("div");
        empty.className = "home-empty";
        empty.textContent =
          query
            ? "Aucun compte trouvé."
            : "Aucun autre compte People.";
        peopleDirectory.appendChild(empty);
        return;
      }

      for (const person of list) {
        peopleDirectory.appendChild(
          makePersonCard(person)
        );
      }
    } catch (err) {
      peopleDirectory.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "home-empty";
      empty.textContent = err.message;
      peopleDirectory.appendChild(empty);
    }
  }

  function renderConversationList() {
    if (!dmConversationList) return;

    dmConversationList.innerHTML = "";

    if (!conversations.length) {
      const empty = document.createElement("div");
      empty.className = "dm-sidebar-empty";
      empty.textContent = "Aucun MP pour l'instant";
      dmConversationList.appendChild(empty);
      return;
    }

    for (const conversation of conversations) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "dm-conversation-row";

      if (
        activeDmUser &&
        activeDmUser.username ===
          conversation.user.username
      ) {
        row.classList.add("active");
      }

      const av = document.createElement("span");
      av.className = "dm-sidebar-avatar";
      av.textContent =
        initialsSocial(conversation.user.username);

      const copy = document.createElement("span");
      copy.className = "dm-sidebar-copy";

      const name = document.createElement("strong");
      name.textContent = conversation.user.username;

      const preview = document.createElement("small");
      preview.textContent =
        conversation.lastMessage || "Message privé";

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

      row.addEventListener(
        "click",
        () => openDm(conversation.user.username)
      );

      dmConversationList.appendChild(row);
    }
  }

  async function refreshConversations() {
    if (!socialReady) return;

    try {
      const data = await api(
        "/api/dm/conversations"
      );

      conversations = Array.isArray(data.conversations)
        ? data.conversations
        : [];

      updateUnreadBadge(data.unreadTotal || 0);
      renderConversationList();
    } catch {}
  }

  function dmMessageElement(message) {
    const mine =
      me &&
      String(message.senderId) === String(me.id);

    const row = document.createElement("div");
    row.className = "dm-message";
    row.classList.toggle("mine", Boolean(mine));

    const av = document.createElement("button");
    av.type = "button";
    av.className = "avatar dm-message-avatar";

    const author = mine
      ? me
      : activeDmUser;

    av.textContent =
      initialsSocial(author?.username || "?");

    if (author?.username) {
      av.addEventListener(
        "click",
        () => openProfile(author.username)
      );
    }

    const body = document.createElement("div");

    const head = document.createElement("div");
    head.className = "message-head";

    const strong = document.createElement("strong");
    strong.textContent =
      author?.username || "Utilisateur";

    const time = document.createElement("time");
    time.textContent = formatDate(
      message.createdAt,
      true
    );

    head.append(strong, time);

    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.body;

    body.append(head, text);
    row.append(av, body);

    return row;
  }

  async function loadActiveDm() {
    if (!activeDmUser || !dmMessages) return;

    try {
      const data = await api(
        "/api/dm/" +
          encodeURIComponent(activeDmUser.username)
      );

      activeDmUser = data.user;

      if (dmHeaderName) {
        dmHeaderName.textContent =
          activeDmUser.username;
      }

      if (dmHeaderAvatar) {
        dmHeaderAvatar.textContent =
          initialsSocial(activeDmUser.username);
      }

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

      dmMessages.innerHTML = "";

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
      dmMessages.appendChild(welcome);

      for (const message of data.messages || []) {
        dmMessages.appendChild(
          dmMessageElement(message)
        );
      }

      dmMessages.scrollTop = dmMessages.scrollHeight;

      await api(
        "/api/dm/" +
          encodeURIComponent(activeDmUser.username) +
          "/read",
        { method: "POST" }
      );

      await refreshConversations();
    } catch (err) {
      if (dmMessages) {
        dmMessages.innerHTML = "";
        const empty = document.createElement("div");
        empty.className = "home-empty";
        empty.textContent = err.message;
        dmMessages.appendChild(empty);
      }
    }
  }

  async function openDm(username) {
    if (!username) return;

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

      profileModalAvatar.textContent =
        initialsSocial(currentProfile.username);

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

      profileActions.classList.toggle(
        "hidden",
        currentProfile.isSelf
      );

      if (currentProfile.isSelf) {
        profileDescriptionInput.value = description;
        profileDescriptionCount.textContent =
          String(description.length);
      } else {
        profileFriendButton.textContent =
          currentProfile.isFriend
            ? "Retirer des amis"
            : "Ajouter en ami";
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
        refreshFriends(),
        refreshDirectory("")
      ]);

      let preferred = "server";

      try {
        preferred =
          localStorage.getItem("people-main-mode") ||
          "server";
      } catch {}

      setMode(
        preferred === "home" ? "home" : "server"
      );
    } catch {
      socialReady = false;
    }
  }

  homeRailButton?.addEventListener(
    "click",
    showFriends
  );

  peopleRailButton?.addEventListener(
    "click",
    () => setMode("server")
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

  dmForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!activeDmUser?.username) return;

    const body = String(dmInput?.value || "").trim();
    if (!body) return;

    dmInput.disabled = true;

    try {
      await api(
        "/api/dm/" +
          encodeURIComponent(activeDmUser.username),
        {
          method: "POST",
          body: JSON.stringify({ body })
        }
      );

      dmInput.value = "";
      await loadActiveDm();
    } catch (err) {
      alert(err.message);
    } finally {
      dmInput.disabled = false;
      dmInput.focus();
    }
  });

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
      if (!currentProfile?.username) return;

      try {
        const remove =
          Boolean(currentProfile.isFriend);

        await api(
          "/api/social/friends/" +
            encodeURIComponent(
              currentProfile.username
            ),
          {
            method: remove
              ? "DELETE"
              : "POST"
          }
        );

        currentProfile.isFriend = !remove;

        profileFriendButton.textContent =
          currentProfile.isFriend
            ? "Retirer des amis"
            : "Ajouter en ami";

        await Promise.all([
          refreshFriends(),
          refreshDirectory(
            peopleSearchInput?.value || ""
          )
        ]);
      } catch (err) {
        alert(err.message);
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

  socket.on("dm-message", async (payload) => {
    const senderName =
      payload?.sender?.username;

    if (!senderName) return;

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
            body: String(payload.body || "").slice(0, 180),
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
    "online-users",
    () => {
      if (socialReady) {
        refreshFriends();
        refreshDirectory(
          peopleSearchInput?.value || ""
        );
      }
    }
  );

  bootstrapSocial();
})();
