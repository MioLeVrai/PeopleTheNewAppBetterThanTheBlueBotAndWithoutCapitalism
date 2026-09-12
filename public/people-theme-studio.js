(() => {
  "use strict";

  if (window.__peopleThemeStudioV1) return;
  window.__peopleThemeStudioV1 = true;

  const PALETTE_KEYS = ["background", "panel", "secondary", "text", "accent"];
  const PALETTE_LABELS = {
    background: "Fond principal",
    panel: "Panneaux",
    secondary: "Fond secondaire",
    text: "Texte principal",
    accent: "Accent"
  };
  const DEFAULT_STOPS = ["#5865F2", "#8B5CF6", "#EB459E"];
  const MAX_STOPS = 7;
  const MIN_STOPS = 3;

  let enhanced = false;
  let studioOpen = false;
  let studioOrigin = null;
  let studioDraft = null;
  let settingsModalWasOpen = false;

  const clone = (value) => JSON.parse(JSON.stringify(value || {}));

  function validHex(value) {
    const color = String(value || "").trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(color) ? color : null;
  }

  function hexToRgb(hex) {
    const clean = (validHex(hex) || "#000000").slice(1);
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16)
    };
  }

  function rgbToHex(r, g, b) {
    const part = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)))
      .toString(16).padStart(2, "0").toUpperCase();
    return `#${part(r)}${part(g)}${part(b)}`;
  }

  function mix(aHex, bHex, ratio) {
    const a = hexToRgb(aHex);
    const b = hexToRgb(bHex);
    const t = Math.max(0, Math.min(1, Number(ratio) || 0));
    return rgbToHex(
      a.r + (b.r - a.r) * t,
      a.g + (b.g - a.g) * t,
      a.b + (b.b - a.b) * t
    );
  }

  function rgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }

  function gradientColors(gradient, palette = {}) {
    const raw = Array.isArray(gradient?.colors)
      ? gradient.colors
      : [gradient?.start, gradient?.middle, gradient?.end];

    let colors = raw.map(validHex).filter(Boolean).slice(0, MAX_STOPS);
    if (colors.length < MIN_STOPS) {
      colors = [
        validHex(gradient?.start) || validHex(palette.background) || DEFAULT_STOPS[0],
        validHex(gradient?.middle) || validHex(palette.accent) || DEFAULT_STOPS[1],
        validHex(gradient?.end) || validHex(palette.secondary) || DEFAULT_STOPS[2]
      ];
    }
    return colors;
  }

  function normalizeGradient(gradient, palette = {}) {
    const colors = gradientColors(gradient, palette);
    const direction = Number(gradient?.direction);
    const intensity = Number(gradient?.intensity);
    const middleIndex = Math.floor((colors.length - 1) / 2);
    return {
      ...(gradient || {}),
      enabled: gradient?.enabled !== false,
      direction: Number.isFinite(direction) ? Math.max(0, Math.min(360, Math.round(direction))) : 135,
      intensity: Number.isFinite(intensity) ? Math.max(0, Math.min(100, Math.round(intensity))) : 72,
      colors,
      start: colors[0],
      middle: colors[middleIndex],
      end: colors[colors.length - 1]
    };
  }

  function appearanceNow() {
    const current = window.PeopleAppearance?.get?.();
    if (!current?.palette) return null;
    const value = clone(current);
    value.palette.gradient = normalizeGradient(value.palette.gradient, value.palette);
    return value;
  }

  function activeVisualPalette(appearance) {
    const visual = window.PeopleAppearance?.getActivePalette?.();
    if (visual) return { ...visual };
    return { ...(appearance?.palette || {}) };
  }

  function stopList(colors, direction, base, intensity) {
    const power = Math.max(0, Math.min(1, intensity / 100));
    return colors.map((color, index) => {
      const position = colors.length === 1 ? 0 : (index / (colors.length - 1)) * 100;
      return `${mix(base, color, power)} ${position.toFixed(2)}%`;
    }).join(", ");
  }

  function pureStopList(colors) {
    return colors.map((color, index) => {
      const position = colors.length === 1 ? 0 : (index / (colors.length - 1)) * 100;
      return `${color} ${position.toFixed(2)}%`;
    }).join(", ");
  }

  function applyGlobalGradient(appearance = appearanceNow()) {
    if (!appearance?.palette) return;
    const palette = activeVisualPalette(appearance);
    const gradient = normalizeGradient(appearance.palette.gradient, palette);
    const root = document.documentElement;
    const enabled = gradient.enabled && gradient.intensity > 0;

    root.dataset.peopleGlobalGradient = enabled ? "on" : "off";
    root.style.setProperty("--people-global-gradient", enabled
      ? `linear-gradient(${gradient.direction}deg, ${stopList(gradient.colors, gradient.direction, palette.background, gradient.intensity)})`
      : "none", "important");

    // Un seul dégradé global. Les zones ne le recommencent pas : elles posent
    // seulement des voiles différents au-dessus pour garder la hiérarchie.
    const power = gradient.intensity / 100;
    root.style.setProperty("--people-global-main-overlay", rgba(palette.background, 0.34 + (1 - power) * 0.20), "important");
    root.style.setProperty("--people-global-panel-overlay", rgba(palette.panel, 0.68 + (1 - power) * 0.12), "important");
    root.style.setProperty("--people-global-panel-soft-overlay", rgba(palette.panel, 0.54 + (1 - power) * 0.15), "important");
    root.style.setProperty("--people-global-rail-overlay", rgba(palette.secondary, 0.78 + (1 - power) * 0.10), "important");

    updateSettingsPreview(appearance, palette, gradient);
  }

  function updateSettingsPreview(appearance, palette, gradient) {
    const preview = document.getElementById("peopleSettingsPalettePreview");
    if (!preview) return;
    const enabled = gradient.enabled && gradient.intensity > 0;
    preview.style.setProperty("--preview-global-gradient", enabled
      ? `linear-gradient(${gradient.direction}deg, ${stopList(gradient.colors, gradient.direction, palette.background, gradient.intensity)})`
      : palette.background);
    const power = gradient.intensity / 100;
    preview.style.setProperty("--preview-global-main-overlay", rgba(palette.background, 0.34 + (1 - power) * 0.20));
    preview.style.setProperty("--preview-global-panel-overlay", rgba(palette.panel, 0.68 + (1 - power) * 0.12));
    preview.style.setProperty("--preview-global-panel-soft-overlay", rgba(palette.panel, 0.54 + (1 - power) * 0.15));
    preview.style.setProperty("--preview-global-rail-overlay", rgba(palette.secondary, 0.78 + (1 - power) * 0.10));
  }

  function dispatchDraft(appearance, status = "Aperçu local — pense à enregistrer.") {
    window.dispatchEvent(new CustomEvent("people-theme-studio-draft", {
      detail: { appearance: clone(appearance), status }
    }));
  }

  function previewDraft(appearance, status) {
    const next = clone(appearance);
    next.palette.gradient = normalizeGradient(next.palette.gradient, next.palette);
    window.PeopleAppearance?.preview?.(next);
    dispatchDraft(next, status);
    queueMicrotask(() => {
      applyGlobalGradient(next);
      renderStandardGradientEditor(next);
      if (studioOpen) renderStudio(studioDraft || next);
    });
    return next;
  }

  function makeGradientStopNode(color, index, count, scope) {
    const wrapper = document.createElement("div");
    wrapper.className = `people-gradient-dynamic-stop people-gradient-dynamic-stop-${scope}`;
    wrapper.style.left = `${count <= 1 ? 0 : (index / (count - 1)) * 100}%`;
    wrapper.dataset.peopleGradientStopWrapper = String(index);

    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = color;
    picker.dataset.peopleGradientStop = String(index);
    picker.dataset.peopleGradientScope = scope;
    picker.setAttribute("aria-label", `Couleur ${index + 1} du dégradé`);
    wrapper.appendChild(picker);

    const badge = document.createElement("span");
    badge.textContent = count === 3 && index === 0 ? "Début"
      : count === 3 && index === 1 ? "Milieu"
      : count === 3 && index === 2 ? "Fin"
      : String(index + 1);
    wrapper.appendChild(badge);

    if (count > MIN_STOPS) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Retirer cette couleur";
      remove.dataset.peopleGradientRemove = String(index);
      remove.dataset.peopleGradientScope = scope;
      wrapper.appendChild(remove);
    }
    return wrapper;
  }

  function renderStopBar(bar, colors, direction, scope) {
    if (!bar) return;
    bar.innerHTML = "";
    bar.style.background = `linear-gradient(${direction}deg, ${pureStopList(colors)})`;
    colors.forEach((color, index) => {
      bar.appendChild(makeGradientStopNode(color, index, colors.length, scope));
    });
  }

  function renderStandardGradientEditor(appearance = appearanceNow()) {
    if (!appearance?.palette) return;
    const bar = document.querySelector(".people-appearance-gradient-colorbar[data-appearance-gradient-preview]");
    if (!bar) return;
    const gradient = normalizeGradient(appearance.palette.gradient, appearance.palette);
    renderStopBar(bar, gradient.colors, gradient.direction, "settings");

    let add = document.querySelector("[data-people-gradient-add='settings']");
    if (!add) {
      add = document.createElement("button");
      add.type = "button";
      add.className = "people-gradient-add-stop";
      add.dataset.peopleGradientAdd = "settings";
      add.textContent = "+ Ajouter une couleur";
      bar.parentElement?.appendChild(add);
    }
    add.disabled = gradient.colors.length >= MAX_STOPS;
    add.textContent = gradient.colors.length >= MAX_STOPS
      ? `Maximum ${MAX_STOPS} couleurs`
      : `+ Ajouter une couleur (${gradient.colors.length}/${MAX_STOPS})`;
  }

  function updateGradientColors(scope, updater) {
    const base = scope === "studio" ? clone(studioDraft) : appearanceNow();
    if (!base?.palette) return;
    const gradient = normalizeGradient(base.palette.gradient, base.palette);
    let colors = [...gradient.colors];
    colors = updater(colors).map(validHex).filter(Boolean).slice(0, MAX_STOPS);
    if (colors.length < MIN_STOPS) return;
    const middleIndex = Math.floor((colors.length - 1) / 2);
    base.palette.gradient = {
      ...gradient,
      colors,
      start: colors[0],
      middle: colors[middleIndex],
      end: colors[colors.length - 1]
    };

    if (scope === "studio") {
      studioDraft = previewDraft(base, "Modifications en direct — non enregistrées.");
      return;
    }
    previewDraft(base);
  }

  function addGradientStop(scope) {
    updateGradientColors(scope, (colors) => {
      if (colors.length >= MAX_STOPS) return colors;
      const insertAt = Math.max(1, colors.length - 1);
      const before = colors[insertAt - 1];
      const after = colors[insertAt];
      colors.splice(insertAt, 0, mix(before, after, 0.5));
      return colors;
    });
  }

  function removeGradientStop(scope, index) {
    updateGradientColors(scope, (colors) => {
      if (colors.length <= MIN_STOPS) return colors;
      if (index >= 0 && index < colors.length) colors.splice(index, 1);
      return colors;
    });
  }

  function enhanceSettings() {
    if (enhanced) return true;
    const preview = document.getElementById("peopleSettingsPalettePreview");
    const note = document.querySelector("#peopleSettingsPaletteEditor .people-settings-preview-note");
    const bar = document.querySelector(".people-appearance-gradient-colorbar[data-appearance-gradient-preview]");
    if (!preview || !bar) return false;

    enhanced = true;
    const row = document.createElement("div");
    row.className = "people-theme-studio-launch-row people-appearance-advanced-content";
    row.innerHTML = `
      <div>
        <strong>Aperçu grandeur nature</strong>
        <span>Vois le thème directement sur ton vrai People pendant que tu le modifies.</span>
      </div>
      <button type="button" class="people-settings-secondary" data-people-theme-studio-open>Voir dans People</button>
    `;
    (note || preview).insertAdjacentElement("afterend", row);

    renderStandardGradientEditor();
    return true;
  }

  function studioMarkup() {
    return `
      <aside class="people-theme-studio" data-people-theme-studio hidden>
        <header class="people-theme-studio-head">
          <div><span>APPARENCE</span><strong>Modifier People en direct</strong></div>
          <button type="button" data-people-theme-studio-close aria-label="Fermer">×</button>
        </header>
        <div class="people-theme-studio-scroll">
          <section class="people-theme-studio-section">
            <div class="people-theme-studio-title"><strong>Couleurs principales</strong><span>Modifie les surfaces et l'accent.</span></div>
            <div class="people-theme-studio-palette" data-studio-palette></div>
          </section>
          <section class="people-theme-studio-section">
            <div class="people-theme-studio-title"><strong>Dégradé global</strong><span>Un seul dégradé traverse toute l'interface.</span></div>
            <label class="people-theme-studio-toggle"><span>Activer le dégradé</span><input type="checkbox" data-studio-gradient-enabled /></label>
            <div class="people-theme-studio-gradient-bar" data-studio-gradient-bar></div>
            <button type="button" class="people-gradient-add-stop studio" data-people-gradient-add="studio">+ Ajouter une couleur</button>
            <label class="people-theme-studio-range"><span>Direction <b data-studio-direction-value>135°</b></span><input type="range" min="0" max="360" step="1" data-studio-direction /></label>
            <label class="people-theme-studio-range"><span>Intensité <b data-studio-intensity-value>72%</b></span><input type="range" min="0" max="100" step="1" data-studio-intensity /></label>
          </section>
        </div>
        <footer class="people-theme-studio-footer">
          <span data-studio-status></span>
          <button type="button" class="people-theme-studio-cancel" data-people-theme-studio-cancel>Annuler</button>
          <button type="button" class="people-theme-studio-save" data-people-theme-studio-save>Sauvegarder</button>
        </footer>
      </aside>
    `;
  }

  function ensureStudio() {
    let studio = document.querySelector("[data-people-theme-studio]");
    if (studio) return studio;
    document.body.insertAdjacentHTML("beforeend", studioMarkup());
    return document.querySelector("[data-people-theme-studio]");
  }

  function paletteRow(key, color) {
    const rgb = hexToRgb(color);
    const row = document.createElement("div");
    row.className = "people-theme-studio-color-row";
    row.dataset.studioPaletteRow = key;
    row.innerHTML = `
      <span>${PALETTE_LABELS[key] || key}</span>
      <input type="color" value="${color}" data-studio-palette-color="${key}" />
      <input type="text" maxlength="7" value="${color}" data-studio-palette-hex="${key}" />
      <div class="people-theme-studio-rgb">
        <input type="number" min="0" max="255" value="${rgb.r}" data-studio-rgb="${key}:r" aria-label="Rouge" />
        <input type="number" min="0" max="255" value="${rgb.g}" data-studio-rgb="${key}:g" aria-label="Vert" />
        <input type="number" min="0" max="255" value="${rgb.b}" data-studio-rgb="${key}:b" aria-label="Bleu" />
      </div>
    `;
    return row;
  }

  function renderStudio(appearance = studioDraft || appearanceNow()) {
    if (!appearance?.palette) return;
    const studio = ensureStudio();
    const paletteBox = studio.querySelector("[data-studio-palette]");
    paletteBox.innerHTML = "";
    for (const key of PALETTE_KEYS) {
      paletteBox.appendChild(paletteRow(key, validHex(appearance.palette[key]) || "#000000"));
    }

    const gradient = normalizeGradient(appearance.palette.gradient, appearance.palette);
    const enabled = studio.querySelector("[data-studio-gradient-enabled]");
    const direction = studio.querySelector("[data-studio-direction]");
    const intensity = studio.querySelector("[data-studio-intensity]");
    if (enabled) enabled.checked = gradient.enabled;
    if (direction) direction.value = String(gradient.direction);
    if (intensity) intensity.value = String(gradient.intensity);
    const directionValue = studio.querySelector("[data-studio-direction-value]");
    const intensityValue = studio.querySelector("[data-studio-intensity-value]");
    if (directionValue) directionValue.textContent = `${gradient.direction}°`;
    if (intensityValue) intensityValue.textContent = `${gradient.intensity}%`;

    renderStopBar(studio.querySelector("[data-studio-gradient-bar]"), gradient.colors, gradient.direction, "studio");
    const add = studio.querySelector("[data-people-gradient-add='studio']");
    if (add) {
      add.disabled = gradient.colors.length >= MAX_STOPS;
      add.textContent = gradient.colors.length >= MAX_STOPS
        ? `Maximum ${MAX_STOPS} couleurs`
        : `+ Ajouter une couleur (${gradient.colors.length}/${MAX_STOPS})`;
    }
  }

  function setStudioStatus(text, tone = "") {
    const el = document.querySelector("[data-studio-status]");
    if (!el) return;
    el.textContent = text || "";
    el.dataset.tone = tone;
  }

  function openStudio() {
    const current = appearanceNow();
    if (!current) return;
    const studio = ensureStudio();
    studioOrigin = clone(current);
    studioDraft = clone(current);
    const modal = document.getElementById("peopleSettingsModal");
    settingsModalWasOpen = !!modal && !modal.classList.contains("hidden");
    if (modal) modal.classList.add("hidden");
    document.body.classList.remove("people-settings-open");
    document.body.classList.add("people-theme-studio-open");
    studio.hidden = false;
    studioOpen = true;
    renderStudio(studioDraft);
    setStudioStatus("Modifications non enregistrées.");
  }

  function closeStudio({ restore = false, reopenSettings = false } = {}) {
    const studio = document.querySelector("[data-people-theme-studio]");
    if (restore && studioOrigin) {
      window.PeopleAppearance?.preview?.(studioOrigin);
      dispatchDraft(studioOrigin, "Modifications annulées.");
      queueMicrotask(() => applyGlobalGradient(studioOrigin));
    }
    studioOpen = false;
    studioDraft = null;
    studioOrigin = null;
    if (studio) studio.hidden = true;
    document.body.classList.remove("people-theme-studio-open");
    if (reopenSettings && settingsModalWasOpen) {
      const modal = document.getElementById("peopleSettingsModal");
      modal?.classList.remove("hidden");
      document.body.classList.add("people-settings-open");
    }
    settingsModalWasOpen = false;
  }

  function updateStudioPalette(key, color) {
    if (!studioDraft?.palette || !PALETTE_KEYS.includes(key)) return;
    const normalized = validHex(color);
    if (!normalized) return;
    studioDraft.palette[key] = normalized;
    studioDraft.theme = "custom";
    studioDraft = previewDraft(studioDraft, "Modifications en direct — non enregistrées.");
  }

  document.addEventListener("input", (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target) return;

    if (target.matches("[data-people-gradient-stop]")) {
      const scope = target.dataset.peopleGradientScope || "settings";
      const index = Number(target.dataset.peopleGradientStop);
      const color = validHex(target.value);
      if (!Number.isInteger(index) || !color) return;
      updateGradientColors(scope, (colors) => {
        colors[index] = color;
        return colors;
      });
      return;
    }

    if (!studioOpen) return;

    const paletteColorKey = target.dataset.studioPaletteColor;
    if (paletteColorKey) {
      updateStudioPalette(paletteColorKey, target.value);
      return;
    }

    const paletteHexKey = target.dataset.studioPaletteHex;
    if (paletteHexKey) {
      target.value = target.value.toUpperCase();
      const color = validHex(target.value);
      if (color) updateStudioPalette(paletteHexKey, color);
      return;
    }

    const rgbToken = target.dataset.studioRgb;
    if (rgbToken) {
      const [key] = rgbToken.split(":");
      const row = target.closest("[data-studio-palette-row]");
      const values = [...row.querySelectorAll("[data-studio-rgb]")].map((input) => Number(input.value));
      updateStudioPalette(key, rgbToHex(values[0], values[1], values[2]));
      return;
    }

    if (target.matches("[data-studio-gradient-enabled], [data-studio-direction], [data-studio-intensity]")) {
      const gradient = normalizeGradient(studioDraft.palette.gradient, studioDraft.palette);
      if (target.matches("[data-studio-gradient-enabled]")) gradient.enabled = target.checked;
      if (target.matches("[data-studio-direction]")) gradient.direction = Math.max(0, Math.min(360, Math.round(Number(target.value) || 0)));
      if (target.matches("[data-studio-intensity]")) gradient.intensity = Math.max(0, Math.min(100, Math.round(Number(target.value) || 0)));
      studioDraft.palette.gradient = gradient;
      studioDraft = previewDraft(studioDraft, "Modifications en direct — non enregistrées.");
    }
  }, true);

  document.addEventListener("click", async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("[data-people-theme-studio-open]")) {
      openStudio();
      return;
    }

    const add = target.closest("[data-people-gradient-add]");
    if (add) {
      addGradientStop(add.dataset.peopleGradientAdd || "settings");
      return;
    }

    const remove = target.closest("[data-people-gradient-remove]");
    if (remove) {
      removeGradientStop(remove.dataset.peopleGradientScope || "settings", Number(remove.dataset.peopleGradientRemove));
      return;
    }

    if (target.closest("[data-people-theme-studio-close], [data-people-theme-studio-cancel]")) {
      closeStudio({ restore: true, reopenSettings: true });
      return;
    }

    const save = target.closest("[data-people-theme-studio-save]");
    if (save && studioDraft) {
      save.disabled = true;
      setStudioStatus("Enregistrement…");
      try {
        const confirmed = await window.PeopleAppearance.save(studioDraft);
        applyGlobalGradient(confirmed);
        setStudioStatus("Sauvegardé ✓", "success");
        setTimeout(() => closeStudio({ restore: false, reopenSettings: false }), 320);
      } catch (error) {
        save.disabled = false;
        setStudioStatus(error?.message || "Impossible d'enregistrer.", "error");
      }
    }
  }, true);

  window.addEventListener("people-theme-studio-import", (event) => {
    const palette = event?.detail?.palette;
    if (!palette) return;
    const current = appearanceNow();
    if (!current) return;
    const next = {
      ...current,
      theme: "custom",
      palette: {
        ...current.palette,
        ...clone(palette),
        gradient: normalizeGradient(palette.gradient, palette)
      }
    };
    previewDraft(next, "Thème importé — vérifie l'aperçu puis enregistre.");
  });

  window.addEventListener("people-appearance-changed", () => {
    queueMicrotask(() => {
      const current = appearanceNow();
      applyGlobalGradient(current);
      renderStandardGradientEditor(current);
      if (studioOpen && studioDraft) renderStudio(studioDraft);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && studioOpen) {
      event.preventDefault();
      closeStudio({ restore: true, reopenSettings: true });
    }
  }, true);

  const boot = () => {
    enhanceSettings();
    applyGlobalGradient();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (enhanceSettings() || attempts > 80) clearInterval(timer);
    applyGlobalGradient();
  }, 100);
})();
