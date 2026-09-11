(() => {
  "use strict";

  const LINK_SELECTOR = ".people-message-image-link";
  const IMAGE_SELECTOR = ".people-message-image";
  const ZOOM_SCALE = 2.25;

  let overlay = null;
  let viewport = null;
  let image = null;
  let closeButton = null;
  let hint = null;
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let dragging = false;
  let dragPointerId = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginX = 0;
  let dragOriginY = 0;
  let previousFocus = null;
  let hintTimer = null;

  function buildViewer() {
    if (overlay) return;

    overlay = document.createElement("div");
    overlay.className = "people-image-viewer hidden";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Image en plein écran");

    viewport = document.createElement("div");
    viewport.className = "people-image-viewer-viewport";

    image = document.createElement("img");
    image.className = "people-image-viewer-image";
    image.alt = "Image agrandie";
    image.draggable = false;

    closeButton = document.createElement("button");
    closeButton.className = "people-image-viewer-close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Fermer l’image");
    closeButton.title = "Fermer";
    closeButton.textContent = "×";

    hint = document.createElement("div");
    hint.className = "people-image-viewer-hint";
    hint.textContent = "Clic droit : zoom · Maintiens et glisse : déplacer · Échap : fermer";

    viewport.appendChild(image);
    overlay.append(viewport, closeButton, hint);
    document.body.appendChild(overlay);

    closeButton.addEventListener("click", closeViewer);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target === viewport) {
        closeViewer();
      }
    });

    image.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleZoomAt(event.clientX, event.clientY);
    });

    image.addEventListener("dragstart", (event) => event.preventDefault());
    image.addEventListener("pointerdown", beginPan);
    image.addEventListener("pointermove", movePan);
    image.addEventListener("pointerup", endPan);
    image.addEventListener("pointercancel", endPan);

    window.addEventListener("resize", () => {
      if (!overlay.classList.contains("hidden")) {
        clampPan();
        renderTransform();
      }
    });
  }

  function openViewer(src, alt = "Image agrandie") {
    if (!src) return;
    buildViewer();

    previousFocus = document.activeElement;
    resetTransform();
    image.src = src;
    image.alt = alt || "Image agrandie";
    overlay.classList.remove("hidden");
    document.body.classList.add("people-image-viewer-open");
    closeButton.focus({ preventScroll: true });
    showHint();
  }

  function closeViewer() {
    if (!overlay || overlay.classList.contains("hidden")) return;

    endPan();
    overlay.classList.add("hidden");
    document.body.classList.remove("people-image-viewer-open");
    image.removeAttribute("src");
    resetTransform();
    hideHint();

    if (previousFocus && typeof previousFocus.focus === "function") {
      try { previousFocus.focus({ preventScroll: true }); } catch {}
    }
    previousFocus = null;
  }

  function resetTransform() {
    scale = 1;
    panX = 0;
    panY = 0;
    dragging = false;
    dragPointerId = null;
    if (image) {
      image.classList.remove("is-zoomed", "is-dragging");
      renderTransform();
    }
  }

  function renderTransform() {
    if (!image) return;
    image.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`;
    image.classList.toggle("is-zoomed", scale > 1.001);
  }

  function toggleZoomAt(clientX, clientY) {
    if (scale > 1.001) {
      resetTransform();
      return;
    }

    const rect = image.getBoundingClientRect();
    const localX = clientX - (rect.left + rect.width / 2);
    const localY = clientY - (rect.top + rect.height / 2);

    scale = ZOOM_SCALE;
    // Garde autant que possible la zone située sous le pointeur au même endroit.
    panX = -localX * (scale - 1);
    panY = -localY * (scale - 1);
    clampPan();
    renderTransform();
    showHint();
  }

  function beginPan(event) {
    if (scale <= 1.001 || event.button !== 0) return;
    event.preventDefault();

    dragging = true;
    dragPointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragOriginX = panX;
    dragOriginY = panY;
    image.classList.add("is-dragging");

    try { image.setPointerCapture(event.pointerId); } catch {}
  }

  function movePan(event) {
    if (!dragging || event.pointerId !== dragPointerId) return;
    event.preventDefault();

    panX = dragOriginX + (event.clientX - dragStartX);
    panY = dragOriginY + (event.clientY - dragStartY);
    clampPan();
    renderTransform();
  }

  function endPan(event) {
    if (!dragging) return;
    if (event && dragPointerId !== null && event.pointerId !== dragPointerId) return;

    if (image && dragPointerId !== null) {
      try { image.releasePointerCapture(dragPointerId); } catch {}
    }

    dragging = false;
    dragPointerId = null;
    image?.classList.remove("is-dragging");
  }

  function clampPan() {
    if (!image || scale <= 1.001) {
      panX = 0;
      panY = 0;
      return;
    }

    // offsetWidth/Height correspondent à la taille "fit" avant transform.
    const baseW = image.offsetWidth || 0;
    const baseH = image.offsetHeight || 0;
    const maxX = Math.max(0, (baseW * scale - viewport.clientWidth) / 2 + 24);
    const maxY = Math.max(0, (baseH * scale - viewport.clientHeight) / 2 + 24);

    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }

  function showHint() {
    if (!hint) return;
    hint.classList.add("show");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint?.classList.remove("show"), 2600);
  }

  function hideHint() {
    clearTimeout(hintTimer);
    hint?.classList.remove("show");
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.(LINK_SELECTOR);
    if (!link) return;

    const clickedImage = event.target.closest?.(IMAGE_SELECTOR) || link.querySelector(IMAGE_SELECTOR);
    event.preventDefault();
    event.stopPropagation();

    openViewer(link.href || clickedImage?.src, clickedImage?.alt);
  }, true);

  // Empêche le menu contextuel du navigateur sur une miniature ; le clic droit
  // ouvre directement l'image zoomée pour rester cohérent avec la visionneuse.
  document.addEventListener("contextmenu", (event) => {
    const link = event.target.closest?.(LINK_SELECTOR);
    if (!link || overlay?.contains(event.target)) return;

    const clickedImage = event.target.closest?.(IMAGE_SELECTOR) || link.querySelector(IMAGE_SELECTOR);
    event.preventDefault();
    event.stopPropagation();
    openViewer(link.href || clickedImage?.src, clickedImage?.alt);

    requestAnimationFrame(() => {
      if (image && !overlay.classList.contains("hidden")) {
        toggleZoomAt(window.innerWidth / 2, window.innerHeight / 2);
      }
    });
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay && !overlay.classList.contains("hidden")) {
      event.preventDefault();
      closeViewer();
    }
  }, true);

  window.PeopleImageViewer = Object.freeze({
    open: openViewer,
    close: closeViewer
  });
})();
