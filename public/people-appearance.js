(() => {
  "use strict";

  // === PEOPLE_APPEARANCE_CLIENT_V3_START ===
  const STORAGE_KEY = "people-appearance-v3";
  const LEGACY_STORAGE_KEYS = [
    "people-appearance-v2",
    "people-appearance-v1"
  ];

  const PRESET_PALETTES = Object.freeze({
    dark: Object.freeze({
      background: "#100E1A",
      panel: "#181524",
      secondary: "#090811",
      text: "#F2EFF8",
      accent: "#67589D"
    }),
    midnight: Object.freeze({
      background: "#07090D",
      panel: "#0D1016",
      secondary: "#020306",
      text: "#F4F6F8",
      accent: "#67589D"
    }),
    light: Object.freeze({
      background: "#F2F3F5",
      panel: "#FFFFFF",
      secondary: "#E3E5E8",
      text: "#202225",
      accent: "#67589D"
    })
  });

  const DEFAULT_CUSTOM_PALETTE = Object.freeze({
    ...PRESET_PALETTES.dark
  });

  const DEFAULT_APPEARANCE = Object.freeze({
    theme: "dark",
    palette: Object.freeze({
      ...DEFAULT_CUSTOM_PALETTE
    })
  });

  const THEMES = new Set([
    "dark",
    "midnight",
    "light",
    "system",
    "custom"
  ]);

  const PALETTE_KEYS = Object.freeze([
    "background",
    "panel",
    "secondary",
    "text",
    "accent"
  ]);

  function clone(value) {
    return {
      theme: value.theme,
      palette: {
        ...value.palette
      },
      accent: value.palette.accent
    };
  }

  function normalizeTheme(value) {
    const theme = String(value || "")
      .trim()
      .toLowerCase();

    return THEMES.has(theme)
      ? theme
      : DEFAULT_APPEARANCE.theme;
  }

  function normalizeHex(value, fallback) {
    const color = String(value || "")
      .trim()
      .toUpperCase();

    return /^#[0-9A-F]{6}$/.test(color)
      ? color
      : fallback;
  }

  function normalizePalette(value, legacyAccent) {
    const source =
      value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};

    const base = DEFAULT_CUSTOM_PALETTE;

    return {
      background: normalizeHex(source.background, base.background),
      panel: normalizeHex(source.panel, base.panel),
      secondary: normalizeHex(source.secondary, base.secondary),
      text: normalizeHex(source.text, base.text),
      accent: normalizeHex(source.accent || legacyAccent, base.accent)
    };
  }

  function normalize(value) {
    const appearance =
      value && typeof value === "object"
        ? value
        : {};

    return {
      theme: normalizeTheme(appearance.theme),
      palette: normalizePalette(
        appearance.palette,
        appearance.accent
      )
    };
  }

  function equal(a, b) {
    const left = normalize(a);
    const right = normalize(b);

    return (
      left.theme === right.theme &&
      PALETTE_KEYS.every(
        (key) => left.palette[key] === right.palette[key]
      )
    );
  }

  function readStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeLocal(value) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(normalize(value))
      );
    } catch {}
  }

  function migrateLocal() {
    const modern = readStorage(STORAGE_KEY);
    if (modern) return normalize(modern);

    for (const key of LEGACY_STORAGE_KEYS) {
      const legacy = readStorage(key);
      if (!legacy) continue;

      const migrated = normalize({
        theme: legacy.theme,
        palette: legacy.palette || {
          ...DEFAULT_CUSTOM_PALETTE,
          accent: legacy.accent
        },
        accent: legacy.accent
      });

      writeLocal(migrated);
      return migrated;
    }

    return normalize(DEFAULT_APPEARANCE);
  }

  function hexToRgb(hex) {
    const clean = normalizeHex(hex, "#000000").slice(1);

    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16)
    };
  }

  function rgbToHex({ r, g, b }) {
    const part = (value) =>
      Math.max(0, Math.min(255, Math.round(Number(value) || 0)))
        .toString(16)
        .padStart(2, "0")
        .toUpperCase();

    return "#" + part(r) + part(g) + part(b);
  }

  function mix(hexA, hexB, ratio) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    const t = Math.max(0, Math.min(1, Number(ratio) || 0));

    return rgbToHex({
      r: a.r + (b.r - a.r) * t,
      g: a.g + (b.g - a.g) * t,
      b: a.b + (b.b - a.b) * t
    });
  }

  function rgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function luminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const channel = (value) => {
      const n = value / 255;
      return n <= 0.03928
        ? n / 12.92
        : Math.pow((n + 0.055) / 1.055, 2.4);
    };

    return (
      0.2126 * channel(r) +
      0.7152 * channel(g) +
      0.0722 * channel(b)
    );
  }

  function systemTheme() {
    return window.matchMedia?.(
      "(prefers-color-scheme: light)"
    )?.matches
      ? "light"
      : "dark";
  }

  function resolvedTheme(choice) {
    if (choice === "system") return systemTheme();
    return choice;
  }

  function paletteFor(appearance) {
    if (appearance.theme === "custom") {
      return {
        ...appearance.palette
      };
    }

    const resolved = resolvedTheme(appearance.theme);
    const preset = PRESET_PALETTES[resolved] || PRESET_PALETTES.dark;

    return {
      ...preset
    };
  }

  let committed = migrateLocal();
  let active = normalize(committed);
  let activeRevision = 0;
  let syncSerial = 0;
  let saveSerial = 0;
  let saveQueue = Promise.resolve();

  function dispatchChange(source) {
    const palette = paletteFor(active);

    window.dispatchEvent(
      new CustomEvent("people-appearance-changed", {
        detail: {
          ...clone(active),
          activePalette: palette,
          resolvedTheme: resolvedTheme(active.theme),
          dirty: !equal(active, committed),
          source
        }
      })
    );
  }

  function render(value, options = {}) {
    active = normalize(value);

    const resolved = resolvedTheme(active.theme);
    const palette = paletteFor(active);
    const root = document.documentElement;
    const lightSurface = luminance(palette.background) > 0.48;

    root.dataset.peopleTheme =
      active.theme === "custom"
        ? "custom"
        : resolved;

    root.dataset.peopleThemeChoice = active.theme;
    root.dataset.peopleAppearanceDirty =
      equal(active, committed) ? "false" : "true";
    root.style.colorScheme = lightSurface ? "light" : "dark";

    const surfaceMixTarget = lightSurface ? "#000000" : "#FFFFFF";
    const mutedTarget = palette.background;

    root.style.setProperty("--people-night", palette.background);
    root.style.setProperty("--people-deep", palette.panel);
    root.style.setProperty("--people-ink", palette.secondary);
    root.style.setProperty(
      "--people-surface",
      mix(palette.panel, surfaceMixTarget, lightSurface ? 0.05 : 0.08)
    );
    root.style.setProperty(
      "--people-hover",
      mix(palette.panel, surfaceMixTarget, lightSurface ? 0.09 : 0.13)
    );
    root.style.setProperty(
      "--people-input",
      mix(palette.background, palette.secondary, 0.58)
    );
    root.style.setProperty("--people-text", palette.text);
    root.style.setProperty(
      "--people-muted",
      mix(palette.text, mutedTarget, lightSurface ? 0.42 : 0.36)
    );
    root.style.setProperty(
      "--people-subtle",
      mix(palette.text, mutedTarget, lightSurface ? 0.58 : 0.53)
    );
    root.style.setProperty(
      "--people-border",
      mix(palette.panel, palette.text, lightSurface ? 0.14 : 0.16)
    );
    root.style.setProperty(
      "--people-overlay",
      rgba(palette.secondary, lightSurface ? 0.42 : 0.84)
    );
    root.style.setProperty(
      "--people-danger",
      lightSurface ? "#C73942" : "#DA4B55"
    );

    root.style.setProperty("--people-accent", palette.accent);
    root.style.setProperty(
      "--people-accent-strong",
      mix(palette.accent, "#000000", lightSurface ? 0.12 : 0.15)
    );
    root.style.setProperty(
      "--people-accent-light",
      mix(palette.accent, "#FFFFFF", lightSurface ? 0.08 : 0.24)
    );
    root.style.setProperty(
      "--people-accent-soft",
      rgba(palette.accent, lightSurface ? 0.16 : 0.26)
    );
    root.style.setProperty(
      "--people-accent-faint",
      rgba(palette.accent, lightSurface ? 0.09 : 0.10)
    );
    root.style.setProperty(
      "--people-accent-border",
      rgba(palette.accent, lightSurface ? 0.34 : 0.40)
    );

    if (options.bumpRevision !== false) {
      activeRevision += 1;
    }

    if (options.persist === true) {
      committed = normalize(active);
      writeLocal(committed);
      root.dataset.peopleAppearanceDirty = "false";
    }

    if (options.dispatch !== false) {
      dispatchChange(options.source || "apply");
    }

    return clone(active);
  }

  function preview(value) {
    return render(value, {
      persist: false,
      source: "preview"
    });
  }

  // Backward-compatible helper. It now behaves as a preview by default so
  // unsaved values are never silently persisted. Pass { persist: true } only
  // for trusted, already-confirmed data.
  function apply(value, options = {}) {
    return render(value, {
      persist: options.persist === true || options.local === true,
      bumpRevision: options.bumpRevision,
      dispatch: options.dispatch,
      source: options.source || "apply"
    });
  }

  function discard() {
    return render(committed, {
      persist: false,
      source: "discard"
    });
  }

  async function syncFromServer() {
    const serial = ++syncSerial;
    const revisionAtStart = activeRevision;

    const response = await fetch("/api/settings/appearance", {
      credentials: "same-origin",
      cache: "no-store"
    });

    if (response.status === 401) {
      return clone(active);
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.ok === false || !data?.appearance) {
      throw new Error(
        data?.error || "Impossible de charger l'apparence."
      );
    }

    if (serial !== syncSerial) {
      return clone(active);
    }

    const confirmed = normalize(data.appearance);
    committed = confirmed;
    writeLocal(committed);

    // Never overwrite a preview the user started while the GET was pending.
    if (revisionAtStart === activeRevision) {
      return render(committed, {
        persist: false,
        bumpRevision: false,
        source: "sync"
      });
    }

    document.documentElement.dataset.peopleAppearanceDirty =
      equal(active, committed) ? "false" : "true";
    dispatchChange("sync-background");
    return clone(active);
  }

  function save(value) {
    const wanted = normalize(value);
    const serial = ++saveSerial;

    // Serialize writes. Even if another caller invokes save twice quickly,
    // the server always receives them in the same order as the UI.
    const operation = saveQueue.then(async () => {
      const response = await fetch("/api/settings/appearance", {
        method: "PUT",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          theme: wanted.theme,
          palette: wanted.palette,
          accent: wanted.palette.accent
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.ok === false) {
        throw new Error(
          data?.error || "Impossible d'enregistrer l'apparence."
        );
      }

      const confirmed = normalize(data.appearance || wanted);

      // A newer queued save owns the final visual state. We still update the
      // confirmed snapshot here; the newer operation will replace it after.
      committed = confirmed;
      writeLocal(committed);

      if (serial === saveSerial) {
        return render(committed, {
          persist: false,
          source: "save"
        });
      }

      return clone(active);
    });

    saveQueue = operation.catch(() => {});

    return operation.catch((err) => {
      if (serial === saveSerial) {
        render(committed, {
          persist: false,
          source: "save-error"
        });
      }
      throw err;
    });
  }

  function get() {
    return clone(active);
  }

  function getSaved() {
    return clone(committed);
  }

  function isDirty() {
    return !equal(active, committed);
  }

  function getActivePalette() {
    return {
      ...paletteFor(active)
    };
  }

  window.PeopleAppearance = {
    get,
    getSaved,
    getActivePalette,
    isDirty,
    preview,
    apply,
    discard,
    save,
    syncFromServer,
    presets: PRESET_PALETTES,
    paletteKeys: PALETTE_KEYS,
    defaults: {
      theme: DEFAULT_APPEARANCE.theme,
      palette: {
        ...DEFAULT_APPEARANCE.palette
      }
    },
    utils: {
      hexToRgb,
      rgbToHex,
      normalizeHex: (value, fallback = "#000000") =>
        normalizeHex(value, fallback)
    }
  };

  render(active, {
    persist: false,
    bumpRevision: false,
    dispatch: false,
    source: "boot"
  });

  window.addEventListener("people-authenticated", () => {
    void syncFromServer().catch((err) => {
      console.warn("[People apparence]", err);
    });
  });

  const systemScheme = window.matchMedia?.(
    "(prefers-color-scheme: light)"
  );

  systemScheme?.addEventListener?.("change", () => {
    if (active.theme === "system") {
      render(active, {
        persist: false,
        bumpRevision: false,
        source: "system-theme"
      });
    }
  });
  // === PEOPLE_APPEARANCE_CLIENT_V3_END ===
})();
