(() => {
  "use strict";

  const PRESETS = ["👍", "❤️", "😂", "😮", "😢", "😡", "🎉", "🔥", "👀", "💜", "🐸", "✅"];
  const state = new Map();
  const pending = new Map();
  let picker = null;

  const style = document.createElement("style");
  style.textContent = `
    .people-message-unit{position:relative}
    .people-message-reactions{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:5px;min-height:0}
    .people-message-reactions:empty{display:none}
    .people-reaction-chip,.people-reaction-quick,.people-reaction-picker button{border:1px solid rgba(255,255,255,.09);background:#23202d;color:#e9e5ef;cursor:pointer;font:inherit}
    .people-reaction-chip{min-height:26px;padding:2px 7px;border-radius:8px;display:inline-flex;align-items:center;gap:5px;font-size:13px;line-height:1}
    .people-reaction-chip:hover{background:#302a3d;border-color:rgba(255,255,255,.15)}
    .people-reaction-chip.mine{background:rgba(103,88,157,.28);border-color:rgba(138,121,202,.78);color:#fff}
    .people-reaction-count{font-size:11px;font-weight:800;color:#c9c2d2}
    .people-reaction-chip.mine .people-reaction-count{color:#eee8ff}
    .people-reaction-quick{position:absolute;right:3px;top:-4px;width:29px;height:27px;padding:0;border-radius:8px;display:grid;place-items:center;font-size:15px;opacity:0;transform:translateY(2px);transition:opacity .12s ease,transform .12s ease;z-index:4;box-shadow:0 5px 18px rgba(0,0,0,.22)}
    .people-message-unit:hover>.people-reaction-quick,.people-reaction-quick:focus-visible{opacity:1;transform:translateY(0)}
    .people-reaction-quick:hover{background:#342d43}
    .people-reaction-picker{position:fixed;z-index:6500;width:238px;padding:8px;border:1px solid #39304d;border-radius:12px;background:#121018;box-shadow:0 16px 46px rgba(0,0,0,.5);display:grid;grid-template-columns:repeat(6,1fr);gap:5px}
    .people-reaction-picker button{height:34px;padding:0;border-radius:8px;font-size:19px}
    .people-reaction-picker button:hover{background:#30283b;transform:translateY(-1px)}
    .people-message-menu-item.reaction{color:#ddd5ef}
    @media (hover:none){.people-reaction-quick{opacity:.72;transform:none}}
  `;
  document.head.appendChild(style);

  function scopeFor(unit) {
    return unit?.closest?.("#dmMessages") ? "dm" : "general";
  }

  function keyFor(scope, id) {
    return scope + ":" + String(id || "");
  }

  function closePicker() {
    picker?.remove();
    picker = null;
  }

  function positionPicker(anchorRect) {
    if (!picker || !anchorRect) return;
    const rect = picker.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - rect.width - 8));
    const preferredTop = anchorRect.bottom + 7;
    const top = preferredTop + rect.height <= window.innerHeight - 8
      ? preferredTop
      : Math.max(8, anchorRect.top - rect.height - 7);
    picker.style.left = left + "px";
    picker.style.top = top + "px";
  }

  async function request(scope, id, options) {
    const response = await fetch(
      "/api/message-reactions/" + encodeURIComponent(scope) + "/" + encodeURIComponent(id) + (options?.toggle ? "/toggle" : ""),
      options?.toggle
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emoji: options.emoji })
          }
        : { method: "GET" }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || "Action impossible.");
    }
    return data;
  }

  function visibleUnits(scope, id) {
    const wanted = String(id || "");
    return [...document.querySelectorAll("[data-message-id]")]
      .filter((unit) => String(unit.dataset.messageId || "") === wanted && scopeFor(unit) === scope);
  }

  function renderUnit(unit, reactions) {
    if (!unit?.isConnected) return;

    let row = unit.querySelector(":scope > .people-message-reactions");
    if (!row) {
      row = document.createElement("div");
      row.className = "people-message-reactions";
      unit.appendChild(row);
    }

    row.replaceChildren();

    for (const reaction of Array.isArray(reactions) ? reactions : []) {
      const emoji = String(reaction?.emoji || "");
      const count = Math.max(0, Number(reaction?.count) || 0);
      if (!emoji || !count) continue;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "people-reaction-chip" + (reaction?.me ? " mine" : "");
      button.dataset.emoji = emoji;
      button.title = Array.isArray(reaction?.users) && reaction.users.length
        ? reaction.users.join(", ")
        : "Réaction";

      const emojiNode = document.createElement("span");
      emojiNode.textContent = emoji;
      const countNode = document.createElement("span");
      countNode.className = "people-reaction-count";
      countNode.textContent = String(count);
      button.append(emojiNode, countNode);

      button.addEventListener("click", () => toggleReaction(unit, emoji));
      row.appendChild(button);
    }
  }

  function applyState(scope, id, reactions) {
    const key = keyFor(scope, id);
    state.set(key, Array.isArray(reactions) ? reactions : []);
    visibleUnits(scope, id).forEach((unit) => renderUnit(unit, state.get(key)));
  }

  async function loadUnit(unit) {
    const id = String(unit?.dataset?.messageId || "");
    if (!id) return;
    const scope = scopeFor(unit);
    const key = keyFor(scope, id);

    if (state.has(key)) {
      renderUnit(unit, state.get(key));
      return;
    }
    if (pending.has(key)) return pending.get(key);

    const task = request(scope, id)
      .then((data) => applyState(scope, id, data.reactions || []))
      .catch(() => {})
      .finally(() => pending.delete(key));

    pending.set(key, task);
    return task;
  }

  async function toggleReaction(unit, emoji) {
    const id = String(unit?.dataset?.messageId || "");
    if (!id || !emoji) return;
    const scope = scopeFor(unit);

    try {
      const data = await request(scope, id, { toggle: true, emoji });
      applyState(scope, id, data.reactions || []);
    } catch (err) {
      alert(err?.message || "Impossible d'ajouter la réaction.");
    }
  }

  function openPicker(unit, anchor) {
    const id = String(unit?.dataset?.messageId || "");
    if (!id) return;

    closePicker();
    picker = document.createElement("div");
    picker.className = "people-reaction-picker";
    picker.setAttribute("role", "menu");

    for (const emoji of PRESETS) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = emoji;
      button.title = "Réagir avec " + emoji;
      button.addEventListener("click", async () => {
        closePicker();
        await toggleReaction(unit, emoji);
      });
      picker.appendChild(button);
    }

    document.body.appendChild(picker);
    positionPicker(anchor?.getBoundingClientRect?.() || unit.getBoundingClientRect());
  }

  function ensureUnit(unit) {
    if (!(unit instanceof Element) || !unit.matches("[data-message-id]")) return;
    if (unit.dataset.peopleReactionsReady === "1") return;
    unit.dataset.peopleReactionsReady = "1";

    const quick = document.createElement("button");
    quick.type = "button";
    quick.className = "people-reaction-quick";
    quick.textContent = "☺";
    quick.title = "Ajouter une réaction";
    quick.setAttribute("aria-label", "Ajouter une réaction");
    quick.addEventListener("click", (event) => {
      event.stopPropagation();
      openPicker(unit, quick);
    });
    unit.appendChild(quick);

    if (visibilityObserver) visibilityObserver.observe(unit);
    else void loadUnit(unit);
  }

  const visibilityObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibilityObserver.unobserve(entry.target);
            void loadUnit(entry.target);
          }
        }
      }, { rootMargin: "180px" })
    : null;

  function scan(root = document) {
    if (root instanceof Element && root.matches("[data-message-id]")) ensureUnit(root);
    root.querySelectorAll?.("[data-message-id]").forEach(ensureUnit);
  }

  // === PEOPLE_REACTIONS_V6_NO_DUP_DELETE ===
  // La suppression reste gérée uniquement par people-message-actions.js.

  document.addEventListener("contextmenu", (event) => {
    const unit = event.target instanceof Element ? event.target.closest("[data-message-id]") : null;
    if (!unit) return;

    queueMicrotask(() => {
      const menu = document.querySelector(".people-message-context-menu");
      if (!menu) return;

      if (!menu.querySelector(".people-message-menu-item.reaction")) {
        const react = document.createElement("button");
        react.type = "button";
        react.className = "people-message-menu-item reaction";
        react.textContent = "😊 Réagir";
        react.addEventListener("click", () => {
          const rect = react.getBoundingClientRect();
          menu.remove();
          openPicker(unit, { getBoundingClientRect: () => rect });
        });
        menu.appendChild(react);
      }

      const rect = menu.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 8) {
        menu.style.top = Math.max(8, window.innerHeight - rect.height - 8) + "px";
      }
    });
  });

  document.addEventListener("pointerdown", (event) => {
    if (picker && !picker.contains(event.target)) closePicker();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePicker();
  });
  window.addEventListener("resize", closePicker);
  window.addEventListener("blur", closePicker);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) scan(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scan();

  const peopleSocket = window.peopleSocket;
  peopleSocket?.on?.("message-reaction-updated", async (payload) => {
    const scope = payload?.scope === "dm" ? "dm" : payload?.scope === "general" ? "general" : "";
    const id = String(payload?.messageId || "");
    if (!scope || !id || !visibleUnits(scope, id).length) return;
    try {
      const data = await request(scope, id);
      applyState(scope, id, data.reactions || []);
    } catch {}
  });
})();
