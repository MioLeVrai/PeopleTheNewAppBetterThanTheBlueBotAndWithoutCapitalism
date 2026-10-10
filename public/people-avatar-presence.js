/* One public presence store and one avatar decoration for every surface. */
(() => {
  "use strict";
  const states = new Map(), revisions = new Map(), observed = new Set();
  const key = name => String(name || "").trim().toLocaleLowerCase("fr-FR");
  const labels = { online: "Online", idle: "Idle", dnd: "Do Not Disturb", offline: "Offline" };
  let epoch = 0, timer = 0, loading = false;
  const sizes = new ResizeObserver(entries => {
    for (const { target, contentRect } of entries) {
      target.style.setProperty("--presence-size", `${Math.max(8, Math.min(24, contentRect.width * .3))}px`);
    }
  });
  function surface(element) {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const bg = getComputedStyle(parent).backgroundColor;
      if (bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return bg;
    }
    return getComputedStyle(document.body).backgroundColor;
  }
  function paint(element) {
    const status = states.get(key(element.dataset.peopleAvatarUsername))?.status || "offline";
    element.dataset.peoplePresence = status;
    element.dataset.peoplePresenceLabel = labels[status];
    element.style.setProperty("--presence-surface", surface(element));
    if (!observed.has(element)) { observed.add(element); sizes.observe(element); }
  }
  function paintAll() {
    for (const element of observed) if (!element.isConnected) { sizes.unobserve(element); observed.delete(element); }
    document.querySelectorAll("[data-people-avatar-username]").forEach(paint);
  }
  function update(user) {
    if (!user.username) return;
    const name = key(user.username);
    const status = labels[user.status] ? user.status : "offline";
    states.set(name, { status, accountId: String(user.accountId || user.id || "") });
    revisions.set(name, (revisions.get(name) || 0) + 1);
  }
  async function refresh() {
    timer = 0;
    if (loading || !window.peopleSocket?.connected) return;
    const names = [...new Set([...document.querySelectorAll("[data-people-avatar-username]")].map(el => el.dataset.peopleAvatarUsername))].filter(name => !states.has(key(name)));
    if (!names.length) return;
    loading = true;
    const generation = epoch;
    try {
      for (let i = 0; i < names.length; i += 100) {
        const batch = names.slice(i, i + 100);
        const before = new Map(batch.map(name => [key(name), revisions.get(key(name)) || 0]));
        const response = await fetch("/api/presence/avatars", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usernames: batch }) });
        if (!response.ok) return;
        const data = await response.json();
        if (generation !== epoch) return;
        for (const user of data.users || []) if ((revisions.get(key(user.username)) || 0) === before.get(key(user.username))) update(user);
      }
    } catch (error) { console.warn("[People presence] Unable to refresh avatars", error); }
    finally { loading = false; paintAll(); if (generation !== epoch) schedule(); }
  }
  function schedule() { if (!timer) timer = setTimeout(refresh, 60); }
  function reset() { epoch++; states.clear(); revisions.clear(); paintAll(); schedule(); }
  window.peopleSocket?.on("people-presence-changed", user => {
    if (!user.username) {
      for (const [username, state] of states) if (state.accountId === String(user.accountId)) update({ ...user, username });
    } else update(user);
    paintAll();
  });
  window.peopleSocket?.on("online-users", users => { (users || []).forEach(update); paintAll(); });
  window.peopleSocket?.on("disconnect", reset);
  window.peopleSocket?.on("people-ready", reset);
  window.addEventListener("people-authenticated", reset);
  new MutationObserver(() => { paintAll(); schedule(); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-people-avatar-username", "data-people-theme"] });
  window.PeopleAvatarPresence = { refresh: reset, status: username => states.get(key(username))?.status || "offline" };
  paintAll(); schedule();
})();
