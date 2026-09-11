(() => {
  "use strict";

  const PALETTE_KEYS = [
    "background",
    "panel",
    "secondary",
    "text",
    "accent"
  ];

  function normalizeHex(value) {
    const color = String(value || "").trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(color) ? color : null;
  }

  function activeAppearance() {
    return window.PeopleAppearance?.get?.() || null;
  }

  function activePalette() {
    const visual = window.PeopleAppearance?.getActivePalette?.();
    if (visual) return { ...visual };
    return activeAppearance()?.palette
      ? { ...activeAppearance().palette }
      : null;
  }

  function setStatus(element, text, tone = "") {
    if (!element) return;
    element.textContent = text || "";
    element.dataset.tone = tone;
  }

  function downloadJson(payload) {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "-",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0")
    ].join("");

    const blob = new Blob(
      [JSON.stringify(payload, null, 2)],
      { type: "application/json;charset=utf-8" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `people-theme-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function parseImportedTheme(value) {
    const source =
      value?.appearance && typeof value.appearance === "object"
        ? value.appearance
        : value;
    const palette = source?.palette;

    if (!palette || typeof palette !== "object" || Array.isArray(palette)) {
      throw new Error("Ce fichier ne contient pas de palette People.");
    }

    const normalized = {};
    for (const key of PALETTE_KEYS) {
      const color = normalizeHex(palette[key]);
      if (!color) {
        throw new Error(`Couleur invalide ou manquante : ${key}.`);
      }
      normalized[key] = color;
    }

    return {
      name:
        typeof value?.name === "string" && value.name.trim()
          ? value.name.trim().slice(0, 80)
          : "Thème importé",
      palette: normalized
    };
  }

  function boot() {
    if (document.documentElement.dataset.peopleAppearanceSettingsV22 === "1") {
      return true;
    }

    const page = document.querySelector('[data-settings-page="appearance"]');
    const themes = document.getElementById("peopleSettingsThemes");
    const editor = document.getElementById("peopleSettingsPaletteEditor");
    const actions = editor?.querySelector(".people-settings-actions");

    if (!page || !themes || !editor || !actions) {
      return false;
    }

    document.documentElement.dataset.peopleAppearanceSettingsV22 = "1";

    const themeSection = themes.closest(".people-settings-section");
    const themeTitle = themeSection?.querySelector(
      ".people-settings-section-title strong"
    );
    const themeCopy = themeSection?.querySelector(
      ".people-settings-section-title span"
    );

    if (themeTitle) themeTitle.textContent = "Thèmes prêts à l'emploi";
    if (themeCopy) {
      themeCopy.textContent =
        "Choisis un thème prêt à l'emploi. Les réglages précis restent disponibles juste en dessous.";
    }

    const customCard = themes.querySelector('[data-appearance-theme="custom"]');
    if (customCard) {
      customCard.hidden = true;
      customCard.setAttribute("aria-hidden", "true");
    }

    editor.classList.add("people-appearance-advanced");

    const editorTitle = editor.querySelector(".people-settings-section-title");
    const editorStrong = editorTitle?.querySelector("strong");
    const editorDescription = editorTitle?.querySelector("div > span");
    const oldBadge = document.getElementById("peopleSettingsCustomBadge");

    if (editorStrong) editorStrong.textContent = "Personnalisation avancée";
    if (editorDescription) {
      editorDescription.textContent =
        "Importe, exporte ou règle précisément chaque couleur de l'interface.";
    }
    if (oldBadge) oldBadge.classList.add("people-appearance-legacy-badge");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "people-appearance-advanced-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = `<span>Ouvrir</span><b aria-hidden="true">⌄</b>`;
    editorTitle?.appendChild(toggle);

    const preview = document.getElementById("peopleSettingsPalettePreview");
    const previewNote = editor.querySelector(".people-settings-preview-note");
    const paletteList = editor.querySelector(".people-settings-palette-list");

    for (const element of [preview, previewNote, paletteList, actions]) {
      element?.classList.add("people-appearance-advanced-content");
    }

    const portable = document.createElement("div");
    portable.className =
      "people-appearance-portable people-appearance-advanced-content";
    portable.innerHTML = `
      <div class="people-appearance-portable-copy">
        <strong>Importer / exporter un thème</strong>
        <span>Partage une palette personnalisée au format JSON ou importe celle de quelqu'un d'autre.</span>
      </div>
      <div class="people-appearance-portable-actions">
        <button id="peopleAppearanceImport" class="people-settings-secondary" type="button">Importer</button>
        <button id="peopleAppearanceExport" class="people-settings-secondary" type="button">Exporter</button>
        <input id="peopleAppearanceImportFile" type="file" accept="application/json,.json" hidden />
      </div>
      <div id="peopleAppearancePortableStatus" class="people-appearance-portable-status" aria-live="polite"></div>
    `;

    actions.insertAdjacentElement("beforebegin", portable);

    const importButton = document.getElementById("peopleAppearanceImport");
    const exportButton = document.getElementById("peopleAppearanceExport");
    const importFile = document.getElementById("peopleAppearanceImportFile");
    const portableStatus = document.getElementById("peopleAppearancePortableStatus");

    function setAdvancedOpen(open) {
      editor.classList.toggle("people-appearance-advanced-open", !!open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.querySelector("span").textContent = open ? "Réduire" : "Ouvrir";
      toggle.querySelector("b").textContent = open ? "⌃" : "⌄";
    }

    function applyPaletteToExistingEditor(palette) {
      for (const key of PALETTE_KEYS) {
        const picker = editor.querySelector(`[data-palette-picker="${key}"]`);
        if (!(picker instanceof HTMLInputElement)) continue;
        picker.value = palette[key];
        picker.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }

    toggle.addEventListener("click", () => {
      setAdvancedOpen(
        !editor.classList.contains("people-appearance-advanced-open")
      );
    });

    // Les themes prets a l'emploi sont volontaires et immediats :
    // le panneau historique applique d'abord l'aperçu, puis on reutilise
    // son bouton Enregistrer afin de conserver exactement la meme logique
    // serveur / rollback que le reste des reglages d'apparence.
    themes.addEventListener("click", (event) => {
      const card =
        event.target instanceof Element
          ? event.target.closest("[data-appearance-theme]")
          : null;

      if (!card || card.dataset.appearanceTheme === "custom") return;

      queueMicrotask(() => {
        const saveButton = document.getElementById("peopleSettingsAppearanceSave");
        if (saveButton instanceof HTMLButtonElement && !saveButton.disabled) {
          saveButton.click();
        }
      });
    });

    exportButton?.addEventListener("click", () => {
      const palette = activePalette();
      if (!palette) {
        setStatus(portableStatus, "Impossible de lire le thème actuel.", "error");
        return;
      }

      const payload = {
        format: "people-theme",
        version: 1,
        name: "Thème personnalisé People",
        exportedAt: new Date().toISOString(),
        appearance: {
          theme: "custom",
          palette
        }
      };

      downloadJson(payload);
      setStatus(portableStatus, "Thème exporté ✓", "success");
    });

    importButton?.addEventListener("click", () => {
      importFile?.click();
    });

    importFile?.addEventListener("change", async () => {
      const file = importFile.files?.[0];
      importFile.value = "";
      if (!file) return;

      try {
        if (file.size > 128 * 1024) {
          throw new Error("Ce fichier est trop volumineux pour être un thème People.");
        }
        const parsed = JSON.parse(await file.text());
        const imported = parseImportedTheme(parsed);
        applyPaletteToExistingEditor(imported.palette);
        setAdvancedOpen(true);
        setStatus(
          portableStatus,
          `${imported.name} importé — vérifie l'aperçu puis clique sur Enregistrer.`,
          "success"
        );
      } catch (error) {
        setStatus(
          portableStatus,
          error?.message || "Impossible d'importer ce thème.",
          "error"
        );
      }
    });

    setAdvancedOpen(false);

    window.PeopleAppearancePortableThemes = {
      format: "people-theme",
      version: 1,
      parse: parseImportedTheme
    };

    return true;
  }

  if (!boot()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (boot() || attempts > 40) {
        clearInterval(timer);
      }
    }, 100);
  }
})();
