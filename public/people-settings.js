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
      name: "Doux",
      description:
        "Une notification plus discrète."
    },
    {
      id: "digital",
      name: "Digital",
      description:
        "Court et plus électronique."
    },
    {
      id: "pop",
      name: "Pop",
      description:
        "Petit son rapide et lumineux."
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
        "Un style téléphone numérique."
    },
    {
      id: "calm",
      name: "Calme",
      description:
        "Plus douce et moins agressive."
    },
    {
      id: "bright",
      name: "Claire",
      description:
        "Une sonnerie plus aiguë."
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
        audioContext
          .resume()
          .catch(
            () => {}
          );
      }
    } catch {}

    /*
      Le routage de sortie n'a besoin
      d'être appliqué qu'à la création.
      Un changement ultérieur de sortie
      passe déjà par applyOutputToAll().
    */
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

  // === PEOPLE_AUDIO_DEVICES_V1_START ===
  const AUDIO_DEVICE_KEYS = {
    input:
      "people-audio-input-device-v1",
    output:
      "people-audio-output-device-v1"
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

    getInputConstraints:
      inputConstraints,

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

  window.PeopleSounds = {
    playNotification,
    playRingtonePulse,

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
    "Paramètres";

  settingsButton.setAttribute(
    "aria-label",
    "Ouvrir les paramètres"
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
      aria-label="Paramètres People"
    >
      <aside
        class="people-settings-nav"
      >
        <div
          class="people-settings-nav-head"
        >
          <span>PEOPLE</span>
          <strong>Paramètres</strong>
        </div>

        <button
          class="people-settings-tab active"
          type="button"
          data-settings-tab="profile"
        >
          <span>👤</span>
          Profil
        </button>

        <button
          class="people-settings-tab"
          type="button"
          data-settings-tab="appearance"
        >
          <span>🎨</span>
          Apparence
        </button>

        <button
          class="people-settings-tab"
          type="button"
          data-settings-tab="sounds"
        >
          <span>🔔</span>
          Sons
        </button>
      </aside>

      <main
        class="people-settings-content"
      >
        <button
          id="peopleSettingsClose"
          class="people-settings-close"
          type="button"
          aria-label="Fermer"
        >✕</button>

        <section
          class="people-settings-page active"
          data-settings-page="profile"
        >
          <div
            class="people-settings-page-head"
          >
            <span>MON COMPTE</span>
            <h2>Profil</h2>
            <p>
              Modifie les informations visibles sur ton profil People.
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
                Changer la photo
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
                Nom d'utilisateur
              </label>

              <div
                id="peopleSettingsUsername"
                class="people-settings-readonly"
              >
                —
              </div>

              <small>
                Le changement de pseudo n'est pas encore disponible.
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
                  Visible sur ta fiche de profil.
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
              placeholder="Écris une petite description..."
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
                Enregistrer
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
            <span>PERSONNALISATION</span>
            <h2>Apparence</h2>
            <p>
              Prévisualise ton thème en direct, puis enregistre seulement quand le résultat te plaît. Tes réglages suivent ton compte.
            </p>
          </div>

          <div
            class="people-settings-section"
          >
            <div
              class="people-settings-section-title"
            >
              <div>
                <strong>Préréglages</strong>
                <span>
                  Choisis une base. Rien n'est envoyé au serveur tant que tu n'appuies pas sur Enregistrer.
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
                <strong>Sombre</strong>
                <small>Le thème People classique.</small>
              </button>

              <button
                class="people-settings-theme-card"
                type="button"
                data-appearance-theme="midnight"
              >
                <span class="people-settings-theme-preview people-theme-preview-midnight">
                  <i></i><b></b><em></em>
                </span>
                <strong>Minuit</strong>
                <small>Des noirs plus profonds.</small>
              </button>

              <button
                class="people-settings-theme-card"
                type="button"
                data-appearance-theme="light"
              >
                <span class="people-settings-theme-preview people-theme-preview-light">
                  <i></i><b></b><em></em>
                </span>
                <strong>Clair</strong>
                <small>Une interface lumineuse.</small>
              </button>

              <button
                class="people-settings-theme-card"
                type="button"
                data-appearance-theme="system"
              >
                <span class="people-settings-theme-preview people-theme-preview-system">
                  <i></i><b></b><em></em>
                </span>
                <strong>Système</strong>
                <small>Suit le thème de l'appareil.</small>
              </button>

              <button
                class="people-settings-theme-card"
                type="button"
                data-appearance-theme="custom"
              >
                <span class="people-settings-theme-preview people-theme-preview-custom">
                  <i></i><b></b><em></em>
                </span>
                <strong>Personnalisé</strong>
                <small>Tes 5 couleurs exactes.</small>
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
                <strong>Palette personnalisée</strong>
                <span>
                  Modifie une couleur pour passer en mode personnalisé. Tu peux annuler tous les changements avant de sauvegarder.
                </span>
              </div>

              <span
                id="peopleSettingsCustomBadge"
                class="people-settings-custom-badge"
              >Personnalisé</span>
            </div>

            <div
              id="peopleSettingsPalettePreview"
              class="people-settings-palette-preview"
              aria-label="Aperçu réaliste de l'interface People"
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
                    <b>Accueil</b>
                    <i>Amis et messages privés</i>
                  </span>
                </div>

                <div class="people-settings-preview-nav active">
                  <span>●●</span>
                  <b>Amis</b>
                </div>

                <div class="people-settings-preview-label">MESSAGES PRIVÉS</div>

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
                  <span><b>Amis</b><i>Tes contacts People</i></span>
                </div>

                <div class="people-settings-preview-content">
                  <div class="people-settings-preview-search-card">
                    <b>Retrouver quelqu'un</b>
                    <i></i>
                    <span></span>
                  </div>

                  <div class="people-settings-preview-section-title">
                    <b>DEMANDES D'AMI</b><span>0</span>
                  </div>

                  <div class="people-settings-preview-request-grid">
                    <div><b>À ACCEPTER</b><i></i></div>
                    <div><b>ENVOYÉES</b><i></i></div>
                  </div>

                  <div class="people-settings-preview-section-title friends">
                    <b>MES AMIS</b><span>6</span>
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
              Cet aperçu reprend les mêmes rôles de couleur que l'application : rail, panneau, fond, texte, champs et accent.
            </div>

            <div class="people-settings-palette-list">
              <div class="people-settings-palette-row" data-palette-key="background">
                <div class="people-settings-palette-copy">
                  <strong>Fond principal</strong>
                  <span>Chat et zone centrale.</span>
                </div>
                <input type="color" value="#100E1A" data-palette-picker="background" aria-label="Fond principal" />
                <input class="people-settings-hex-input" type="text" value="#100E1A" maxlength="7" spellcheck="false" data-palette-hex="background" aria-label="Fond principal en hexadécimal" />
                <div class="people-settings-rgb" data-palette-rgb="background">
                  <label>R<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="r" /></label>
                  <label>G<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="g" /></label>
                  <label>B<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="b" /></label>
                </div>
              </div>

              <div class="people-settings-palette-row" data-palette-key="panel">
                <div class="people-settings-palette-copy">
                  <strong>Panneaux</strong>
                  <span>Barres, cartes et zones élevées.</span>
                </div>
                <input type="color" value="#181524" data-palette-picker="panel" aria-label="Panneaux" />
                <input class="people-settings-hex-input" type="text" value="#181524" maxlength="7" spellcheck="false" data-palette-hex="panel" aria-label="Panneaux en hexadécimal" />
                <div class="people-settings-rgb" data-palette-rgb="panel">
                  <label>R<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="r" /></label>
                  <label>G<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="g" /></label>
                  <label>B<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="b" /></label>
                </div>
              </div>

              <div class="people-settings-palette-row" data-palette-key="secondary">
                <div class="people-settings-palette-copy">
                  <strong>Fond secondaire</strong>
                  <span>Rail des serveurs, menus et champs.</span>
                </div>
                <input type="color" value="#090811" data-palette-picker="secondary" aria-label="Fond secondaire" />
                <input class="people-settings-hex-input" type="text" value="#090811" maxlength="7" spellcheck="false" data-palette-hex="secondary" aria-label="Fond secondaire en hexadécimal" />
                <div class="people-settings-rgb" data-palette-rgb="secondary">
                  <label>R<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="r" /></label>
                  <label>G<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="g" /></label>
                  <label>B<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="b" /></label>
                </div>
              </div>

              <div class="people-settings-palette-row" data-palette-key="text">
                <div class="people-settings-palette-copy">
                  <strong>Texte principal</strong>
                  <span>Messages, titres et texte important.</span>
                </div>
                <input type="color" value="#F2EFF8" data-palette-picker="text" aria-label="Texte principal" />
                <input class="people-settings-hex-input" type="text" value="#F2EFF8" maxlength="7" spellcheck="false" data-palette-hex="text" aria-label="Texte principal en hexadécimal" />
                <div class="people-settings-rgb" data-palette-rgb="text">
                  <label>R<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="r" /></label>
                  <label>G<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="g" /></label>
                  <label>B<input class="people-settings-rgb-input" type="number" min="0" max="255" data-rgb-channel="b" /></label>
                </div>
              </div>

              <div class="people-settings-palette-row" data-palette-key="accent">
                <div class="people-settings-palette-copy">
                  <strong>Accent</strong>
                  <span>Boutons, sélections et éléments actifs.</span>
                </div>
                <input type="color" value="#67589D" data-palette-picker="accent" aria-label="Accent" />
                <input class="people-settings-hex-input" type="text" value="#67589D" maxlength="7" spellcheck="false" data-palette-hex="accent" aria-label="Accent en hexadécimal" />
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
                Annuler
              </button>

              <button
                id="peopleSettingsAppearanceReset"
                class="people-settings-secondary"
                type="button"
              >
                Valeurs par défaut
              </button>

              <button
                id="peopleSettingsAppearanceSave"
                class="people-settings-primary"
                type="button"
                disabled
              >
                Enregistrer
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
            <h2>Sons</h2>
            <p>
              Choisis les sons utilisés uniquement sur cet appareil.
            </p>
          </div>

          <div
            class="people-settings-section people-settings-audio-devices"
          >
            <div
              class="people-settings-section-title"
            >
              <div>
                <strong>Entrée / sortie audio</strong>
                <span>
                  Choisis le micro et le casque ou haut-parleur utilisés par les vocaux et appels.
                </span>
              </div>
            </div>

            <div
              class="people-settings-device-grid"
            >
              <label
                class="people-settings-device-field"
              >
                <span>Entrée — Microphone</span>

                <select
                  id="peopleSettingsAudioInput"
                >
                  <option value="">
                    Microphone par défaut
                  </option>
                </select>
              </label>

              <label
                class="people-settings-device-field"
              >
                <span>Sortie — Casque / haut-parleurs</span>

                <select
                  id="peopleSettingsAudioOutput"
                >
                  <option value="">
                    Sortie par défaut
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
                Détecter / actualiser
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
                <strong>Sonnerie d'appel</strong>
                <span>
                  Son joué quand quelqu'un t'appelle en MP.
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
                  Utilisé pour les MP et les @pings.
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
        "Erreur People."
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
        ...(source.palette || {})
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
          "#67589D"
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

    return (
      a.theme === b.theme &&
      PEOPLE_SETTINGS_PALETTE_KEYS.every(
        (key) =>
          a.palette[key] ===
          b.palette[key]
      )
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
  }

  function setAppearanceButtons() {
    const dirty = appearanceIsDirty();

    if (appearanceSave) {
      appearanceSave.disabled =
        appearanceSaving || !dirty;
      appearanceSave.textContent =
        appearanceSaving
          ? "Enregistrement…"
          : "Enregistrer";
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
          ? "Personnalisé actif"
          : "Palette mémorisée";
    }

    const palette = {
      ...appearance.palette
    };

    setPalettePreview(palette);

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
        "Aperçu local — pense à enregistrer."
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
        "Modifications annulées."
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
        "Apparence enregistrée ✓",
        "success"
      );
    } catch (err) {
      appearanceDraft =
        savedAppearanceValue();

      updateAppearanceControls();
      setAppearanceStatus(
        err?.message ||
        "Impossible d'enregistrer l'apparence. Les changements ont été annulés.",
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
        "La synchronisation du thème a échoué.",
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

        if (target.matches("[data-palette-hex]")) {
          target.value = target.value.toUpperCase();

          if (!appearanceValidHex(target.value)) {
            setAppearanceStatus(
              "Couleur HEX incomplète — exemple : #12ABEF."
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

        const value =
          paletteColorFromTarget(target);

        if (!value) {
          updateAppearanceControls();
          setAppearanceStatus(
            "Valeur de couleur invalide.",
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
          "Aperçu local — pense à enregistrer."
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
          "Valeurs par défaut prévisualisées — clique sur Enregistrer pour confirmer."
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
          "Compte People introuvable."
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
        "Impossible de charger le profil.",
        "error"
      );
    }
  }

  function openSettings() {
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
          "Bio enregistrée ✓",
          "success"
        );
      } catch (err) {
        setStatus(
          err?.message ||
          "Impossible d'enregistrer la bio.",
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
          "Format d'image non supporté.",
          "error"
        );

        avatarInput.value =
          "";

        return;
      }

      avatarButton.disabled =
        true;

      setStatus(
        "Préparation de la photo…"
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
            "Impossible de préparer la photo."
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
            "Impossible de changer la photo."
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
          "Photo enregistrée ✓",
          "success"
        );
      } catch (err) {
        setStatus(
          err?.message ||
          "Impossible de changer la photo.",
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
        ? "Microphone par défaut"
        : "Sortie par défaut";

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
          "Ce navigateur ne permet pas de choisir les périphériques audio.";
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
        "Recherche des périphériques…";
    }

    try {
      if (
        requestPermission &&
        navigator.mediaDevices
          ?.getUserMedia
      ) {
        try {
          const temporary =
            await navigator.mediaDevices
              .getUserMedia({
                audio: true,
                video: false
              });

          for (
            const track of
            temporary.getTracks()
          ) {
            track.stop();
          }
        } catch {}
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

      fillDeviceSelect(
        audioInputSelect,
        inputs,
        "input"
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
            "Micro sélectionnable. Le choix de sortie n'est pas supporté par ce navigateur.";
        } else if (
          !hasNamedInput
        ) {
          audioDeviceStatus.textContent =
            "Clique sur Détecter / actualiser pour autoriser People à afficher les noms.";
        } else {
          audioDeviceStatus.textContent =
            "Les changements sont appliqués automatiquement.";
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
          "Impossible de charger les périphériques.";
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
            "Micro changé ✓";
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
            "Sortie audio changée ✓";
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
        title="Écouter"
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
