(() => {
  /*
    Compatibilité avec l'ancien module "upload-fix".
    Le vrai travail est désormais centralisé dans
    PeopleAvatarUltra (compression) et PeopleAvatars
    (cache + affichage), afin d'éviter trois pipelines
    avatar différents chargés en parallèle.
  */

  async function prepareForUpload(
    croppedBlob
  ) {
    if (
      !croppedBlob ||
      croppedBlob.size <= 0
    ) {
      throw new Error(
        "Le recadrage n'a produit aucune image."
      );
    }

    const prepared =
      await window
        .PeopleAvatarUltra
        ?.prepare(
          croppedBlob
        );

    return (
      prepared?.blob ||
      croppedBlob
    );
  }

  function applyBlobEverywhere(
    username,
    blob
  ) {
    return Boolean(
      window.PeopleAvatars
        ?.applyBlobEverywhere?.(
          username,
          blob
        )
    );
  }

  function applyBlobToElement(
    element,
    username,
    blob
  ) {
    if (
      !element ||
      !blob ||
      blob.size <= 0
    ) {
      return false;
    }

    const url =
      URL.createObjectURL(
        blob
      );

    const image =
      document.createElement(
        "img"
      );

    image.className =
      "people-avatar-image";

    image.alt =
      "Photo de profil de " +
      (
        String(
          username || "?"
        ).trim() || "?"
      );

    image.decoding =
      "async";

    const release = () => {
      URL.revokeObjectURL(
        url
      );
    };

    image.addEventListener(
      "load",
      release,
      {
        once: true
      }
    );

    image.addEventListener(
      "error",
      release,
      {
        once: true
      }
    );

    image.src = url;

    element.replaceChildren(
      image
    );

    return true;
  }

  async function reloadFromServer(
    username
  ) {
    const name =
      String(
        username || ""
      ).trim();

    if (!name) {
      return false;
    }

    window.PeopleAvatars
      ?.refresh?.(
        name
      );

    await window.PeopleAvatars
      ?.preload?.(
        name
      );

    return true;
  }

  window.PeopleAvatarUploadFix = {
    prepareForUpload,
    applyBlobToElement,
    applyBlobEverywhere,
    reloadFromServer
  };
})();
