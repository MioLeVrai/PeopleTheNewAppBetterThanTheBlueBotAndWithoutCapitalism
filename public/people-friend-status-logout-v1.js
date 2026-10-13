/* PEOPLE_FRIEND_STATUS_LOGOUT_V1: friend labels and themed logout control. */
(() => {
  "use strict";

  const friends = document.getElementById("friendsList");
  const labels = Object.freeze({
    online: "Online",
    idle: "Idle",
    dnd: "Do Not Disturb",
    invisible: "Offline",
    offline: "Offline"
  });

  // Observe the existing avatar presence, which is already synced by People.
  // This does not create a second presence store or extra network requests.
  if (friends) {
    let queued = false;
    function syncFriendLabels() {
      for (const row of friends.querySelectorAll(".people-card")) {
        const avatar = row.querySelector(".people-card-avatar");
        const copy = row.querySelector(".people-card-copy");
        if (!avatar || !copy) continue;
        const username = row.dataset.username || "";
        const current = avatar.dataset.peoplePresence ||
          window.PeopleAvatarPresence?.status(username) || "offline";
        const label = labels[current] || labels.offline;
        let line = copy.querySelector(".people-friend-status-label");
        if (!line) {
          line = document.createElement("span");
          line.className = "people-friend-status-label";
          copy.appendChild(line);
        }
        if (line.textContent !== label) line.textContent = label;
      }
    }
    function schedule() {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        syncFriendLabels();
      });
    }
    new MutationObserver(schedule).observe(friends, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-people-presence"]
    });
    syncFriendLabels();
  }

  // Replace the fixed orange emoji with a monochrome, theme-colored icon.
  // The original button and its click/logout behavior remain unchanged.
  const logout = document.getElementById("logoutButton");
  if (logout && !logout.querySelector("svg")) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.9");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M10 17l5-5-5-5M15 12H3M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6");
    svg.appendChild(path);
    logout.replaceChildren(svg);
  }
})();
