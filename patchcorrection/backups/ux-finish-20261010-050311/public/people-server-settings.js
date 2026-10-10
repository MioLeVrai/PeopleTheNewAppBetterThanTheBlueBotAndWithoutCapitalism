(() => {
  "use strict";

  // PEOPLE_SERVER_SETTINGS_V2_CLIENT
  // === PEOPLE_SERVER_SETTINGS_GEAR_FIX_V1_START ===
  let settingsButton = document.getElementById("serverSettingsButton");
  // Le bouton peut etre absent d'anciennes installations. On le cree plus bas.
  // === PEOPLE_SERVER_SETTINGS_GEAR_FIX_V1_TOP_END ===

let currentUserId = null;
  let overlay = null;
  let activeSection = "overview";
  let serverSnapshot = null;
  let serverPermissions = { mask: 0, names: [], owner: false, highestRolePosition: 0 };

  const SECTIONS = [
    { id: "overview", label: "Vue d’ensemble" },
    { id: "channels", label: "Salons" },
    { id: "members", label: "Membres" },
    { id: "invites", label: "Invitations" },
    { id: "roles", label: "Rôles et permissions" },
    { id: "moderation", label: "Modération" }
  ];

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || "Action impossible.");
    }
    return data;
  }

  function activeServer() {
    return window.PeopleServers?.getActiveServer?.() || null;
  }

  function isOwner(server = serverSnapshot) {
    return Boolean(
      server?.ownerId && currentUserId &&
      String(server.ownerId) === String(currentUserId)
    );
  }

  function hasPermission(permission, server = serverSnapshot) {
    if (isOwner(server) || serverPermissions?.owner) return true;
    return Array.isArray(serverPermissions?.names) && (serverPermissions.names.includes("ADMINISTRATOR") || serverPermissions.names.includes(String(permission)));
  }

  function initials(value) {
    return String(value || "?").trim().slice(0, 2).toUpperCase() || "?";
  }

  // === PEOPLE_SERVER_ICON_V1_SETTINGS ===
  function renderSettingsServerIcon(target, server) {
    if (!target) return;
    target.replaceChildren();
    const iconData = server?.iconData;
    if (typeof iconData === "string" && iconData.startsWith("data:image/")) {
      const image = document.createElement("img");
      image.src = iconData;
      image.alt = "";
      image.draggable = false;
      target.appendChild(image);
      return;
    }
    target.textContent = initials(server?.name);
  }

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Impossible de lire cette image."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Image illisible."));
      image.src = src;
    });
  }

  async function prepareServerIcon(file) {
    if (!file || !/^image\/(png|jpeg|webp)$/i.test(file.type || "")) {
      throw new Error("Choisis une image PNG, JPEG ou WebP.");
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("Choisis une image de moins de 10 Mo.");
    }

    const source = await readImageFile(file);
    const image = await loadImage(source);
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Impossible de préparer l'image.");

    const sourceSize = Math.min(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const sx = ((image.naturalWidth || image.width) - sourceSize) / 2;
    const sy = ((image.naturalHeight || image.height) - sourceSize) / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, size, size);

    let result = canvas.toDataURL("image/webp", 0.86);
    if (!result.startsWith("data:image/webp")) result = canvas.toDataURL("image/jpeg", 0.88);
    return result;
  }

  function closeSettings() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    serverSnapshot = null;
    document.body.classList.remove("people-server-settings-open");
  }

  function statusBox(message, kind = "info") {
    const box = document.createElement("div");
    box.className = `people-server-settings-status ${kind}`;
    box.textContent = message;
    return box;
  }

  function placeholder(title, description) {
    const wrap = document.createElement("section");
    wrap.className = "people-server-settings-placeholder";
    wrap.innerHTML = `
      <div class="people-server-settings-placeholder-icon">◆</div>
      <h3></h3>
      <p></p>
      <span>Emplacement préparé pour une prochaine mise à jour.</span>
    `;
    wrap.querySelector("h3").textContent = title;
    wrap.querySelector("p").textContent = description;
    return wrap;
  }

  function sectionHeader(title, description) {
    const head = document.createElement("header");
    head.className = "people-server-settings-section-head";
    const h = document.createElement("h2");
    h.textContent = title;
    const p = document.createElement("p");
    p.textContent = description;
    head.append(h, p);
    return head;
  }

  async function renderOverview(content) {
    const server = serverSnapshot;
    content.appendChild(sectionHeader(
      "Vue d’ensemble",
      "Modifie le nom et l’image visibles du serveur sans toucher à son identité technique ni à son invitation."
    ));

    const owner = hasPermission("MANAGE_SERVER", server);
    const card = document.createElement("section");
    card.className = "people-server-settings-card people-server-settings-overview-card";

    const iconColumn = document.createElement("div");
    iconColumn.className = "people-server-settings-icon-column";

    const avatar = document.createElement("button");
    avatar.type = "button";
    avatar.className = "people-server-settings-server-icon";
    avatar.title = owner ? "Changer l’image du serveur" : "Image du serveur";
    avatar.disabled = !owner;
    renderSettingsServerIcon(avatar, server);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/png,image/jpeg,image/webp";
    fileInput.hidden = true;
    fileInput.disabled = !owner;

    const iconActions = document.createElement("div");
    iconActions.className = "people-server-settings-icon-actions";
    const changeIcon = document.createElement("button");
    changeIcon.type = "button";
    changeIcon.textContent = server?.iconData ? "Changer" : "Ajouter une image";
    changeIcon.disabled = !owner;
    const removeIcon = document.createElement("button");
    removeIcon.type = "button";
    removeIcon.className = "danger-ghost";
    removeIcon.textContent = "Retirer";
    removeIcon.hidden = !server?.iconData;
    removeIcon.disabled = !owner;
    iconActions.append(changeIcon, removeIcon);

    const iconState = document.createElement("small");
    iconState.className = "people-server-settings-icon-state";
    iconState.textContent = owner ? "PNG, JPEG ou WebP. Recadrée automatiquement en carré." : "Tu n'as pas la permission de changer l’image.";

    iconColumn.append(avatar, fileInput, iconActions, iconState);

    async function saveIcon(iconData) {
      if (!owner || !server?.id) return;
      changeIcon.disabled = true;
      removeIcon.disabled = true;
      avatar.disabled = true;
      iconState.classList.remove("error", "success");
      iconState.textContent = "Enregistrement…";
      try {
        const result = await api(`/api/servers/${encodeURIComponent(server.id)}/icon`, {
          method: "PATCH",
          body: JSON.stringify({ iconData })
        });
        serverSnapshot = result.server || { ...serverSnapshot, iconData };
        renderSettingsServerIcon(avatar, serverSnapshot);
        changeIcon.textContent = serverSnapshot.iconData ? "Changer" : "Ajouter une image";
        removeIcon.hidden = !serverSnapshot.iconData;
        iconState.textContent = serverSnapshot.iconData ? "Image enregistrée." : "Image retirée.";
        iconState.classList.add("success");
        window.dispatchEvent(new CustomEvent("people-server-updated", { detail: { server: serverSnapshot } }));
      } catch (err) {
        iconState.textContent = err?.message || "Impossible d’enregistrer l’image.";
        iconState.classList.add("error");
      } finally {
        changeIcon.disabled = !owner;
        removeIcon.disabled = !owner;
        avatar.disabled = !owner;
      }
    }

    avatar.addEventListener("click", () => { if (owner) fileInput.click(); });
    changeIcon.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      try {
        iconState.classList.remove("error", "success");
        iconState.textContent = "Préparation de l’image…";
        const iconData = await prepareServerIcon(file);
        await saveIcon(iconData);
      } catch (err) {
        iconState.textContent = err?.message || "Image invalide.";
        iconState.classList.add("error");
      }
    });
    removeIcon.addEventListener("click", () => void saveIcon(null));

    const form = document.createElement("form");
    form.className = "people-server-settings-name-form";
    form.innerHTML = `
      <label>Nom du serveur</label>
      <input maxlength="40" autocomplete="off" />
      <p>Le nom et l’image sont uniquement l’identité affichée dans People. Le lien d’invitation et l’identifiant du serveur restent inchangés.</p>
      <div class="people-server-settings-save-row">
        <span class="people-server-settings-save-state"></span>
        <button type="submit">Enregistrer</button>
      </div>
    `;

    const input = form.querySelector("input");
    const saveButton = form.querySelector("button");
    const saveState = form.querySelector(".people-server-settings-save-state");
    input.value = server?.name || "";
    input.disabled = !owner;
    saveButton.hidden = !owner;

    if (!owner) saveState.textContent = "Tu n'as pas la permission de gérer le serveur.";

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!owner || !server?.id) return;
      const name = String(input.value || "").trim().replace(/\s+/g, " ");
      if (name.length < 2 || name.length > 40) {
        saveState.textContent = "Le nom doit faire entre 2 et 40 caractères.";
        saveState.classList.add("error");
        return;
      }
      saveButton.disabled = true;
      saveState.classList.remove("error", "success");
      saveState.textContent = "Enregistrement…";
      try {
        const result = await api(`/api/servers/${encodeURIComponent(server.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ name })
        });
        serverSnapshot = { ...serverSnapshot, ...(result.server || { name }) };
        input.value = serverSnapshot.name;
        renderSettingsServerIcon(avatar, serverSnapshot);
        saveState.textContent = "Nom enregistré. L’invitation n’a pas changé.";
        saveState.classList.add("success");
        window.dispatchEvent(new CustomEvent("people-server-updated", { detail: { server: serverSnapshot } }));
      } catch (err) {
        saveState.textContent = err?.message || "Impossible d’enregistrer le nom.";
        saveState.classList.add("error");
      } finally {
        saveButton.disabled = false;
      }
    });

    card.append(iconColumn, form);
    content.appendChild(card);

    const identity = document.createElement("section");
    identity.className = "people-server-settings-card people-server-settings-identity";
    identity.innerHTML = `
      <div>
        <strong>Identité technique</strong>
        <p>Cette valeur identifie le serveur en interne et ne dépend jamais de son nom ou de son image.</p>
      </div>
      <code></code>
    `;
    identity.querySelector("code").textContent = String(server?.id || "—");
    content.appendChild(identity);
  }

  async function createChannel(type) {
    if (!hasPermission("MANAGE_CHANNELS")) {
      throw new Error("Tu n'as pas la permission de gérer les salons.");
    }
    if (!window.PeopleServerChannels?.create) {
      throw new Error("Le gestionnaire de salons n’est pas disponible.");
    }
    await window.PeopleServerChannels.create(type, null);
  }

  function renderChannels(content) {
    content.appendChild(sectionHeader(
      "Salons",
      "Crée les éléments principaux du serveur. L’organisation avancée reste disponible directement dans la liste des salons."
    ));

    const grid = document.createElement("div");
    grid.className = "people-server-settings-action-grid";

    const actions = [
      ["category", "Catégorie", "Range plusieurs salons sous un même groupe.", "＋"],
      ["text", "Salon textuel", "Un espace avec son propre historique de messages.", "#"],
      ["voice", "Salon vocal", "Une room vocale indépendante avec audio, vidéo et écran.", "◉"]
    ];

    for (const [type, title, description, icon] of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "people-server-settings-action";
      button.disabled = !hasPermission("MANAGE_CHANNELS");
      button.innerHTML = `<span class="icon"></span><strong></strong><small></small>`;
      button.querySelector(".icon").textContent = icon;
      button.querySelector("strong").textContent = title;
      button.querySelector("small").textContent = description;
      button.addEventListener("click", async () => {
        try {
          await createChannel(type);
        } catch (err) {
          const message = overlay?.querySelector(".people-server-settings-inline-error");
          if (message) message.textContent = err?.message || "Création impossible.";
        }
      });
      grid.appendChild(button);
    }

    content.appendChild(grid);
    const message = document.createElement("div");
    message.className = "people-server-settings-inline-error";
    if (!hasPermission("MANAGE_CHANNELS")) message.textContent = "Tu n'as pas la permission de gérer les salons.";
    content.appendChild(message);

    const note = document.createElement("section");
    note.className = "people-server-settings-card people-server-settings-note";
    note.innerHTML = `
      <strong>Organisation</strong>
      <p>Tu peux toujours renommer, déplacer et supprimer les catégories, textuels et vocaux depuis leur menu contextuel. Les boutons ＋ des catégories restent disponibles.</p>
    `;
    content.appendChild(note);
  }

  async function renderInvites(content) {
    content.appendChild(sectionHeader(
      "Invitations",
      "Le lien d’invitation appartient au serveur, pas à son nom. Renommer le serveur ne le régénère pas."
    ));

    const card = document.createElement("section");
    card.className = "people-server-settings-card people-server-settings-invite-card";
    card.innerHTML = `
      <label>Lien d’invitation actuel</label>
      <div class="people-server-settings-copy-row">
        <input readonly value="Chargement…" />
        <button type="button">Copier</button>
      </div>
      <p class="people-server-settings-invite-state">Ce lien reste identique quand tu modifies le nom du serveur.</p>
    `;
    content.appendChild(card);

    const input = card.querySelector("input");
    const copy = card.querySelector("button");
    const state = card.querySelector(".people-server-settings-invite-state");

    try {
      const result = await api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/invite`);
      const link = location.origin + result.invitePath;
      input.value = link;
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(link);
          state.textContent = "Lien copié. Il restera le même après un renommage.";
          state.classList.add("success");
        } catch {
          input.select();
          state.textContent = "Sélectionne puis copie le lien.";
        }
      });
    } catch (err) {
      input.value = "Indisponible";
      copy.disabled = true;
      state.textContent = err?.message || "Impossible de charger l’invitation.";
      state.classList.add("error");
    }
  }

  async function renderMembers(content) {
    content.appendChild(sectionHeader(
      "Membres",
      "Consulte les membres, leurs rôles et utilise les actions de modération autorisées par tes permissions."
    ));

    const card = document.createElement("section");
    card.className = "people-server-settings-card people-server-settings-members-card";
    card.innerHTML = `
      <div class="people-server-settings-members-toolbar">
        <div>
          <strong class="people-server-settings-members-count">Membres</strong>
          <small class="people-server-settings-members-online"></small>
        </div>
        <input class="people-server-settings-members-search" type="search" placeholder="Rechercher un membre" autocomplete="off" />
      </div>
      <div class="people-server-settings-members-list" aria-live="polite"></div>
    `;
    content.appendChild(card);

    const list = card.querySelector(".people-server-settings-members-list");
    const search = card.querySelector(".people-server-settings-members-search");
    const count = card.querySelector(".people-server-settings-members-count");
    const online = card.querySelector(".people-server-settings-members-online");

    list.appendChild(statusBox("Chargement des membres…"));

    let members = [];
    try {
      const result = await api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/members`);
      members = Array.isArray(result.members) ? result.members : [];
      const onlineCount = members.filter((member) => member.online).length;
      count.textContent = `${members.length} membre${members.length > 1 ? "s" : ""}`;
      online.textContent = `${onlineCount} en ligne`;
    } catch (err) {
      list.replaceChildren(statusBox(err?.message || "Impossible de charger les membres.", "error"));
      search.disabled = true;
      return;
    }

    const canKick = hasPermission("KICK_MEMBERS");
    const canBan = hasPermission("BAN_MEMBERS");
    const myHighest = Number(serverPermissions?.highestRolePosition || 0);

    function canModerate(member) {
      const id = String(member.id || member.accountId || "");
      if (!id || id === String(currentUserId || "") || member.owner) return false;
      if (serverPermissions?.owner) return true;
      return Number(member.highestRolePosition || 0) < myHighest;
    }

    async function refreshMembers() {
      await renderSection("members");
    }

    function draw() {
      const q = String(search.value || "").trim().toLocaleLowerCase("fr-FR");
      const filtered = members.filter((member) =>
        !q || String(member.username || "").toLocaleLowerCase("fr-FR").includes(q)
      );

      list.replaceChildren();
      if (!filtered.length) {
        list.appendChild(statusBox(q ? "Aucun membre ne correspond à cette recherche." : "Aucun membre."));
        return;
      }

      for (const member of filtered) {
        const row = document.createElement("div");
        row.className = "people-server-settings-member-row";
        if (member.online) row.classList.add("online");

        const avatar = document.createElement("div");
        avatar.className = "people-server-settings-member-avatar";
        avatar.textContent = initials(member.username);

        const identity = document.createElement("div");
        identity.className = "people-server-settings-member-identity";
        const name = document.createElement("strong");
        name.textContent = member.username || "Membre";
        if (/^#[0-9a-f]{6}$/i.test(member.roleColor || "")) name.style.color = member.roleColor;
        const state = document.createElement("span");
        state.textContent = window.PeoplePresence?.label(member.status) || (member.online ? "En ligne" : "Hors ligne");
        identity.append(name, state);

        const badges = document.createElement("div");
        badges.className = "people-server-settings-member-badges";
        for (const role of member.roles || []) {
          const badge = document.createElement("span");
          badge.className = "people-role-badge";
          badge.textContent = role.name;
          if (/^#[0-9a-f]{6}$/i.test(role.color || "")) badge.style.setProperty("--role-color", role.color);
          badges.append(badge);
        }
        if (member.owner) {
          const owner = document.createElement("span");
          owner.className = "people-server-settings-member-badge owner";
          owner.textContent = "Propriétaire";
          badges.appendChild(owner);
        }
        if (String(member.id || member.accountId || "") === String(currentUserId || "")) {
          const you = document.createElement("span");
          you.className = "people-server-settings-member-badge";
          you.textContent = "Toi";
          badges.appendChild(you);
        }

        const actions = document.createElement("div");
        actions.className = "people-server-settings-member-actions";
        const targetId = String(member.id || member.accountId || "");
        const allowedTarget = canModerate(member);
        if (hasPermission("MOVE_MEMBERS") && allowedTarget) {
          const disconnect = document.createElement("button");
          disconnect.type = "button";
          disconnect.textContent = "Déconnecter du vocal";
          disconnect.addEventListener("click", async () => {
            disconnect.disabled = true;
            try {
              await api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/members/${encodeURIComponent(targetId)}/voice`, { method: "DELETE" });
            } catch (err) { alert(err.message); }
            finally { disconnect.disabled = false; }
          });
          actions.append(disconnect);
        }

        if (canKick && allowedTarget) {
          const kick = document.createElement("button");
          kick.type = "button";
          kick.textContent = "Exclure";
          kick.addEventListener("click", async () => {
            if (!confirm(`Exclure ${member.username || "ce membre"} du serveur ?`)) return;
            kick.disabled = true;
            try {
              await api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/members/${encodeURIComponent(targetId)}`, { method: "DELETE" });
              await refreshMembers();
            } catch (err) {
              alert(err?.message || "Impossible d'exclure ce membre.");
              kick.disabled = false;
            }
          });
          actions.appendChild(kick);
        }

        if (canBan && allowedTarget) {
          const ban = document.createElement("button");
          ban.type = "button";
          ban.className = "danger";
          ban.textContent = "Bannir";
          ban.addEventListener("click", async () => {
            const reason = prompt(`Raison du bannissement de ${member.username || "ce membre"} (facultatif) :`, "");
            if (reason === null) return;
            ban.disabled = true;
            try {
              await api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/bans/${encodeURIComponent(targetId)}`, {
                method: "PUT",
                body: JSON.stringify({ reason })
              });
              await refreshMembers();
            } catch (err) {
              alert(err?.message || "Impossible de bannir ce membre.");
              ban.disabled = false;
            }
          });
          actions.appendChild(ban);
        }

        row.append(avatar, identity, badges);
        if (actions.childElementCount) row.appendChild(actions);
        list.appendChild(row);
      }
    }

    search.addEventListener("input", draw);
    draw();

    if (canBan) {
      const bannedCard = document.createElement("section");
      bannedCard.className = "people-server-settings-card people-server-settings-bans-card";
      bannedCard.innerHTML = `
        <div class="people-role-card-title"><strong>Membres bannis</strong><span>Un membre banni ne peut plus rejoindre avec une invitation.</span></div>
        <div class="people-server-settings-bans-list"></div>
      `;
      const bannedList = bannedCard.querySelector(".people-server-settings-bans-list");
      bannedList.appendChild(statusBox("Chargement des bannissements…"));
      content.appendChild(bannedCard);
      try {
        const result = await api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/bans`);
        const bans = Array.isArray(result.bans) ? result.bans : [];
        bannedList.replaceChildren();
        if (!bans.length) {
          bannedList.appendChild(statusBox("Aucun membre banni."));
        } else {
          for (const entry of bans) {
            const row = document.createElement("div");
            row.className = "people-server-settings-ban-row";
            const info = document.createElement("div");
            info.className = "people-server-settings-ban-info";
            const title = document.createElement("strong");
            title.textContent = entry.username || "Utilisateur";
            const reason = document.createElement("span");
            reason.textContent = entry.reason ? `Raison : ${entry.reason}` : "Aucune raison indiquée";
            info.append(title, reason);
            const unban = document.createElement("button");
            unban.type = "button";
            unban.textContent = "Débannir";
            unban.addEventListener("click", async () => {
              if (!confirm(`Débannir ${entry.username || "cet utilisateur"} ?`)) return;
              unban.disabled = true;
              try {
                await api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/bans/${encodeURIComponent(entry.userId)}`, { method: "DELETE" });
                await refreshMembers();
              } catch (err) {
                alert(err?.message || "Impossible de lever ce bannissement.");
                unban.disabled = false;
              }
            });
            row.append(info, unban);
            bannedList.appendChild(row);
          }
        }
      } catch (err) {
        bannedList.replaceChildren(statusBox(err?.message || "Impossible de charger les bannissements.", "error"));
      }
    }
  }

  async function renderRoles(content) {
    content.appendChild(sectionHeader(
      "Rôles et permissions",
      "Crée des rôles hiérarchisés, attribue-les aux membres et définis des exceptions par catégorie ou salon. Le propriétaire garde toujours toutes les permissions."
    ));

    const loading = statusBox("Chargement des rôles…");
    content.appendChild(loading);

    let roleResult;
    let memberResult;
    let channelResult;
    try {
      [roleResult, memberResult, channelResult] = await Promise.all([
        api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/roles`),
        api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/member-roles`),
        api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/channels`)
      ]);
    } catch (err) {
      loading.replaceWith(statusBox(err?.message || "Impossible de charger les permissions.", "error"));
      return;
    }
    loading.remove();

    const roles = Array.isArray(roleResult.roles) ? roleResult.roles : [];
    const permissionDefs = Array.isArray(roleResult.permissions) ? roleResult.permissions : [];
    const members = Array.isArray(memberResult.members) ? memberResult.members : [];
    const channels = Array.isArray(channelResult.channels) ? channelResult.channels : [];
    const me = roleResult.me || serverPermissions || { names: [] };
    serverPermissions = me;
    const canManageRoles = Boolean(me.owner || (Array.isArray(me.names) && me.names.includes("MANAGE_ROLES")));
    const canManageOverrides = Boolean(
      me.owner ||
      (Array.isArray(me.names) && (me.names.includes("MANAGE_ROLES") || me.names.includes("MANAGE_CHANNELS")))
    );

    const createCard = document.createElement("section");
    createCard.className = "people-server-settings-card people-role-create-card";
    createCard.innerHTML = `
      <div class="people-role-card-title"><strong>Créer un rôle</strong><span>Les rôles les plus hauts contrôlent ceux placés en dessous.</span></div>
      <form class="people-role-create-form">
        <input name="name" maxlength="32" placeholder="Nom du rôle" required />
        <input name="color" type="color" value="#67589D" title="Couleur" />
        <button type="submit">Créer</button>
      </form>
      <div class="people-role-inline-state"></div>
    `;
    const createForm = createCard.querySelector("form");
    const createState = createCard.querySelector(".people-role-inline-state");
    if (!canManageRoles) {
      createForm.querySelectorAll("input,button").forEach((node) => { node.disabled = true; });
      createState.textContent = "Tu peux consulter les rôles, mais tu n'as pas la permission de les modifier.";
    }
    createForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!canManageRoles) return;
      const form = new FormData(createForm);
      createState.textContent = "Création…";
      try {
        await api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/roles`, {
          method: "POST",
          body: JSON.stringify({ name: form.get("name"), color: form.get("color"), permissions: [] })
        });
        await renderSection("roles");
      } catch (err) {
        createState.textContent = err?.message || "Impossible de créer le rôle.";
        createState.classList.add("error");
      }
    });
    content.appendChild(createCard);

    const list = document.createElement("div");
    list.className = "people-role-list";
    const sortedRoles = [...roles].sort((a, b) => (Number(b.position || 0) - Number(a.position || 0)) || String(a.name).localeCompare(String(b.name), "fr"));

    for (const role of sortedRoles) {
      const lockedByHierarchy = !me.owner && !role.everyone && Number(role.position || 0) >= Number(me.highestRolePosition || 0);
      const editable = canManageRoles && !lockedByHierarchy;
      const card = document.createElement("section");
      card.className = "people-server-settings-card people-role-card";
      card.dataset.roleId = String(role.id);

      const head = document.createElement("div");
      head.className = "people-role-card-head";
      const dot = document.createElement("span");
      dot.className = "people-role-color-dot";
      dot.style.background = role.color || "#99AAB5";
      const name = document.createElement("input");
      name.className = "people-role-name-input";
      name.value = role.name || "Rôle";
      name.maxLength = 32;
      name.disabled = !editable || role.everyone;
      const color = document.createElement("input");
      color.type = "color";
      color.className = "people-role-color-input";
      color.value = /^#[0-9A-F]{6}$/i.test(role.color || "") ? role.color : "#99AAB5";
      color.disabled = !editable || role.everyone;
      color.addEventListener("input", () => { dot.style.background = color.value; });
      const pos = document.createElement("input");
      pos.type = "number";
      pos.min = "1";
      pos.max = "9999";
      pos.className = "people-role-position-input";
      pos.value = String(role.position || 0);
      pos.title = "Position hiérarchique";
      pos.disabled = !editable || role.everyone;
      const label = document.createElement("div");
      label.className = "people-role-card-heading";
      label.append(dot, name);
      if (role.everyone) {
        const badge = document.createElement("span");
        badge.className = "people-role-system-badge";
        badge.textContent = "Tous les membres";
        label.appendChild(badge);
      }
      head.append(label, color, pos);
      card.appendChild(head);

      if (lockedByHierarchy) {
        const warning = document.createElement("p");
        warning.className = "people-role-hierarchy-warning";
        warning.textContent = "Ce rôle est égal ou supérieur à ton rôle le plus élevé : tu ne peux pas le modifier.";
        card.appendChild(warning);
      }

      const grid = document.createElement("div");
      grid.className = "people-role-permission-grid";
      const current = new Set(Array.isArray(role.permissions) ? role.permissions : []);
      for (const def of permissionDefs) {
        const row = document.createElement("label");
        row.className = "people-role-permission-row";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.value = def.key;
        check.checked = current.has(def.key);
        check.disabled = !editable;
        const text = document.createElement("span");
        text.innerHTML = `<strong></strong><small></small>`;
        text.querySelector("strong").textContent = def.label || def.key;
        text.querySelector("small").textContent = def.group || "Permission";
        row.append(check, text);
        grid.appendChild(row);
      }
      card.appendChild(grid);

      const actions = document.createElement("div");
      actions.className = "people-role-actions";
      const state = document.createElement("span");
      state.className = "people-role-inline-state";
      const save = document.createElement("button");
      save.type = "button";
      save.textContent = "Enregistrer";
      save.disabled = !editable;
      save.addEventListener("click", async () => {
        const permissions = [...grid.querySelectorAll('input[type="checkbox"]:checked')].map((item) => item.value);
        save.disabled = true;
        state.textContent = "Enregistrement…";
        try {
          await api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/roles/${encodeURIComponent(role.id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              ...(role.everyone ? {} : { name: name.value, color: color.value, position: Number(pos.value || role.position || 1) }),
              permissions
            })
          });
          state.textContent = "Enregistré.";
          state.classList.add("success");
          setTimeout(() => void renderSection("roles"), 250);
        } catch (err) {
          state.textContent = err?.message || "Échec de l'enregistrement.";
          state.classList.add("error");
          save.disabled = false;
        }
      });
      actions.append(state, save);
      if (!role.everyone) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger";
        remove.textContent = "Supprimer";
        remove.disabled = !editable;
        remove.addEventListener("click", async () => {
          if (!confirm(`Supprimer le rôle « ${role.name} » ?`)) return;
          try {
            await api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/roles/${encodeURIComponent(role.id)}`, { method: "DELETE" });
            await renderSection("roles");
          } catch (err) {
            state.textContent = err?.message || "Impossible de supprimer le rôle.";
            state.classList.add("error");
          }
        });
        actions.appendChild(remove);
      }
      card.appendChild(actions);
      list.appendChild(card);
    }
    content.appendChild(list);

    const assignment = document.createElement("section");
    assignment.className = "people-server-settings-card people-role-assignment-card";
    assignment.innerHTML = `
      <div class="people-role-card-title"><strong>Attribuer les rôles</strong><span>Un membre peut avoir plusieurs rôles. Les permissions se cumulent.</span></div>
      <select class="people-role-member-select"></select>
      <div class="people-role-member-checks"></div>
      <div class="people-role-actions"><span class="people-role-inline-state"></span><button type="button">Enregistrer les rôles</button></div>
    `;
    const memberSelect = assignment.querySelector(".people-role-member-select");
    const memberChecks = assignment.querySelector(".people-role-member-checks");
    const memberSave = assignment.querySelector("button");
    const memberState = assignment.querySelector(".people-role-inline-state");
    for (const member of members) {
      const option = document.createElement("option");
      option.value = String(member.id);
      option.textContent = `${member.username || "Membre"}${member.owner ? " • propriétaire" : ""}`;
      memberSelect.appendChild(option);
    }
    function drawMemberRoles() {
      memberChecks.replaceChildren();
      const member = members.find((item) => String(item.id) === String(memberSelect.value));
      if (!member) return;
      const assigned = new Set(Array.isArray(member.roleIds) ? member.roleIds.map(String) : []);
      const targetLocked = !me.owner && (member.owner || Number(member.highestRolePosition || 0) >= Number(me.highestRolePosition || 0));
      for (const role of sortedRoles.filter((item) => !item.everyone)) {
        const row = document.createElement("label");
        row.className = "people-role-member-check";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.value = String(role.id);
        check.checked = assigned.has(String(role.id));
        const locked = targetLocked || !canManageRoles || (!me.owner && Number(role.position || 0) >= Number(me.highestRolePosition || 0));
        check.disabled = locked;
        const dot = document.createElement("span");
        dot.className = "people-role-color-dot";
        dot.style.background = role.color || "#99AAB5";
        const text = document.createElement("span");
        text.textContent = role.name;
        row.append(check, dot, text);
        memberChecks.appendChild(row);
      }
      memberSave.disabled = !canManageRoles || targetLocked;
    }
    memberSelect.addEventListener("change", drawMemberRoles);
    drawMemberRoles();
    if (!members.length) memberSave.disabled = true;
    memberSave.addEventListener("click", async () => {
      const memberId = memberSelect.value;
      const roleIds = [...memberChecks.querySelectorAll('input[type="checkbox"]:checked')].map((item) => item.value);
      memberSave.disabled = true;
      memberState.textContent = "Enregistrement…";
      try {
        await api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/members/${encodeURIComponent(memberId)}/roles`, {
          method: "PUT",
          body: JSON.stringify({ roleIds })
        });
        memberState.textContent = "Rôles mis à jour.";
        memberState.classList.add("success");
        setTimeout(() => void renderSection("roles"), 250);
      } catch (err) {
        memberState.textContent = err?.message || "Impossible de modifier les rôles.";
        memberState.classList.add("error");
        memberSave.disabled = false;
      }
    });
    content.appendChild(assignment);

    const overrideCard = document.createElement("section");
    overrideCard.className = "people-server-settings-card people-role-overrides-card";
    overrideCard.innerHTML = `
      <div class="people-role-card-title"><strong>Permissions par salon</strong><span>Une catégorie s'applique d'abord, puis le salon peut la surcharger.</span></div>
      <div class="people-role-override-pickers">
        <select class="people-role-channel-select"></select>
        <select class="people-role-override-role-select"></select>
      </div>
      <div class="people-role-override-grid"></div>
      <div class="people-role-actions"><span class="people-role-inline-state"></span><button class="people-role-reset-override" type="button">Réinitialiser</button><button class="people-role-save-override" type="button">Enregistrer</button></div>
    `;
    const channelSelect = overrideCard.querySelector(".people-role-channel-select");
    const roleSelect = overrideCard.querySelector(".people-role-override-role-select");
    const overrideGrid = overrideCard.querySelector(".people-role-override-grid");
    const overrideState = overrideCard.querySelector(".people-role-inline-state");
    const resetOverride = overrideCard.querySelector(".people-role-reset-override");
    const saveOverride = overrideCard.querySelector(".people-role-save-override");

    for (const channel of channels) {
      const option = document.createElement("option");
      option.value = String(channel.id);
      option.textContent = `${channel.type === "category" ? "▾" : channel.type === "voice" ? "🔊" : "#"} ${channel.name}`;
      channelSelect.appendChild(option);
    }
    for (const role of sortedRoles) {
      const option = document.createElement("option");
      option.value = String(role.id);
      option.textContent = role.name;
      roleSelect.appendChild(option);
    }

    async function drawOverrides() {
      overrideGrid.replaceChildren();
      overrideState.textContent = "";
      if (!channelSelect.value || !roleSelect.value) return;
      let currentOverride = null;
      try {
        const result = await api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/permission-overrides?channelId=${encodeURIComponent(channelSelect.value)}`);
        currentOverride = (result.overrides || []).find((item) => String(item.roleId) === String(roleSelect.value)) || null;
      } catch (err) {
        overrideState.textContent = err?.message || "Impossible de charger ces permissions.";
        overrideState.classList.add("error");
        return;
      }
      const allow = new Set(Array.isArray(currentOverride?.allow) ? currentOverride.allow : []);
      const deny = new Set(Array.isArray(currentOverride?.deny) ? currentOverride.deny : []);
      for (const def of permissionDefs) {
        const row = document.createElement("label");
        row.className = "people-role-override-row";
        const text = document.createElement("span");
        text.textContent = def.label || def.key;
        const select = document.createElement("select");
        select.dataset.permission = def.key;
        select.innerHTML = '<option value="inherit">Hériter</option><option value="allow">Autoriser</option><option value="deny">Refuser</option>';
        select.value = allow.has(def.key) ? "allow" : deny.has(def.key) ? "deny" : "inherit";
        select.disabled = !canManageOverrides;
        row.append(text, select);
        overrideGrid.appendChild(row);
      }
    }
    channelSelect.addEventListener("change", () => void drawOverrides());
    roleSelect.addEventListener("change", () => void drawOverrides());
    saveOverride.disabled = !canManageOverrides || !channels.length || !roles.length;
    resetOverride.disabled = saveOverride.disabled;
    saveOverride.addEventListener("click", async () => {
      const allow = [];
      const deny = [];
      for (const select of overrideGrid.querySelectorAll("select[data-permission]")) {
        if (select.value === "allow") allow.push(select.dataset.permission);
        if (select.value === "deny") deny.push(select.dataset.permission);
      }
      saveOverride.disabled = true;
      overrideState.textContent = "Enregistrement…";
      try {
        await api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/channels/${encodeURIComponent(channelSelect.value)}/role-overrides/${encodeURIComponent(roleSelect.value)}`, {
          method: "PUT",
          body: JSON.stringify({ allow, deny })
        });
        overrideState.textContent = "Permissions du salon enregistrées.";
        overrideState.classList.add("success");
        saveOverride.disabled = false;
      } catch (err) {
        overrideState.textContent = err?.message || "Impossible d'enregistrer ces permissions.";
        overrideState.classList.add("error");
        saveOverride.disabled = false;
      }
    });
    resetOverride.addEventListener("click", async () => {
      if (!channelSelect.value || !roleSelect.value) return;
      try {
        await api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/channels/${encodeURIComponent(channelSelect.value)}/role-overrides/${encodeURIComponent(roleSelect.value)}`, { method: "DELETE" });
        await drawOverrides();
        overrideState.textContent = "Permissions héritées rétablies.";
        overrideState.classList.add("success");
      } catch (err) {
        overrideState.textContent = err?.message || "Impossible de réinitialiser ces permissions.";
        overrideState.classList.add("error");
      }
    });
    content.appendChild(overrideCard);
    if (channels.length && roles.length) await drawOverrides();
  }


  function renderPlaceholderSection(content, id) {
    const definitions = {
      roles: ["Rôles et permissions", "Rôles personnalisés et permissions globales ou propres à chaque salon."],
      moderation: ["Modération", "Outils de sécurité, journal d’actions et paramètres de modération."]
    };
    const [title, description] = definitions[id] || ["Paramètres", "Cette section sera ajoutée plus tard."];
    content.appendChild(sectionHeader(title, description));
    content.appendChild(placeholder(title, description));
  }

  async function renderSection(id) {
    if (!overlay) return;
    activeSection = id;
    overlay.querySelectorAll(".people-server-settings-nav-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.section === id);
    });

    const content = overlay.querySelector(".people-server-settings-content");
    content.replaceChildren();

    if (id === "overview") await renderOverview(content);
    else if (id === "channels") renderChannels(content);
    else if (id === "members") await renderMembers(content);
    else if (id === "invites") await renderInvites(content);
    else if (id === "roles") await renderRoles(content);
    else if (id === "moderation") {
      await renderMembers(content);
      if (hasPermission("MANAGE_SERVER")) {
        content.append(sectionHeader("Journal d’administration", "Les dernières actions effectuées sur le serveur."));
        try {
          const result = await api(`/api/servers/${encodeURIComponent(serverSnapshot.id)}/audit`);
          const actions = { POST: "Création", PUT: "Modification", PATCH: "Modification", DELETE: "Suppression / retrait" };
          if (!result.entries.length) content.append(statusBox("Aucune action enregistrée."));
          for (const entry of result.entries) {
            const row = document.createElement("div");
            row.className = "people-server-settings-card";
            const kind = entry.path.includes("/roles") ? "rôle" : entry.path.includes("/bans") ? "bannissement" : entry.path.includes("/voice") ? "connexion vocale" : entry.path.includes("/members") ? "membre" : entry.path.includes("/channels") ? "salon" : "serveur";
            row.textContent = `${new Date(entry.created_at).toLocaleString("fr-FR")} · ${entry.actor_name} · ${actions[entry.method] || entry.method} : ${kind}`;
            content.append(row);
          }
        } catch (err) { content.append(statusBox(err.message, "error")); }
      }
    } else renderPlaceholderSection(content, id);
  }

  async function openSettings() {
    const server = activeServer();
    if (!server?.id) return;

    serverSnapshot = { ...server };
    if (!currentUserId) {
      try {
        const me = await api("/api/auth/me");
        currentUserId = me?.user?.id ? String(me.user.id) : null;
      } catch {}
    }

    try {
      const permissionResult = await api(`/api/servers/${encodeURIComponent(server.id)}/permissions/me`);
      serverPermissions = permissionResult?.permissions || { mask: 0, names: [], owner: false, highestRolePosition: 0 };
    } catch {
      serverPermissions = { mask: 0, names: [], owner: isOwner(server), highestRolePosition: 0 };
    }

    closeSettings();
    serverSnapshot = { ...server };

    overlay = document.createElement("div");
    overlay.className = "people-server-settings-overlay";
    overlay.innerHTML = `
      <div class="people-server-settings-shell" role="dialog" aria-modal="true" aria-label="Paramètres du serveur">
        <aside class="people-server-settings-sidebar">
          <div class="people-server-settings-server-label">
            <span class="server-avatar"></span>
            <div><strong></strong><small>PARAMÈTRES DU SERVEUR</small></div>
          </div>
          <nav class="people-server-settings-nav"></nav>
        </aside>
        <main class="people-server-settings-main">
          <button class="people-server-settings-close" type="button" aria-label="Fermer">✕<span>ESC</span></button>
          <div class="people-server-settings-content"></div>
        </main>
      </div>
    `;

    const label = overlay.querySelector(".people-server-settings-server-label");
    renderSettingsServerIcon(label.querySelector(".server-avatar"), server);
    label.querySelector("strong").textContent = server.name;

    const nav = overlay.querySelector(".people-server-settings-nav");
    for (const section of SECTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "people-server-settings-nav-button";
      button.dataset.section = section.id;
      button.textContent = section.label;
      button.addEventListener("click", () => void renderSection(section.id));
      nav.appendChild(button);
    }

    overlay.querySelector(".people-server-settings-close").addEventListener("click", closeSettings);
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) closeSettings();
    });

    document.body.appendChild(overlay);
    document.body.classList.add("people-server-settings-open");
    void renderSection(activeSection || "overview");
  }
  // Branchement gere par le correctif dynamique plus bas.

  window.addEventListener("people-authenticated", (event) => {
    currentUserId = event.detail?.id ? String(event.detail.id) : currentUserId;
  });

  window.addEventListener("people-server-updated", (event) => {
    const updated = event.detail?.server;
    if (!updated?.id || !serverSnapshot?.id) return;
    if (String(updated.id) !== String(serverSnapshot.id)) return;
    serverSnapshot = { ...serverSnapshot, ...updated };
    if (overlay) {
      const label = overlay.querySelector(".people-server-settings-server-label");
      if (label) {
        renderSettingsServerIcon(label.querySelector(".server-avatar"), serverSnapshot);
        label.querySelector("strong").textContent = serverSnapshot.name;
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay) {
      closeSettings();
    }
  });


  // === PEOPLE_SERVER_SETTINGS_GEAR_FIX_V1_RUNTIME_START ===
  function buildSettingsGearButton() {
    const existing = document.getElementById("serverSettingsButton");
    if (existing) return existing;

    const oldCreateButton = document.getElementById("serverChannelCreateButton");
    const inviteButton =
      document.getElementById("serverInviteButton") ||
      document.querySelector('[data-action="server-invite"]') ||
      document.querySelector('button[aria-label*="invitation" i]') ||
      document.querySelector('button[title*="invitation" i]') ||
      document.querySelector('button[aria-label*="invite" i]') ||
      document.querySelector('button[title*="invite" i]');

    const host =
      oldCreateButton?.parentElement ||
      inviteButton?.parentElement ||
      document.querySelector(".server-header-actions") ||
      document.querySelector(".server-title-actions") ||
      document.querySelector(".server-actions");

    if (!host) return null;

    const button = document.createElement("button");
    button.id = "serverSettingsButton";
    button.type = "button";
    button.className = "server-invite-button people-server-settings-button";
    button.title = "Parametres du serveur";
    button.setAttribute("aria-label", "Parametres du serveur");
    button.innerHTML = [
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
      '<path d="M19.14 12.94a7.6 7.6 0 0 0 .05-.94 7.6 7.6 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.4 7.4 0 0 0-1.63-.95L14.38 2.8a.5.5 0 0 0-.5-.4h-3.76a.5.5 0 0 0-.5.4l-.36 2.51c-.58.25-1.12.57-1.63.95L5.24 5.3a.5.5 0 0 0-.61.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.6 7.6 0 0 0-.05.94c0 .32.02.63.05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96c.51.39 1.05.71 1.63.95l.36 2.51a.5.5 0 0 0 .5.4h3.76a.5.5 0 0 0 .5-.4l.36-2.51c.58-.24 1.12-.56 1.63-.95l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"/>',
      '</svg>'
    ].join("");

    if (oldCreateButton?.parentElement) {
      // Comportement demande: la roue remplace l'ancien +.
      oldCreateButton.replaceWith(button);
    } else if (inviteButton?.parentElement === host) {
      // Sinon elle apparait juste a gauche du bouton d'invitation.
      host.insertBefore(button, inviteButton);
    } else {
      host.appendChild(button);
    }

    return button;
  }

  function bindSettingsGearButton() {
    const button = buildSettingsGearButton();
    if (!button) return false;
    settingsButton = button;
    if (button.dataset.peopleServerSettingsBound === "1") return true;
    button.dataset.peopleServerSettingsBound = "1";
    button.addEventListener("click", () => void openSettings());
    return true;
  }

  bindSettingsGearButton();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindSettingsGearButton, { once: true });
  }

  // Certaines vues People sont reconstruites dynamiquement: si l'en-tete revient,
  // la roue revient aussi sans recharger toute l'application.
  const gearObserver = new MutationObserver(() => {
    bindSettingsGearButton();
  });
  if (document.body) {
    gearObserver.observe(document.body, { childList: true, subtree: true });
  }
  // === PEOPLE_SERVER_SETTINGS_GEAR_FIX_V1_RUNTIME_END ===
})();

/* people-server-wheel-align-v2-start */
(function ensureServerHeaderActionAlignmentV2(){
  function apply(){
    try {
      const settingsBtn = document.getElementById('serverSettingsButton');
      if (!settingsBtn) return;
      const parent = settingsBtn.parentElement;
      if (parent) {
        parent.style.display = 'flex';
        parent.style.alignItems = 'center';
        parent.style.justifyContent = 'flex-end';
        parent.style.gap = '8px';
      }

      const inviteBtn = document.getElementById('serverInviteButton')
        || (parent ? parent.querySelector('[data-server-invite], .server-invite-button, .invite-button, button[title*="invitation" i], button[aria-label*="invitation" i]') : null);

      for (const btn of [settingsBtn, inviteBtn]) {
        if (!btn) continue;
        Object.assign(btn.style, {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '34px',
          height: '34px',
          minWidth: '34px',
          minHeight: '34px',
          padding: '0',
          margin: '0',
          top: 'auto',
          bottom: 'auto',
          left: 'auto',
          right: 'auto',
          transform: 'none',
          verticalAlign: 'middle',
          lineHeight: '1',
          position: 'relative',
          alignSelf: 'center'
        });
      }
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
  window.addEventListener('resize', apply);
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
/* people-server-wheel-align-v2-end */
