(() => {
  const OUTPUT_SIZE = 384;
  const TARGET_BYTES = 300 * 1024;

  function delay(ms) {
    return new Promise(
      (resolve) =>
        setTimeout(resolve, ms)
    );
  }

  function canvasToBlob(
    canvas,
    type,
    quality
  ) {
    return new Promise(
      (resolve) => {
        canvas.toBlob(
          resolve,
          type,
          quality
        );
      }
    );
  }

  async function blobToImage(blob) {
    if (
      typeof createImageBitmap ===
      "function"
    ) {
      try {
        const bitmap =
          await createImageBitmap(
            blob
          );

        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          close() {
            bitmap.close?.();
          }
        };
      } catch {}
    }

    return new Promise(
      (resolve, reject) => {
        const url =
          URL.createObjectURL(
            blob
          );

        const image =
          new Image();

        image.onload = () => {
          resolve({
            source: image,
            width:
              image.naturalWidth ||
              image.width,
            height:
              image.naturalHeight ||
              image.height,
            close() {
              URL.revokeObjectURL(
                url
              );
            }
          });
        };

        image.onerror = () => {
          URL.revokeObjectURL(
            url
          );

          reject(
            new Error(
              "Impossible de préparer la photo."
            )
          );
        };

        image.src = url;
      }
    );
  }

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

    const loaded =
      await blobToImage(
        croppedBlob
      );

    try {
      const canvas =
        document.createElement(
          "canvas"
        );

      canvas.width =
        OUTPUT_SIZE;

      canvas.height =
        OUTPUT_SIZE;

      const ctx =
        canvas.getContext(
          "2d",
          {
            alpha: false
          }
        );

      if (!ctx) {
        throw new Error(
          "Canvas indisponible."
        );
      }

      ctx.fillStyle =
        "#1e1f22";

      ctx.fillRect(
        0,
        0,
        OUTPUT_SIZE,
        OUTPUT_SIZE
      );

      ctx.drawImage(
        loaded.source,
        0,
        0,
        OUTPUT_SIZE,
        OUTPUT_SIZE
      );

      const qualities = [
        0.82,
        0.74,
        0.66,
        0.58,
        0.50
      ];

      let best = null;

      for (
        const quality
        of qualities
      ) {
        const blob =
          await canvasToBlob(
            canvas,
            "image/jpeg",
            quality
          );

        if (!blob) {
          continue;
        }

        best = blob;

        if (
          blob.size <=
          TARGET_BYTES
        ) {
          break;
        }
      }

      if (!best) {
        throw new Error(
          "La compression JPEG a échoué."
        );
      }

      return best;
    } finally {
      loaded.close?.();
    }
  }

  function applyBlobToElement(
    element,
    username,
    blob
  ) {
    if (
      !element ||
      !blob
    ) {
      return;
    }

    const name =
      String(
        username || "?"
      ).trim() || "?";

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
      name;

    image.onload = () => {
      setTimeout(
        () =>
          URL.revokeObjectURL(
            url
          ),
        500
      );
    };

    image.onerror = () => {
      URL.revokeObjectURL(
        url
      );
    };

    image.src = url;

    element.dataset
      .peopleAvatarUsername =
      name;

    element.classList.add(
      "people-avatar-host"
    );

    element.replaceChildren(
      image
    );
  }

  function applyBlobEverywhere(
    username,
    blob
  ) {
    const wanted =
      String(
        username || ""
      )
        .trim()
        .toLocaleLowerCase(
          "fr-FR"
        );

    if (!wanted) {
      return;
    }

    document
      .querySelectorAll(
        "[data-people-avatar-username]"
      )
      .forEach(
        (element) => {
          const current =
            String(
              element.dataset
                .peopleAvatarUsername ||
              ""
            )
              .trim()
              .toLocaleLowerCase(
                "fr-FR"
              );

          if (
            current === wanted
          ) {
            applyBlobToElement(
              element,
              username,
              blob
            );
          }
        }
      );
  }

  async function fetchAvatar(
    username
  ) {
    const name =
      String(
        username || ""
      ).trim();

    if (!name) {
      return null;
    }

    const response =
      await fetch(
        "/api/profile/avatar/" +
          encodeURIComponent(
            name
          ) +
          "?fresh=" +
          Date.now(),
        {
          method: "GET",
          credentials:
            "same-origin",
          cache: "no-store"
        }
      );

    if (!response.ok) {
      return null;
    }

    const blob =
      await response.blob();

    if (
      !String(blob.type)
        .startsWith(
          "image/"
        ) ||
      blob.size <= 0
    ) {
      return null;
    }

    return blob;
  }

  async function reloadFromServer(
    username
  ) {
    let blob = null;

    for (
      let attempt = 0;
      attempt < 3;
      attempt += 1
    ) {
      blob =
        await fetchAvatar(
          username
        );

      if (blob) {
        break;
      }

      await delay(
        180 +
        attempt * 180
      );
    }

    if (!blob) {
      return false;
    }

    applyBlobEverywhere(
      username,
      blob
    );

    window.PeopleAvatars
      ?.refresh(
        username
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
