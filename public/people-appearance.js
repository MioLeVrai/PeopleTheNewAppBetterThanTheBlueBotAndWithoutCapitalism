(() => {
  "use strict";

  // === PEOPLE_APPEARANCE_CLIENT_V2_START ===
  const STORAGE_KEY = "people-appearance-v2";
  const LEGACY_STORAGE_KEY = "people-appearance-v1";

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
      value && typeof value === "object"
        ? value
        : {};

    const base = DEFAULT_CUSTOM_PALETTE;

    return {
      background: normalizeHex(
        source.background,
        base.background
      ),
      panel: normalizeHex(
        source.panel,
        base.panel
      ),
      secondary: normalizeHex(
        source.secondary,
        base.secondary
      ),
      text: normalizeHex(
        source.text,
        base.text
      ),
      accent: normalizeHex(
        source.accent || legacyAccent,
        base.accent
      )
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

  function readStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function readLocal() {
    const modern = readStorage(STORAGE_KEY);
    if (modern) return normalize(modern);

    const legacy = readStorage(LEGACY_STORAGE_KEY);
    if (legacy) {
      const migrated = normalize({
        theme: legacy.theme,
        palette: {
          ...DEFAULT_CUSTOM_PALETTE,
          accent: legacy.accent
        }
      });

      writeLocal(migrated);
      return migrated;
    }

    return normalize(DEFAULT_APPEARANCE);
  }

  function writeLocal(value) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(normalize(value))
      );
    } catch {}
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

  let current = readLocal();

  function apply(appearance, options = {}) {
    current = normalize(appearance);

    const resolved = resolvedTheme(current.theme);
    const palette = paletteFor(current);
    const root = document.documentElement;
    const lightSurface = luminance(palette.background) > 0.48;

    root.dataset.peopleTheme =
      current.theme === "custom"
        ? "custom"
        : resolved;

    root.dataset.peopleThemeChoice = current.theme;
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
    root.style.setProperty("--people-danger", lightSurface ? "#C73942" : "#DA4B55");

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

    if (options.local !== false) {
      writeLocal(current);
    }

    window.dispatchEvent(
      new CustomEvent("people-appearance-changed", {
        detail: {
          ...current,
          accent: palette.accent,
          activePalette: palette,
          resolvedTheme: resolved
        }
      })
    );

    return {
      ...current,
      accent: current.palette.accent
    };
  }

  async function syncFromServer() {
    const response = await fetch("/api/settings/appearance", {
      credentials: "same-origin"
    });

    if (response.status === 401) {
      return { ...current };
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.ok === false || !data?.appearance) {
      throw new Error(
        data?.error || "Impossible de charger l'apparence."
      );
    }

    return apply(data.appearance);
  }

  async function save(appearance) {
    const clean = apply(appearance);

    const response = await fetch("/api/settings/appearance", {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        theme: clean.theme,
        palette: clean.palette,
        accent: clean.palette.accent
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.ok === false) {
      throw new Error(
        data?.error || "Impossible d'enregistrer l'apparence."
      );
    }

    return apply(data.appearance || clean);
  }

  function get() {
    return {
      ...current,
      palette: {
        ...current.palette
      },
      accent: current.palette.accent
    };
  }

  function getActivePalette() {
    return {
      ...paletteFor(current)
    };
  }

  window.PeopleAppearance = {
    get,
    getActivePalette,
    apply,
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

  apply(current, { local: false });

  window.addEventListener("people-authenticated", () => {
    void syncFromServer().catch((err) => {
      console.warn("[People apparence]", err);
    });
  });

  const systemScheme = window.matchMedia?.(
    "(prefers-color-scheme: light)"
  );

  systemScheme?.addEventListener?.("change", () => {
    if (current.theme === "system") {
      apply(current, { local: false });
    }
  });
  // === PEOPLE_APPEARANCE_CLIENT_V2_END ===
})();
