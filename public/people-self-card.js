/* PEOPLE_SELF_CARD_V1: profile preview + existing presence controls, no new presence API. */
(() => {
  "use strict";

  const avatarButton = document.getElementById("avatar");
  const profileButton = document.getElementById("profileInfoButton");
  const profileName = document.getElementById("profileName");
  const presenceSelect = document.getElementById("peoplePresenceSelect");
  const presenceControls = presenceSelect?.closest(".people-presence-controls");
  if (!avatarButton || !profileButton || !profileName || !presenceSelect || !presenceControls) {
    console.warn("[People self card] Profile/presence controls unavailable: keeping original UI.");
    return;
  }
  if (document.getElementById("peopleSelfCard")) return;

  const statusLabels = {
    online: "Online", idle: "Idle", dnd: "Do Not Disturb", invisible: "Invisible"
  };
  const statusNames = Object.keys(statusLabels);
  const card = document.createElement("section");
  card.id = "peopleSelfCard";
  card.className = "people-self-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "My profile");
  card.setAttribute("aria-modal", "false");
  card.tabIndex = -1;
  card.hidden = true;
  card.innerHTML = `
    <div class="people-self-card__banner" aria-hidden="true"></div>
    <div class="people-self-card__identity">
      <div class="people-self-card__avatar" aria-hidden="true"></div>
      <strong class="people-self-card__name"></strong>
      <span class="people-self-card__handle"></span>
      <div class="people-self-card__bio" hidden></div>
    </div>
    <div class="people-self-card__actions">
      <button class="people-self-card__action" id="peopleSelfEdit" type="button">Edit Profile <span aria-hidden="true">›</span></button>
      <button class="people-self-card__action" id="peopleSelfStatusToggle" type="button" aria-expanded="false" aria-controls="peopleSelfStatusOptions"><span class="people-self-card__choice"><i class="people-self-card__dot" aria-hidden="true"></i><span id="peopleSelfStatusLabel">Online</span></span><span aria-hidden="true">›</span></button>
      <div class="people-self-card__status-options" id="peopleSelfStatusOptions" hidden aria-label="Choose a status"></div>
      <div class="people-self-card__native"></div>
    </div>`;
  document.body.append(card);

  // Move, rather than copy, the existing select and its controls: its original
  // change listener is the one that persists status changes to the backend.
  card.querySelector(".people-self-card__native").append(presenceControls);
  const avatarPreview = card.querySelector(".people-self-card__avatar");
  const namePreview = card.querySelector(".people-self-card__name");
  const handlePreview = card.querySelector(".people-self-card__handle");
  const bioPreview = card.querySelector(".people-self-card__bio");
  const labelPreview = card.querySelector("#peopleSelfStatusLabel");
  const dotPreview = card.querySelector(".people-self-card__dot");
  const statusToggle = card.querySelector("#peopleSelfStatusToggle");
  const statusOptions = card.querySelector("#peopleSelfStatusOptions");
  const editButton = card.querySelector("#peopleSelfEdit");
  const statusFeedback = presenceControls.querySelector(".people-presence-feedback");
  let lastTrigger = null;
  let profileRequest = null;
  let pendingStatus = null;

  function selectedStatus() {
    const saved = presenceSelect.dataset.saved;
    return statusNames.includes(saved) ? saved :
      (statusNames.includes(presenceSelect.value) ? presenceSelect.value : "online");
  }

  function reflectStatus() {
    const status = selectedStatus();
    labelPreview.textContent = presenceSelect.disabled ? "Updating status..." : statusLabels[status];
    dotPreview.dataset.status = status;
    for (const button of statusOptions.querySelectorAll("button[data-status]")) {
      button.setAttribute("aria-pressed", String(button.dataset.status === status));
      button.disabled = presenceSelect.disabled;
    }
    if (pendingStatus && !presenceSelect.disabled) {
      if (presenceSelect.dataset.saved === pendingStatus) {
        pendingStatus = null;
        closeCard();
      } else {
        pendingStatus = null;
      }
    }
  }

  for (const status of statusNames) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "people-self-card__option";
    option.dataset.status = status;
    const dot = document.createElement("i");
    dot.className = "people-self-card__dot";
    dot.dataset.status = status;
    dot.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = statusLabels[status];
    option.append(dot, label);
    option.addEventListener("click", () => {
      if (presenceSelect.disabled) return;
      if (selectedStatus() === status) { closeCard(); return; }
      pendingStatus = status;
      presenceSelect.value = status;
      presenceSelect.dispatchEvent(new Event("change", { bubbles: true }));
      reflectStatus();
    });
    statusOptions.append(option);
  }

  /* PEOPLE_PROFILE_LAYOUT_V2: anchor the popup flush to the sidebar footer. */
  function positionCard() {
    if (card.hidden) return;
    const sidebar = profileButton.closest(".sidebar");
    const footer = profileButton.closest(".profile");
    const anchor = footer || lastTrigger || profileButton;
    const rect = anchor.getBoundingClientRect();
    const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : rect;
    const gap = 6;
    const viewportWidth = Math.max(1, window.innerWidth);
    const width = Math.min(
      Math.max(220, sidebarRect.width - gap * 2),
      Math.max(1, viewportWidth - gap * 2)
    );
    card.style.width = `${Math.round(width)}px`;
    // Reserve a visible gap above the footer. This also works when the
    // biography or status options make the card grow after it opens.
    const footerGap = 12;
    card.style.maxHeight = `${Math.max(80, Math.floor(rect.top - footerGap - 6))}px`;
    const height = card.getBoundingClientRect().height;
    const left = Math.max(gap, Math.min(sidebarRect.left + gap, viewportWidth - gap - width));
    const top = Math.max(6, rect.top - height - footerGap);
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  }

  /* PEOPLE_PROFILE_POSITION_V3: follow async changes to the card height. */
  let pendingCardPosition = false;
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => {
      if (card.hidden || pendingCardPosition) return;
      pendingCardPosition = true;
      requestAnimationFrame(() => {
        pendingCardPosition = false;
        if (!card.hidden) positionCard();
      });
    }).observe(card);
  }

  function closeCard({ returnFocus = false } = {}) {
    if (card.hidden) return;
    card.hidden = true;
    statusOptions.hidden = true;
    statusToggle.setAttribute("aria-expanded", "false");
    for (const trigger of [avatarButton, profileButton]) trigger.setAttribute("aria-expanded", "false");
    if (profileRequest) { profileRequest.abort(); profileRequest = null; }
    if (returnFocus) lastTrigger?.focus();
  }

  async function loadBio(username) {
    if (profileRequest) profileRequest.abort();
    const controller = new AbortController();
    profileRequest = controller;
    try {
      const response = await fetch(`/api/profile/${encodeURIComponent(username)}`, {
        credentials: "same-origin", signal: controller.signal
      });
      if (!response.ok) return;
      const data = await response.json();
      if (controller.signal.aborted || card.hidden || !data?.profile?.isSelf) return;
      const description = String(data.profile.description || "").trim();
      bioPreview.textContent = description;
      bioPreview.hidden = !description;
      positionCard();
    } catch (error) {
      if (error.name !== "AbortError") console.warn("[People self card] Bio unavailable.");
    } finally {
      if (profileRequest === controller) profileRequest = null;
    }
  }

  function showCard(trigger) {
    if (!card.hidden) { closeCard(); return; }
    lastTrigger = trigger;
    const username = profileName.textContent.trim();
    namePreview.textContent = username;
    handlePreview.textContent = username ? `@${username}` : "";
    bioPreview.hidden = true;
    bioPreview.textContent = "";
    avatarPreview.replaceChildren();
    // Use the actual profile avatar artwork, without duplicating its listeners.
    const image = avatarButton.querySelector("img");
    if (image) avatarPreview.append(image.cloneNode(true));
    else avatarPreview.textContent = avatarButton.textContent.trim() || "?";
    statusOptions.hidden = true;
    statusToggle.setAttribute("aria-expanded", "false");
    reflectStatus();
    card.hidden = false;
    for (const button of [avatarButton, profileButton]) button.setAttribute("aria-expanded", "true");
    positionCard();
    card.focus({ preventScroll: true });
    if (username) void loadBio(username);
  }

  function interceptProfileClick(event) {
    event.preventDefault();
    event.stopImmediatePropagation(); // Stop the previous direct-to-editor click listener.
    showCard(event.currentTarget);
  }
  for (const trigger of [avatarButton, profileButton]) {
    trigger.setAttribute("aria-controls", "peopleSelfCard");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("title", "My Profile");
    trigger.setAttribute("aria-label", "My Profile");
    trigger.addEventListener("click", interceptProfileClick, true);
  }

  editButton.addEventListener("click", () => {
    const username = profileName.textContent.trim();
    closeCard();
    if (username) window.dispatchEvent(new CustomEvent("people-open-profile", { detail: { username } }));
  });
  statusToggle.addEventListener("click", () => {
    statusOptions.hidden = !statusOptions.hidden;
    statusToggle.setAttribute("aria-expanded", String(!statusOptions.hidden));
    positionCard();
    if (!statusOptions.hidden) statusOptions.querySelector("button[aria-pressed='true']")?.focus();
  });
  document.addEventListener("pointerdown", event => {
    if (!card.hidden && !card.contains(event.target) &&
        !avatarButton.contains(event.target) && !profileButton.contains(event.target)) closeCard();
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !card.hidden) {
      event.preventDefault();
      closeCard({ returnFocus: true });
    }
  });
  window.addEventListener("resize", positionCard);
  window.addEventListener("scroll", () => { if (!card.hidden) positionCard(); }, true);
  new MutationObserver(reflectStatus).observe(presenceSelect, {
    attributes: true, attributeFilter: ["data-saved", "disabled"]
  });
  // Keep the original async PUT error feedback visible inside the card.
  if (statusFeedback) statusFeedback.setAttribute("aria-live", "polite");
  reflectStatus();
})();