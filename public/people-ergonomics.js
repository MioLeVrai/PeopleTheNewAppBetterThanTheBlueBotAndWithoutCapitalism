(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const shell = $("#peopleAppShell");
  if (!shell) return;
  const normalize = value => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").trim();
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "people-quick-launch";
  launcher.innerHTML = '<span>⌕ <span class="people-quick-label">Rechercher</span></span><kbd>Ctrl K</kbd>';
  launcher.title = "Retrouver un serveur, un salon ou une conversation (Ctrl / ⌘ K)";
  launcher.setAttribute("aria-label", "Rechercher un serveur, un salon ou une conversation");
  launcher.setAttribute("aria-haspopup", "dialog");
  $(".sidebar").prepend(launcher);

  const dialog = document.createElement("dialog");
  dialog.className = "people-quick-dialog";
  dialog.setAttribute("aria-labelledby", "peopleQuickTitle");
  dialog.innerHTML = `<div class="people-quick-head"><h2 id="peopleQuickTitle">Où veux-tu aller ?</h2><button type="button" aria-label="Fermer la recherche">✕</button></div>
    <label class="people-sr-only" for="peopleQuickInput">Rechercher un serveur, un salon ou une conversation</label>
    <input id="peopleQuickInput" type="search" placeholder="Un serveur, un salon, une personne…" autocomplete="off" maxlength="100" aria-controls="peopleQuickResults">
    <p class="people-quick-hint">Salons du serveur actuel · Conversations · Serveurs</p>
    <div id="peopleQuickResults" class="people-quick-results"></div>
    <p id="peopleQuickStatus" class="people-sr-only" role="status"></p>
    <footer>↑ ↓ pour parcourir · Entrée pour ouvrir · Échap pour fermer</footer>`;
  document.body.append(dialog);
  const input = dialog.querySelector("input");
  const results = dialog.querySelector(".people-quick-results");
  let previousFocus;
  let entries = [];
  let selected = 0;

  function destinations() {
    const items = [{ name: "Amis", kind: "Accueil", source: $("#friendsNavButton") }];
    document.querySelectorAll(".dynamic-server-button").forEach(source => items.push({ name: source.title, kind: "Serveur", source }));
    document.querySelectorAll(".people-server-channel").forEach(source => {
      if (source.querySelector(".people-server-channel-icon")?.textContent !== "#") return;
      items.push({ name: source.querySelector(".people-server-channel-name").textContent, kind: "Salon texte", source });
    });
    document.querySelectorAll(".dm-conversation-row").forEach(source => items.push({ name: source.dataset.username, kind: "Message privé", source }));
    return items.filter(item => item.source && !item.source.disabled).map(item => ({
      ...item,
      unread: item.source.querySelector(".people-unread-channel-badge, .dm-unread-badge, .rail-badge:not(.hidden)")?.textContent.trim() || ""
    }));
  }
  function highlight() {
    [...results.children].forEach((button, index) => button.classList.toggle("is-selected", index === selected));
  }
  function render() {
    const query = normalize(input.value);
    entries = destinations().filter(item => normalize(item.name + " " + item.kind).includes(query))
      .sort((a, b) => Number(Boolean(b.unread)) - Number(Boolean(a.unread)));
    selected = 0;
    results.replaceChildren();
    for (const [index, item] of entries.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "people-quick-result";
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = item.name;
      const kind = document.createElement("small");
      kind.textContent = item.kind;
      copy.append(name, kind);
      button.append(copy);
      if (item.unread) {
        const badge = document.createElement("span");
        badge.className = "people-quick-unread";
        badge.textContent = item.unread;
        badge.setAttribute("aria-label", item.unread + " messages non lus");
        button.append(badge);
      }
      button.addEventListener("click", () => activate(index));
      results.append(button);
    }
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "people-quick-empty";
      empty.textContent = "Aucun résultat. Essaie un autre nom.";
      results.append(empty);
    }
    $("#peopleQuickStatus").textContent = `${entries.length} résultat${entries.length > 1 ? "s" : ""}`;
    highlight();
  }
  function activate(index) {
    const item = entries[index];
    if (!item?.source.isConnected) { render(); return; }
    dialog.close();
    item.source.click();
    if (shell.classList.contains("people-mobile-sidebar-open")) $("#peopleMobileSidebarToggle")?.click();
  }
  function open() {
    if (!$("#joinScreen").classList.contains("hidden") || dialog.open) return;
    previousFocus = document.activeElement;
    input.value = "";
    render();
    dialog.showModal();
    input.focus();
  }
  launcher.addEventListener("click", open);
  dialog.querySelector(".people-quick-head button").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  dialog.addEventListener("close", () => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); });
  input.addEventListener("input", render);
  input.addEventListener("keydown", event => {
    if (event.isComposing || !entries.length) return;
    if (event.key === "Enter") { event.preventDefault(); activate(selected); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length;
      highlight();
      results.children[selected]?.scrollIntoView({ block: "nearest" });
    }
  });
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !event.isComposing) {
      // Keep other dialogs' keyboard interactions intact.
      if (document.querySelector('dialog[open], [aria-modal="true"]:not(.hidden)') && !dialog.open) {
        const visibleModal = [...document.querySelectorAll('[aria-modal="true"]')].some(el => el.getClientRects().length);
        if (visibleModal || document.querySelector("dialog[open]")) return;
      }
      event.preventDefault();
      dialog.open ? dialog.close() : open();
    }
  });

  for (const [formId, fieldId, messagesId] of [["messageForm", "messageInput", "messages"], ["dmForm", "dmInput", "dmMessages"]]) {
    const form = document.getElementById(formId);
    const field = document.getElementById(fieldId);
    const messages = document.getElementById(messagesId);
    field.setAttribute("aria-label", formId === "dmForm" ? "Écrire un message privé" : "Écrire un message dans le salon");
    const counter = document.createElement("span");
    counter.className = "people-composer-count";
    counter.id = fieldId + "Count";
    counter.hidden = true;
    field.setAttribute("aria-describedby", counter.id);
    form.append(counter);
    function updateCount() {
      counter.hidden = field.value.length < field.maxLength * .8;
      counter.textContent = `${field.value.length} / ${field.maxLength}`;
    }
    field.addEventListener("input", updateCount);
    form.addEventListener("submit", () => setTimeout(updateCount, 0));
    const latest = document.createElement("button");
    latest.type = "button";
    latest.className = "people-jump-latest";
    latest.textContent = "↓ Derniers messages";
    latest.hidden = true;
    form.append(latest);
    function updateLatest() {
      latest.hidden = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 160;
    }
    latest.addEventListener("click", () => { messages.scrollTop = messages.scrollHeight; updateLatest(); });
    messages.addEventListener("scroll", updateLatest, { passive: true });
    new ResizeObserver(updateLatest).observe(messages);
    new MutationObserver(updateLatest).observe(messages, { childList: true, subtree: true });
  }
})();
