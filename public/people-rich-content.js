(() => {
  "use strict";

  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const ACCEPTED_IMAGE_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif"
  ]);

  function cleanUrlTail(value) {
    let url = String(value || "");
    let tail = "";

    while (
      url &&
      /[.,!?;:)\]}]$/.test(url)
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
      /https?:\/\/[^\s<>"']+/gi;

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
          youtubeId(
            cleaned.url
          );

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

    container.replaceChildren();

    const youtubeIds =
      appendTextWithLinks(
        container,
        text
      );

    for (
      const id of youtubeIds
    ) {
      appendYoutube(
        container,
        id
      );
    }

    appendImage(
      container,
      imageId
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
    preview
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
