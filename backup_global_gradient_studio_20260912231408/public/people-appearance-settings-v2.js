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

    const rawGradient = palette.gradient || source?.gradient || {};
    const direction = Number(rawGradient.direction);
    const intensity = Number(rawGradient.intensity);

    normalized.gradient = {
      enabled: rawGradient.enabled !== false,
      direction: Number.isFinite(direction)
        ? Math.max(0, Math.min(360, Math.round(direction)))
        : 135,
      intensity: Number.isFinite(intensity)
        ? Math.max(0, Math.min(100, Math.round(intensity)))
        : 72,
      start: normalizeHex(rawGradient.start) || normalized.background,
      middle: normalizeHex(rawGradient.middle) || normalized.accent,
      end: normalizeHex(rawGradient.end) || normalized.secondary
    };

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

    const gradientControls = document.createElement("div");
    gradientControls.className =
      "people-appearance-gradient people-appearance-advanced-content";
    gradientControls.innerHTML = `
      <div class="people-appearance-gradient-head">
        <div>
          <strong>Dégradé du thème</strong>
          <span>Ajoute un dégradé doux aux fonds, comme les thèmes colorés de Discord.</span>
        </div>
        <label class="people-appearance-gradient-switch">
          <input type="checkbox" data-appearance-gradient-enabled />
          <span>Actif</span>
        </label>
      </div>
      <div class="people-appearance-gradient-colors">
        <span class="people-appearance-gradient-colors-label">Couleurs</span>
        <div class="people-appearance-gradient-colorbar" data-appearance-gradient-preview>
          <label class="people-appearance-gradient-color people-gradient-color-start" title="Couleur de gauche">
            <input type="color" value="#5865F2" data-appearance-gradient-color="start" aria-label="Couleur gauche du dégradé" />
            <span>Gauche</span>
          </label>
          <label class="people-appearance-gradient-color people-gradient-color-middle" title="Couleur du milieu">
            <input type="color" value="#8B5CF6" data-appearance-gradient-color="middle" aria-label="Couleur centrale du dégradé" />
            <span>Milieu</span>
          </label>
          <label class="people-appearance-gradient-color people-gradient-color-end" title="Couleur de droite">
            <input type="color" value="#EB459E" data-appearance-gradient-color="end" aria-label="Couleur droite du dégradé" />
            <span>Droite</span>
          </label>
        </div>
      </div>
      <label class="people-appearance-gradient-control">
        <span>Direction <b data-appearance-gradient-direction-value>135°</b></span>
        <input type="range" min="0" max="360" step="1" value="135" data-appearance-gradient-direction />
      </label>
      <label class="people-appearance-gradient-control">
        <span>Intensité <b data-appearance-gradient-intensity-value>46%</b></span>
        <input type="range" min="0" max="100" step="1" value="46" data-appearance-gradient-intensity />
      </label>
    `;

    if (previewNote) {
      previewNote.insertAdjacentElement("afterend", gradientControls);
    } else if (preview) {
      preview.insertAdjacentElement("afterend", gradientControls);
    } else {
      actions.insertAdjacentElement("beforebegin", gradientControls);
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

      const gradient = palette.gradient || {};
      const enabled = editor.querySelector("[data-appearance-gradient-enabled]");
      const direction = editor.querySelector("[data-appearance-gradient-direction]");
      const intensity = editor.querySelector("[data-appearance-gradient-intensity]");
      const start = editor.querySelector('[data-appearance-gradient-color="start"]');
      const middle = editor.querySelector('[data-appearance-gradient-color="middle"]');
      const end = editor.querySelector('[data-appearance-gradient-color="end"]');

      if (enabled instanceof HTMLInputElement) {
        enabled.checked = gradient.enabled !== false;
        enabled.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (direction instanceof HTMLInputElement && Number.isFinite(Number(gradient.direction))) {
        direction.value = String(gradient.direction);
        direction.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (intensity instanceof HTMLInputElement && Number.isFinite(Number(gradient.intensity))) {
        intensity.value = String(gradient.intensity);
        intensity.dispatchEvent(new Event("input", { bubbles: true }));
      }
      for (const [input, value, fallback] of [
        [start, gradient.start, palette.background],
        [middle, gradient.middle, palette.accent],
        [end, gradient.end, palette.secondary]
      ]) {
        if (!(input instanceof HTMLInputElement)) continue;
        const color = normalizeHex(value) || normalizeHex(fallback);
        if (!color) continue;
        input.value = color;
        input.dispatchEvent(new Event("input", { bubbles: true }));
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
      const appearance = activeAppearance();
      const palette = appearance?.palette || activePalette();
      if (!palette) {
        setStatus(portableStatus, "Impossible de lire le thème actuel.", "error");
        return;
      }

      const payload = {
        format: "people-theme",
        version: 2,
        name: "Thème personnalisé People",
        exportedAt: new Date().toISOString(),
        appearance: {
          theme: appearance?.theme || "custom",
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
