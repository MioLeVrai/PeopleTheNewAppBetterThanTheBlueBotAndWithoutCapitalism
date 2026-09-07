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
    try {
      if (!audioContext) {
        const AudioCtx =
          window.AudioContext ||
          window.webkitAudioContext;

        if (AudioCtx) {
          audioContext =
            new AudioCtx();
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

    return audioContext;
  }

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

  document.addEventListener(
    "pointerdown",
    ensureAudio,
    {
      passive: true
    }
  );

  document.addEventListener(
    "keydown",
    ensureAudio
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

  const ringtones =
    document.getElementById(
      "peopleSettingsRingtones"
    );

  const notifications =
    document.getElementById(
      "peopleSettingsNotifications"
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
      const meData =
        await api(
          "/api/auth/me"
        );

      currentUser =
        meData.user;

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

    renderSounds();

    void loadProfile();
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

    const selected =
      kind ===
        "ringtone"
        ? window.PeopleSounds
            .getRingtone()
        : window.PeopleSounds
            .getNotificationSound();

    card.classList.toggle(
      "selected",
      sound.id ===
        selected
    );

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

    card.addEventListener(
      "click",
      (event) => {
        const preview =
          event.target instanceof
          Element
            ? event.target.closest(
                ".people-settings-sound-preview"
              )
            : null;

        if (
          kind ===
          "ringtone"
        ) {
          window.PeopleSounds
            .setRingtone(
              sound.id
            );

          window.PeopleSounds
            .playRingtonePulse(
              "incoming",
              sound.id
            );
        } else {
          window.PeopleSounds
            .setNotificationSound(
              sound.id
            );

          window.PeopleSounds
            .playNotification(
              sound.id
            );
        }

        renderSounds();

        if (preview) {
          event.stopPropagation();
        }
      }
    );

    return card;
  }

  function renderSounds() {
    ringtones.innerHTML =
      "";

    notifications.innerHTML =
      "";

    for (
      const sound of
      RINGTONES
    ) {
      ringtones.appendChild(
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
      notifications.appendChild(
        soundCard(
          sound,
          "notification"
        )
      );
    }
  }

  renderSounds();

  // === PEOPLE_SETTINGS_V1_END ===
})();
