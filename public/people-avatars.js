(() => {
  const versions = new Map();
  const requests = new WeakMap();

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

    const version =
      versions.get(
        key(name)
      ) || 0;

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

    if (
      !body?.avatar?.data
    ) {
      return null;
    }

    return dataUrl(
      body.avatar.mime,
      body.avatar.data
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
    loadAvatarData
  };
})();
