(() => {
  const PREVIEW_SIZE = 320;
  const OUTPUT_SIZE = 512;
  const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

  let overlay = null;
  let canvas = null;
  let ctx = null;
  let zoomInput = null;
  let info = null;
  let confirmButton = null;
  let cancelButton = null;

  let image = null;
  let imageWidth = 0;
  let imageHeight = 0;

  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;

  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  let currentResolve = null;
  let previewFrame = 0;

  function injectStyle() {
    if (
      document.getElementById(
        "peopleAvatarCropperStyle"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "peopleAvatarCropperStyle";

    style.textContent = `
      .people-avatar-cropper-overlay {
        position: fixed;
        inset: 0;
        z-index: 20000;
        display: grid;
        place-items: center;
        padding: 18px;
        background: rgba(0, 0, 0, 0.72);
      }

      .people-avatar-cropper-overlay.hidden {
        display: none;
      }

      .people-avatar-cropper-card {
        width: min(92vw, 390px);
        padding: 16px;
        border-radius: 14px;
        background: #1e1f22;
        color: #dbdee1;
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.5);
      }

      .people-avatar-cropper-title {
        margin: 0 0 5px;
        font-size: 16px;
      }

      .people-avatar-cropper-subtitle {
        margin: 0 0 12px;
        color: #949ba4;
        font-size: 11px;
      }

      .people-avatar-cropper-stage {
        width: 320px;
        max-width: 100%;
        aspect-ratio: 1 / 1;
        margin: 0 auto;
        overflow: hidden;
        border-radius: 12px;
        background:
          linear-gradient(45deg, #24262b 25%, transparent 25%),
          linear-gradient(-45deg, #24262b 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #24262b 75%),
          linear-gradient(-45deg, transparent 75%, #24262b 75%),
          #313338;
        background-size: 18px 18px;
        background-position:
          0 0,
          0 9px,
          9px -9px,
          -9px 0;
        touch-action: none;
        cursor: grab;
      }

      .people-avatar-cropper-stage:active {
        cursor: grabbing;
      }

      .people-avatar-cropper-canvas {
        width: 100%;
        height: 100%;
        display: block;
      }

      .people-avatar-cropper-controls {
        display: grid;
        gap: 8px;
        margin-top: 12px;
      }

      .people-avatar-cropper-zoom {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        color: #b5bac1;
        font-size: 10px;
      }

      .people-avatar-cropper-zoom input {
        width: 100%;
      }

      .people-avatar-cropper-info {
        min-height: 14px;
        color: #949ba4;
        font-size: 10px;
        text-align: center;
      }

      .people-avatar-cropper-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 10px;
      }

      .people-avatar-cropper-actions button {
        min-height: 36px;
        border: 0;
        border-radius: 8px;
        color: white;
        cursor: pointer;
        font-weight: 800;
      }

      .people-avatar-cropper-cancel {
        background: #4e5058;
      }

      .people-avatar-cropper-save {
        background: #5865f2;
      }

      .people-avatar-cropper-actions button:disabled {
        opacity: 0.55;
        cursor: default;
      }
    `;

    document.head.appendChild(style);
  }

  function ensureUi() {
    if (overlay) return;

    injectStyle();

    overlay =
      document.createElement("div");

    overlay.className =
      "people-avatar-cropper-overlay hidden";

    overlay.innerHTML = `
      <section
        class="people-avatar-cropper-card"
        role="dialog"
        aria-modal="true"
        aria-label="Recadrer la photo de profil"
      >
        <h3 class="people-avatar-cropper-title">
          Recadrer la photo
        </h3>

        <p class="people-avatar-cropper-subtitle">
          Glisse l’image pour la déplacer, puis ajuste le zoom.
        </p>

        <div class="people-avatar-cropper-stage">
          <canvas
            class="people-avatar-cropper-canvas"
            width="${PREVIEW_SIZE}"
            height="${PREVIEW_SIZE}"
          ></canvas>
        </div>

        <div class="people-avatar-cropper-controls">
          <label class="people-avatar-cropper-zoom">
            <span>−</span>
            <input
              type="range"
              min="1"
              max="3"
              step="0.01"
              value="1"
              aria-label="Zoom"
            />
            <span>+</span>
          </label>

          <div class="people-avatar-cropper-info"></div>
        </div>

        <div class="people-avatar-cropper-actions">
          <button
            type="button"
            class="people-avatar-cropper-cancel"
          >
            Annuler
          </button>

          <button
            type="button"
            class="people-avatar-cropper-save"
          >
            Enregistrer
          </button>
        </div>
      </section>
    `;

    document.body.appendChild(
      overlay
    );

    canvas =
      overlay.querySelector(
        ".people-avatar-cropper-canvas"
      );

    ctx =
      canvas.getContext("2d");

    zoomInput =
      overlay.querySelector(
        'input[type="range"]'
      );

    info =
      overlay.querySelector(
        ".people-avatar-cropper-info"
      );

    confirmButton =
      overlay.querySelector(
        ".people-avatar-cropper-save"
      );

    cancelButton =
      overlay.querySelector(
        ".people-avatar-cropper-cancel"
      );

    const stage =
      overlay.querySelector(
        ".people-avatar-cropper-stage"
      );

    zoomInput.addEventListener(
      "input",
      () => {
        zoom =
          Number(
            zoomInput.value
          ) || 1;

        clampOffset();
        schedulePreview();
      }
    );

    stage.addEventListener(
      "pointerdown",
      (event) => {
        dragging = true;

        stage.setPointerCapture(
          event.pointerId
        );

        dragStartX =
          event.clientX;

        dragStartY =
          event.clientY;

        dragOffsetX =
          offsetX;

        dragOffsetY =
          offsetY;
      }
    );

    stage.addEventListener(
      "pointermove",
      (event) => {
        if (!dragging) return;

        offsetX =
          dragOffsetX +
          (
            event.clientX -
            dragStartX
          );

        offsetY =
          dragOffsetY +
          (
            event.clientY -
            dragStartY
          );

        clampOffset();
        schedulePreview();
      }
    );

    const stopDrag = () => {
      dragging = false;
    };

    stage.addEventListener(
      "pointerup",
      stopDrag
    );

    stage.addEventListener(
      "pointercancel",
      stopDrag
    );

    cancelButton.addEventListener(
      "click",
      () => finish(null)
    );

    overlay.addEventListener(
      "click",
      (event) => {
        if (event.target === overlay) {
          finish(null);
        }
      }
    );

    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Escape" &&
          !overlay.classList.contains(
            "hidden"
          )
        ) {
          finish(null);
        }
      }
    );

    confirmButton.addEventListener(
      "click",
      async () => {
        confirmButton.disabled = true;
        cancelButton.disabled = true;

        info.textContent =
          "Préparation...";

        try {
          const blob =
            await createCroppedAvatar();

          if (!blob) {
            throw new Error(
              "Impossible de préparer cette image."
            );
          }

          const sizeKb =
            Math.max(
              1,
              Math.round(
                blob.size / 1024
              )
            );

          info.textContent =
            sizeKb +
            " Ko • 512×512";

          finish(blob);
        } catch (err) {
          info.textContent =
            err?.message ||
            "Erreur de préparation.";

          confirmButton.disabled = false;
          cancelButton.disabled = false;
        }
      }
    );
  }

  function baseScaleFor(size) {
    return Math.max(
      size / imageWidth,
      size / imageHeight
    );
  }

  function drawnSize(size) {
    const scale =
      baseScaleFor(size) *
      zoom;

    return {
      width:
        imageWidth * scale,
      height:
        imageHeight * scale
    };
  }

  function clampOffset() {
    if (!image) return;

    const drawn =
      drawnSize(
        PREVIEW_SIZE
      );

    const maxX =
      Math.max(
        0,
        (
          drawn.width -
          PREVIEW_SIZE
        ) / 2
      );

    const maxY =
      Math.max(
        0,
        (
          drawn.height -
          PREVIEW_SIZE
        ) / 2
      );

    offsetX =
      Math.max(
        -maxX,
        Math.min(
          maxX,
          offsetX
        )
      );

    offsetY =
      Math.max(
        -maxY,
        Math.min(
          maxY,
          offsetY
        )
      );
  }

  function drawImageTo(
    targetCtx,
    size
  ) {
    const scale =
      baseScaleFor(size) *
      zoom;

    const width =
      imageWidth * scale;

    const height =
      imageHeight * scale;

    const offsetScale =
      size / PREVIEW_SIZE;

    const x =
      (
        size -
        width
      ) / 2 +
      offsetX *
      offsetScale;

    const y =
      (
        size -
        height
      ) / 2 +
      offsetY *
      offsetScale;

    targetCtx.clearRect(
      0,
      0,
      size,
      size
    );

    targetCtx.drawImage(
      image,
      x,
      y,
      width,
      height
    );
  }

  function drawPreview() {
    if (!image || !ctx) return;

    drawImageTo(
      ctx,
      PREVIEW_SIZE
    );
  }

  function schedulePreview() {
    if (previewFrame) {
      return;
    }

    previewFrame =
      requestAnimationFrame(
        () => {
          previewFrame = 0;
          drawPreview();
        }
      );
  }

  function canvasToBlob(
    targetCanvas,
    type,
    quality
  ) {
    return new Promise(
      (resolve) => {
        targetCanvas.toBlob(
          resolve,
          type,
          quality
        );
      }
    );
  }

  async function encodeCroppedCanvas(
    targetCanvas
  ) {
    /*
      Le fichier passe ensuite dans PeopleAvatarUltra.prepare(),
      qui effectue la vraie compression finale (~14 Ko).
      Faire ici 5 essais WebP puis recompresser juste après
      était du travail CPU en double.
    */
    const webp =
      await canvasToBlob(
        targetCanvas,
        "image/webp",
        0.90
      );

    if (webp) {
      return webp;
    }

    const jpegCanvas =
      document.createElement(
        "canvas"
      );

    jpegCanvas.width =
      OUTPUT_SIZE;
    jpegCanvas.height =
      OUTPUT_SIZE;

    const jpegCtx =
      jpegCanvas.getContext(
        "2d",
        {
          alpha: false
        }
      );

    if (!jpegCtx) {
      throw new Error(
        "Canvas indisponible."
      );
    }

    jpegCtx.fillStyle =
      "#1e1f22";

    jpegCtx.fillRect(
      0,
      0,
      OUTPUT_SIZE,
      OUTPUT_SIZE
    );

    jpegCtx.drawImage(
      targetCanvas,
      0,
      0
    );

    return canvasToBlob(
      jpegCanvas,
      "image/jpeg",
      0.90
    );
  }

  async function createCroppedAvatar() {
    const output =
      document.createElement(
        "canvas"
      );

    output.width =
      OUTPUT_SIZE;

    output.height =
      OUTPUT_SIZE;

    const outputCtx =
      output.getContext("2d");

    drawImageTo(
      outputCtx,
      OUTPUT_SIZE
    );

    return encodeCroppedCanvas(
      output
    );
  }

  function loadImage(file) {
    return new Promise(
      (resolve, reject) => {
        const url =
          URL.createObjectURL(file);

        const img =
          new Image();

        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img);
        };

        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(
            new Error(
              "Impossible de lire cette image."
            )
          );
        };

        img.src = url;
      }
    );
  }

  function finish(value) {
    overlay?.classList.add(
      "hidden"
    );

    if (previewFrame) {
      cancelAnimationFrame(
        previewFrame
      );
      previewFrame = 0;
    }

    image = null;
    dragging = false;

    confirmButton.disabled = false;
    cancelButton.disabled = false;

    const resolve =
      currentResolve;

    currentResolve = null;

    if (resolve) {
      resolve(value);
    }
  }

  async function open(file) {
    if (!file) return null;

    if (
      !String(file.type)
        .startsWith("image/")
    ) {
      throw new Error(
        "Ce fichier n’est pas une image."
      );
    }

    if (
      file.size >
      MAX_SOURCE_BYTES
    ) {
      throw new Error(
        "L’image source est trop lourde (25 Mo maximum)."
      );
    }

    ensureUi();

    if (currentResolve) {
      finish(null);
    }

    image =
      await loadImage(file);

    imageWidth =
      Number(
        image.naturalWidth ||
        image.width
      );

    imageHeight =
      Number(
        image.naturalHeight ||
        image.height
      );

    if (
      !imageWidth ||
      !imageHeight
    ) {
      throw new Error(
        "Dimensions de l’image invalides."
      );
    }

    zoom = 1;
    offsetX = 0;
    offsetY = 0;

    zoomInput.value =
      "1";

    info.textContent =
      imageWidth +
      "×" +
      imageHeight +
      " • sera compressée avant l’envoi";

    overlay.classList.remove(
      "hidden"
    );

    clampOffset();
    drawPreview();

    return new Promise(
      (resolve) => {
        currentResolve = resolve;
      }
    );
  }

  window.PeopleAvatarCropper = {
    open
  };
})();
