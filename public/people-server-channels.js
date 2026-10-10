(() => {
  const tree = document.getElementById("peopleServerChannelTree");
  const createButton = document.getElementById("serverChannelCreateButton");
  const titleName = document.getElementById("activeTextChannelName");
  const subtitle = document.getElementById("activeTextChannelSubtitle");
  const welcome = document.getElementById("serverWelcomeText");
  const messageInput = document.getElementById("messageInput");
  if (!tree) return;

  let state = {
    serverId: null,
    activeTextChannelId: null,
    activeVoiceServerId: null,
    activeVoiceChannelId: null,
    channels: [],
    voice: [],
    serverPermissions: { mask: 0, names: [] }
  };
  let currentUserId = null;
  let menu = null;
  let activeDialog = null;
  let draggedChannelId = null;

  function closeMenu() {
    menu?.remove();
    menu = null;
  }

  function activeServer() {
    return window.PeopleServers?.getActiveServer?.() || null;
  }

  function permissionNames(value) {
    return new Set(Array.isArray(value?.names) ? value.names.map(String) : []);
  }

  function canServer(permission) {
    const server = activeServer();
    if (server?.ownerId && currentUserId && String(server.ownerId) === String(currentUserId)) return true;
    const names = permissionNames(state.serverPermissions);
    return names.has("ADMINISTRATOR") || names.has(String(permission));
  }

  function canChannel(channel, permission) {
    const names = new Set(Array.isArray(channel?.permissions) ? channel.permissions.map(String) : []);
    return names.has(String(permission)) || canServer("ADMINISTRATOR");
  }

  function canManage() {
    return canServer("MANAGE_CHANNELS");
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || ("" + window.PeopleI18n.t("ui_4a47d829df") + ""));
    }
    return data;
  }

  function cleanName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 50);
  }

  function closeDialog(result = null) {
    if (!activeDialog) return;
    const { overlay, resolve } = activeDialog;
    activeDialog = null;
    overlay.remove();
    resolve(result);
  }

  function peopleDialog({
    title = "People",
    description = "",
    value = "",
    placeholder = "",
    confirmText = "Valider",
    cancelText = ("" + window.PeopleI18n.t("ui_19766ed6cc") + ""),
    danger = false,
    input = true
  } = {}) {
    if (activeDialog) closeDialog(null);

    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "people-channel-dialog-overlay";

      const panel = document.createElement("form");
      panel.className = "people-channel-dialog";

      const heading = document.createElement("h3");
      heading.textContent = title;
      panel.appendChild(heading);

      if (description) {
        const text = document.createElement("p");
        text.textContent = description;
        panel.appendChild(text);
      }

      let field = null;
      if (input) {
        field = document.createElement("input");
        field.className = "people-channel-dialog-input";
        field.type = "text";
        field.maxLength = 50;
        field.value = String(value || "");
        field.placeholder = placeholder;
        field.autocomplete = "off";
        panel.appendChild(field);
      }

      const actions = document.createElement("div");
      actions.className = "people-channel-dialog-actions";

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "people-channel-dialog-cancel";
      cancel.textContent = cancelText;

      const confirm = document.createElement("button");
      confirm.type = "submit";
      confirm.className = `people-channel-dialog-confirm${danger ? " danger" : ""}`;
      confirm.textContent = confirmText;

      actions.append(cancel, confirm);
      panel.appendChild(actions);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      activeDialog = { overlay, resolve };

      const finish = (answer) => {
        if (!activeDialog || activeDialog.overlay !== overlay) return;
        closeDialog(answer);
      };

      cancel.addEventListener("click", () => finish(null));
      overlay.addEventListener("pointerdown", (event) => {
        if (event.target === overlay) finish(null);
      });
      panel.addEventListener("submit", (event) => {
        event.preventDefault();
        finish(input ? String(field?.value || "") : true);
      });
      overlay.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      });

      requestAnimationFrame(() => {
        if (field) {
          field.focus();
          field.select();
        } else {
          confirm.focus();
        }
      });
    });
  }

  async function refreshChannelsFromServer(expectedServerId = state.serverId) {
    const sid = String(expectedServerId || "");
    if (!sid) return false;
    const result = await api(`/api/servers/${encodeURIComponent(sid)}/channels`);
    if (String(state.serverId || "") !== sid) return false;
    state.channels = Array.isArray(result.channels) ? result.channels : [];
    if (result.permissions) state.serverPermissions = result.permissions;
    render();
    return true;
  }

  function upsertLocalChannel(channel) {
    if (!channel?.id) return;
    const id = String(channel.id);
    const index = state.channels.findIndex((item) => String(item?.id || "") === id);
    if (index >= 0) state.channels[index] = channel;
    else state.channels.push(channel);
    render();
  }

  async function createItem(type, parentId = null) {
    const labels = {
      category: ["Create Category", "Category name"],
      text: ["Create Text Channel", "Text channel name"],
      voice: ["Create Voice Channel", "Voice channel name"]
    };
    const defaults = { category: "New category", text: "new-channel", voice: "New voice channel" };
    const [title, description] = labels[type] || [("" + window.PeopleI18n.t("ui_4759498ac2") + ""), "Nom"];
    const value = await peopleDialog({
      title,
      description,
      value: defaults[type] || "",
      placeholder: defaults[type] || "",
      confirmText: ("" + window.PeopleI18n.t("ui_4759498ac2") + "")
    });
    if (value === null) return;
    const name = cleanName(value);
    if (!name) return;

    const sid = String(state.serverId || activeServer()?.id || "");
    if (!sid) return;

    try {
      const result = await api(`/api/servers/${encodeURIComponent(sid)}/channels`, {
        method: "POST",
        body: JSON.stringify({ type, name, parentId })
      });
      if (String(state.serverId || "") === sid && result.channel) {
        upsertLocalChannel(result.channel);
      }
      try { await refreshChannelsFromServer(sid); } catch (syncErr) {
        console.warn("[People salons/synchronisation après création]", syncErr);
      }
    } catch (err) {
      alert(err.message);
    }
  }

  async function renameItem(channel) {
    const value = await peopleDialog({
      title: "Renommer",
      description: `New name for “${channel.name || "this item"}”`,
      value: channel.name || "",
      confirmText: ("" + window.PeopleI18n.t("ui_35322b5bb5") + "")
    });
    if (value === null) return;
    const name = cleanName(value);
    if (!name || name === channel.name) return;

    const sid = String(state.serverId || "");
    try {
      const result = await api(`/api/servers/${encodeURIComponent(sid)}/channels/${encodeURIComponent(channel.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name })
      });
      if (result.channel) upsertLocalChannel(result.channel);
      try { await refreshChannelsFromServer(sid); } catch (syncErr) {
        console.warn("[People salons/synchronisation après renommage]", syncErr);
      }
    } catch (err) {
      alert(err.message);
    }
  }

  async function moveItem(channel) {
    if (channel.type === "category") return;
    const categories = state.channels.filter((item) => item.type === "category");
    const choices = [("" + window.PeopleI18n.t("ui_6dce68fcb3") + ""), ...categories.map((item, index) => `${index + 1} — ${item.name}`)].join("\n");
    const raw = await peopleDialog({
      title: "Move channel",
      description: `Choose the category by number:\n${choices}`,
      value: "0",
      confirmText: "Move"
    });
    if (raw === null) return;
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index > categories.length) return;
    const parentId = index === 0 ? null : categories[index - 1].id;
    const sid = String(state.serverId || "");
    try {
      const result = await api(`/api/servers/${encodeURIComponent(sid)}/channels/${encodeURIComponent(channel.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ parentId })
      });
      if (result.channel) upsertLocalChannel(result.channel);
      try { await refreshChannelsFromServer(sid); } catch (syncErr) {
        console.warn("[People salons/synchronisation après déplacement]", syncErr);
      }
    } catch (err) {
      alert(err.message);
    }
  }

  async function deleteItem(channel) {
    const what = channel.type === "category" ? ("" + window.PeopleI18n.t("ui_56d386dd07") + "") : channel.type === "voice" ? ("" + window.PeopleI18n.t("ui_3ee593cc06") + "") : ("" + window.PeopleI18n.t("ui_32b477d29c") + "");
    const detail = channel.type === "category"
      ? ("" + window.PeopleI18n.t("ui_994b2b2a98") + "")
      : channel.type === "text"
        ? ("" + window.PeopleI18n.t("ui_4e896c7bad") + "")
        : ("" + window.PeopleI18n.t("ui_84b43ff4f5") + "");
    const confirmed = await peopleDialog({
      title: `${window.PeopleI18n.t("ui_e2d0a54968")} ${what}`,
      description: `« ${channel.name} »\n\n${detail}`,
      confirmText: ("" + window.PeopleI18n.t("ui_e2d0a54968") + ""),
      danger: true,
      input: false
    });
    if (!confirmed) return;

    const sid = String(state.serverId || "");
    try {
      await api(`/api/servers/${encodeURIComponent(sid)}/channels/${encodeURIComponent(channel.id)}`, {
        method: "DELETE"
      });
      state.channels = state.channels.filter((item) => String(item?.id || "") !== String(channel.id));
      render();
      try { await refreshChannelsFromServer(sid); } catch (syncErr) {
        console.warn("[People salons/synchronisation après suppression]", syncErr);
      }
    } catch (err) {
      alert(err.message);
    }
  }

  function menuButton(label, action, danger = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `people-channel-menu-item${danger ? " danger" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      closeMenu();
      void action();
    });
    return button;
  }

  function placeMenu(element, x, y) {
    closeMenu();
    menu = element;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
  }

  function openCreateMenu(x, y, parentId = null) {
    if (!canManage() || !state.serverId) return;
    const box = document.createElement("div");
    box.className = "people-channel-create-menu";
    box.append(
      menuButton(("" + window.PeopleI18n.t("ui_45526444d5") + ""), () => createItem("category", null)),
      menuButton(("" + window.PeopleI18n.t("ui_fc84ee20d1") + ""), () => createItem("text", parentId)),
      menuButton(("" + window.PeopleI18n.t("ui_db9501323b") + ""), () => createItem("voice", parentId))
    );
    placeMenu(box, x, y);
  }

  function openContextMenu(event, channel) {
    if (!canChannel(channel, "MANAGE_CHANNELS")) return;
    event.preventDefault();
    const box = document.createElement("div");
    box.className = "people-channel-context-menu";
    box.append(menuButton("Renommer", () => renameItem(channel)));
    box.append(menuButton("Permissions", () => window.PeopleChannelPermissions.open(state.serverId, channel)));
    if (channel.type !== "category") {
      box.append(menuButton(("" + window.PeopleI18n.t("ui_2848e4d443") + ""), () => moveItem(channel)));
    } else {
      box.append(
        menuButton(("" + window.PeopleI18n.t("ui_a1de7df694") + ""), () => createItem("text", channel.id)),
        menuButton(("" + window.PeopleI18n.t("ui_f3ef909c78") + ""), () => createItem("voice", channel.id))
      );
    }
    box.append(menuButton(("" + window.PeopleI18n.t("ui_e2d0a54968") + ""), () => deleteItem(channel), true));
    placeMenu(box, event.clientX, event.clientY);
  }

  function collapsedKey(categoryId) {
    return `people:server:${state.serverId}:category:${categoryId}:collapsed`;
  }

  function isCollapsed(categoryId) {
    return localStorage.getItem(collapsedKey(categoryId)) === "1";
  }

  function setCollapsed(categoryId, collapsed) {
    localStorage.setItem(collapsedKey(categoryId), collapsed ? "1" : "0");
  }

  async function patchParent(channelId, parentId) {
    const sid = String(state.serverId || "");
    try {
      const result = await api(`/api/servers/${encodeURIComponent(sid)}/channels/${encodeURIComponent(channelId)}`, {
        method: "PATCH",
        body: JSON.stringify({ parentId })
      });
      if (result.channel) upsertLocalChannel(result.channel);
      try { await refreshChannelsFromServer(sid); } catch (syncErr) {
        console.warn("[People salons/synchronisation après glisser-déposer]", syncErr);
      }
    } catch (err) {
      alert(err.message);
    }
  }

  function voiceMembers(channelId) {
    return (state.voice || []).filter((user) => String(user?.channelId || "") === String(channelId));
  }

  function memberRow(user) {
    const row = document.createElement("div");
    row.className = "people-server-voice-member";
    row.dataset.serverId = String(state.serverId || "");
    row.dataset.channelId = String(user.channelId || "");
    const avatar = document.createElement("div");
    avatar.className = "people-server-voice-member-avatar";
    window.PeopleAvatars?.apply?.(avatar, user.username);
    const name = document.createElement("span");
    name.className = "people-server-voice-member-name";
    name.textContent = user.username || "User";
    const media = document.createElement("span");
    media.className = "people-server-voice-member-media";
    media.textContent = `${user.screen ? "🖥️ " : user.camera ? "📹 " : ""}${user.muted ? "🔇" : ""}`.trim();
    row.append(avatar, name, media);
    return row;
  }

  function channelButton(channel) {
    const wrap = document.createElement("div");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "people-server-channel";
    button.dataset.channelId = String(channel.id);
    button.draggable = canChannel(channel, "MANAGE_CHANNELS") && channel.type !== "category";

    const icon = document.createElement("span");
    icon.className = "people-server-channel-icon";
    icon.textContent = channel.type === "voice" ? "🔊" : "#";
    const name = document.createElement("span");
    name.className = "people-server-channel-name";
    name.textContent = channel.name;
    button.append(icon, name);

    if (channel.type === "text") {
      button.classList.toggle("active", String(state.activeTextChannelId || "") === String(channel.id));
      button.addEventListener("click", async () => {
        const response = await window.PeopleServerRuntime?.selectTextChannel?.(channel.id);
        if (response?.ok === false) alert(response.error || ("" + window.PeopleI18n.t("ui_c764ed30bd") + ""));
      });
    } else {
      const members = voiceMembers(channel.id);
      if (members.length) {
        const count = document.createElement("span");
        count.className = "people-server-channel-count";
        count.textContent = String(members.length);
        button.appendChild(count);
      }
      const joined =
        String(state.activeVoiceServerId || "") === String(state.serverId || "") &&
        String(state.activeVoiceChannelId || "") === String(channel.id);
      button.classList.toggle("joined-voice", joined);
      const canConnect = canChannel(channel, "CONNECT");
      button.classList.toggle("people-channel-no-connect", !canConnect);
      button.addEventListener("click", async () => {
        if (!canConnect) {
          alert(("" + window.PeopleI18n.t("ui_4875c87d3c") + ""));
          return;
        }
        await window.PeopleServerRuntime?.joinVoiceChannel?.(channel.id);
      });
    }

    button.addEventListener("contextmenu", (event) => openContextMenu(event, channel));
    button.addEventListener("dragstart", () => {
      draggedChannelId = String(channel.id);
      button.classList.add("dragging");
    });
    button.addEventListener("dragend", () => {
      draggedChannelId = null;
      button.classList.remove("dragging");
      document.querySelectorAll(".drag-over,.drag-over-root").forEach((node) => node.classList.remove("drag-over", "drag-over-root"));
    });

    wrap.appendChild(button);
    if (channel.type === "voice") {
      const members = voiceMembers(channel.id);
      if (members.length) {
        const list = document.createElement("div");
        list.className = "people-server-voice-members";
        for (const user of members) list.appendChild(memberRow(user));
        wrap.appendChild(list);
      }
    }
    return wrap;
  }

  function categoryBlock(category, children) {
    const section = document.createElement("section");
    section.className = "people-channel-category";
    if (isCollapsed(category.id)) section.classList.add("collapsed");

    const header = document.createElement("div");
    header.className = "people-channel-category-header";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "people-channel-category-toggle";
    toggle.textContent = section.classList.contains("collapsed") ? "▶" : "▼";
    const name = document.createElement("span");
    name.className = "people-channel-category-name";
    name.textContent = category.name;
    header.append(toggle, name);

    if (canChannel(category, "MANAGE_CHANNELS")) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "people-channel-category-add";
      add.textContent = "+";
      add.title = ("" + window.PeopleI18n.t("ui_9f25e21a9a") + "");
      add.addEventListener("click", (event) => {
        event.stopPropagation();
        const rect = add.getBoundingClientRect();
        openCreateMenu(rect.right, rect.bottom + 4, category.id);
      });
      header.appendChild(add);
    }

    header.addEventListener("contextmenu", (event) => openContextMenu(event, category));
    toggle.addEventListener("click", () => {
      const collapsed = !section.classList.contains("collapsed");
      section.classList.toggle("collapsed", collapsed);
      toggle.textContent = collapsed ? "▶" : "▼";
      setCollapsed(category.id, collapsed);
    });

    const body = document.createElement("div");
    body.className = "people-channel-category-body";
    body.dataset.categoryId = String(category.id);
    for (const child of children) body.appendChild(channelButton(child));

    body.addEventListener("dragover", (event) => {
      if (!draggedChannelId || !canChannel(category, "MANAGE_CHANNELS")) return;
      event.preventDefault();
      body.classList.add("drag-over");
    });
    body.addEventListener("dragleave", () => body.classList.remove("drag-over"));
    body.addEventListener("drop", (event) => {
      event.preventDefault();
      body.classList.remove("drag-over");
      const id = draggedChannelId;
      draggedChannelId = null;
      if (id) void patchParent(id, category.id);
    });

    section.append(header, body);
    return section;
  }

  function updateChatChrome() {
    const active = state.channels.find((item) => item.type === "text" && String(item.id) === String(state.activeTextChannelId || ""));
    if (!active) return;
    if (titleName) titleName.textContent = `# ${active.name}`;
    if (subtitle) subtitle.textContent = `${window.PeopleI18n.t("ui_c13ae7eea1")} ${active.name}`;
    if (welcome) welcome.textContent = `${window.PeopleI18n.t("ui_b6001be120")}${active.name}.`;
    if (messageInput) {
      const canSend = canChannel(active, "SEND_MESSAGES");
      messageInput.disabled = !canSend;
      messageInput.placeholder = canSend
        ? `Message in #${active.name}`
        : `${window.PeopleI18n.t("ui_1f42e5a3c9")}${active.name}`;
    }
    const h2 = document.querySelector("#messages .welcome h2");
    if (h2) h2.textContent = `Welcome to # ${active.name}`;
  }

  function render() {
    closeMenu();
    tree.replaceChildren();
    if (createButton) createButton.hidden = !canManage();
    updateChatChrome();
    if (!state.serverId) return;

    const channels = [...(state.channels || [])].sort((a, b) => (Number(a.position || 0) - Number(b.position || 0)) || String(a.name).localeCompare(String(b.name), "fr"));
    const categories = channels.filter((item) => item.type === "category");
    const uncategorized = channels.filter((item) => item.type !== "category" && !item.parentId);

    for (const channel of uncategorized) tree.appendChild(channelButton(channel));
    for (const category of categories) {
      const children = channels.filter((item) => item.type !== "category" && String(item.parentId || "") === String(category.id));
      tree.appendChild(categoryBlock(category, children));
    }

    if (!channels.length) {
      const empty = document.createElement("div");
      empty.className = "people-channel-empty";
      empty.textContent = ("" + window.PeopleI18n.t("ui_c9c207c2cd") + "");
      tree.appendChild(empty);
    }
  }

  tree.addEventListener("dragover", (event) => {
    if (!draggedChannelId || !canManage() || event.target.closest(".people-channel-category-body")) return;
    event.preventDefault();
    tree.classList.add("drag-over-root");
  });
  tree.addEventListener("dragleave", (event) => {
    if (!tree.contains(event.relatedTarget)) tree.classList.remove("drag-over-root");
  });
  tree.addEventListener("drop", (event) => {
    if (event.target.closest(".people-channel-category-body")) return;
    event.preventDefault();
    tree.classList.remove("drag-over-root");
    const id = draggedChannelId;
    draggedChannelId = null;
    if (id) void patchParent(id, null);
  });

  createButton?.addEventListener("click", (event) => {
    const rect = createButton.getBoundingClientRect();
    openCreateMenu(rect.right, rect.bottom + 5, null);
  });

  document.addEventListener("pointerdown", (event) => {
    if (menu && !menu.contains(event.target) && event.target !== createButton) closeMenu();
  });
  window.addEventListener("blur", closeMenu);

  async function hydrateCurrentUser() {
    if (currentUserId) return;
    try {
      const result = await api("/api/auth/me");
      currentUserId = result?.user?.id ? String(result.user.id) : null;
      render();
    } catch {}
  }

  window.addEventListener("people-authenticated", (event) => {
    currentUserId = event.detail?.id ? String(event.detail.id) : null;
    render();
  });

  void hydrateCurrentUser();

  // === PEOPLE_SERVER_SETTINGS_V1_CHANNEL_API_START ===
  window.PeopleServerChannels = {
    async create(type, parentId = null) {
      if (!canManage()) throw new Error("Only the owner can manage channels at this time.");
      if (!["category", "text", "voice"].includes(String(type || ""))) throw new Error("Invalid channel type.");
      return createItem(String(type), parentId || null);
    },
    canManage,
    getState() {
      return { ...state, channels: [...(state.channels || [])] };
    }
  };
  // === PEOPLE_SERVER_SETTINGS_V1_CHANNEL_API_END ===

  window.addEventListener("people-server-channel-state", (event) => {
    const detail = event.detail || {};
    state = {
      ...state,
      ...detail,
      channels: Array.isArray(detail.channels) ? detail.channels : state.channels,
      voice: Array.isArray(detail.voice) ? detail.voice : state.voice
    };
    render();
  });
})();
