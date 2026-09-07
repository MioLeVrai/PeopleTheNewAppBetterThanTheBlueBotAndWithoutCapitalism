(() => {
  const TARGET_BYTES = 14 * 1024;

  const SIZES = [
    128,
    112,
    96,
    80
  ];

  const QUALITIES = [
    0.72,
    0.60,
    0.48,
    0.38,
    0.30,
    0.22,
    0.16
  ];

  function canvasToBlob(
    canvas,
    quality
  ) {
    return new Promise(
      (resolve) => {
        canvas.toBlob(
          resolve,
          "image/jpeg",
          quality
        );
      }
    );
  }

  async function blobToImage(
    blob
  ) {
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
              "Impossible de lire l'image recadrée."
            )
          );
        };

        image.src = url;
      }
    );
  }

  function makeCanvas(
    loaded,
    size
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = size;
    canvas.height = size;

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

    ctx.imageSmoothingEnabled =
      true;

    ctx.imageSmoothingQuality =
      "high";

    ctx.fillStyle =
      "#1e1f22";

    ctx.fillRect(
      0,
      0,
      size,
      size
    );

    ctx.drawImage(
      loaded.source,
      0,
      0,
      size,
      size
    );

    return canvas;
  }

  async function compress(
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

    let smallest = null;

    try {
      for (
        const size
        of SIZES
      ) {
        const canvas =
          makeCanvas(
            loaded,
            size
          );

        for (
          const quality
          of QUALITIES
        ) {
          const blob =
            await canvasToBlob(
              canvas,
              quality
            );

          if (!blob) {
            continue;
          }

          if (
            !smallest ||
            blob.size <
              smallest.blob.size
          ) {
            smallest = {
              blob,
              size,
              quality
            };
          }

          if (
            blob.size <=
            TARGET_BYTES
          ) {
            return {
              blob,
              size,
              quality
            };
          }
        }
      }

      if (!smallest) {
        throw new Error(
          "Impossible de compresser la photo."
        );
      }

      return smallest;
    } finally {
      loaded.close?.();
    }
  }

  function blobToBase64(
    blob
  ) {
    return new Promise(
      (resolve, reject) => {
        const reader =
          new FileReader();

        reader.onload = () => {
          const value =
            String(
              reader.result ||
              ""
            );

          const comma =
            value.indexOf(",");

          if (comma < 0) {
            reject(
              new Error(
                "Conversion de la photo impossible."
              )
            );

            return;
          }

          resolve(
            value.slice(
              comma + 1
            )
          );
        };

        reader.onerror = () => {
          reject(
            new Error(
              "Conversion de la photo impossible."
            )
          );
        };

        reader.readAsDataURL(
          blob
        );
      }
    );
  }

  function applyPreview(
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
            current !== wanted
          ) {
            return;
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
            username;

          image.onload = () => {
            setTimeout(
              () =>
                URL.revokeObjectURL(
                  url
                ),
              600
            );
          };

          image.src = url;

          element.replaceChildren(
            image
          );
        }
      );
  }

  async function prepare(
    croppedBlob
  ) {
    const compressed =
      await compress(
        croppedBlob
      );

    const base64 =
      await blobToBase64(
        compressed.blob
      );

    return {
      ...compressed,
      base64,
      mime:
        "image/jpeg"
    };
  }

  window.PeopleAvatarUltra = {
    prepare,
    applyPreview,
    targetBytes:
      TARGET_BYTES
  };
})();
