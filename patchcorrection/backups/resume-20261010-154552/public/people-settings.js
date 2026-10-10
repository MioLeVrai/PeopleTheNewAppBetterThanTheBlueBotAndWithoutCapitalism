(() => {
  "use strict";

  // === PEOPLE_SETTINGS_V1_START ===

  const profileActions =
    document.querySelector(
      ".profile-actions"
    );

  const profileName =
    document.getElementById(
      "profileName"
    );

  if (
    !profileActions ||
    !profileName
  ) {
    return;
  }

  // ==========================================================
  // SONS PEOPLE
  // ==========================================================

  const SOUND_KEYS = {
    notification:
      "people-settings-notification-sound-v1",
    ringtone:
      "people-settings-ringtone-v1"
  };

  const NOTIFICATION_SOUNDS = [
    {
      id: "classic",
      name: "People classique",
      description:
        "Le double bip actuel de People."
    },
    {
      id: "soft",
      name: ("" + window.PeopleI18n.t("ui_5964d46729") + ""),
      description:
        "Une notification plus douce."
    },
    {
      id: "digital",
      name: "Digital",
      description:
        "Une notification vibe retro comme on aime."
    },
    {
      id: "pop",
      name: "Pop",
      description:
        "Une notification plus petite, rapide et lumineuse."
    }
  ];

  const RINGTONES = [
    {
      id: "people",
      name: "People",
      description:
        "La sonnerie actuelle."
    },
    {
      id: "pulse",
      name: "Pulse",
      description:
        "Une sonnerie rythmée."
    },
    {
      id: "retro",
      name: "Rétro",
      description:
        "Une sonnerie de vieille console."
    },
    {
      id: "calm",
      name: "Calme",
      description:
        "Une sonnerie plus douce et moins agressive."
    },
    {
      id: "bright",
      name: "Claire",
      description:
        "Une sonnerie plus discrète."
    }
  ];

  let audioContext = null;

  function ensureAudio() {
    let created =
      false;

    try {
      if (!audioContext) {
        const AudioCtx =
          window.AudioContext ||
          window.webkitAudioContext;

        if (AudioCtx) {
          audioContext =
            new AudioCtx();

          created =
            true;
        }
      }

      if (
        audioContext?.state ===
        "suspended"
      ) {
        void audioContext
          .resume()
          .catch(
            () => {}
          );
      }
    } catch {}

    if (
      created &&
      audioContext
    ) {
      void window.PeopleAudioDevices
        ?.applyContext?.(
          audioContext
        );
    }

    return audioContext;
  }

  // === PEOPLE_CALL_SOUND_UNLOCK_V5_1_START ===
  async function ensureAudioReady() {
    const ctx =
      ensureAudio();

    if (!ctx) {
      return null;
    }

    try {
      if (
        ctx.state ===
        "suspended"
      ) {
        await ctx.resume();
      }
    } catch {}

    if (
      ctx.state !==
      "running"
    ) {
      return null;
    }

    try {
      void window.PeopleAudioDevices
        ?.applyContext?.(
          ctx
        );
    } catch {}

    return ctx;
  }

  function unlockPeopleAudioFromGesture() {
    void ensureAudioReady();
  }

  document.addEventListener(
    "pointerdown",
    unlockPeopleAudioFromGesture,
    {
      once: true,
      capture: true
    }
  );

  document.addEventListener(
    "keydown",
    unlockPeopleAudioFromGesture,
    {
      once: true,
      capture: true
    }
  );
  // === PEOPLE_CALL_SOUND_UNLOCK_V5_1_END ===

  // === PEOPLE_AUDIO_DEVICES_V1_START ===
  const AUDIO_DEVICE_KEYS = {
    input:
      "people-audio-input-device-v1",
    output:
      "people-audio-output-device-v1",
    camera:
      "people-video-input-device-v1"
  };

  const PEOPLE_BASE_AUDIO_CONSTRAINTS = {
    echoCancellation:
      true,
    noiseSuppression:
      true,
    autoGainControl:
      true,
    channelCount:
      1
  };

  function audioDeviceValue(
    kind
  ) {
    try {
      return (
        localStorage.getItem(
          AUDIO_DEVICE_KEYS[
            kind
          ]
        ) || ""
      );
    } catch {
      return "";
    }
  }

  function saveAudioDeviceValue(
    kind,
    value
  ) {
    try {
      localStorage.setItem(
        AUDIO_DEVICE_KEYS[
          kind
        ],
        String(
          value || ""
        )
      );
    } catch {}
  }

  function inputConstraints() {
    const deviceId =
      audioDeviceValue(
        "input"
      );

    return {
      ...PEOPLE_BASE_AUDIO_CONSTRAINTS,
      ...(
        deviceId
          ? {
              deviceId: {
                exact:
                  deviceId
              }
            }
          : {}
      )
    };
  }

  function cameraConstraints(
    base = {}
  ) {
    const deviceId =
      audioDeviceValue(
        "camera"
      );

    const constraints = {
      ...(base || {})
    };

    if (deviceId) {
      delete constraints.facingMode;

      constraints.deviceId = {
        exact:
          deviceId
      };
    }

    return constraints;
  }

  async function applyOutput(
    element
  ) {
    if (
      !element ||
      typeof element.setSinkId !==
        "function"
    ) {
      return false;
    }

    const deviceId =
      audioDeviceValue(
        "output"
      );

    try {
      await element.setSinkId(
        deviceId ||
        "default"
      );

      return true;
    } catch (err) {
      console.warn(
        "[People sortie audio]",
        err
      );

      return false;
    }
  }

  async function applyContext(
    context
  ) {
    if (
      !context ||
      typeof context.setSinkId !==
        "function"
    ) {
      return false;
    }

    const deviceId =
      audioDeviceValue(
        "output"
      );

    try {
      await context.setSinkId(
        deviceId ||
        "default"
      );

      return true;
    } catch {
      return false;
    }
  }

  async function applyOutputToAll() {
    const audioElements =
      [
        ...document.querySelectorAll(
          "audio"
        )
      ];

    await Promise.allSettled(
      audioElements.map(
        (element) =>
          applyOutput(
            element
          )
      )
    );

    if (audioContext) {
      await applyContext(
        audioContext
      );
    }
  }

  window.PeopleAudioDevices = {
    getInputId() {
      return audioDeviceValue(
        "input"
      );
    },

    getOutputId() {
      return audioDeviceValue(
        "output"
      );
    },

    getCameraId() {
      return audioDeviceValue(
        "camera"
      );
    },

    getInputConstraints:
      inputConstraints,

    getCameraConstraints:
      cameraConstraints,

    setInputId(
      value
    ) {
      const next =
        String(
          value || ""
        );

      if (
        audioDeviceValue(
          "input"
        ) ===
        next
      ) {
        return;
      }

      saveAudioDeviceValue(
        "input",
        next
      );

      window.dispatchEvent(
        new CustomEvent(
          "people-audio-input-device-changed",
          {
            detail: {
              deviceId:
                next
            }
          }
        )
      );
    },

    setCameraId(
      value
    ) {
      const next =
        String(
          value || ""
        );

      if (
        audioDeviceValue(
          "camera"
        ) ===
        next
      ) {
        return;
      }

      saveAudioDeviceValue(
        "camera",
        next
      );

      window.dispatchEvent(
        new CustomEvent(
          "people-camera-input-device-changed",
          {
            detail: {
              deviceId:
                next
            }
          }
        )
      );
    },

    setOutputId(
      value
    ) {
      const next =
        String(
          value || ""
        );

      if (
        audioDeviceValue(
          "output"
        ) ===
        next
      ) {
        return;
      }

      saveAudioDeviceValue(
        "output",
        next
      );

      void applyOutputToAll();

      window.dispatchEvent(
        new CustomEvent(
          "people-audio-output-device-changed",
          {
            detail: {
              deviceId:
                next
            }
          }
        )
      );
    },

    applyOutput,
    applyOutputToAll,
    applyContext
  };
  // === PEOPLE_AUDIO_DEVICES_V1_END ===

  function storedSound(
    key,
    fallback
  ) {
    try {
      const value =
        localStorage.getItem(
          key
        );

      return value ||
        fallback;
    } catch {
      return fallback;
    }
  }

  function storeSound(
    key,
    value
  ) {
    try {
      localStorage.setItem(
        key,
        String(value)
      );
    } catch {}
  }

  function note(
    frequency,
    startDelay,
    duration,
    volume,
    type = "sine"
  ) {
    const ctx =
      ensureAudio();

    if (
      !ctx ||
      ctx.state !==
        "running"
    ) {
      return;
    }

    const start =
      ctx.currentTime +
      Math.max(
        0,
        startDelay
      );

    const oscillator =
      ctx.createOscillator();

    const gain =
      ctx.createGain();

    oscillator.type =
      type;

    oscillator.frequency
      .setValueAtTime(
        frequency,
        start
      );

    gain.gain
      .setValueAtTime(
        0.0001,
        start
      );

    gain.gain
      .exponentialRampToValueAtTime(
        Math.max(
          0.001,
          volume
        ),
        start + 0.012
      );

    gain.gain
      .exponentialRampToValueAtTime(
        0.0001,
        start + duration
      );

    oscillator.connect(
      gain
    );

    gain.connect(
      ctx.destination
    );

    oscillator.start(
      start
    );

    oscillator.stop(
      start +
      duration +
      0.04
    );
  }

  function playNotification(
    forcedId = ""
  ) {
    const id =
      forcedId ||
      storedSound(
        SOUND_KEYS.notification,
        "classic"
      );

    ensureAudio();

    if (
      id ===
      "soft"
    ) {
      note(
        660,
        0,
        0.14,
        0.075,
        "sine"
      );

      note(
        880,
        0.11,
        0.15,
        0.065,
        "sine"
      );

      return true;
    }

    if (
      id ===
      "digital"
    ) {
      note(
        1046,
        0,
        0.09,
        0.08,
        "square"
      );

      note(
        784,
        0.1,
        0.09,
        0.07,
        "square"
      );

      note(
        1175,
        0.2,
        0.1,
        0.065,
        "square"
      );

      return true;
    }

    if (
      id ===
      "pop"
    ) {
      note(
        988,
        0,
        0.08,
        0.08,
        "triangle"
      );

      note(
        1318,
        0.08,
        0.1,
        0.07,
        "triangle"
      );

      return true;
    }

    note(
      880,
      0,
      0.16,
      0.16,
      "sine"
    );

    note(
      1175,
      0.12,
      0.16,
      0.16,
      "sine"
    );

    return true;
  }

  function playRingtonePulse(
    kind = "incoming",
    forcedId = ""
  ) {
    const id =
      forcedId ||
      storedSound(
        SOUND_KEYS.ringtone,
        "people"
      );

    ensureAudio();

    const incoming =
      kind ===
      "incoming";

    if (
      !incoming
    ) {
      /*
        La tonalité d'attente de l'appelant
        reste plus discrète, quel que soit
        le choix de sonnerie.
      */
      note(
        440,
        0,
        0.14,
        0.045,
        "sine"
      );

      note(
        554,
        0.2,
        0.14,
        0.045,
        "sine"
      );

      return true;
    }

    if (
      id ===
      "pulse"
    ) {
      note(
        659,
        0,
        0.12,
        0.075,
        "triangle"
      );

      note(
        784,
        0.18,
        0.12,
        0.075,
        "triangle"
      );

      note(
        988,
        0.36,
        0.16,
        0.07,
        "triangle"
      );

      return true;
    }

    if (
      id ===
      "retro"
    ) {
      note(
        523,
        0,
        0.13,
        0.07,
        "square"
      );

      note(
        659,
        0.16,
        0.13,
        0.07,
        "square"
      );

      note(
        523,
        0.32,
        0.13,
        0.065,
        "square"
      );

      note(
        784,
        0.49,
        0.18,
        0.065,
        "square"
      );

      return true;
    }

    if (
      id ===
      "calm"
    ) {
      note(
        523,
        0,
        0.24,
        0.055,
        "sine"
      );

      note(
        659,
        0.28,
        0.25,
        0.052,
        "sine"
      );

      note(
        784,
        0.58,
        0.3,
        0.048,
        "sine"
      );

      return true;
    }

    if (
      id ===
      "bright"
    ) {
      note(
        988,
        0,
        0.12,
        0.07,
        "triangle"
      );

      note(
        1318,
        0.16,
        0.12,
        0.07,
        "triangle"
      );

      note(
        1568,
        0.34,
        0.18,
        0.065,
        "triangle"
      );

      return true;
    }

    note(
      784,
      0,
      0.18,
      0.075,
      "sine"
    );

    note(
      988,
      0.24,
      0.2,
      0.075,
      "sine"
    );

    note(
      784,
      0.52,
      0.18,
      0.065,
      "sine"
    );

    return true;
  }

  // === PEOPLE_CALL_EVENT_SOUNDS_V5_1_START ===
  /*
    Sons join / leave / mute / unmute communs aux vocaux serveur
    et aux appels MP. Le contexte audio est explicitement reveille
    avant de programmer les notes : le premier evenement n'est donc
    plus perdu quand Chrome suspend Web Audio.
  */
  function playCallEvent(
    kind = "join"
  ) {
    const event =
      String(
        kind ||
        "join"
      ).toLowerCase();

    void (async () => {
      const ctx =
        await ensureAudioReady();

      if (!ctx) {
        return;
      }

      if (
        event ===
        "mute"
      ) {
        note(
          220,
          0,
          0.07,
          0.052,
          "triangle"
        );

        note(
          165,
          0.055,
          0.1,
          0.042,
          "sine"
        );

        return;
      }

      if (
        event ===
        "unmute"
      ) {
        note(
          392,
          0,
          0.065,
          0.05,
          "triangle"
        );

        note(
          587,
          0.055,
          0.105,
          0.047,
          "sine"
        );

        return;
      }

      if (
        event ===
        "leave"
      ) {
        note(
          659,
          0,
          0.1,
          0.055,
          "sine"
        );

        note(
          494,
          0.085,
          0.12,
          0.052,
          "sine"
        );

        note(
          330,
          0.175,
          0.14,
          0.045,
          "sine"
        );

        return;
      }

      note(
        392,
        0,
        0.08,
        0.05,
        "sine"
      );

      note(
        523,
        0.065,
        0.11,
        0.055,
        "sine"
      );

      note(
        659,
        0.145,
        0.15,
        0.05,
        "sine"
      );
    })();

    return true;
  }
  // === PEOPLE_CALL_EVENT_SOUNDS_V5_1_END ===

  window.PeopleSounds = {
    playNotification,
    playRingtonePulse,
    playCallEvent,

    getNotificationSound() {
      return storedSound(
        SOUND_KEYS.notification,
        "classic"
      );
    },

    setNotificationSound(
      value
    ) {
      const exists =
        NOTIFICATION_SOUNDS
          .some(
            (item) =>
              item.id ===
              value
          );

      if (!exists) {
        return false;
      }

      storeSound(
        SOUND_KEYS.notification,
        value
      );

      return true;
    },

    getRingtone() {
      return storedSound(
        SOUND_KEYS.ringtone,
        "people"
      );
    },

    setRingtone(
      value
    ) {
      const exists =
        RINGTONES
          .some(
            (item) =>
              item.id ===
              value
          );

      if (!exists) {
        return false;
      }

      storeSound(
        SOUND_KEYS.ringtone,
        value
      );

      return true;
    }
  };

  let audioUnlockBound =
    true;

  function removeAudioUnlockListeners() {
    if (!audioUnlockBound) {
      return;
    }

    audioUnlockBound =
      false;

    document.removeEventListener(
      "pointerdown",
      unlockAudioFromGesture
    );

    document.removeEventListener(
      "keydown",
      unlockAudioFromGesture
    );
  }

  function unlockAudioFromGesture() {
    const ctx =
      ensureAudio();

    if (!ctx) {
      removeAudioUnlockListeners();
      return;
    }

    if (
      ctx.state ===
      "running"
    ) {
      removeAudioUnlockListeners();
      return;
    }

    ctx.resume?.()
      .then(
        () => {
          if (
            ctx.state ===
            "running"
          ) {
            removeAudioUnlockListeners();
          }
        }
      )
      .catch(
        () => {}
      );
  }

  document.addEventListener(
    "pointerdown",
    unlockAudioFromGesture,
    {
      passive: true
    }
  );

  document.addEventListener(
    "keydown",
    unlockAudioFromGesture
  );

  // ==========================================================
  // BOUTON PARAMÈTRES
  // ==========================================================

  const settingsButton =
    document.createElement(
      "button"
    );

  settingsButton.id =
    "peopleSettingsButton";

  settingsButton.className =
    "icon-btn people-settings-button";

  settingsButton.type =
    "button";

  settingsButton.title =
    ("" + window.PeopleI18n.t("ui_74a883a037") + "");

  settingsButton.setAttribute(
    "aria-label",
    ("" + window.PeopleI18n.t("ui_3f940108cb") + "")
  );

  settingsButton.textContent =
    "⚙️";

  profileActions.appendChild(
    settingsButton
  );

  // ==========================================================
  // MODALE PARAMÈTRES
  // ==========================================================

  const modal =
    document.createElement(
      "div"
    );

  modal.id =
    "peopleSettingsModal";

  modal.className =
    "people-settings-modal hidden";

  modal.innerHTML = `
    <div
      class="people-settings-backdrop"
      data-settings-close="1"
    ></div>

    <section
      class="people-settings-shell"
      role="dialog"
      aria-modal="true"
      aria-label="${window.PeopleI18n.t("ui_16c9b02227")}"
    >
      <aside
        class="people-settings-nav"
      >
        <div
          class="people-settings-nav-head"
        >
          <span>PEOPLE</span>
          <strong>${window.PeopleI18n.t("ui_74a883a037")}</strong>
        </div>

        <button
          class="people-settings-tab active"
          type="button"
          data-settings-tab="profile"
        >
          <span>👤</span>
          ${window.PeopleI18n.t("ui_d696a35bdd")}
        </button>

        <button
          class="people-settings-tab"
          type="button"
          data-settings-tab="appearance"
        >
          <span>🎨</span>
          ${window.PeopleI18n.t("ui_3907fa7f80")}
        </button>

        <button
          class="people-settings-tab"
          type="button"
          data-settings-tab="sounds"
        >
          <span>🔔</span>
          ${window.PeopleI18n.t("ui_6f305c4b18")}
        </button>
      </aside>

      <main
        class="people-settings-content"
      >
        <button
          id="peopleSettingsClose"
          class="people-settings-close"
          type="button"
          aria-label="${window.PeopleI18n.t("ui_7d9eb7acb1")}"
        >✕</button>

        <section
          class="people-settings-page active"
          data-settings-page="profile"
        >
          <div
            class="people-settings-page-head"
          >
            <span>${window.PeopleI18n.t("ui_63931eea0e")}</span>
            <h2>${window.PeopleI18n.t("ui_d696a35bdd")}</h2>
            <p>
              ${window.PeopleI18n.t("ui_931e5b72a5")}
            </p>
          </div>

          <div
            class="people-settings-profile-card"
          >
            <div
              class="people-settings-avatar-column"
            >
              <div
                id="peopleSettingsAvatar"
                class="people-settings-avatar"
              >?</div>

              <button
                id="peopleSettingsAvatarButton"
                class="people-settings-secondary"
                type="button"
              >
                ${window.PeopleI18n.t("ui_c6bc15c0f0")}
              </button>

              <input
                id="peopleSettingsAvatarInput"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                hidden
              />
            </div>

            <div
              class="people-settings-profile-copy"
            >
              <label>
                ${window.PeopleI18n.t("ui_e3b89e9d33")}
              </label>

              <div
                id="peopleSettingsUsername"
                class="people-settings-readonly"
              >
                —
              </div>

              <small>
                ${window.PeopleI18n.t("ui_309d1a1b31")}
              </small>
            </div>
          </div>

          <div
            class="people-settings-section"
          >
            <div
              class="people-settings-section-title"
            >
              <div>
                <strong>Bio</strong>
                <span>
                  ${window.PeopleI18n.t("ui_e1f3b1081c")}
                </span>
              </div>

              <span
                id="peopleSettingsBioCounter"
                class="people-settings-counter"
              >0/280</span>
            </div>

            <textarea
              id="peopleSettingsBio"
              maxlength="280"
              placeholder="${window.PeopleI18n.t("ui_c57e3f7a13")}"
            ></textarea>

            <div
              class="people-settings-actions"
            >
              <span
                id="peopleSettingsProfileStatus"
                class="people-settings-status"
              ></span>

              <button
                id="peopleSettingsSaveProfile"
                class="people-settings-primary"
                type="button"
              >
                ${window.PeopleI18n.t("ui_35322b5bb5")}
              </button>
            </div>
          </div>
        </section>

        <section
          class="people-settings-page"
          data-settings-page="appearance"
        >
          <div
            class="people-settings-page-head"
          >
            <span>${window.PeopleI18n.t("ui_3598197fe8")}</span>
            <h2>${window.PeopleI18n.t("ui_3907fa7f80")}</h2>
            <p>
              ${window.PeopleI18n.t("ui_e6f3bdc8c7")}
            </p>
          </div>

          <div
            class="people-settings-section"
          >
            <div
              class="people-settings-section-title"
            >
              <div>
                <strong>${window.PeopleI18n.t("ui_954f93fe1c")}</strong>
                <span>
                  ${window.PeopleI18n.t("ui_344afa1480")}
                </span>
              </div>
            </div>

            <div
              id="peopleSettingsThemes"
              class="people-settings-theme-grid"
            >
              <button
                class="people-settings-theme-card"
                type="button"
                data-appearance-theme="dark"
              >
                <span class="people-settings-theme-preview people-theme-preview-dark">
                  <i></i><b></b><em></em>
                </span>
                <strong>${window.PeopleI18n.t("ui_60acc53f13")}</strong>
                <small>${window.PeopleI18n.t("ui_56e70740f8")}</small>
              </button>

              <button
                class="people-settings-theme-card"
                type="button"
                data-appearance-theme="midnight"
              >
                <span class="people-settings-theme-preview people-theme-preview-midnight">
                  <i></i><b></b><em></em>
                </span>
                <strong>${window.PeopleI18n.t("ui_aa996cf21f")}</strong>
                <small>${window.PeopleI18n.t("ui_678c2290b7")}</small>
              </button>

              <button
                class="people-settings-theme-card"
                type="button"
                data-appearance-theme="light"
              >
                <span class="people-settings-theme-preview people-theme-preview-light">
                  <i></i><b></b><em></em>
                </span>
                <strong>${window.PeopleI18n.t("ui_dbcd5e7bb7")}</strong>
                <small>${window.PeopleI18n.t("ui_c0e8b9e9c7")}</small>
              </button>

              <button
                class="people-settings-theme-card"
                type="button"
                data-appearance-theme="system"
              >
                <span class="people-settings-theme-preview people-theme-preview-system">
                  <i></i><b></b><em></em>
                </span>
                <strong>${window.PeopleI18n.t("ui_6725e7bbcd")}</strong>
                <small>${window.PeopleI18n.t("ui_814d15cfb1")}</small>
              </button>

              <button
                class="people-settings-theme-card"
                type="button"
                data-appearance-theme="custom"
              >
                <span class="people-settings-theme-preview people-theme-preview-custom">
                  <i></i><b></b><em></em>
                </span>
                <strong>${window.PeopleI18n.t("ui_494ca78f73")}</strong>
                <small>${window.PeopleI18n.t("ui_6ae2970397")}</small>
              </button>
            </div>
          </div>

          <div
            id="peopleSettingsPaletteEditor"
            class="people-settings-section people-settings-palette-editor"
          >
            <div
              class="people-settings-section-title people-settings-palette-title"
            >
              <div>
                <strong>${window.PeopleI18n.t("ui_02f96b9343")}</strong>
                <span>
                  ${window.PeopleI18n.t("ui_09d2347687")}
                </span>
              </div>

              <span
                id="peopleSettingsCustomBadge"
                class="people-settings-custom-badge"
              >${window.PeopleI18n.t("ui_494ca78f73")}</span>
            </div>

            <div
              id="peopleSettingsPalettePreview"
              class="people-settings-palette-preview"
              aria-label="${window.PeopleI18n.t("ui_ac5002b4af")}"
            >
              <div class="people-settings-preview-rail">
                <span class="people-settings-preview-rail-icon active">⌂</span>
                <span class="people-settings-preview-rail-separator"></span>
                <span class="people-settings-preview-rail-icon">PE</span>
                <span class="people-settings-preview-rail-icon">SE</span>
                <span class="people-settings-preview-rail-icon add">+</span>
              </div>

              <div class="people-settings-preview-sidebar">
                <div class="people-settings-preview-sidebar-head">
                  <span class="people-settings-preview-home-icon">⌂</span>
                  <span class="people-settings-preview-head-copy">
                    <b>${window.PeopleI18n.t("ui_3a78695388")}</b>
                    <i>${window.PeopleI18n.t("ui_3efbf04fd3")}</i>
                  </span>
                </div>

                <div class="people-settings-preview-nav active">
                  <span>●●</span>
                  <b>${window.PeopleI18n.t("ui_bd104d1b98")}</b>
                </div>

                <div class="people-settings-preview-label">${window.PeopleI18n.t("ui_4d645258f9")}</div>

                <div class="people-settings-preview-dm-list">
                  <span class="people-settings-preview-dm"><i></i><b></b></span>
                  <span class="people-settings-preview-dm"><i></i><b></b></span>
                  <span class="people-settings-preview-dm"><i></i><b></b></span>
                  <span class="people-settings-preview-dm"><i></i><b></b></span>
                </div>

                <div class="people-settings-preview-profile">
                  <i></i>
                  <span><b></b><em></em></span>
                  <strong>•••</strong>
                </div>
              </div>

              <div class="people-settings-preview-main">
                <div class="people-settings-preview-topbar">
                  <span><b>${window.PeopleI18n.t("ui_bd104d1b98")}</b><i>${window.PeopleI18n.t("ui_7310659deb")}</i></span>
                </div>

                <div class="people-settings-preview-content">
                  <div class="people-settings-preview-search-card">
                    <b>${window.PeopleI18n.t("ui_c070d28bbe")}</b>
                    <i></i>
                    <span></span>
                  </div>

                  <div class="people-settings-preview-section-title">
                    <b>${window.PeopleI18n.t("ui_018c62e292")}</b><span>0</span>
                  </div>

                  <div class="people-settings-preview-request-grid">
                    <div><b>${window.PeopleI18n.t("ui_4118a9cff9")}</b><i></i></div>
                    <div><b>${window.PeopleI18n.t("ui_608dbf6658")}</b><i></i></div>
                  </div>

                  <div class="people-settings-preview-section-title friends">
                    <b>${window.PeopleI18n.t("ui_dc5a40b1c1")}</b><span>6</span>
                  </div>

                  <div class="people-settings-preview-friends">
                    <div class="people-settings-preview-friend">
                      <i></i><span><b></b><em></em></span><strong></strong><strong></strong>
                    </div>
                    <div class="people-settings-preview-friend">
                      <i></i><span><b></b><em></em></span><strong></strong><strong></strong>
                    </div>
                    <div class="people-settings-preview-friend">
                      <i></i><span><b></b><em></em></span><strong></strong><strong></strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="people-settings-preview-note">
              ${window.PeopleI18n.t("ui_82ffe25667")}
            </div>

            <div class="people-settings-palette-list">
              <div class="people-settings-palette-row" data-palette-key="background">
                <div class="people-settings-palette-copy">
                  <strong>${window.PeopleI18n.t("ui_e02ff63f05")}</strong>
                  <span>${window.PeopleI18n.t("ui_16b9c86c73")}</span>
                </div>
                <input type="color" value="#100E1A" data-palette-picker="background" aria-label="${window.PeopleI18n.t("ui_e02ff63f05")}" />
                <input class="people-settings-hex-input" type="text" value="#100E1A" maxlength="7" spellcheck="false" data-palette-hex="background" aria-label="${window.PeopleI18n.t("ui_fe5a8684bc")}" />
                <div class="people-settings-rgb" data-palette-rgb="background">
                  <label>R<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="r" /></label>
                  <label>G<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="g" /></label>
                  <label>B<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="b" /></label>
                </div>
              </div>

              <div class="people-settings-palette-row" data-palette-key="panel">
                <div class="people-settings-palette-copy">
                  <strong>${window.PeopleI18n.t("ui_d010ff3906")}</strong>
                  <span>${window.PeopleI18n.t("ui_54644ee4e5")}</span>
                </div>
                <input type="color" value="#181524" data-palette-picker="panel" aria-label="${window.PeopleI18n.t("ui_d010ff3906")}" />
                <input class="people-settings-hex-input" type="text" value="#181524" maxlength="7" spellcheck="false" data-palette-hex="panel" aria-label="${window.PeopleI18n.t("ui_8f9d16b5da")}" />
                <div class="people-settings-rgb" data-palette-rgb="panel">
                  <label>R<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="r" /></label>
                  <label>G<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="g" /></label>
                  <label>B<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="b" /></label>
                </div>
              </div>

              <div class="people-settings-palette-row" data-palette-key="secondary">
                <div class="people-settings-palette-copy">
                  <strong>${window.PeopleI18n.t("ui_4b2919fe2c")}</strong>
                  <span>${window.PeopleI18n.t("ui_81ee0152cc")}</span>
                </div>
                <input type="color" value="#090811" data-palette-picker="secondary" aria-label="${window.PeopleI18n.t("ui_4b2919fe2c")}" />
                <input class="people-settings-hex-input" type="text" value="#090811" maxlength="7" spellcheck="false" data-palette-hex="secondary" aria-label="${window.PeopleI18n.t("ui_690307a14a")}" />
                <div class="people-settings-rgb" data-palette-rgb="secondary">
                  <label>R<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="r" /></label>
                  <label>G<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="g" /></label>
                  <label>B<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="b" /></label>
                </div>
              </div>

              <div class="people-settings-palette-row" data-palette-key="text">
                <div class="people-settings-palette-copy">
                  <strong>${window.PeopleI18n.t("ui_dc299d2d90")}</strong>
                  <span>${window.PeopleI18n.t("ui_d7eca5b338")}</span>
                </div>
                <input type="color" value="#F2EFF8" data-palette-picker="text" aria-label="${window.PeopleI18n.t("ui_dc299d2d90")}" />
                <input class="people-settings-hex-input" type="text" value="#F2EFF8" maxlength="7" spellcheck="false" data-palette-hex="text" aria-label="${window.PeopleI18n.t("ui_514e9e8506")}" />
                <div class="people-settings-rgb" data-palette-rgb="text">
                  <label>R<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="r" /></label>
                  <label>G<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="g" /></label>
                  <label>B<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="b" /></label>
                </div>
              </div>

              <div class="people-settings-palette-row" data-palette-key="accent">
                <div class="people-settings-palette-copy">
                  <strong>Accent</strong>
                  <span>${window.PeopleI18n.t("ui_2614d6688c")}</span>
                </div>
                <input type="color" value="#67589D" data-palette-picker="accent" aria-label="Accent" />
                <input class="people-settings-hex-input" type="text" value="#67589D" maxlength="7" spellcheck="false" data-palette-hex="accent" aria-label="${window.PeopleI18n.t("ui_fd36df7331")}" />
                <div class="people-settings-rgb" data-palette-rgb="accent">
                  <label>R<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="r" /></label>
                  <label>G<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="g" /></label>
                  <label>B<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="b" /></label>
                </div>
              </div>
            </div>

            <div
              class="people-settings-actions"
            >
              <span
                id="peopleSettingsAppearanceStatus"
                class="people-settings-status"
              ></span>

              <button
                id="peopleSettingsAppearanceCancel"
                class="people-settings-secondary"
                type="button"
                disabled
              >
                ${window.PeopleI18n.t("ui_19766ed6cc")}
              </button>

              <button
                id="peopleSettingsAppearanceReset"
                class="people-settings-secondary"
                type="button"
              >
                ${window.PeopleI18n.t("ui_610b7468ce")}
              </button>

              <button
                id="peopleSettingsAppearanceSave"
                class="people-settings-primary"
                type="button"
                disabled
              >
                ${window.PeopleI18n.t("ui_35322b5bb5")}
              </button>
            </div>
          </div>
        </section>

        <section
          class="people-settings-page"
          data-settings-page="sounds"
        >
          <div
            class="people-settings-page-head"
          >
            <span>AUDIO</span>
            <h2>${window.PeopleI18n.t("ui_6f305c4b18")}</h2>
            <p>
              ${window.PeopleI18n.t("ui_5272617c1f")}
            </p>
          </div>

          <div
            class="people-settings-section people-settings-audio-devices"
          >
            <div
              class="people-settings-section-title"
            >
              <div>
                <strong>${window.PeopleI18n.t("ui_90c9d8de7a")}</strong>
                <span>
                  ${window.PeopleI18n.t("ui_80a6f9d129")}
                </span>
              </div>
            </div>

            <div
              class="people-settings-device-grid"
            >
              <label
                class="people-settings-device-field"
              >
                <span>${window.PeopleI18n.t("ui_8042fd7c1b")}</span>

                <select
                  id="peopleSettingsAudioInput"
                >
                  <option value="">
                    ${window.PeopleI18n.t("ui_6b4a8c64d6")}
                  </option>
                </select>
              </label>

              <label
                class="people-settings-device-field"
              >
                <span>${window.PeopleI18n.t("ui_e222cb81a8")}</span>

                <select
                  id="peopleSettingsAudioOutput"
                >
                  <option value="">
                    ${window.PeopleI18n.t("ui_ec736c0471")}
                  </option>
                </select>
              </label>
            </div>

            <div
              class="people-settings-device-actions"
            >
              <span
                id="peopleSettingsAudioDeviceStatus"
                class="people-settings-device-status"
              ></span>

              <button
                id="peopleSettingsAudioRefresh"
                class="people-settings-secondary"
                type="button"
              >
                ${window.PeopleI18n.t("ui_f4580acacf")}
              </button>
            </div>
          </div>

          <div
            class="people-settings-section"
          >
            <div
              class="people-settings-section-title"
            >
              <div>
                <strong>${window.PeopleI18n.t("ui_2cfecf2a37")}</strong>
                <span>
                  ${window.PeopleI18n.t("ui_19d0c5ee7c")}
                </span>
              </div>
            </div>

            <div
              id="peopleSettingsRingtones"
              class="people-settings-sound-grid"
            ></div>
          </div>

          <div
            class="people-settings-section"
          >
            <div
              class="people-settings-section-title"
            >
              <div>
                <strong>Notifications</strong>
                <span>
                  ${window.PeopleI18n.t("ui_0a7d692438")}
                </span>
              </div>
            </div>

            <div
              id="peopleSettingsNotifications"
              class="people-settings-sound-grid"
            ></div>
          </div>
        </section>
      </main>
    </section>
  `;

  document.body.appendChild(
    modal
  );

  const closeButton =
    document.getElementById(
      "peopleSettingsClose"
    );

  const avatar =
    document.getElementById(
      "peopleSettingsAvatar"
    );

  const avatarButton =
    document.getElementById(
      "peopleSettingsAvatarButton"
    );

  const avatarInput =
    document.getElementById(
      "peopleSettingsAvatarInput"
    );

  const username =
    document.getElementById(
      "peopleSettingsUsername"
    );

  const bio =
    document.getElementById(
      "peopleSettingsBio"
    );

  const bioCounter =
    document.getElementById(
      "peopleSettingsBioCounter"
    );

  const saveProfile =
    document.getElementById(
      "peopleSettingsSaveProfile"
    );

  const profileStatus =
    document.getElementById(
      "peopleSettingsProfileStatus"
    );

  const appearanceThemes =
    document.getElementById(
      "peopleSettingsThemes"
    );

  const appearancePaletteEditor =
    document.getElementById(
      "peopleSettingsPaletteEditor"
    );

  const appearancePalettePreview =
    document.getElementById(
      "peopleSettingsPalettePreview"
    );

  const appearanceCustomBadge =
    document.getElementById(
      "peopleSettingsCustomBadge"
    );

  const appearanceStatus =
    document.getElementById(
      "peopleSettingsAppearanceStatus"
    );

  const appearanceReset =
    document.getElementById(
      "peopleSettingsAppearanceReset"
    );

  const appearanceCancel =
    document.getElementById(
      "peopleSettingsAppearanceCancel"
    );

  const appearanceSave =
    document.getElementById(
      "peopleSettingsAppearanceSave"
    );

  const ringtones =
    document.getElementById(
      "peopleSettingsRingtones"
    );

  const notifications =
    document.getElementById(
      "peopleSettingsNotifications"
    );

  const audioInputSelect =
    document.getElementById(
      "peopleSettingsAudioInput"
    );

  const audioOutputSelect =
    document.getElementById(
      "peopleSettingsAudioOutput"
    );

  const videoInputSelect =
    document.getElementById(
      "peopleSettingsVideoInput"
    );

  const audioRefreshButton =
    document.getElementById(
      "peopleSettingsAudioRefresh"
    );

  const audioDeviceStatus =
    document.getElementById(
      "peopleSettingsAudioDeviceStatus"
    );

  let currentUser =
    null;

  let currentProfile =
    null;

  async function api(
    url,
    options = {}
  ) {
    const response =
      await fetch(
        url,
        {
          credentials:
            "same-origin",
          headers: {
            "Content-Type":
              "application/json",
            ...(options.headers || {})
          },
          ...options
        }
      );

    let data = null;

    try {
      data =
        await response.json();
    } catch {}

    if (
      !response.ok ||
      data?.ok === false
    ) {
      throw new Error(
        data?.error ||
        ("" + window.PeopleI18n.t("ui_49e6c692bb") + "")
      );
    }

    return data ||
      {};
  }

  function setStatus(
    text,
    kind = ""
  ) {
    profileStatus.textContent =
      text || "";

    profileStatus.classList.toggle(
      "success",
      kind ===
        "success"
    );

    profileStatus.classList.toggle(
      "error",
      kind ===
        "error"
    );
  }

  function updateBioCounter() {
    const length =
      bio.value.length;

    bioCounter.textContent =
      length +
      "/280";
  }

  bio.addEventListener(
    "input",
    updateBioCounter
  );

  // ==========================================================
  // APPARENCE — V3 : brouillon local + sauvegarde explicite
  // ==========================================================

  const PEOPLE_SETTINGS_PALETTE_KEYS = [
    "background",
    "panel",
    "secondary",
    "text",
    "accent"
  ];

  let appearanceDraft = null;
  let appearanceSaving = false;

  function cloneAppearance(value) {
    const fallback = appearanceDefaults();
    const source = value?.palette ? value : fallback;

    return {
      theme: String(source.theme || fallback.theme),
      palette: {
        ...fallback.palette,
        ...(source.palette || {}),
        gradient: {
          ...fallback.palette.gradient,
          ...(source.palette?.gradient || {})
        }
      }
    };
  }

  function setAppearanceStatus(
    text,
    kind = ""
  ) {
    if (!appearanceStatus) {
      return;
    }

    appearanceStatus.textContent =
      text || "";

    appearanceStatus.classList.toggle(
      "success",
      kind === "success"
    );

    appearanceStatus.classList.toggle(
      "error",
      kind === "error"
    );
  }

  function appearanceDefaults() {
    const defaults =
      window.PeopleAppearance
        ?.defaults;

    return {
      theme:
        defaults?.theme ||
        "dark",
      palette: {
        background:
          defaults?.palette
            ?.background ||
          "#100E1A",
        panel:
          defaults?.palette
            ?.panel ||
          "#181524",
        secondary:
          defaults?.palette
            ?.secondary ||
          "#090811",
        text:
          defaults?.palette
            ?.text ||
          "#F2EFF8",
        accent:
          defaults?.palette
            ?.accent ||
          "#67589D",
        gradient: {
          enabled:
            defaults?.palette
              ?.gradient?.enabled !== false,
          direction:
            Number(defaults?.palette
              ?.gradient?.direction) || 135,
          intensity:
            Number(defaults?.palette
              ?.gradient?.intensity) || 72,
          start:
            String(defaults?.palette
              ?.gradient?.start || "#5865F2").toUpperCase(),
          middle:
            String(defaults?.palette
              ?.gradient?.middle || "#8B5CF6").toUpperCase(),
          end:
            String(defaults?.palette
              ?.gradient?.end || "#EB459E").toUpperCase()
        }
      }
    };
  }

  function savedAppearanceValue() {
    const saved =
      window.PeopleAppearance
        ?.getSaved?.() ||
      window.PeopleAppearance
        ?.get?.();

    return cloneAppearance(saved);
  }

  function appearanceValue() {
    if (appearanceDraft) {
      return cloneAppearance(
        appearanceDraft
      );
    }

    return cloneAppearance(
      window.PeopleAppearance
        ?.get?.() ||
      appearanceDefaults()
    );
  }

  function appearanceEqual(left, right) {
    const a = cloneAppearance(left);
    const b = cloneAppearance(right);
    const aGradient = a.palette.gradient || {};
    const bGradient = b.palette.gradient || {};
    const aColors = Array.isArray(aGradient.colors)
      ? aGradient.colors
      : [aGradient.start, aGradient.middle, aGradient.end];
    const bColors = Array.isArray(bGradient.colors)
      ? bGradient.colors
      : [bGradient.start, bGradient.middle, bGradient.end];

    return (
      a.theme === b.theme &&
      PEOPLE_SETTINGS_PALETTE_KEYS.every((key) => a.palette[key] === b.palette[key]) &&
      aGradient.enabled === bGradient.enabled &&
      Number(aGradient.direction) === Number(bGradient.direction) &&
      Number(aGradient.intensity) === Number(bGradient.intensity) &&
      aColors.length === bColors.length &&
      aColors.every((color, index) => color === bColors[index])
    );
  }

  function appearanceIsDirty() {
    return !appearanceEqual(
      appearanceValue(),
      savedAppearanceValue()
    );
  }

  function appearanceHexToRgb(hex) {
    const helper =
      window.PeopleAppearance
        ?.utils?.hexToRgb;

    if (helper) {
      return helper(hex);
    }

    const clean = String(hex || "#000000")
      .replace("#", "")
      .padEnd(6, "0")
      .slice(0, 6);

    return {
      r: parseInt(clean.slice(0, 2), 16) || 0,
      g: parseInt(clean.slice(2, 4), 16) || 0,
      b: parseInt(clean.slice(4, 6), 16) || 0
    };
  }

  function appearanceRgbToHex(rgb) {
    const helper =
      window.PeopleAppearance
        ?.utils?.rgbToHex;

    if (helper) {
      return helper(rgb);
    }

    const part = (value) =>
      Math.max(
        0,
        Math.min(
          255,
          Math.round(Number(value) || 0)
        )
      )
        .toString(16)
        .padStart(2, "0")
        .toUpperCase();

    return (
      "#" +
      part(rgb.r) +
      part(rgb.g) +
      part(rgb.b)
    );
  }

  function appearanceValidHex(value) {
    return /^#[0-9A-F]{6}$/.test(
      String(value || "")
        .trim()
        .toUpperCase()
    );
  }

  function setPalettePreview(palette) {
    if (!appearancePalettePreview) {
      return;
    }

    for (const key of PEOPLE_SETTINGS_PALETTE_KEYS) {
      appearancePalettePreview.style.setProperty(
        `--palette-${key}`,
        palette[key]
      );
    }

    // La grande preview doit refléter le vrai dégradé du thème, pas seulement
    // les cinq couleurs de base. On mélange les trois stops du dégradé avec
    // chaque surface afin de garder le rôle visuel du fond / panneau / rail.
    const rawGradient = palette.gradient || {};
    const enabled = rawGradient.enabled !== false;
    const direction = Math.max(
      0,
      Math.min(360, Math.round(Number(rawGradient.direction) || 135))
    );
    const intensity = Math.max(
      0,
      Math.min(100, Math.round(Number(rawGradient.intensity) || 72))
    );
    const start = appearanceValidHex(rawGradient.start)
      ? String(rawGradient.start).toUpperCase()
      : String(palette.background).toUpperCase();
    const middle = appearanceValidHex(rawGradient.middle)
      ? String(rawGradient.middle).toUpperCase()
      : String(palette.accent).toUpperCase();
    const end = appearanceValidHex(rawGradient.end)
      ? String(rawGradient.end).toUpperCase()
      : String(palette.secondary).toUpperCase();

    // Reproduit exactement le mix sRGB utilisé par people-appearance.js.
    // Avant, la preview utilisait color-mix() et des coefficients légèrement
    // différents, ce qui pouvait la rendre un peu plus claire que le vrai thème.
    const mixExact = (base, color, ratio) => {
      const a = appearanceHexToRgb(base);
      const b = appearanceHexToRgb(color);
      const t = Math.max(0, Math.min(1, Number(ratio) || 0));
      return appearanceRgbToHex({
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t
      });
    };

    const gradientFor = (base, strength = 1) => {
      if (!enabled || intensity <= 0) return base;
      const power = (intensity / 100) * strength;
      return `linear-gradient(${direction}deg, ${mixExact(base, start, power)} 0%, ${mixExact(base, middle, power)} 50%, ${mixExact(base, end, power)} 100%)`;
    };

    // Même coefficients que le rendu réel :
    // main = 1.00, panneaux = 0.78, rail = 0.62.
    appearancePalettePreview.style.setProperty(
      "--preview-gradient-main",
      gradientFor(palette.background, 1)
    );
    appearancePalettePreview.style.setProperty(
      "--preview-gradient-panel",
      gradientFor(palette.panel, 0.78)
    );
    appearancePalettePreview.style.setProperty(
      "--preview-gradient-panel-soft",
      gradientFor(palette.panel, 0.78)
    );
    appearancePalettePreview.style.setProperty(
      "--preview-gradient-secondary",
      gradientFor(palette.secondary, 0.62)
    );
  }

  function setAppearanceButtons() {
    const dirty = appearanceIsDirty();

    if (appearanceSave) {
      appearanceSave.disabled =
        appearanceSaving || !dirty;
      appearanceSave.textContent =
        appearanceSaving
          ? "Enregistrement…"
          : ("" + window.PeopleI18n.t("ui_35322b5bb5") + "");
    }

    if (appearanceCancel) {
      appearanceCancel.disabled =
        appearanceSaving || !dirty;
    }

    if (appearanceReset) {
      appearanceReset.disabled =
        appearanceSaving;
    }
  }

  function updateAppearanceControls(options = {}) {
    const appearance =
      appearanceValue();

    for (
      const card of
      appearanceThemes
        ?.querySelectorAll(
          "[data-appearance-theme]"
        ) || []
    ) {
      const selected =
        card.dataset
          .appearanceTheme ===
        appearance.theme;

      card.classList.toggle(
        "selected",
        selected
      );
      card.setAttribute(
        "aria-pressed",
        selected ? "true" : "false"
      );
    }

    appearancePaletteEditor
      ?.classList.toggle(
        "active",
        appearance.theme ===
          "custom"
      );

    if (appearanceCustomBadge) {
      appearanceCustomBadge.textContent =
        appearance.theme === "custom"
          ? ("" + window.PeopleI18n.t("ui_2cab6f2a71") + "")
          : ("" + window.PeopleI18n.t("ui_68033a3a52") + "");
    }

    const palette = {
      ...appearance.palette
    };

    setPalettePreview(palette);

    const gradient = {
      enabled: palette.gradient?.enabled !== false,
      direction: Math.max(0, Math.min(360, Math.round(Number(palette.gradient?.direction) || 135))),
      intensity: Math.max(0, Math.min(100, Math.round(Number(palette.gradient?.intensity) || 72))),
      start: appearanceValidHex(palette.gradient?.start)
        ? String(palette.gradient.start).toUpperCase()
        : String(palette.background).toUpperCase(),
      middle: appearanceValidHex(palette.gradient?.middle)
        ? String(palette.gradient.middle).toUpperCase()
        : String(palette.accent).toUpperCase(),
      end: appearanceValidHex(palette.gradient?.end)
        ? String(palette.gradient.end).toUpperCase()
        : String(palette.secondary).toUpperCase()
    };
    const gradientEnabled = appearancePaletteEditor
      ?.querySelector("[data-appearance-gradient-enabled]");
    const gradientDirection = appearancePaletteEditor
      ?.querySelector("[data-appearance-gradient-direction]");
    const gradientIntensity = appearancePaletteEditor
      ?.querySelector("[data-appearance-gradient-intensity]");
    const gradientDirectionValue = appearancePaletteEditor
      ?.querySelector("[data-appearance-gradient-direction-value]");
    const gradientIntensityValue = appearancePaletteEditor
      ?.querySelector("[data-appearance-gradient-intensity-value]");
    const gradientPreview = appearancePaletteEditor
      ?.querySelector("[data-appearance-gradient-preview]");
    const gradientStart = appearancePaletteEditor
      ?.querySelector('[data-appearance-gradient-color="start"]');
    const gradientMiddle = appearancePaletteEditor
      ?.querySelector('[data-appearance-gradient-color="middle"]');
    const gradientEnd = appearancePaletteEditor
      ?.querySelector('[data-appearance-gradient-color="end"]');

    if (gradientEnabled instanceof HTMLInputElement) {
      gradientEnabled.checked = gradient.enabled;
    }
    if (gradientDirection instanceof HTMLInputElement) {
      gradientDirection.value = String(gradient.direction);
    }
    if (gradientIntensity instanceof HTMLInputElement) {
      gradientIntensity.value = String(gradient.intensity);
    }
    if (gradientDirectionValue) {
      gradientDirectionValue.textContent = `${gradient.direction}°`;
    }
    if (gradientIntensityValue) {
      gradientIntensityValue.textContent = `${gradient.intensity}%`;
    }
    if (gradientStart instanceof HTMLInputElement) gradientStart.value = gradient.start;
    if (gradientMiddle instanceof HTMLInputElement) gradientMiddle.value = gradient.middle;
    if (gradientEnd instanceof HTMLInputElement) gradientEnd.value = gradient.end;
    if (gradientPreview instanceof HTMLElement) {
      gradientPreview.style.background =
        `linear-gradient(${gradient.direction}deg, ${gradient.start} 0%, ${gradient.middle} 50%, ${gradient.end} 100%)`;
    }

    const customPreview =
      appearanceThemes
        ?.querySelector(
          ".people-theme-preview-custom"
        );

    if (customPreview) {
      for (const key of PEOPLE_SETTINGS_PALETTE_KEYS) {
        customPreview.style.setProperty(
          `--custom-${key}`,
          palette[key]
        );
      }
    }

    if (options.skipInputs !== true) {
      for (const key of PEOPLE_SETTINGS_PALETTE_KEYS) {
        const row =
          appearancePaletteEditor
            ?.querySelector(
              `[data-palette-key="${key}"]`
            );

        if (!row) continue;

        const color =
          String(palette[key] || "#000000")
            .toUpperCase();
        const rgb = appearanceHexToRgb(color);

        const picker =
          row.querySelector(
            `[data-palette-picker="${key}"]`
          );
        const hexInput =
          row.querySelector(
            `[data-palette-hex="${key}"]`
          );
        const rgbWrap =
          row.querySelector(
            `[data-palette-rgb="${key}"]`
          );

        if (picker) picker.value = color;
        if (hexInput) hexInput.value = color;

        if (rgbWrap) {
          for (
            const input of
            rgbWrap.querySelectorAll(
              "[data-rgb-channel]"
            )
          ) {
            const channel =
              input.dataset.rgbChannel;
            input.value =
              String(rgb[channel] ?? 0);
          }
        }
      }
    }

    setAppearanceButtons();
  }

  function previewAppearance(next, options = {}) {
    appearanceDraft =
      cloneAppearance(next);

    window.PeopleAppearance
      ?.preview?.(
        appearanceDraft
      );

    updateAppearanceControls({
      skipInputs:
        options.skipInputs === true
    });

    if (options.status !== false) {
      setAppearanceStatus(
        ("" + window.PeopleI18n.t("ui_6023dad373") + "")
      );
    }

    return cloneAppearance(
      appearanceDraft
    );
  }

  function discardAppearanceDraft(options = {}) {
    const hadDraft =
      appearanceDraft != null &&
      appearanceIsDirty();

    appearanceDraft =
      savedAppearanceValue();

    window.PeopleAppearance
      ?.discard?.();

    updateAppearanceControls();

    if (
      hadDraft &&
      options.status !== false
    ) {
      setAppearanceStatus(
        ("" + window.PeopleI18n.t("ui_95071425fc") + "")
      );
    }
  }

  async function saveAppearanceDraft() {
    if (
      appearanceSaving ||
      !appearanceIsDirty()
    ) {
      return;
    }

    if (!window.PeopleAppearance?.save) {
      setAppearanceStatus(
        "Module d'apparence indisponible.",
        "error"
      );
      return;
    }

    appearanceSaving = true;
    setAppearanceButtons();
    setAppearanceStatus(
      "Enregistrement…"
    );

    const wanted =
      cloneAppearance(
        appearanceDraft ||
        appearanceValue()
      );

    try {
      const saved =
        await window.PeopleAppearance
          .save(wanted);

      appearanceDraft =
        cloneAppearance(saved);

      updateAppearanceControls();
      setAppearanceStatus(
        ("" + window.PeopleI18n.t("ui_aa98227417") + ""),
        "success"
      );
    } catch (err) {
      appearanceDraft =
        savedAppearanceValue();

      updateAppearanceControls();
      setAppearanceStatus(
        err?.message ||
        ("" + window.PeopleI18n.t("ui_30a6d7d7a3") + ""),
        "error"
      );
    } finally {
      appearanceSaving = false;
      setAppearanceButtons();
    }
  }

  async function loadAppearance() {
    setAppearanceStatus("");

    try {
      await window.PeopleAppearance
        ?.syncFromServer?.();

      appearanceDraft =
        savedAppearanceValue();
      updateAppearanceControls();
    } catch (err) {
      appearanceDraft =
        savedAppearanceValue();
      updateAppearanceControls();
      setAppearanceStatus(
        err?.message ||
        ("" + window.PeopleI18n.t("ui_a24d43e692") + ""),
        "error"
      );
    }
  }

  function paletteColorFromTarget(target) {
    const row = target.closest(
      "[data-palette-key]"
    );

    if (!row) return null;

    const key = row.dataset.paletteKey;

    if (
      !PEOPLE_SETTINGS_PALETTE_KEYS
        .includes(key)
    ) {
      return null;
    }

    if (target.matches("[data-palette-picker]")) {
      return {
        key,
        color: String(target.value || "")
          .toUpperCase()
      };
    }

    if (target.matches("[data-palette-hex]")) {
      const color = String(target.value || "")
        .trim()
        .toUpperCase();

      return appearanceValidHex(color)
        ? { key, color }
        : null;
    }

    if (target.matches("[data-rgb-channel]")) {
      const rgbWrap = target.closest(
        "[data-palette-rgb]"
      );

      if (!rgbWrap) return null;

      const values = {};

      for (
        const input of
        rgbWrap.querySelectorAll(
          "[data-rgb-channel]"
        )
      ) {
        const raw = String(input.value ?? "").trim();
        const number = Number(raw);

        if (
          raw === "" ||
          !Number.isFinite(number) ||
          number < 0 ||
          number > 255
        ) {
          return null;
        }

        values[input.dataset.rgbChannel] = number;
      }

      return {
        key,
        color: appearanceRgbToHex(values)
      };
    }

    return null;
  }

  function previewPaletteColor(key, color, options = {}) {
    if (
      !PEOPLE_SETTINGS_PALETTE_KEYS.includes(key) ||
      !appearanceValidHex(color)
    ) {
      return null;
    }

    const base = appearanceValue();
    const next = {
      theme: "custom",
      palette: {
        ...base.palette,
        [key]: String(color)
          .trim()
          .toUpperCase()
      }
    };

    return previewAppearance(next, options);
  }

  appearanceThemes
    ?.addEventListener(
      "click",
      (event) => {
        if (appearanceSaving) return;

        const target =
          event.target instanceof Element
            ? event.target.closest(
                "[data-appearance-theme]"
              )
            : null;

        if (!target) return;

        const current =
          appearanceValue();
        const next = {
          ...current,
          theme:
            target.dataset
              .appearanceTheme,
          palette: {
            ...current.palette
          }
        };

        previewAppearance(next);
      }
    );

  appearancePaletteEditor
    ?.addEventListener(
      "input",
      (event) => {
        if (appearanceSaving) return;

        const target =
          event.target instanceof HTMLInputElement
            ? event.target
            : null;

        if (!target) return;

        if (
          target.matches("[data-appearance-gradient-enabled], [data-appearance-gradient-direction], [data-appearance-gradient-intensity], [data-appearance-gradient-color]")
        ) {
          const base = appearanceValue();
          const gradient = {
            ...base.palette.gradient
          };

          if (target.matches("[data-appearance-gradient-enabled]")) {
            gradient.enabled = target.checked;
          } else if (target.matches("[data-appearance-gradient-direction]")) {
            gradient.direction = Math.max(0, Math.min(360, Math.round(Number(target.value) || 0)));
          } else if (target.matches("[data-appearance-gradient-intensity]")) {
            gradient.intensity = Math.max(0, Math.min(100, Math.round(Number(target.value) || 0)));
          } else if (target.matches("[data-appearance-gradient-color]")) {
            const key = String(target.dataset.appearanceGradientColor || "");
            if (["start", "middle", "end"].includes(key) && appearanceValidHex(target.value)) {
              gradient[key] = target.value.toUpperCase();
            }
          }

          previewAppearance({
            ...base,
            palette: {
              ...base.palette,
              gradient
            }
          }, { skipInputs: true });

          const directionValue = appearancePaletteEditor
            ?.querySelector("[data-appearance-gradient-direction-value]");
          const intensityValue = appearancePaletteEditor
            ?.querySelector("[data-appearance-gradient-intensity-value]");
          if (directionValue) directionValue.textContent = `${gradient.direction}°`;
          if (intensityValue) intensityValue.textContent = `${gradient.intensity}%`;
          const gradientPreview = appearancePaletteEditor
            ?.querySelector("[data-appearance-gradient-preview]");
          if (gradientPreview instanceof HTMLElement) {
            gradientPreview.style.background =
              `linear-gradient(${gradient.direction}deg, ${gradient.start} 0%, ${gradient.middle} 50%, ${gradient.end} 100%)`;
          }
          return;
        }

        if (target.matches("[data-palette-hex]")) {
          target.value = target.value.toUpperCase();

          if (!appearanceValidHex(target.value)) {
            setAppearanceStatus(
              ("" + window.PeopleI18n.t("ui_ad44ae5a55") + "")
            );
            return;
          }
        }

        const value =
          paletteColorFromTarget(target);

        if (!value) return;

        previewPaletteColor(
          value.key,
          value.color,
          { skipInputs: true }
        );

        // Synchronise uniquement les autres représentations de la même
        // couleur sans casser la saisie en cours.
        const row = target.closest("[data-palette-key]");
        if (row) {
          const color = value.color.toUpperCase();
          const rgb = appearanceHexToRgb(color);
          const picker = row.querySelector("[data-palette-picker]");
          const hex = row.querySelector("[data-palette-hex]");

          if (picker && picker !== target) picker.value = color;
          if (hex && hex !== target) hex.value = color;

          for (const input of row.querySelectorAll("[data-rgb-channel]")) {
            if (input === target) continue;
            input.value = String(rgb[input.dataset.rgbChannel] ?? 0);
          }
        }
      }
    );

  appearancePaletteEditor
    ?.addEventListener(
      "change",
      (event) => {
        if (appearanceSaving) return;

        const target =
          event.target instanceof HTMLInputElement
            ? event.target
            : null;

        if (!target) return;

        if (
          target.matches("[data-appearance-gradient-enabled], [data-appearance-gradient-direction], [data-appearance-gradient-intensity], [data-appearance-gradient-color]")
        ) {
          setAppearanceStatus(
            ("" + window.PeopleI18n.t("ui_6023dad373") + "")
          );
          return;
        }

        const value =
          paletteColorFromTarget(target);

        if (!value) {
          updateAppearanceControls();
          setAppearanceStatus(
            ("" + window.PeopleI18n.t("ui_22e1a409be") + ""),
            "error"
          );
          return;
        }

        previewPaletteColor(
          value.key,
          value.color,
          { status: false }
        );
        setAppearanceStatus(
          ("" + window.PeopleI18n.t("ui_6023dad373") + "")
        );
      }
    );

  appearanceReset
    ?.addEventListener(
      "click",
      () => {
        if (appearanceSaving) return;

        previewAppearance(
          appearanceDefaults()
        );
        setAppearanceStatus(
          ("" + window.PeopleI18n.t("ui_e9557f61dd") + "")
        );
      }
    );

  appearanceCancel
    ?.addEventListener(
      "click",
      () => {
        if (appearanceSaving) return;
        discardAppearanceDraft();
      }
    );

  appearanceSave
    ?.addEventListener(
      "click",
      () => {
        void saveAppearanceDraft();
      }
    );

  window.addEventListener(
    "people-appearance-changed",
    (event) => {
      const source = event?.detail?.source;

      // Les previews sont déjà pilotées par ce panneau. Les autres sources
      // (sync, save, système) peuvent rafraîchir les contrôles.
      if (source === "preview") return;

      if (!appearanceIsDirty()) {
        appearanceDraft =
          savedAppearanceValue();
      }

      updateAppearanceControls();
    }
  );

  // === PEOPLE_THEME_STUDIO_BRIDGE_V1_START ===
  window.addEventListener(
    "people-theme-studio-draft",
    (event) => {
      const incoming = event?.detail?.appearance;
      if (!incoming?.palette) return;
      appearanceDraft = cloneAppearance(incoming);
      updateAppearanceControls({ skipInputs: true });
      setAppearanceButtons();
      if (event?.detail?.status) {
        setAppearanceStatus(String(event.detail.status));
      }
    }
  );
  // === PEOPLE_THEME_STUDIO_BRIDGE_V1_END ===

  function activateTab(
    name
  ) {
    for (
      const button of
      modal.querySelectorAll(
        ".people-settings-tab"
      )
    ) {
      button.classList.toggle(
        "active",
        button.dataset
          .settingsTab ===
          name
      );
    }

    for (
      const page of
      modal.querySelectorAll(
        ".people-settings-page"
      )
    ) {
      page.classList.toggle(
        "active",
        page.dataset
          .settingsPage ===
          name
      );
    }
  }

  modal.addEventListener(
    "click",
    (event) => {
      const target =
        event.target instanceof
        Element
          ? event.target
          : null;

      if (!target) {
        return;
      }

      const tab =
        target.closest(
          ".people-settings-tab"
        );

      if (tab) {
        activateTab(
          tab.dataset
            .settingsTab
        );

        return;
      }

      if (
        target.dataset
          .settingsClose ===
        "1"
      ) {
        closeSettings();
      }
    }
  );

  function closeSettings() {
    if (
      appearanceDraft != null &&
      appearanceIsDirty() &&
      !appearanceSaving
    ) {
      discardAppearanceDraft({
        status: false
      });
    }

    modal.classList.add(
      "hidden"
    );

    document.body.classList.remove(
      "people-settings-open"
    );
  }

  async function loadProfile() {
    setStatus("");

    try {
      if (
        !currentUser?.username
      ) {
        const meData =
          await api(
            "/api/auth/me"
          );

        currentUser =
          meData.user;
      }

      if (
        !currentUser?.username
      ) {
        throw new Error(
          ("" + window.PeopleI18n.t("ui_3162ab4066") + "")
        );
      }

      const profileData =
        await api(
          "/api/profile/" +
          encodeURIComponent(
            currentUser.username
          )
        );

      currentProfile =
        profileData.profile;

      username.textContent =
        currentProfile.username;

      bio.value =
        String(
          currentProfile.description ||
          ""
        );

      updateBioCounter();

      avatar.textContent =
        String(
          currentProfile.username ||
          "?"
        )
          .trim()
          .slice(
            0,
            2
          )
          .toUpperCase() ||
        "?";

      window.PeopleAvatars
        ?.apply(
          avatar,
          currentProfile.username
        );
    } catch (err) {
      setStatus(
        err?.message ||
        ("" + window.PeopleI18n.t("ui_503622bf69") + ""),
        "error"
      );
    }
  }

  function openSettings() {
    void loadCallPrivacy();
    activateTab(
      "profile"
    );

    modal.classList.remove(
      "hidden"
    );

    document.body.classList.add(
      "people-settings-open"
    );

    updateSoundSelections();
    updateAppearanceControls();

    void refreshAudioDevices(
      false
    );

    void loadProfile();
    void loadAppearance();
  }

  const callPrivacy = document.createElement("section");
  callPrivacy.innerHTML = `<h3>${window.PeopleI18n.t("ui_230ae4811a")}</h3>
    <label><input type="checkbox"> ${window.PeopleI18n.t("ui_ba1823c68c")}</label>
    <p>${window.PeopleI18n.t("ui_4b8837cab1")}</p>
    <p role="status"></p>`;
  modal.querySelector('[data-settings-page="profile"]').append(callPrivacy);
  const callPrivacyInput = callPrivacy.querySelector("input");
  const callPrivacyFeedback = callPrivacy.querySelector('[role="status"]');
  async function loadCallPrivacy() {
    callPrivacyInput.disabled = true;
    try {
      const response = await fetch("/api/call-privacy");
      if (!response.ok) throw new Error(("" + window.PeopleI18n.t("ui_bc25a04220") + ""));
      const data = await response.json();
      callPrivacyInput.checked = data.showInterlocutors === true;
      callPrivacyFeedback.textContent = "";
      callPrivacyInput.disabled = false;
    } catch (err) { callPrivacyFeedback.textContent = err.message; }
  }
  callPrivacyInput.addEventListener("change", async () => {
    callPrivacyInput.disabled = true;
    try {
      const response = await fetch("/api/call-privacy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ showInterlocutors: callPrivacyInput.checked }) });
      if (!response.ok) throw new Error(("" + window.PeopleI18n.t("ui_ab029fe154") + ""));
      callPrivacyFeedback.textContent = ("" + window.PeopleI18n.t("ui_9cd9058f10") + "");
    } catch (err) {
      callPrivacyInput.checked = !callPrivacyInput.checked;
      callPrivacyFeedback.textContent = err.message;
    } finally { callPrivacyInput.disabled = false; }
  });
  window.peopleSocket?.on("people-call-privacy", data => { callPrivacyInput.checked = data.showInterlocutors === true; });
  window.peopleSocket?.on("connect", () => { if (!modal.classList.contains("hidden")) void loadCallPrivacy(); });

  settingsButton.addEventListener(
    "click",
    openSettings
  );

  closeButton.addEventListener(
    "click",
    closeSettings
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key ===
          "Escape" &&
        !modal.classList
          .contains(
            "hidden"
          )
      ) {
        closeSettings();
      }
    }
  );

  // ==========================================================
  // PROFIL
  // ==========================================================

  saveProfile.addEventListener(
    "click",
    async () => {
      if (
        !currentProfile
      ) {
        return;
      }

      saveProfile.disabled =
        true;

      setStatus(
        "Enregistrement…"
      );

      try {
        const data =
          await api(
            "/api/profile/me",
            {
              method:
                "PUT",
              body:
                JSON.stringify({
                  description:
                    bio.value
                })
            }
          );

        currentProfile =
          data.profile;

        bio.value =
          String(
            currentProfile.description ||
            ""
          );

        updateBioCounter();

        setStatus(
          ("" + window.PeopleI18n.t("ui_8653c240eb") + ""),
          "success"
        );
      } catch (err) {
        setStatus(
          err?.message ||
          ("" + window.PeopleI18n.t("ui_c1a256ac25") + ""),
          "error"
        );
      } finally {
        saveProfile.disabled =
          false;
      }
    }
  );

  avatarButton.addEventListener(
    "click",
    () => {
      avatarInput.click();
    }
  );

  avatarInput.addEventListener(
    "change",
    async () => {
      const file =
        avatarInput.files?.[0];

      if (!file) {
        return;
      }

      if (
        !/^image\/(jpeg|png|webp|gif)$/i
          .test(
            file.type
          )
      ) {
        setStatus(
          ("" + window.PeopleI18n.t("ui_6f9c7e85d0") + ""),
          "error"
        );

        avatarInput.value =
          "";

        return;
      }

      avatarButton.disabled =
        true;

      setStatus(
        ("" + window.PeopleI18n.t("ui_02736040b8") + "")
      );

      try {
        const cropped =
          await window
            .PeopleAvatarCropper
            ?.open(
              file
            );

        if (!cropped) {
          setStatus("");
          return;
        }

        const prepared =
          await window
            .PeopleAvatarUltra
            ?.prepare(
              cropped
            );

        if (
          !prepared?.base64 ||
          !prepared?.blob
        ) {
          throw new Error(
            ("" + window.PeopleI18n.t("ui_8572b43613") + "")
          );
        }

        setStatus(
          "Envoi de la photo…"
        );

        const response =
          await fetch(
            "/api/profile/avatar-ultra",
            {
              method:
                "PUT",
              credentials:
                "same-origin",
              headers: {
                "Content-Type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  data:
                    prepared.base64
                })
            }
          );

        let data = null;

        try {
          data =
            await response.json();
        } catch {}

        if (
          !response.ok ||
          data?.ok === false
        ) {
          throw new Error(
            data?.error ||
            ("" + window.PeopleI18n.t("ui_6c45c0c963") + "")
          );
        }

        const accountName =
          currentProfile
            ?.username ||
          currentUser
            ?.username;

        if (
          data?.avatarDataUrl &&
          accountName
        ) {
          window.PeopleAvatars
            ?.applyDataUrlEverywhere(
              accountName,
              data.avatarDataUrl
            );

          window.PeopleAvatars
            ?.applyDataUrlToElement(
              avatar,
              accountName,
              data.avatarDataUrl
            );
        } else if (
          accountName
        ) {
          window.PeopleAvatarUltra
            ?.applyPreview(
              accountName,
              prepared.blob
            );
        }

        setStatus(
          ("" + window.PeopleI18n.t("ui_4976516689") + ""),
          "success"
        );
      } catch (err) {
        setStatus(
          err?.message ||
          ("" + window.PeopleI18n.t("ui_6c45c0c963") + ""),
          "error"
        );
      } finally {
        avatarButton.disabled =
          false;

        avatarInput.value =
          "";
      }
    }
  );

  // ==========================================================
  // CHOIX DES SONS
  // ==========================================================

  // === PEOPLE_AUDIO_DEVICE_UI_V1_START ===
  function deviceLabel(
    device,
    fallback,
    index
  ) {
    return (
      String(
        device?.label ||
        ""
      ).trim() ||
      (
        fallback +
        " " +
        String(
          index + 1
        )
      )
    );
  }

  function fillDeviceSelect(
    select,
    devices,
    kind
  ) {
    if (!select) {
      return;
    }

    const selected =
      kind ===
        "input"
        ? window.PeopleAudioDevices
            ?.getInputId?.() ||
          ""
        : kind ===
            "camera"
          ? window.PeopleAudioDevices
              ?.getCameraId?.() ||
            ""
          : window.PeopleAudioDevices
              ?.getOutputId?.() ||
            "";

    const fragment =
      document.createDocumentFragment();

    const fallback =
      document.createElement(
        "option"
      );

    fallback.value =
      "";

    fallback.textContent =
      kind ===
        "input"
        ? ("" + window.PeopleI18n.t("ui_6b4a8c64d6") + "")
        : kind ===
            "camera"
          ? ("" + window.PeopleI18n.t("ui_08ff2c201b") + "")
          : ("" + window.PeopleI18n.t("ui_ec736c0471") + "");

    fragment.appendChild(
      fallback
    );

    const unique =
      new Set();

    let visibleIndex =
      0;

    for (
      const device of
      devices
    ) {
      if (
        !device?.deviceId ||
        device.deviceId ===
          "default" ||
        unique.has(
          device.deviceId
        )
      ) {
        continue;
      }

      unique.add(
        device.deviceId
      );

      const option =
        document.createElement(
          "option"
        );

      option.value =
        device.deviceId;

      option.textContent =
        deviceLabel(
          device,
          kind ===
            "input"
            ? "Microphone"
            : kind ===
                "camera"
              ? ("" + window.PeopleI18n.t("ui_03494b0d1f") + "")
              : "Sortie audio",
          visibleIndex
        );

      visibleIndex +=
        1;

      fragment.appendChild(
        option
      );
    }

    const stillExists =
      !selected ||
      unique.has(
        selected
      );

    if (!stillExists) {
      if (
        kind ===
        "input"
      ) {
        window.PeopleAudioDevices
          ?.setInputId?.(
            ""
          );
      } else if (
        kind ===
        "camera"
      ) {
        window.PeopleAudioDevices
          ?.setCameraId?.(
            ""
          );
      } else {
        window.PeopleAudioDevices
          ?.setOutputId?.(
            ""
          );
      }
    }

    select.replaceChildren(
      fragment
    );

    select.value =
      stillExists
        ? selected
        : "";
  }

  async function performAudioDeviceRefresh(
    requestPermission = false
  ) {
    if (
      !navigator.mediaDevices
        ?.enumerateDevices
    ) {
      if (
        audioDeviceStatus
      ) {
        audioDeviceStatus.textContent =
          ("" + window.PeopleI18n.t("ui_b683b00aa9") + "");
      }

      return;
    }

    if (
      audioRefreshButton
    ) {
      audioRefreshButton.disabled =
        true;
    }

    if (
      audioDeviceStatus
    ) {
      audioDeviceStatus.textContent =
        ("" + window.PeopleI18n.t("ui_ce5dccd688") + "");
    }

    try {
      if (
        requestPermission &&
        navigator.mediaDevices
          ?.getUserMedia
      ) {
        for (
          const constraints of
          [
            {
              audio: true,
              video: false
            },
            {
              audio: false,
              video: true
            }
          ]
        ) {
          try {
            const temporary =
              await navigator.mediaDevices
                .getUserMedia(
                  constraints
                );

            for (
              const track of
              temporary.getTracks()
            ) {
              track.stop();
            }
          } catch {}
        }
      }

      const devices =
        await navigator.mediaDevices
          .enumerateDevices();

      const inputs =
        devices.filter(
          (device) =>
            device.kind ===
            "audioinput"
        );

      const outputs =
        devices.filter(
          (device) =>
            device.kind ===
            "audiooutput"
        );

      const cameras =
        devices.filter(
          (device) =>
            device.kind ===
            "videoinput"
        );

      fillDeviceSelect(
        audioInputSelect,
        inputs,
        "input"
      );

      fillDeviceSelect(
        videoInputSelect,
        cameras,
        "camera"
      );

      fillDeviceSelect(
        audioOutputSelect,
        outputs,
        "output"
      );

      const hasNamedInput =
        inputs.some(
          (device) =>
            Boolean(
              String(
                device.label ||
                ""
              ).trim()
            )
        );

      const hasNamedCamera =
        cameras.some(
          (device) =>
            Boolean(
              String(
                device.label ||
                ""
              ).trim()
            )
        );

      const outputSupported =
        "setSinkId" in
        HTMLMediaElement.prototype;

      if (
        audioOutputSelect
      ) {
        audioOutputSelect.disabled =
          !outputSupported;
      }

      if (
        audioDeviceStatus
      ) {
        if (
          !outputSupported
        ) {
          audioDeviceStatus.textContent =
            ("" + window.PeopleI18n.t("ui_abdc86990d") + "");
        } else if (
          !hasNamedInput ||
          !hasNamedCamera
        ) {
          audioDeviceStatus.textContent =
            ("" + window.PeopleI18n.t("ui_b14325f3dc") + "");
        } else {
          audioDeviceStatus.textContent =
            ("" + window.PeopleI18n.t("ui_b96f217868") + "");
        }
      }

      await window.PeopleAudioDevices
        ?.applyOutputToAll?.();
    } catch (err) {
      if (
        audioDeviceStatus
      ) {
        audioDeviceStatus.textContent =
          err?.message ||
          ("" + window.PeopleI18n.t("ui_da68d1cf52") + "");
      }
    } finally {
      if (
        audioRefreshButton
      ) {
        audioRefreshButton.disabled =
          false;
      }
    }
  }

  let audioDeviceRefreshPromise =
    null;

  function refreshAudioDevices(
    requestPermission = false
  ) {
    if (
      audioDeviceRefreshPromise
    ) {
      return audioDeviceRefreshPromise;
    }

    audioDeviceRefreshPromise =
      performAudioDeviceRefresh(
        requestPermission
      )
        .finally(
          () => {
            audioDeviceRefreshPromise =
              null;
          }
        );

    return audioDeviceRefreshPromise;
  }

  audioInputSelect
    ?.addEventListener(
      "change",
      () => {
        window.PeopleAudioDevices
          ?.setInputId?.(
            audioInputSelect.value
          );

        if (
          audioDeviceStatus
        ) {
          audioDeviceStatus.textContent =
            ("" + window.PeopleI18n.t("ui_b7e97c9641") + "");
        }
      }
    );

  videoInputSelect
    ?.addEventListener(
      "change",
      () => {
        window.PeopleAudioDevices
          ?.setCameraId?.(
            videoInputSelect.value
          );

        if (
          audioDeviceStatus
        ) {
          audioDeviceStatus.textContent =
            ("" + window.PeopleI18n.t("ui_45b2613ed5") + "");
        }
      }
    );

  audioOutputSelect
    ?.addEventListener(
      "change",
      () => {
        window.PeopleAudioDevices
          ?.setOutputId?.(
            audioOutputSelect.value
          );

        if (
          audioDeviceStatus
        ) {
          audioDeviceStatus.textContent =
            ("" + window.PeopleI18n.t("ui_738e1a2cee") + "");
        }
      }
    );

  audioRefreshButton
    ?.addEventListener(
      "click",
      () => {
        void refreshAudioDevices(
          true
        );
      }
    );

  navigator.mediaDevices
    ?.addEventListener?.(
      "devicechange",
      () => {
        if (
          !modal.classList
            .contains(
              "hidden"
            )
        ) {
          void refreshAudioDevices(
            false
          );
        }
      }
    );
  // === PEOPLE_AUDIO_DEVICE_UI_V1_END ===

  function soundCard(
    sound,
    kind
  ) {
    const card =
      document.createElement(
        "button"
      );

    card.type =
      "button";

    card.className =
      "people-settings-sound-card";

    card.dataset.soundId =
      sound.id;

    card.dataset.soundKind =
      kind;

    card.innerHTML = `
      <span
        class="people-settings-sound-radio"
      ></span>

      <span
        class="people-settings-sound-copy"
      >
        <strong></strong>
        <small></small>
      </span>

      <span
        class="people-settings-sound-preview"
        title="${window.PeopleI18n.t("ui_6027436127")}"
      >▶</span>
    `;

    card.querySelector(
      "strong"
    ).textContent =
      sound.name;

    card.querySelector(
      "small"
    ).textContent =
      sound.description;

    return card;
  }

  function updateSoundSelections() {
    const ringtoneId =
      window.PeopleSounds
        .getRingtone();

    const notificationId =
      window.PeopleSounds
        .getNotificationSound();

    for (
      const card of
      ringtones.querySelectorAll(
        ".people-settings-sound-card"
      )
    ) {
      card.classList.toggle(
        "selected",
        card.dataset
          .soundId ===
          ringtoneId
      );
    }

    for (
      const card of
      notifications.querySelectorAll(
        ".people-settings-sound-card"
      )
    ) {
      card.classList.toggle(
        "selected",
        card.dataset
          .soundId ===
          notificationId
      );
    }
  }

  function renderSounds() {
    const ringtoneFragment =
      document.createDocumentFragment();

    const notificationFragment =
      document.createDocumentFragment();

    for (
      const sound of
      RINGTONES
    ) {
      ringtoneFragment
        .appendChild(
          soundCard(
            sound,
            "ringtone"
          )
        );
    }

    for (
      const sound of
      NOTIFICATION_SOUNDS
    ) {
      notificationFragment
        .appendChild(
          soundCard(
            sound,
            "notification"
          )
        );
    }

    ringtones.replaceChildren(
      ringtoneFragment
    );

    notifications.replaceChildren(
      notificationFragment
    );

    updateSoundSelections();
  }

  function handleSoundClick(
    event,
    kind,
    container
  ) {
    const target =
      event.target instanceof
      Element
        ? event.target
        : null;

    const card =
      target?.closest(
        ".people-settings-sound-card"
      );

    if (
      !card ||
      !container.contains(
        card
      )
    ) {
      return;
    }

    const soundId =
      card.dataset.soundId ||
      "";

    if (
      kind ===
      "ringtone"
    ) {
      if (
        !window.PeopleSounds
          .setRingtone(
            soundId
          )
      ) {
        return;
      }

      window.PeopleSounds
        .playRingtonePulse(
          "incoming",
          soundId
        );
    } else {
      if (
        !window.PeopleSounds
          .setNotificationSound(
            soundId
          )
      ) {
        return;
      }

      window.PeopleSounds
        .playNotification(
          soundId
        );
    }

    updateSoundSelections();
  }

  ringtones.addEventListener(
    "click",
    (event) => {
      handleSoundClick(
        event,
        "ringtone",
        ringtones
      );
    }
  );

  notifications.addEventListener(
    "click",
    (event) => {
      handleSoundClick(
        event,
        "notification",
        notifications
      );
    }
  );

  renderSounds();

  // === PEOPLE_SETTINGS_V1_END ===
})();
