(() => {
  const versions = new Map();
  const requests = new WeakMap();

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

  function storeAvatar(
    username,
    src
  ) {
    avatarCache.set(
      key(username),
      {
        version:
          currentVersion(
            username
          ),
        src:
          src || ""
      }
    );
  }

  function clearAvatarCache(
    username
  ) {
    const wanted =
      key(username);

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
      La data URL a déjà été récupérée :
      on l'affiche immédiatement au lieu d'attendre
      une nouvelle requête réseau.
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

  function dataUrl(
    mime,
    base64
  ) {
    const type =
      String(
        mime || "image/jpeg"
      );

    const data =
      String(
        base64 || ""
      ).trim();

    if (!data) {
      return "";
    }

    return (
      "data:" +
      type +
      ";base64," +
      data
    );
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
            "/api/profile/avatar-json/" +
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
                  "application/json"
              }
            }
          );

        let body = null;

        try {
          body =
            await response.json();
        } catch {}

        if (!response.ok) {
          throw new Error(
            body?.error ||
            "Avatar indisponible."
          );
        }

        const src =
          body?.avatar?.data
            ? dataUrl(
                body.avatar.mime,
                body.avatar.data
              )
            : "";

        /*
          Même "pas de PP" est mis en cache.
          Sinon les comptes sans photo provoqueraient
          eux aussi une requête à chaque changement d'écran.
        */
        if (
          currentVersion(
            name
          ) === version
        ) {
          storeAvatar(
            name,
            src
          );
        }

        return (
          src ||
          null
        );
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
    const names =
      [
        ...new Set(
          (
            Array.isArray(
              usernames
            )
              ? usernames
              : []
          )
            .map(
              (name) =>
                String(
                  name || ""
                ).trim()
            )
            .filter(Boolean)
        )
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

    element.dataset
      .peopleAvatarUsername =
      name;

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
          .peopleAvatarUsername !==
          name
      ) {
        return;
      }

      if (!src) {
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
          }
        },
        {
          once: true
        }
      );

      /*
        loadAvatarData() a déjà récupéré et mis en cache
        la data URL. Pas besoin d'attendre un deuxième
        cycle "load" avant de montrer l'image.
      */
      if (
        requests.get(
          element
        ) === requestId
      ) {
        element.replaceChildren(
          image
        );
      }
    } catch (err) {
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

    element.dataset
      .peopleAvatarUsername =
      name;

    element.classList.add(
      "people-avatar-host"
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

    document
      .querySelectorAll(
        "[data-people-avatar-username]"
      )
      .forEach(
        (element) => {
          if (
            key(
              element.dataset
                .peopleAvatarUsername
            ) !== wanted
          ) {
            return;
          }

          applyDataUrlToElement(
            element,
            username,
            src
          );
        }
      );
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

    document
      .querySelectorAll(
        "[data-people-avatar-username]"
      )
      .forEach(
        (element) => {
          if (
            key(
              element.dataset
                .peopleAvatarUsername
            ) === key(name)
          ) {
            apply(
              element,
              name
            );
          }
        }
      );
  }

  window.PeopleAvatars = {
    apply,
    refresh,
    applyDataUrlEverywhere,
    applyDataUrlToElement,
    loadAvatarData,
    preload,
    preloadMany,

    cacheSize() {
      return avatarCache.size;
    }
  };
})();
