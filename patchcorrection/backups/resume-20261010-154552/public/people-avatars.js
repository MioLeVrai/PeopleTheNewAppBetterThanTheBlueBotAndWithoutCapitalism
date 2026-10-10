(() => {
  const versions = new Map();
  const requests = new WeakMap();
  const elementStates = new WeakMap();

  // === PEOPLE_AVATAR_CACHE_V2_START ===
  const avatarCache =
    new Map();

  const avatarInflight =
    new Map();

  const PEOPLE_AVATAR_PRELOAD_CONCURRENCY =
    4;

  function currentVersion(
    username
  ) {
    return (
      versions.get(
        key(username)
      ) || 0
    );
  }

  function cachedAvatar(
    username
  ) {
    const wanted =
      key(username);

    const cached =
      avatarCache.get(
        wanted
      );

    if (
      !cached ||
      cached.version !==
        currentVersion(
          username
        )
    ) {
      return null;
    }

    return cached;
  }

  function releaseCachedAvatar(
    cached
  ) {
    if (
      cached?.objectUrl &&
      cached.src
    ) {
      URL.revokeObjectURL(
        cached.src
      );
    }
  }

  function storeAvatar(
    username,
    src,
    objectUrl = false
  ) {
    const wanted =
      key(username);

    const previous =
      avatarCache.get(
        wanted
      );

    if (
      previous &&
      previous.src !== src
    ) {
      releaseCachedAvatar(
        previous
      );
    }

    avatarCache.set(
      wanted,
      {
        version:
          currentVersion(
            username
          ),
        src:
          src || "",
        objectUrl:
          Boolean(
            objectUrl && src
          )
      }
    );
  }

  function clearAvatarCache(
    username
  ) {
    const wanted =
      key(username);

    releaseCachedAvatar(
      avatarCache.get(
        wanted
      )
    );

    avatarCache.delete(
      wanted
    );

    for (
      const inflightKey of
      [...avatarInflight.keys()]
    ) {
      if (
        inflightKey.startsWith(
          wanted + "|"
        )
      ) {
        avatarInflight.delete(
          inflightKey
        );
      }
    }
  }

  function renderCachedAvatar(
    element,
    username,
    src
  ) {
    const name =
      String(
        username || "?"
      ).trim() || "?";

    const requestId =
      Symbol(
        "avatar-cache"
      );

    requests.set(
      element,
      requestId
    );

    if (!src) {
      element.replaceChildren(
        fallbackFor(
          name
        )
      );

      return;
    }

    const image =
      imageFor(
        name,
        src
      );

    image.addEventListener(
      "error",
      () => {
        if (
          requests.get(
            element
          ) === requestId
        ) {
          element.replaceChildren(
            fallbackFor(
              name
            )
          );
        }
      },
      {
        once: true
      }
    );

    /*
      La source a déjà été récupérée et mise en cache :
      on l'affiche immédiatement sans nouvelle requête.
    */
    element.replaceChildren(
      image
    );
  }
  // === PEOPLE_AVATAR_CACHE_V2_END ===

  function initials(value) {
    return String(value || "?")
      .trim()
      .slice(0, 2)
      .toUpperCase();
  }

  function key(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase("fr-FR");
  }

  function avatarElementsFor(
    username
  ) {
    const wanted =
      key(username);

    if (!wanted) {
      return [];
    }

    if (
      window.CSS?.escape
    ) {
      return document.querySelectorAll(
        '[data-people-avatar-key="' +
          window.CSS.escape(
            wanted
          ) +
          '"]'
      );
    }

    return [
      ...document.querySelectorAll(
        "[data-people-avatar-key]"
      )
    ].filter(
      (element) =>
        element.dataset
          .peopleAvatarKey ===
        wanted
    );
  }

  function fallbackFor(name) {
    const fallback =
      document.createElement("span");

    fallback.className =
      "people-avatar-fallback";

    fallback.textContent =
      initials(name);

    return fallback;
  }

  function imageFor(
    name,
    src
  ) {
    const image =
      document.createElement("img");

    image.className =
      "people-avatar-image";

    image.alt =
      "Photo de profil de " +
      name;

    /*
      PAS de loading="lazy" ici :
      certains avatars sont créés dans des zones
      cachées (modal profil) avant d'être affichées.
    */
    image.decoding = "async";
    image.src = src;

    return image;
  }

  async function loadAvatarData(
    username
  ) {
    const name =
      String(
        username || ""
      ).trim();

    if (!name) {
      return null;
    }

    const cached =
      cachedAvatar(
        name
      );

    if (cached) {
      return (
        cached.src ||
        null
      );
    }

    const version =
      currentVersion(
        name
      );

    const inflightKey =
      key(name) +
      "|" +
      String(version);

    if (
      avatarInflight.has(
        inflightKey
      )
    ) {
      return avatarInflight.get(
        inflightKey
      );
    }

    const request =
      (async () => {
        const response =
          await fetch(
            "/api/profile/avatar/" +
              encodeURIComponent(
                name
              ) +
              "?v=" +
              encodeURIComponent(
                String(version)
              ),
            {
              method: "GET",
              credentials:
                "same-origin",
              cache:
                "no-store",
              headers: {
                Accept:
                  "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
              }
            }
          );

        /*
          Une absence de photo est aussi mise en cache.
          Sinon un compte sans avatar déclencherait
          une requête à chaque nouvel affichage.
        */
        if (
          response.status === 404
        ) {
          if (
            currentVersion(
              name
            ) === version
          ) {
            storeAvatar(
              name,
              ""
            );
          }

          return null;
        }

        if (!response.ok) {
          throw new Error(
            "Avatar indisponible."
          );
        }

        const blob =
          await response.blob();

        if (!blob.size) {
          if (
            currentVersion(
              name
            ) === version
          ) {
            storeAvatar(
              name,
              ""
            );
          }

          return null;
        }

        const src =
          URL.createObjectURL(
            blob
          );

        /*
          Si l'avatar a changé pendant la requête,
          cette réponse est déjà périmée : on libère
          immédiatement son Blob URL.
        */
        if (
          currentVersion(
            name
          ) !== version
        ) {
          URL.revokeObjectURL(
            src
          );

          return null;
        }

        storeAvatar(
          name,
          src,
          true
        );

        return src;
      })();

    avatarInflight.set(
      inflightKey,
      request
    );

    try {
      return await request;
    } finally {
      if (
        avatarInflight.get(
          inflightKey
        ) === request
      ) {
        avatarInflight.delete(
          inflightKey
        );
      }
    }
  }

  async function preload(
    username
  ) {
    try {
      await loadAvatarData(
        username
      );
    } catch {
      /*
        Un avatar en erreur ne doit jamais
        bloquer un préchargement global.
      */
    }
  }

  async function preloadMany(
    usernames
  ) {
    const uniqueNames =
      new Map();

    for (
      const value of
      Array.isArray(
        usernames
      )
        ? usernames
        : []
    ) {
      const name =
        String(
          value || ""
        ).trim();

      if (name) {
        uniqueNames.set(
          key(name),
          name
        );
      }
    }

    const names =
      [
        ...uniqueNames.values()
      ];

    if (!names.length) {
      return;
    }

    let cursor =
      0;

    async function worker() {
      while (
        cursor <
        names.length
      ) {
        const index =
          cursor++;

        await preload(
          names[index]
        );
      }
    }

    const workers =
      Math.min(
        PEOPLE_AVATAR_PRELOAD_CONCURRENCY,
        names.length
      );

    await Promise.all(
      Array.from(
        {
          length:
            workers
        },
        worker
      )
    );
  }

  async function apply(
    element,
    username
  ) {
    if (!element) {
      return;
    }

    const name =
      String(
        username || "?"
      ).trim() || "?";

    const wanted =
      key(name);

    const version =
      currentVersion(
        name
      );

    const previousState =
      elementStates.get(
        element
      );

    /*
      Certains composants réappellent apply() à chaque
      mise à jour alors que l'avatar n'a pas changé.
      Dans ce cas on garde simplement l'image déjà rendue.
    */
    if (
      previousState?.key ===
        wanted &&
      previousState.version ===
        version &&
      previousState.status !==
        "error"
    ) {
      return;
    }

    elementStates.set(
      element,
      {
        key: wanted,
        version,
        status: "loading"
      }
    );

    element.dataset
      .peopleAvatarUsername =
      name;

    element.dataset
      .peopleAvatarKey =
      wanted;

    element.classList.add(
      "people-avatar-host"
    );

    const cached =
      cachedAvatar(
        name
      );

    if (cached) {
      renderCachedAvatar(
        element,
        name,
        cached.src
      );

      elementStates.set(
        element,
        {
          key: wanted,
          version,
          status: "rendered"
        }
      );

      return;
    }

    element.replaceChildren(
      fallbackFor(name)
    );

    const requestId =
      Symbol("avatar-request");

    requests.set(
      element,
      requestId
    );

    try {
      const src =
        await loadAvatarData(
          name
        );

      if (
        requests.get(
          element
        ) !== requestId ||
        element.dataset
          .peopleAvatarKey !==
          wanted
      ) {
        return;
      }

      if (!src) {
        elementStates.set(
          element,
          {
            key: wanted,
            version,
            status: "rendered"
          }
        );

        return;
      }

      const image =
        imageFor(
          name,
          src
        );

      image.addEventListener(
        "error",
        () => {
          if (
            requests.get(
              element
            ) === requestId
          ) {
            element.replaceChildren(
              fallbackFor(name)
            );

            elementStates.set(
              element,
              {
                key: wanted,
                version,
                status: "error"
              }
            );
          }
        },
        {
          once: true
        }
      );

      if (
        requests.get(
          element
        ) === requestId
      ) {
        element.replaceChildren(
          image
        );

        elementStates.set(
          element,
          {
            key: wanted,
            version,
            status: "rendered"
          }
        );
      }
    } catch (err) {
      if (
        requests.get(
          element
        ) === requestId
      ) {
        elementStates.set(
          element,
          {
            key: wanted,
            version,
            status: "error"
          }
        );
      }

      console.warn(
        "[People avatar]",
        name,
        err
      );
    }
  }

  function applyDataUrlToElement(
    element,
    username,
    src
  ) {
    if (
      !element ||
      !src
    ) {
      return;
    }

    const name =
      String(
        username || "?"
      ).trim() || "?";

    const wanted =
      key(name);

    const version =
      currentVersion(name);

    const previousState =
      elementStates.get(
        element
      );

    /*
      Les écrans profil/settings peuvent demander deux fois
      de suite exactement le même avatar après un upload.
      On évite de recréer une <img> identique.
    */
    if (
      previousState?.key ===
        wanted &&
      previousState.version ===
        version &&
      previousState.src === src &&
      previousState.status !==
        "error"
    ) {
      return;
    }

    element.dataset
      .peopleAvatarUsername =
      name;

    element.dataset
      .peopleAvatarKey =
      wanted;

    element.classList.add(
      "people-avatar-host"
    );

    elementStates.set(
      element,
      {
        key: wanted,
        version,
        src,
        status: "loading"
      }
    );

    const requestId =
      Symbol(
        "avatar-direct"
      );

    requests.set(
      element,
      requestId
    );

    const image =
      imageFor(
        name,
        src
      );

    image.addEventListener(
      "error",
      () => {
        if (
          requests.get(
            element
          ) === requestId
        ) {
          element.replaceChildren(
            fallbackFor(name)
          );

          elementStates.set(
            element,
            {
              key: wanted,
              version,
              src,
              status: "error"
            }
          );
        }
      },
      {
        once: true
      }
    );

    image.addEventListener(
      "load",
      () => {
        if (
          requests.get(
            element
          ) === requestId
        ) {
          element.replaceChildren(
            image
          );

          elementStates.set(
            element,
            {
              key: wanted,
              version,
              src,
              status: "rendered"
            }
          );
        }
      },
      {
        once: true
      }
    );
  }

  function applyDataUrlEverywhere(
    username,
    src
  ) {
    const wanted =
      key(username);

    if (
      !wanted ||
      !src
    ) {
      return;
    }

    storeAvatar(
      username,
      src
    );

    avatarElementsFor(
      username
    ).forEach(
      (element) => {
        applyDataUrlToElement(
          element,
          username,
          src
        );
      }
    );
  }

  function applyBlobEverywhere(
    username,
    blob
  ) {
    const name =
      String(
        username || ""
      ).trim();

    if (
      !name ||
      !blob ||
      blob.size <= 0
    ) {
      return false;
    }

    const src =
      URL.createObjectURL(
        blob
      );

    /*
      Une seule Blob URL est partagée par tous les avatars
      du même utilisateur. Elle reste vivante dans le cache
      et sera révoquée automatiquement au prochain refresh.
    */
    storeAvatar(
      name,
      src,
      true
    );

    avatarElementsFor(
      name
    ).forEach(
      (element) => {
        applyDataUrlToElement(
          element,
          name,
          src
        );
      }
    );

    return true;
  }

  function refresh(username) {
    const name =
      String(
        username || ""
      ).trim();

    if (!name) {
      return;
    }

    versions.set(
      key(name),
      Date.now()
    );

    clearAvatarCache(
      name
    );

    avatarElementsFor(
      name
    ).forEach(
      (element) => {
        apply(
          element,
          name
        );
      }
    );
  }

  window.PeopleAvatars = {
    apply,
    refresh,
    applyDataUrlEverywhere,
    applyDataUrlToElement,
    applyBlobEverywhere,
    loadAvatarData,
    preload,
    preloadMany,

    cacheSize() {
      return avatarCache.size;
    }
  };
})();
