(() => {
  // === PEOPLE_MESSAGE_EDIT_V6_START ===
  const editStyle = document.createElement("style");
  editStyle.textContent = `
    .people-message-inline-edit{display:flex;flex-direction:column;gap:7px;margin-top:4px;max-width:min(720px,100%)}
    .people-message-inline-edit textarea{width:100%;min-height:74px;max-height:220px;resize:vertical;box-sizing:border-box;border:1px solid rgba(151,128,255,.55);border-radius:9px;background:#17141f;color:#f2eef8;padding:10px 11px;font:inherit;line-height:1.35;outline:none}
    .people-message-inline-edit textarea:focus{border-color:#9f88ff;box-shadow:0 0 0 2px rgba(126,98,255,.16)}
    .people-message-inline-edit-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
    .people-message-inline-edit-actions button{border:0;border-radius:7px;padding:5px 9px;font:inherit;font-size:12px;font-weight:750;cursor:pointer;background:#6f5bd3;color:white}
    .people-message-inline-edit-actions button.people-message-edit-cancel{background:#2b2733;color:#d9d2e1}
    .people-message-inline-edit-hint{font-size:11px;color:#8f8899}
    .people-message-edited-label{display:inline-block;margin:3px 0 0 6px;font-size:10px;line-height:1;color:#8d8697;vertical-align:middle;user-select:none}
    .people-message-menu-item.edit{color:#e8e0ff}
    .people-message-edit-hidden{display:none!important}
  `;
  document.head.appendChild(editStyle);
  // === PEOPLE_MESSAGE_EDIT_V6_END ===

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
      return ("" + window.PeopleI18n.t("ui_b97d58e7b3") + "");
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
            ("" + window.PeopleI18n.t("ui_4a47d829df") + "")
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
      canEdit = false,
      canDelete = false,
      onReply,
      onEdit,
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
        ("" + window.PeopleI18n.t("ui_b2df965204") + ""),
        "reply",
        onReply
      )
    );

    if (canEdit) {
      menu.appendChild(
        makeMenuButton(
          ("" + window.PeopleI18n.t("ui_c62d7bf6a0") + ""),
          "edit",
          onEdit
        )
      );
    }

    if (typeof canDelete === "function" ? canDelete() : canDelete) {
      menu.appendChild(
        makeMenuButton(
          ("" + window.PeopleI18n.t("ui_870809ae98") + ""),
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
        ? ("" + window.PeopleI18n.t("ui_0a8438e26d") + "")
        : String(
            reply.username ||
            "Utilisateur"
          );

    // === PEOPLE_REPLY_PROFILE_CLICK_V3 ===
    if (
      !reply.deleted &&
      reply.username
    ) {
      author.classList.add(
        "people-profile-trigger",
        "people-profile-name-trigger"
      );

      author.dataset.peopleProfileUsername =
        String(
          reply.username
        );

      author.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();

          window.dispatchEvent(
            new CustomEvent(
              "people-open-profile",
              {
                detail: {
                  username:
                    author.dataset.peopleProfileUsername
                }
              }
            )
          );
        }
      );
    }

    const text =
      document.createElement("span");

    text.textContent =
      reply.deleted
        ? ("" + window.PeopleI18n.t("ui_e1269fb250") + "")
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
            ("" + window.PeopleI18n.t("ui_0a8438e26d") + "");
        }

        if (text) {
          text.textContent =
            ("" + window.PeopleI18n.t("ui_e1269fb250") + "");
        }

        box.disabled = true;
      });
  }

  // === PEOPLE_INLINE_EDIT_V6_START ===
  function setEditedLabel(
    unit,
    editedAt = null
  ) {
    if (!unit) return;

    let label =
      unit.querySelector(
        ":scope > .people-message-edited-label"
      );

    if (!editedAt) {
      label?.remove();
      return;
    }

    if (!label) {
      label =
        document.createElement("span");

      label.className =
        "people-message-edited-label";

      const text =
        unit.querySelector(
          ":scope > .message-text"
        );

      if (text) {
        text.insertAdjacentElement(
          "afterend",
          label
        );
      } else {
        unit.appendChild(label);
      }
    }

    label.textContent = ("" + window.PeopleI18n.t("ui_1fb9f40972") + "");

    const date =
      new Date(editedAt);

    label.title =
      Number.isNaN(date.getTime())
        ? ("" + window.PeopleI18n.t("ui_48c829a8fc") + "")
        : ("" + window.PeopleI18n.t("ui_109467a652") + " ") +
          date.toLocaleString("en-US");
  }

  function startInlineEdit(
    unit,
    {
      initialText = "",
      maxLength = 2000,
      allowEmpty = false,
      onSave
    } = {}
  ) {
    if (!unit) return;

    const current =
      unit.querySelector(
        ":scope > .people-message-inline-edit"
      );

    if (current) {
      current.querySelector("textarea")?.focus();
      return;
    }

    const textElement =
      unit.querySelector(
        ":scope > .message-text"
      );

    if (!textElement) return;

    const editor =
      document.createElement("div");

    editor.className =
      "people-message-inline-edit";

    const textarea =
      document.createElement("textarea");

    textarea.value =
      String(initialText || "");

    textarea.maxLength =
      Math.max(1, Number(maxLength) || 2000);

    textarea.setAttribute(
      "aria-label",
      ("" + window.PeopleI18n.t("ui_8d227a2cfa") + "")
    );

    const actions =
      document.createElement("div");

    actions.className =
      "people-message-inline-edit-actions";

    const save =
      document.createElement("button");

    save.type = "button";
    save.textContent = ("" + window.PeopleI18n.t("ui_35322b5bb5") + "");

    const cancel =
      document.createElement("button");

    cancel.type = "button";
    cancel.className =
      "people-message-edit-cancel";
    cancel.textContent = ("" + window.PeopleI18n.t("ui_19766ed6cc") + "");

    const hint =
      document.createElement("span");

    hint.className =
      "people-message-inline-edit-hint";
    hint.textContent =
      ("" + window.PeopleI18n.t("ui_0283149057") + "");

    actions.append(
      save,
      cancel,
      hint
    );

    editor.append(
      textarea,
      actions
    );

    textElement.classList.add(
      "people-message-edit-hidden"
    );

    const editedLabel =
      unit.querySelector(
        ":scope > .people-message-edited-label"
      );

    editedLabel?.classList.add(
      "people-message-edit-hidden"
    );

    textElement.insertAdjacentElement(
      "afterend",
      editor
    );

    let busy = false;

    function close() {
      editor.remove();

      textElement.classList.remove(
        "people-message-edit-hidden"
      );

      editedLabel?.classList.remove(
        "people-message-edit-hidden"
      );
    }

    async function commit() {
      if (busy) return;

      const next =
        String(textarea.value || "").trim();

      if (!next && !allowEmpty) {
        alert(
          ("" + window.PeopleI18n.t("ui_e0c1197eb4") + "")
        );
        return;
      }

      busy = true;
      textarea.disabled = true;
      save.disabled = true;
      cancel.disabled = true;

      try {
        await onSave?.(next);
        close();
      } catch (err) {
        busy = false;
        textarea.disabled = false;
        save.disabled = false;
        cancel.disabled = false;
        textarea.focus();

        throw err;
      }
    }

    save.addEventListener(
      "click",
      () => {
        void commit().catch((err) => {
          alert(
            err?.message ||
            ("" + window.PeopleI18n.t("ui_b9ab4fea4b") + "")
          );
        });
      }
    );

    cancel.addEventListener(
      "click",
      close
    );

    textarea.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          return;
        }

        if (
          event.key === "Enter" &&
          !event.shiftKey
        ) {
          event.preventDefault();

          void commit().catch((err) => {
            alert(
              err?.message ||
              ("" + window.PeopleI18n.t("ui_b9ab4fea4b") + "")
            );
          });
        }
      }
    );

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(
        textarea.value.length,
        textarea.value.length
      );
    });
  }
  // === PEOPLE_INLINE_EDIT_V6_END ===

  function updateReplyPreview(
    id,
    message = {}
  ) {
    const wanted = String(id || "");
    if (!wanted) return;

    document
      .querySelectorAll(
        `.people-message-reply-preview[data-reply-target-id="${escapeAttributeValue(
          wanted
        )}"]`
      )
      .forEach((box) => {
        if (box.disabled) return;
        const text = box.querySelector("span");
        if (text) {
          text.textContent = summary(message);
        }
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
      ("" + window.PeopleI18n.t("ui_f2d0431368") + "");

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
        ("" + window.PeopleI18n.t("ui_6e5842a7ca") + " ") +
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

  let longPress = null;
  let pressOrigin = null;
  function cancelLongPress() {
    clearTimeout(longPress);
    longPress = null;
    pressOrigin = null;
  }
  document.addEventListener("pointerdown", event => {
    cancelLongPress();
    if (event.pointerType !== "touch") return;
    let node = event.target instanceof Element ? event.target : null;
    while (node && !contextBindings.has(node)) node = node.parentElement;
    if (!node) return;
    pressOrigin = { x: event.clientX, y: event.clientY };
    longPress = setTimeout(() => {
      showMenu({ clientX: event.clientX, clientY: event.clientY, preventDefault() {}, stopPropagation() {} }, contextBindings.get(node));
      longPress = null;
    }, 550);
  }, { passive: true });
  document.addEventListener("pointermove", event => {
    if (pressOrigin && Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y) > 10) cancelLongPress();
  }, { passive: true });
  document.addEventListener("pointerup", cancelLongPress, { passive: true });
  document.addEventListener("pointercancel", cancelLongPress, { passive: true });

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
    summary,
    startInlineEdit,
    setEditedLabel,
    updateReplyPreview
  };
})();
