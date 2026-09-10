(() => {
  "use strict";

  // === PEOPLE_APPEARANCE_CLIENT_V1_START ===
  const STORAGE_KEY =
    "people-appearance-v1";

  const DEFAULT_APPEARANCE = {
    theme: "dark",
    accent: "#67589D"
  };

  const THEMES = new Set([
    "dark",
    "midnight",
    "light",
    "system"
  ]);

  function normalizeTheme(value) {
    const theme = String(value || "")
      .trim()
      .toLowerCase();

    return THEMES.has(theme)
      ? theme
      : DEFAULT_APPEARANCE.theme;
  }

  function normalizeAccent(value) {
    const accent = String(value || "")
      .trim()
      .toUpperCase();

    return /^#[0-9A-F]{6}$/.test(accent)
      ? accent
      : DEFAULT_APPEARANCE.accent;
  }

  function normalize(value) {
    return {
      theme: normalizeTheme(value?.theme),
      accent: normalizeAccent(value?.accent)
    };
  }

  function readLocal() {
    try {
      return normalize(
        JSON.parse(
          localStorage.getItem(
            STORAGE_KEY
          ) || "{}"
        )
      );
    } catch {
      return {
        ...DEFAULT_APPEARANCE
      };
    }
  }

  function writeLocal(value) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          normalize(value)
        )
      );
    } catch {}
  }

  function hexToRgb(hex) {
    const clean =
      normalizeAccent(hex)
        .slice(1);

    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16)
    };
  }

  function rgbToHex({ r, g, b }) {
    const part = (value) =>
      Math.max(
        0,
        Math.min(
          255,
          Math.round(value)
        )
      )
        .toString(16)
        .padStart(2, "0")
        .toUpperCase();

    return (
      "#" +
      part(r) +
      part(g) +
      part(b)
    );
  }

  function mix(hexA, hexB, ratio) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    const t = Math.max(
      0,
      Math.min(1, Number(ratio) || 0)
    );

    return rgbToHex({
      r: a.r + (b.r - a.r) * t,
      g: a.g + (b.g - a.g) * t,
      b: a.b + (b.b - a.b) * t
    });
  }

  function rgba(hex, alpha) {
    const { r, g, b } =
      hexToRgb(hex);

    return (
      "rgba(" +
      r + "," +
      g + "," +
      b + "," +
      alpha +
      ")"
    );
  }

  function resolvedTheme(choice) {
    if (choice !== "system") {
      return choice;
    }

    return window.matchMedia?.(
      "(prefers-color-scheme: light)"
    )?.matches
      ? "light"
      : "dark";
  }

  let current = readLocal();

  function apply(
    appearance,
    options = {}
  ) {
    current = normalize(appearance);

    const resolved =
      resolvedTheme(current.theme);

    const root =
      document.documentElement;

    root.dataset.peopleTheme =
      resolved;

    root.dataset.peopleThemeChoice =
      current.theme;

    root.style.setProperty(
      "--people-accent",
      current.accent
    );

    root.style.setProperty(
      "--people-accent-strong",
      mix(
        current.accent,
        "#000000",
        resolved === "light"
          ? 0.12
          : 0.15
      )
    );

    root.style.setProperty(
      "--people-accent-light",
      mix(
        current.accent,
        "#FFFFFF",
        resolved === "light"
          ? 0.08
          : 0.24
      )
    );

    root.style.setProperty(
      "--people-accent-soft",
      rgba(
        current.accent,
        resolved === "light"
          ? 0.16
          : 0.26
      )
    );

    root.style.setProperty(
      "--people-accent-faint",
      rgba(
        current.accent,
        resolved === "light"
          ? 0.09
          : 0.10
      )
    );

    root.style.setProperty(
      "--people-accent-border",
      rgba(
        current.accent,
        resolved === "light"
          ? 0.34
          : 0.40
      )
    );

    if (options.local !== false) {
      writeLocal(current);
    }

    window.dispatchEvent(
      new CustomEvent(
        "people-appearance-changed",
        {
          detail: {
            ...current,
            resolvedTheme:
              resolved
          }
        }
      )
    );

    return {
      ...current
    };
  }

  async function syncFromServer() {
    const response = await fetch(
      "/api/settings/appearance",
      {
        credentials: "same-origin"
      }
    );

    if (response.status === 401) {
      return {
        ...current
      };
    }

    const data = await response
      .json()
      .catch(() => ({}));

    if (
      !response.ok ||
      data?.ok === false ||
      !data?.appearance
    ) {
      throw new Error(
        data?.error ||
        "Impossible de charger l'apparence."
      );
    }

    return apply(
      data.appearance
    );
  }

  async function save(appearance) {
    const clean =
      apply(appearance);

    const response = await fetch(
      "/api/settings/appearance",
      {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify(clean)
      }
    );

    const data = await response
      .json()
      .catch(() => ({}));

    if (
      !response.ok ||
      data?.ok === false
    ) {
      throw new Error(
        data?.error ||
        "Impossible d'enregistrer l'apparence."
      );
    }

    return apply(
      data.appearance || clean
    );
  }

  function get() {
    return {
      ...current
    };
  }

  window.PeopleAppearance = {
    get,
    apply,
    save,
    syncFromServer,
    defaults: {
      ...DEFAULT_APPEARANCE
    }
  };

  // Application immédiate avant le rendu du client.
  apply(current, {
    local: false
  });

  window.addEventListener(
    "people-authenticated",
    () => {
      void syncFromServer()
        .catch(
          (err) => {
            console.warn(
              "[People apparence]",
              err
            );
          }
        );
    }
  );

  const systemScheme =
    window.matchMedia?.(
      "(prefers-color-scheme: light)"
    );

  systemScheme?.addEventListener?.(
    "change",
    () => {
      if (
        current.theme ===
        "system"
      ) {
        apply(current, {
          local: false
        });
      }
    }
  );
  // === PEOPLE_APPEARANCE_CLIENT_V1_END ===
})();
