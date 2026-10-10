(() => {
  "use strict";
  const labels = { online: "En ligne", idle: "Absent", dnd: "Ne pas déranger", invisible: "Invisible", offline: "Hors ligne" };
  let roster = new Map();
  const callPresence = document.createElement("section");
  callPresence.setAttribute("aria-label", "Utilisateurs en double appel");
  callPresence.setAttribute("aria-live", "polite");
  callPresence.hidden = true;
  document.querySelector(".profile")?.after(callPresence);
  window.peopleSocket?.on("people-call-presence", states => {
    callPresence.replaceChildren();
    for (const state of states || []) {
      if (!state.doubleCall) continue;
      const row = document.createElement("p");
      row.textContent = `${state.username} — En double appel`;
      if (state.interlocutors?.length) row.textContent += ` avec ${state.interlocutors.join(", ")}`;
      callPresence.append(row);
    }
    callPresence.hidden = !callPresence.childElementCount;
  });
  window.peopleSocket?.on("disconnect", () => { callPresence.replaceChildren(); callPresence.hidden = true; });
  let serverId = null;
  let currentUser = null;
  let visibleProfile = null;
  let frame = 0;
  const key = value => String(value || "").toLocaleLowerCase("fr-FR");
  const color = value => /^#[0-9a-f]{6}$/i.test(value || "") ? value : "";
  const label = status => labels[status] || labels.offline;

  function paintNames() {
    frame = 0;
    document.querySelectorAll('#peopleMain .people-profile-name-trigger, .sidebar .people-profile-name-trigger').forEach(node => {
      const member = roster.get(key(node.dataset.peopleProfileUsername));
      const next = color(member?.roleColor);
      if (node.style.color !== next) node.style.color = next;
    });
  }
  function schedulePaint() {
    if (!frame) frame = requestAnimationFrame(paintNames);
  }
  function setRoster(users) {
    roster = new Map((Array.isArray(users) ? users : []).map(user => [key(user.username), user]));
    schedulePaint();
    const member = roster.get(key(visibleProfile?.username));
    if (member && visibleProfile?.serverMember?.serverId === serverId) {
      renderProfile({ ...visibleProfile, serverMember: { ...visibleProfile.serverMember, roles: member.roles, roleColor: member.roleColor } });
    }
  }
  function renderProfile(profile) {
    visibleProfile = profile;
    const name = document.getElementById("profileModalName");
    if (name) name.style.color = color(profile.serverMember?.roleColor);
    let wrap = document.getElementById("peopleProfileRoles");
    if (!wrap) {
      wrap = document.createElement("section");
      wrap.id = "peopleProfileRoles";
      wrap.className = "people-profile-roles";
      document.getElementById("profileModalOnline")?.closest(".profile-card-head")?.after(wrap);
    }
    wrap.replaceChildren();
    wrap.hidden = !profile.serverMember;
    if (!profile.serverMember) return;
    const title = document.createElement("strong");
    title.textContent = "Rôles sur ce serveur";
    wrap.append(title);
    const roles = profile.serverMember.roles || [];
    if (profile.serverMember.owner) {
      const owner = document.createElement("span");
      owner.className = "people-role-badge";
      owner.textContent = "Propriétaire";
      wrap.append(owner);
    }
    for (const role of roles) {
      const badge = document.createElement("span");
      badge.className = "people-role-badge";
      badge.style.setProperty("--role-color", color(role.color) || "#99AAB5");
      badge.textContent = role.name;
      wrap.append(badge);
    }
    if (!roles.length && !profile.serverMember.owner) {
      const empty = document.createElement("span");
      empty.textContent = "Aucun rôle attribué";
      wrap.append(empty);
    }
  }

  const select = document.createElement("select");
  select.id = "peoplePresenceSelect";
  select.className = "people-presence-select";
  select.setAttribute("aria-label", "Ton statut");
  for (const status of ["online", "idle", "dnd", "invisible"]) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = label(status);
    select.append(option);
  }
  const feedback = document.createElement("span");
  feedback.className = "people-presence-feedback";
  feedback.setAttribute("role", "status");
  const controls = document.createElement("div");
  controls.className = "people-presence-controls";
  controls.append(select, feedback);
  document.querySelector(".profile")?.append(controls);
  async function syncPreference() {
    try {
      const response = await fetch("/api/presence/me", { credentials: "same-origin" });
      if (!response.ok) return;
      const data = await response.json();
      select.value = data.status;
      select.dataset.saved = data.status;
    } catch {}
  }
  select.addEventListener("change", async () => {
    select.disabled = true;
    feedback.textContent = "";
    try {
      const response = await fetch("/api/presence/me", {
        method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: select.value })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Statut non enregistré.");
      select.dataset.saved = data.status;
    } catch (err) {
      select.value = select.dataset.saved || "online";
      feedback.textContent = err.message;
    } finally { select.disabled = false; }
  });
  window.addEventListener("people-authenticated", event => {
    currentUser = event.detail;
    void syncPreference();
  });
  window.addEventListener("people-server-channel-state", event => {
    if (serverId !== event.detail?.serverId) {
      serverId = event.detail?.serverId;
      setRoster([]);
      if (visibleProfile?.serverMember && visibleProfile.serverMember.serverId !== serverId) {
        renderProfile({ ...visibleProfile, serverMember: null });
      }
    }
  });
  window.peopleSocket?.on("people-presence-changed", data => {
    if (String(data.accountId) === String(currentUser?.id)) void syncPreference();
  });
  window.PeoplePresence = { label, setRoster, renderProfile, get doNotDisturb() { return select.value === "dnd"; } };
  new MutationObserver(schedulePaint).observe(document.getElementById("peopleMain") || document.body, { childList: true, subtree: true });

  // The visual viewport follows the keyboard on iOS and Android.
  function updateViewport() {
    const height = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty("--people-viewport-height", `${Math.round(height)}px`);
  }
  window.visualViewport?.addEventListener("resize", updateViewport);
  window.addEventListener("resize", updateViewport);
  updateViewport();

  let installPrompt = null;
  const install = document.createElement("button");
  install.type = "button";
  install.className = "people-install-app";
  install.textContent = "Installer People";
  install.hidden = true;
  controls.append(install);
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    install.hidden = false;
  });
  install.addEventListener("click", async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    install.hidden = true;
  });
  window.addEventListener("appinstalled", () => { install.hidden = true; installPrompt = null; });
})();
