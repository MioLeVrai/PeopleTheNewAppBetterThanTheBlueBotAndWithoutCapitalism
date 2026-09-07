"use strict";

const closeButton =
  document.getElementById(
    "closeButton"
  );

const laterButton =
  document.getElementById(
    "laterButton"
  );

const updateButton =
  document.getElementById(
    "updateButton"
  );

const message =
  document.getElementById(
    "message"
  );

const versions =
  document.getElementById(
    "versions"
  );

const progressWrap =
  document.getElementById(
    "progressWrap"
  );

const progressText =
  document.getElementById(
    "progressText"
  );

const progressPercent =
  document.getElementById(
    "progressPercent"
  );

const progressBar =
  document.getElementById(
    "progressBar"
  );

const errorBox =
  document.getElementById(
    "error"
  );

let busy = false;

function setBusy(value) {
  busy =
    Boolean(value);

  closeButton.disabled =
    busy;

  laterButton.disabled =
    busy;

  updateButton.disabled =
    busy;
}

function closePopup() {
  if (busy) {
    return;
  }

  window.peopleUpdate.close();
}

closeButton.addEventListener(
  "click",
  closePopup
);

laterButton.addEventListener(
  "click",
  closePopup
);

window.peopleUpdate
  .getState()
  .then((state) => {
    message.textContent =
      state.message ||
      "Une nouvelle version de People est disponible.";

    versions.textContent =
      `Version installée : ${state.currentVersion}  •  Version serveur : ${state.serverVersion}`;
  });

window.peopleUpdate.onProgress(
  (payload) => {
    progressWrap.style.display =
      "block";

    errorBox.style.display =
      "none";

    if (
      payload.phase ===
      "starting"
    ) {
      progressText.textContent =
        "Préparation du téléchargement…";

      progressPercent.textContent =
        "";

      progressBar.style.width =
        "3%";
    }

    if (
      payload.phase ===
      "download"
    ) {
      progressText.textContent =
        "Téléchargement de la mise à jour…";

      if (
        Number.isFinite(
          payload.percent
        )
      ) {
        progressPercent.textContent =
          `${payload.percent}%`;

        progressBar.style.width =
          `${Math.max(4, payload.percent)}%`;
      } else {
        progressPercent.textContent =
          "";

        progressBar.style.width =
          "35%";
      }
    }

    if (
      payload.phase ===
      "ready"
    ) {
      progressText.textContent =
        "Téléchargement terminé";

      progressPercent.textContent =
        "100%";

      progressBar.style.width =
        "100%";
    }

    if (
      payload.phase ===
      "launching"
    ) {
      progressText.textContent =
        "Ouverture de l'installateur…";

      progressPercent.textContent =
        "100%";
    }

    if (
      payload.phase ===
      "error"
    ) {
      setBusy(false);

      updateButton.textContent =
        "Réessayer";

      errorBox.textContent =
        payload.error ||
        "La mise à jour a échoué.";

      errorBox.style.display =
        "block";
    }
  }
);

updateButton.addEventListener(
  "click",
  async () => {
    if (busy) {
      return;
    }

    setBusy(true);

    errorBox.style.display =
      "none";

    updateButton.textContent =
      "Téléchargement…";

    const result =
      await window.peopleUpdate.install();

    if (!result?.ok) {
      setBusy(false);

      updateButton.textContent =
        "Réessayer";

      errorBox.textContent =
        result?.error ||
        "La mise à jour a échoué.";

      errorBox.style.display =
        "block";
    }
  }
);
