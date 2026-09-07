(() => {
  const versions = new Map();

  function initials(value) {
    return String(value || "?").trim().slice(0, 2).toUpperCase();
  }

  function key(value) {
    return String(value || "").trim().toLocaleLowerCase("fr-FR");
  }

  function avatarUrl(username) {
    const name = String(username || "").trim();
    if (!name) return "";

    return (
      "/api/profile/avatar/" +
      encodeURIComponent(name) +
      "?v=" +
      (versions.get(key(name)) || 0)
    );
  }

  function apply(element, username) {
    if (!element) return;

    const name = String(username || "?").trim() || "?";
    element.dataset.peopleAvatarUsername = name;
    element.classList.add("people-avatar-host");

    const fallback = document.createElement("span");
    fallback.className = "people-avatar-fallback";
    fallback.textContent = initials(name);
    element.replaceChildren(fallback);

    const image = document.createElement("img");
    image.className = "people-avatar-image";
    image.alt = "Photo de profil de " + name;
    image.loading = "lazy";

    image.addEventListener(
      "load",
      () => {
        if (element.dataset.peopleAvatarUsername === name) {
          element.replaceChildren(image);
        }
      },
      { once: true }
    );

    image.src = avatarUrl(name);
  }

  function refresh(username) {
    const name = String(username || "").trim();
    if (!name) return;

    versions.set(key(name), Date.now());

    document
      .querySelectorAll("[data-people-avatar-username]")
      .forEach((element) => {
        if (key(element.dataset.peopleAvatarUsername) === key(name)) {
          apply(element, element.dataset.peopleAvatarUsername);
        }
      });
  }

  window.PeopleAvatars = {
    apply,
    refresh,
    avatarUrl
  };
})();
