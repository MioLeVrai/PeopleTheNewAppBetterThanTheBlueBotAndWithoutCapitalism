(() => {
  let menu = null;
  const contextBindings = new WeakMap();
  const WHITESPACE_RE = /\s+/g;

  function escapeAttributeValue(value) {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\D ")
      .replace(/\n/g, "\\A ");
  }

  function cleanText(value, max = 110) {
    const text = String(value || "")
      .replace(WHITESPACE_RE, " ")
      .trim();

    if (!text) return "";

    return text.length > max
      ? text.slice(0, max - 1) + "…"
      : text;
  }

  function summary(message) {
    const text = cleanText(
      message?.text ??
      message?.body ??
      ""
    );

    if (text) return text;

    if (message?.imageId) {
      return "🖼️ Image";
    }

    return "Message";
  }

  function closeMenu() {
    if (!menu) return;
    menu.remove();
    menu = null;
  }

  function makeMenuButton(
    label,
    className,
    action
  ) {
    const button =
      document.createElement("button");

    button.type = "button";
    button.className =
      "people-message-menu-item " +
      className;

    button.textContent = label;

    button.addEventListener(
      "click",
      async () => {
        closeMenu();

        try {
          await action?.();
        } catch (err) {
          alert(
            err?.message ||
            "Action impossible."
          );
        }
      }
    );

    return button;
  }

  function showMenu(
    event,
    {
      message,
      canDelete = false,
      onReply,
      onDelete
    } = {}
  ) {
    const id =
      String(message?.id || "").trim();

    if (!id) return;

    event.preventDefault();
    event.stopPropagation();

    closeMenu();

    menu =
      document.createElement("div");

    menu.className =
      "people-message-context-menu";

    menu.appendChild(
      makeMenuButton(
        "↩ Répondre",
        "reply",
        onReply
      )
    );

    if (canDelete) {
      menu.appendChild(
        makeMenuButton(
          "🗑 Supprimer",
          "delete",
          onDelete
        )
      );
    }

    document.body.appendChild(menu);

    const rect =
      menu.getBoundingClientRect();

    const x =
      Math.max(
        8,
        Math.min(
          event.clientX,
          window.innerWidth -
            rect.width -
            8
        )
      );

    const y =
      Math.max(
        8,
        Math.min(
          event.clientY,
          window.innerHeight -
            rect.height -
            8
        )
      );

    menu.style.left = x + "px";
    menu.style.top = y + "px";
  }

  function bindContext(
    element,
    options
  ) {
    if (!element) return;

    // Keep the latest actions for this message without
    // installing one contextmenu listener per message.
    contextBindings.set(
      element,
      options || {}
    );
  }

  function scrollToMessage(id) {
    const wanted =
      String(id || "");

    if (!wanted) return;

    const target =
      document.querySelector(
        `[data-message-id="${escapeAttributeValue(
          wanted
        )}"]`
      );

    if (!target) return;

    target.scrollIntoView({
      block: "center",
      behavior: "smooth"
    });

    target.classList.remove(
      "people-message-flash"
    );

    requestAnimationFrame(() => {
      target.classList.add(
        "people-message-flash"
      );

      setTimeout(
        () =>
          target.classList.remove(
            "people-message-flash"
          ),
        1000
      );
    });
  }

  function createReplyPreview(reply) {
    if (!reply?.id) {
      return null;
    }

    const box =
      document.createElement("button");

    box.type = "button";
    box.className =
      "people-message-reply-preview";

    box.dataset.replyTargetId =
      String(reply.id);

    const author =
      document.createElement("strong");

    author.textContent =
      reply.deleted
        ? "Message supprimé"
        : String(
            reply.username ||
            "Utilisateur"
          );

    const text =
      document.createElement("span");

    text.textContent =
      reply.deleted
        ? "Le message d’origine a été supprimé."
        : summary(reply);

    box.append(author, text);

    if (reply.deleted) {
      box.disabled = true;
    }

    return box;
  }

  function markDeleted(id) {
    const wanted =
      String(id || "");

    if (!wanted) return;

    document
      .querySelectorAll(
        `.people-message-reply-preview[data-reply-target-id="${escapeAttributeValue(
          wanted
        )}"]`
      )
      .forEach((box) => {
        const author =
          box.querySelector("strong");

        const text =
          box.querySelector("span");

        if (author) {
          author.textContent =
            "Message supprimé";
        }

        if (text) {
          text.textContent =
            "Le message d’origine a été supprimé.";
        }

        box.disabled = true;
      });
  }

  function createReplyController({
    form,
    input
  } = {}) {
    if (!form) {
      return {
        set() {},
        clear() {},
        clearIfId() {},
        get() {
          return null;
        }
      };
    }

    let state = null;

    const bar =
      document.createElement("div");

    bar.className =
      "people-composer-reply hidden";

    const copy =
      document.createElement("div");

    copy.className =
      "people-composer-reply-copy";

    const label =
      document.createElement("strong");

    const text =
      document.createElement("span");

    copy.append(label, text);

    const close =
      document.createElement("button");

    close.type = "button";
    close.className =
      "people-composer-reply-close";

    close.textContent = "✕";
    close.title =
      "Annuler la réponse";

    close.addEventListener(
      "click",
      () => clear()
    );

    bar.append(copy, close);
    form.prepend(bar);

    function set(message) {
      const id =
        String(message?.id || "").trim();

      if (!id) return;

      state = {
        id,
        username:
          String(
            message?.username ||
            message?.author ||
            "Utilisateur"
          ),
        text:
          String(
            message?.text ??
            message?.body ??
            ""
          ),
        imageId:
          message?.imageId || null
      };

      label.textContent =
        "Répondre à " +
        state.username;

      text.textContent =
        summary(state);

      bar.classList.remove(
        "hidden"
      );

      form.classList.add(
        "people-composer-has-reply"
      );

      input?.focus();
    }

    function clear() {
      state = null;

      bar.classList.add(
        "hidden"
      );

      form.classList.remove(
        "people-composer-has-reply"
      );
    }

    function clearIfId(id) {
      if (
        state &&
        String(state.id) ===
          String(id)
      ) {
        clear();
      }
    }

    return {
      set,
      clear,
      clearIfId,
      get() {
        return state;
      }
    };
  }

  document.addEventListener(
    "contextmenu",
    (event) => {
      let element =
        event.target instanceof Element
          ? event.target
          : null;

      while (element) {
        const options =
          contextBindings.get(element);

        if (options) {
          showMenu(
            event,
            options
          );
          return;
        }

        element =
          element.parentElement;
      }
    }
  );

  document.addEventListener(
    "click",
    (event) => {
      const preview =
        event.target instanceof Element
          ? event.target.closest(
              ".people-message-reply-preview[data-reply-target-id]"
            )
          : null;

      if (
        !preview ||
        preview.disabled
      ) {
        return;
      }

      scrollToMessage(
        preview.dataset
          .replyTargetId
      );
    }
  );

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (
        menu &&
        !menu.contains(
          event.target
        )
      ) {
        closeMenu();
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    }
  );

  window.addEventListener(
    "blur",
    closeMenu
  );

  window.addEventListener(
    "resize",
    closeMenu
  );

  document.addEventListener(
    "scroll",
    closeMenu,
    {
      capture: true,
      passive: true
    }
  );

  window.PeopleMessageActions = {
    bindContext,
    createReplyPreview,
    createReplyController,
    scrollToMessage,
    markDeleted,
    summary
  };
})();
