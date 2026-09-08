(() => {
  "use strict";

  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const ACCEPTED_IMAGE_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif"
  ]);

  const TRAILING_URL_PUNCTUATION_RE =
    /[.,!?;:)\]}]$/;

  const MESSAGE_URL_RE =
    /https?:\/\/[^\s<>"']+/gi;

  function mayBeYoutubeUrl(value) {
    const source =
      String(value || "")
        .toLowerCase();

    return (
      source.includes("youtu.be/") ||
      source.includes("youtube.com/") ||
      source.includes("m.youtube.com/")
    );
  }

  function cleanUrlTail(value) {
    let url = String(value || "");
    let tail = "";

    while (
      url &&
      TRAILING_URL_PUNCTUATION_RE.test(url)
    ) {
      tail =
        url.slice(-1) +
        tail;

      url =
        url.slice(0, -1);
    }

    return {
      url,
      tail
    };
  }

  function youtubeId(value) {
    try {
      const url =
        new URL(value);

      const host =
        url.hostname
          .toLowerCase()
          .replace(/^www\./, "");

      let id = "";

      if (
        host === "youtu.be"
      ) {
        id =
          url.pathname
            .split("/")
            .filter(Boolean)[0] || "";
      } else if (
        host === "youtube.com" ||
        host === "m.youtube.com"
      ) {
        if (
          url.pathname === "/watch"
        ) {
          id =
            url.searchParams.get("v") || "";
        } else {
          const parts =
            url.pathname
              .split("/")
              .filter(Boolean);

          if (
            ["shorts", "embed", "live"]
              .includes(parts[0])
          ) {
            id =
              parts[1] || "";
          }
        }
      }

      return /^[A-Za-z0-9_-]{11}$/.test(id)
        ? id
        : null;
    } catch {
      return null;
    }
  }

  function appendTextWithLinks(
    container,
    text
  ) {
    const source =
      String(text || "");

    const youtubeIds = [];
    const seenYoutube =
      new Set();

    const regex =
      MESSAGE_URL_RE;

    regex.lastIndex = 0;

    let cursor = 0;
    let match;

    while (
      (match = regex.exec(source))
    ) {
      if (match.index > cursor) {
        container.appendChild(
          document.createTextNode(
            source.slice(
              cursor,
              match.index
            )
          )
        );
      }

      const cleaned =
        cleanUrlTail(match[0]);

      if (cleaned.url) {
        const link =
          document.createElement("a");

        link.href =
          cleaned.url;

        link.target =
          "_blank";

        link.rel =
          "noopener noreferrer";

        link.className =
          "people-message-link";

        link.textContent =
          cleaned.url;

        container.appendChild(
          link
        );

        const id =
          mayBeYoutubeUrl(
            cleaned.url
          )
            ? youtubeId(
                cleaned.url
              )
            : null;

        if (
          id &&
          !seenYoutube.has(id) &&
          youtubeIds.length < 2
        ) {
          seenYoutube.add(id);
          youtubeIds.push(id);
        }
      }

      if (cleaned.tail) {
        container.appendChild(
          document.createTextNode(
            cleaned.tail
          )
        );
      }

      cursor =
        match.index +
        match[0].length;
    }

    if (cursor < source.length) {
      container.appendChild(
        document.createTextNode(
          source.slice(cursor)
        )
      );
    }

    return youtubeIds;
  }

  function appendYoutube(
    container,
    id
  ) {
    const wrap =
      document.createElement("div");

    wrap.className =
      "people-youtube-preview";

    const iframe =
      document.createElement("iframe");

    iframe.src =
      "https://www.youtube-nocookie.com/embed/" +
      encodeURIComponent(id);

    iframe.title =
      "Prévisualisation YouTube";

    iframe.loading =
      "lazy";

    iframe.referrerPolicy =
      "strict-origin-when-cross-origin";

    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";

    iframe.allowFullscreen =
      true;

    wrap.appendChild(
      iframe
    );

    container.appendChild(
      wrap
    );
  }

  function appendImage(
    container,
    imageId
  ) {
    const id =
      String(imageId || "").trim();

    if (!id) return;

    const link =
      document.createElement("a");

    link.className =
      "people-message-image-link";

    link.href =
      "/api/chat/image/" +
      encodeURIComponent(id);

    link.target =
      "_blank";

    link.rel =
      "noopener noreferrer";

    const image =
      document.createElement("img");

    image.className =
      "people-message-image";

    image.src =
      link.href;

    image.alt =
      "Image envoyée";

    image.loading =
      "lazy";

    image.decoding =
      "async";

    image.fetchPriority =
      "low";

    link.appendChild(
      image
    );

    container.appendChild(
      link
    );
  }

  function render(
    container,
    {
      text = "",
      imageId = null
    } = {}
  ) {
    if (!container) return;

    const fragment =
      document.createDocumentFragment();

    const youtubeIds =
      appendTextWithLinks(
        fragment,
        text
      );

    for (
      const id of youtubeIds
    ) {
      appendYoutube(
        fragment,
        id
      );
    }

    appendImage(
      fragment,
      imageId
    );

    container.replaceChildren(
      fragment
    );
  }

  function validateImage(file) {
    if (!file) {
      throw new Error(
        "Aucune image sélectionnée."
      );
    }

    if (
      !ACCEPTED_IMAGE_TYPES.has(
        file.type
      )
    ) {
      throw new Error(
        "Format non accepté. JPEG, PNG, WebP ou GIF uniquement."
      );
    }

    if (
      file.size <= 0 ||
      file.size >
        MAX_IMAGE_BYTES
    ) {
      throw new Error(
        "L'image doit faire moins de 5 Mo."
      );
    }
  }

  async function uploadImage(file) {
    validateImage(file);

    const response =
      await fetch(
        "/api/chat/image",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type":
              file.type
          },
          body: file
        }
      );

    const data =
      await response
        .json()
        .catch(
          () => ({})
        );

    if (
      !response.ok ||
      data.ok === false ||
      !data.imageId
    ) {
      throw new Error(
        data.error ||
        "Impossible d'envoyer l'image."
      );
    }

    return String(
      data.imageId
    );
  }

  function createImagePicker({
    button,
    input,
    preview,
    pasteTarget
  }) {
    let selectedFile =
      null;

    let objectUrl =
      null;

    function clear() {
      selectedFile =
        null;

      if (input) {
        input.value = "";
      }

      if (objectUrl) {
        URL.revokeObjectURL(
          objectUrl
        );

        objectUrl =
          null;
      }

      if (preview) {
        preview.replaceChildren();
        preview.classList.add(
          "hidden"
        );
      }
    }

    function show(file) {
      clear();

      validateImage(file);

      selectedFile =
        file;

      if (!preview) return;

      objectUrl =
        URL.createObjectURL(
          file
        );

      const image =
        document.createElement("img");

      image.src =
        objectUrl;

      image.alt =
        "Image sélectionnée";

      image.decoding =
        "async";

      const remove =
        document.createElement("button");

      remove.type =
        "button";

      remove.className =
        "composer-image-remove";

      remove.title =
        "Retirer l'image";

      remove.setAttribute(
        "aria-label",
        "Retirer l'image"
      );

      remove.textContent =
        "×";

      remove.addEventListener(
        "click",
        clear
      );

      preview.append(
        image,
        remove
      );

      preview.classList.remove(
        "hidden"
      );
    }

    button?.addEventListener(
      "click",
      () =>
        input?.click()
    );

    input?.addEventListener(
      "change",
      () => {
        const file =
          input.files?.[0];

        if (!file) {
          clear();
          return;
        }

        try {
          show(file);
        } catch (err) {
          alert(err.message);
          clear();
        }
      }
    );

    /*
      PEOPLE_CLIPBOARD_IMAGES_V1

      Permet notamment :
      Win + Shift + S
      puis Ctrl + V dans le champ de message.

      Le collage texte normal n'est jamais bloqué
      s'il n'y a aucune image dans le presse-papiers.
    */
    pasteTarget?.addEventListener(
      "paste",
      (event) => {
        const clipboard =
          event.clipboardData;

        if (!clipboard) {
          return;
        }

        let file =
          Array.from(
            clipboard.files || []
          ).find(
            (candidate) =>
              String(
                candidate?.type || ""
              ).startsWith(
                "image/"
              )
          ) || null;

        if (!file) {
          const imageItem =
            Array.from(
              clipboard.items || []
            ).find(
              (item) =>
                item.kind === "file" &&
                String(
                  item.type || ""
                ).startsWith(
                  "image/"
                )
            );

          file =
            imageItem?.getAsFile?.() ||
            null;
        }

        if (!file) {
          return;
        }

        try {
          show(file);
          event.preventDefault();
        } catch (err) {
          event.preventDefault();

          alert(
            err?.message ||
            "Impossible de coller cette image."
          );

          clear();
        }
      }
    );

    return {
      getFile() {
        return selectedFile;
      },

      clear,

      setBusy(busy) {
        if (button) {
          button.disabled =
            Boolean(busy);
        }

        if (input) {
          input.disabled =
            Boolean(busy);
        }
      }
    };
  }

  window.PeopleRichContent = {
    render,
    uploadImage,
    createImagePicker,
    youtubeId
  };
})();
