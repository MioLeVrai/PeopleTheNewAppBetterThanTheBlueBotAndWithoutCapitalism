/* ===== People Camera Face Effects V1.1 ===== */
(() => {
  "use strict";

  const STORAGE_KEY = "people.camera.faceEffect.v1";
  const MEDIAPIPE_VERSION = "0.10.35";
  const MODULE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
  const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
  const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

  // Dessins du filtre Chat fournis pour People. Chaque élément reste séparé
  // afin de suivre correctement la rotation et la taille du visage.
  const CAT_ASSET_URLS = Object.freeze({
    leftEar: "assets/people-facefx/cat/ear-left.png?v=people-cat-fix-v4-20260911a",
    rightEar: "assets/people-facefx/cat/ear-right.png?v=people-cat-fix-v4-20260911a",
    leftWhiskers: "assets/people-facefx/cat/whiskers-left.png?v=people-cat-fix-v4-20260911a",
    rightWhiskers: "assets/people-facefx/cat/whiskers-right.png?v=people-cat-fix-v4-20260911a",
    nose: "assets/people-facefx/cat/nose.png?v=people-cat-fix-v4-20260911a"
  });

  const EFFECTS = Object.freeze([
    { id: "none", label: "Aucun", icon: "✕", cover: "none" },
    { id: "glasses", label: "Lunettes", icon: "😎", cover: "light" },
    { id: "pixel-glasses", label: "Pixel", icon: "🕶️", cover: "light" },
    { id: "crown", label: "Couronne", icon: "👑", cover: "light" },
    { id: "cat", label: "Chat", icon: "🐱", cover: "light" },
    { id: "censor", label: "Censure", icon: "▬", cover: "medium" },
    { id: "pixel-face", label: "Mosaïque", icon: "▓", cover: "strong" },
    { id: "emoji", label: "Emoji", icon: "🙂", cover: "strong" },
    { id: "robot", label: "Robot", icon: "🤖", cover: "strong" },
    { id: "full-mask", label: "Masque", icon: "🎭", cover: "strong" }
  ]);

  const validIds = new Set(EFFECTS.map((effect) => effect.id));

  function readStoredEffect() {
    try {
      const value = localStorage.getItem(STORAGE_KEY) || "none";
      return validIds.has(value) ? value : "none";
    } catch {
      return "none";
    }
  }

  let selectedEffect = readStoredEffect();
  let sourceTrack = null;
  let outputTrack = null;
  let sourceVideo = null;
  let canvas = null;
  let context = null;
  let captureStream = null;
  let renderFrame = 0;
  let renderToken = 0;
  let detector = null;
  let detectorPromise = null;
  let detectorError = "";
  let detections = [];
  let lastDetectionAt = 0;
  let lastVideoTime = -1;
  let picker = null;
  let pickerStatus = null;
  let activeAnchor = null;
  let scratchCanvas = null;
  let scratchContext = null;
  const catAssets = Object.create(null);
  let catAssetsState = "idle";
  let catAssetsPromise = null;

  function effectInfo(id = selectedEffect) {
    return EFFECTS.find((effect) => effect.id === id) || EFFECTS[0];
  }

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function emitEffectChanged() {
    emit("people-camera-effect-changed", {
      effectId: selectedEffect,
      effect: effectInfo(),
      active: selectedEffect !== "none"
    });
  }

  function emitTrackChanged(track) {
    emit("people-camera-effect-track-changed", {
      track: track || null,
      sourceTrack,
      effectId: selectedEffect,
      active: selectedEffect !== "none"
    });
  }

  async function ensureDetector() {
    if (detector) return detector;
    if (detectorPromise) return detectorPromise;

    detectorError = "";
    updatePickerStatus("Chargement du suivi du visage…", "loading");

    detectorPromise = (async () => {
      try {
        const vision = await import(MODULE_URL);
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
        detector = await vision.FaceDetector.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.5,
          minSuppressionThreshold: 0.3
        });
        detectorError = "";
        updatePickerStatus("Suivi visage actif", "ready");
        return detector;
      } catch (firstError) {
        try {
          const vision = await import(MODULE_URL);
          const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
          detector = await vision.FaceDetector.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: MODEL_URL,
              delegate: "CPU"
            },
            runningMode: "VIDEO",
            minDetectionConfidence: 0.5,
            minSuppressionThreshold: 0.3
          });
          detectorError = "";
          updatePickerStatus("Suivi visage actif", "ready");
          return detector;
        } catch (error) {
          detectorError = "Impossible de charger le suivi du visage";
          updatePickerStatus(detectorError, "error");
          console.warn("[People effets caméra] MediaPipe indisponible", error || firstError);
          emit("people-camera-effect-error", {
            message: detectorError,
            error: error || firstError
          });
          throw error || firstError;
        }
      }
    })().finally(() => {
      detectorPromise = null;
    });

    return detectorPromise;
  }

  function stopRenderLoop() {
    renderToken += 1;
    if (renderFrame) {
      cancelAnimationFrame(renderFrame);
      renderFrame = 0;
    }
  }

  function stopProcessedOutput() {
    stopRenderLoop();

    if (captureStream) {
      for (const track of captureStream.getTracks()) {
        if (track !== sourceTrack) {
          try { track.stop(); } catch {}
        }
      }
    }

    captureStream = null;
    outputTrack = null;
    detections = [];
    lastDetectionAt = 0;
    lastVideoTime = -1;

    if (sourceVideo) {
      try {
        sourceVideo.pause();
        sourceVideo.srcObject = null;
      } catch {}
    }

    sourceVideo = null;
    canvas = null;
    context = null;
  }

  function currentDimensions() {
    const settings = sourceTrack?.getSettings?.() || {};
    const width = Math.max(320, Number(sourceVideo?.videoWidth || settings.width || 1280));
    const height = Math.max(240, Number(sourceVideo?.videoHeight || settings.height || 720));
    return { width, height };
  }

  function ensureCanvasDimensions() {
    if (!canvas) return;
    const { width, height } = currentDimensions();
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function normalizeDetection(detection) {
    const box = detection?.boundingBox;
    if (!box || !canvas) return null;

    const x = Number(box.originX ?? box.x ?? 0);
    const y = Number(box.originY ?? box.y ?? 0);
    const width = Number(box.width ?? 0);
    const height = Number(box.height ?? 0);

    if (!(width > 1 && height > 1)) return null;

    const keypoints = Array.isArray(detection?.keypoints)
      ? detection.keypoints
      : [];

    function point(index, fallbackX, fallbackY) {
      const item = keypoints[index];
      const px = Number(item?.x);
      const py = Number(item?.y);
      if (Number.isFinite(px) && Number.isFinite(py)) {
        return {
          x: px <= 1.2 ? px * canvas.width : px,
          y: py <= 1.2 ? py * canvas.height : py
        };
      }
      return { x: fallbackX, y: fallbackY };
    }

    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const leftEye = point(0, x + width * 0.34, y + height * 0.42);
    const rightEye = point(1, x + width * 0.66, y + height * 0.42);
    const nose = point(2, centerX, y + height * 0.57);
    const mouth = point(3, centerX, y + height * 0.73);
    const angle = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

    return {
      x,
      y,
      width,
      height,
      centerX,
      centerY,
      leftEye,
      rightEye,
      nose,
      mouth,
      angle
    };
  }

  function withFaceTransform(face, callback) {
    context.save();
    context.translate(face.centerX, face.centerY);
    context.rotate(face.angle);
    callback();
    context.restore();
  }

  function roundRectPath(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawGlasses(face) {
    withFaceTransform(face, () => {
      const w = face.width;
      const h = face.height;
      const lensW = w * 0.33;
      const lensH = h * 0.20;
      const y = -h * 0.13;
      const leftX = -w * 0.38;
      const rightX = w * 0.05;

      context.lineWidth = Math.max(4, w * 0.025);
      context.strokeStyle = "#101216";
      context.fillStyle = "rgba(18, 24, 32, 0.82)";

      for (const x of [leftX, rightX]) {
        roundRectPath(context, x, y, lensW, lensH, lensH * 0.38);
        context.fill();
        context.stroke();
      }

      context.beginPath();
      context.moveTo(leftX + lensW, y + lensH * 0.45);
      context.lineTo(rightX, y + lensH * 0.45);
      context.stroke();

      context.beginPath();
      context.moveTo(leftX, y + lensH * 0.38);
      context.lineTo(-w * 0.53, y + lensH * 0.22);
      context.moveTo(rightX + lensW, y + lensH * 0.38);
      context.lineTo(w * 0.53, y + lensH * 0.22);
      context.stroke();
    });
  }

  function drawPixelGlasses(face) {
    withFaceTransform(face, () => {
      const w = face.width;
      const h = face.height;
      const unit = Math.max(5, Math.round(w / 34));
      const x0 = -w * 0.47;
      const y0 = -h * 0.13;
      const cols = Math.max(14, Math.round((w * 0.94) / unit));
      const rows = Math.max(5, Math.round((h * 0.22) / unit));

      context.imageSmoothingEnabled = false;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const bridge = col > cols * 0.43 && col < cols * 0.57 && row > 1;
          if (bridge) continue;
          const edge = row === 0 || row === rows - 1 || col === 0 || col === cols - 1;
          context.fillStyle = edge || (row + col) % 3 === 0 ? "#050608" : "rgba(24, 27, 34, .92)";
          context.fillRect(x0 + col * unit, y0 + row * unit, unit + 1, unit + 1);
        }
      }
      context.imageSmoothingEnabled = true;
    });
  }

  function drawCrown(face) {
    withFaceTransform(face, () => {
      const w = face.width;
      const h = face.height;
      const y = -h * 0.72;
      const baseY = -h * 0.42;
      context.lineJoin = "round";
      context.lineWidth = Math.max(3, w * 0.016);
      context.strokeStyle = "#7d4e00";
      context.fillStyle = "#ffd642";
      context.beginPath();
      context.moveTo(-w * 0.42, baseY);
      context.lineTo(-w * 0.38, y + h * 0.15);
      context.lineTo(-w * 0.20, y + h * 0.28);
      context.lineTo(0, y);
      context.lineTo(w * 0.20, y + h * 0.28);
      context.lineTo(w * 0.38, y + h * 0.15);
      context.lineTo(w * 0.42, baseY);
      context.closePath();
      context.fill();
      context.stroke();
      context.fillStyle = "#fff3a6";
      for (const x of [-0.25, 0, 0.25]) {
        context.beginPath();
        context.arc(w * x, baseY - h * 0.03, Math.max(3, w * 0.025), 0, Math.PI * 2);
        context.fill();
      }
    });
  }

  function loadCatAsset(key, url) {
    return new Promise((resolve) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        catAssets[key] = image;
        resolve(true);
      };
      image.onerror = () => {
        console.warn(`[People effets caméra] asset Chat introuvable: ${url}`);
        resolve(false);
      };
      image.src = url;
    });
  }

  function ensureCatAssets() {
    if (catAssetsState === "ready") return Promise.resolve(true);
    if (catAssetsState === "error") return Promise.resolve(false);
    if (catAssetsPromise) return catAssetsPromise;

    catAssetsState = "loading";
    catAssetsPromise = Promise.all(
      Object.entries(CAT_ASSET_URLS).map(([key, url]) => loadCatAsset(key, url))
    ).then((results) => {
      const ok = results.every(Boolean);
      catAssetsState = ok ? "ready" : "error";
      return ok;
    }).finally(() => {
      catAssetsPromise = null;
    });

    return catAssetsPromise;
  }

  function drawCatFallback(face) {
    withFaceTransform(face, () => {
      const w = face.width;
      const h = face.height;
      const top = -h * 0.52;
      context.fillStyle = "#ff9eb9";
      context.strokeStyle = "#3b2430";
      context.lineWidth = Math.max(3, w * 0.015);

      for (const side of [-1, 1]) {
        context.beginPath();
        context.moveTo(side * w * 0.16, top + h * 0.10);
        context.lineTo(side * w * 0.42, top - h * 0.18);
        context.lineTo(side * w * 0.46, top + h * 0.22);
        context.closePath();
        context.fill();
        context.stroke();
      }

      context.fillStyle = "#ff6f9a";
      context.beginPath();
      context.moveTo(-w * 0.055, h * 0.08);
      context.lineTo(w * 0.055, h * 0.08);
      context.lineTo(0, h * 0.15);
      context.closePath();
      context.fill();

      context.strokeStyle = "rgba(255,255,255,.88)";
      context.lineWidth = Math.max(2, w * 0.01);
      for (const dy of [-0.01, 0.06]) {
        context.beginPath();
        context.moveTo(-w * 0.08, h * (0.18 + dy));
        context.lineTo(-w * 0.48, h * (0.12 + dy));
        context.moveTo(w * 0.08, h * (0.18 + dy));
        context.lineTo(w * 0.48, h * (0.12 + dy));
        context.stroke();
      }
    });
  }

  function drawCat(face) {
    if (catAssetsState !== "ready") {
      if (catAssetsState === "idle") void ensureCatAssets();
      return;
    }

    withFaceTransform(face, () => {
      const w = face.width;
      const h = face.height;

      // Les proportions sont volontairement liées à la boîte du visage :
      // le dessin grandit/rétrécit avec la personne et suit l'inclinaison de la tête.
      // V4 : on respecte davantage les proportions du dessin complet :
      // oreilles plus présentes, et moustaches nettement séparées du nez.
      const earW = w * 0.52;
      const earH = w * 0.47;
      const earY = -h * 0.76;
      context.drawImage(catAssets.leftEar, -w * 0.56, earY, earW, earH);
      context.drawImage(catAssets.rightEar, w * 0.56 - earW, earY, earW, earH);

      const whiskersW = w * 0.41;
      const whiskersH = h * 0.25;
      const whiskersY = h * 0.03;
      const whiskersInnerGap = w * 0.17;
      context.drawImage(catAssets.leftWhiskers, -whiskersInnerGap - whiskersW, whiskersY, whiskersW, whiskersH);
      context.drawImage(catAssets.rightWhiskers, whiskersInnerGap, whiskersY, whiskersW, whiskersH);

      // Le nez retrouve sa taille V2 : le problème venait surtout de l'écartement.
      const noseW = w * 0.12;
      const noseH = h * 0.105;
      const noseY = h * 0.085;
      context.drawImage(catAssets.nose, -noseW / 2, noseY, noseW, noseH);
    });
  }

  function drawCensor(face) {
    withFaceTransform(face, () => {
      const w = face.width;
      const h = face.height;
      const barH = h * 0.24;
      roundRectPath(context, -w * 0.54, -h * 0.16, w * 1.08, barH, barH * 0.16);
      context.fillStyle = "rgba(3, 4, 7, .98)";
      context.fill();
      context.lineWidth = Math.max(2, w * 0.01);
      context.strokeStyle = "rgba(255,255,255,.12)";
      context.stroke();
    });
  }

  function drawPixelFace(face) {
    if (!sourceVideo || !canvas) return;

    const marginX = face.width * 0.16;
    const marginY = face.height * 0.14;
    const sx = Math.max(0, face.x - marginX);
    const sy = Math.max(0, face.y - marginY);
    const sw = Math.min(canvas.width - sx, face.width + marginX * 2);
    const sh = Math.min(canvas.height - sy, face.height + marginY * 2);
    if (!(sw > 2 && sh > 2)) return;

    if (!scratchCanvas) {
      scratchCanvas = document.createElement("canvas");
      scratchContext = scratchCanvas.getContext("2d", { alpha: false });
    }

    const blocks = Math.max(10, Math.min(24, Math.round(face.width / 25)));
    scratchCanvas.width = blocks;
    scratchCanvas.height = Math.max(8, Math.round(blocks * sh / sw));
    scratchContext.imageSmoothingEnabled = true;
    scratchContext.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
    scratchContext.drawImage(sourceVideo, sx, sy, sw, sh, 0, 0, scratchCanvas.width, scratchCanvas.height);

    context.save();
    context.imageSmoothingEnabled = false;
    context.drawImage(scratchCanvas, 0, 0, scratchCanvas.width, scratchCanvas.height, sx, sy, sw, sh);
    context.imageSmoothingEnabled = true;
    context.restore();
  }

  function drawEmoji(face) {
    withFaceTransform(face, () => {
      const w = face.width;
      const h = face.height;
      const radius = Math.max(w, h) * 0.60;
      context.fillStyle = "#ffd83d";
      context.strokeStyle = "#9f7c00";
      context.lineWidth = Math.max(3, w * 0.018);
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();

      context.fillStyle = "#242424";
      for (const x of [-0.20, 0.20]) {
        context.beginPath();
        context.arc(w * x, -h * 0.12, Math.max(5, w * 0.045), 0, Math.PI * 2);
        context.fill();
      }
      context.strokeStyle = "#242424";
      context.lineWidth = Math.max(5, w * 0.028);
      context.lineCap = "round";
      context.beginPath();
      context.arc(0, h * 0.05, w * 0.23, 0.12 * Math.PI, 0.88 * Math.PI);
      context.stroke();
    });
  }

  function drawRobot(face) {
    withFaceTransform(face, () => {
      const w = face.width;
      const h = face.height;
      context.fillStyle = "rgba(31, 38, 50, .98)";
      context.strokeStyle = "#8fa3b8";
      context.lineWidth = Math.max(3, w * 0.018);
      roundRectPath(context, -w * 0.55, -h * 0.56, w * 1.10, h * 1.12, w * 0.18);
      context.fill();
      context.stroke();

      const visorY = -h * 0.18;
      const visorH = h * 0.28;
      roundRectPath(context, -w * 0.43, visorY, w * 0.86, visorH, visorH * 0.22);
      context.fillStyle = "rgba(7, 13, 18, .98)";
      context.fill();
      context.strokeStyle = "#70e5ff";
      context.lineWidth = Math.max(3, w * 0.014);
      context.stroke();

      context.strokeStyle = "#70e5ff";
      context.lineWidth = Math.max(5, w * 0.028);
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(-w * 0.27, -h * 0.04);
      context.lineTo(-w * 0.08, -h * 0.04);
      context.moveTo(w * 0.08, -h * 0.04);
      context.lineTo(w * 0.27, -h * 0.04);
      context.stroke();

      context.fillStyle = "#596b7e";
      roundRectPath(context, -w * 0.22, h * 0.23, w * 0.44, h * 0.14, h * 0.04);
      context.fill();
    });
  }

  function drawFullMask(face) {
    withFaceTransform(face, () => {
      const w = face.width;
      const h = face.height;
      context.fillStyle = "rgba(16, 13, 24, .99)";
      context.strokeStyle = "#8a79ca";
      context.lineWidth = Math.max(4, w * 0.022);
      context.beginPath();
      context.ellipse(0, 0, w * 0.60, h * 0.66, 0, 0, Math.PI * 2);
      context.fill();
      context.stroke();

      context.strokeStyle = "rgba(178, 160, 242, .94)";
      context.lineWidth = Math.max(4, w * 0.02);
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(-w * 0.30, -h * 0.10);
      context.quadraticCurveTo(-w * 0.18, -h * 0.22, -w * 0.06, -h * 0.10);
      context.moveTo(w * 0.06, -h * 0.10);
      context.quadraticCurveTo(w * 0.18, -h * 0.22, w * 0.30, -h * 0.10);
      context.stroke();

      context.strokeStyle = "rgba(255,255,255,.26)";
      context.lineWidth = Math.max(2, w * 0.01);
      context.beginPath();
      context.moveTo(0, -h * 0.45);
      context.lineTo(0, h * 0.42);
      context.stroke();
    });
  }

  function drawEffect(face) {
    switch (selectedEffect) {
      case "glasses": drawGlasses(face); break;
      case "pixel-glasses": drawPixelGlasses(face); break;
      case "crown": drawCrown(face); break;
      case "cat": drawCat(face); break;
      case "censor": drawCensor(face); break;
      case "pixel-face": drawPixelFace(face); break;
      case "emoji": drawEmoji(face); break;
      case "robot": drawRobot(face); break;
      case "full-mask": drawFullMask(face); break;
      default: break;
    }
  }

  function runDetection(now) {
    if (!detector || !sourceVideo || sourceVideo.readyState < 2) return;
    if (now - lastDetectionAt < 82) return;
    if (sourceVideo.currentTime === lastVideoTime) return;

    lastDetectionAt = now;
    lastVideoTime = sourceVideo.currentTime;

    try {
      let result;
      try {
        result = detector.detectForVideo(sourceVideo, now);
      } catch {
        result = detector.detectForVideo(sourceVideo);
      }
      detections = Array.isArray(result?.detections) ? result.detections : [];
    } catch (error) {
      console.warn("[People effets caméra/détection]", error);
    }
  }

  function renderLoop(token) {
    if (token !== renderToken || !sourceVideo || !canvas || !context) return;

    ensureCanvasDimensions();

    if (sourceVideo.readyState >= 2) {
      context.save();
      context.imageSmoothingEnabled = true;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
      context.restore();

      const now = performance.now();
      runDetection(now);

      if (selectedEffect !== "none") {
        for (const detection of detections) {
          const face = normalizeDetection(detection);
          if (face) drawEffect(face);
        }
      }
    }

    renderFrame = requestAnimationFrame(() => renderLoop(token));
  }

  async function startProcessedOutput() {
    if (!sourceTrack || sourceTrack.readyState !== "live") {
      outputTrack = sourceTrack || null;
      return outputTrack;
    }

    stopProcessedOutput();

    sourceVideo = document.createElement("video");
    sourceVideo.muted = true;
    sourceVideo.autoplay = true;
    sourceVideo.playsInline = true;
    sourceVideo.srcObject = new MediaStream([sourceTrack]);

    try {
      await sourceVideo.play();
    } catch {}

    canvas = document.createElement("canvas");
    context = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true
    });
    ensureCanvasDimensions();

    if (!context || typeof canvas.captureStream !== "function") {
      outputTrack = sourceTrack;
      emitTrackChanged(outputTrack);
      throw new Error("Le navigateur ne permet pas les effets caméra.");
    }

    captureStream = canvas.captureStream(24);
    outputTrack = captureStream.getVideoTracks()[0] || sourceTrack;
    if (outputTrack && outputTrack !== sourceTrack) {
      outputTrack.contentHint = "motion";
    }

    const token = ++renderToken;
    renderLoop(token);
    emitTrackChanged(outputTrack);

    void ensureDetector().catch(() => {});
    return outputTrack;
  }

  async function attachSource(track) {
    if (!track || track.kind !== "video") return track || null;

    if (sourceTrack !== track) {
      stopProcessedOutput();
      sourceTrack = track;
    }

    if (selectedEffect === "none") {
      outputTrack = sourceTrack;
      emitTrackChanged(outputTrack);
      return outputTrack;
    }

    return startProcessedOutput();
  }

  function detachSource(track = sourceTrack) {
    if (track && sourceTrack && track !== sourceTrack) return;
    const oldSource = sourceTrack;
    stopProcessedOutput();
    sourceTrack = null;
    outputTrack = null;
    if (oldSource) emitTrackChanged(null);
  }

  async function setEffect(id) {
    const next = validIds.has(String(id || "")) ? String(id) : "none";
    if (next === selectedEffect) {
      return selectedEffect;
    }

    selectedEffect = next;
    try { localStorage.setItem(STORAGE_KEY, selectedEffect); } catch {}
    updatePickerSelection();
    emitEffectChanged();

    if (!sourceTrack || sourceTrack.readyState !== "live") {
      return selectedEffect;
    }

    if (selectedEffect === "none") {
      stopProcessedOutput();
      outputTrack = sourceTrack;
      emitTrackChanged(outputTrack);
      updatePickerStatus("Effets désactivés", "ready");
      return selectedEffect;
    }

    if (!outputTrack || outputTrack === sourceTrack || !sourceVideo) {
      try {
        await startProcessedOutput();
      } catch (error) {
        console.warn("[People effets caméra/activation]", error);
      }
    }

    updatePickerStatus(
      detector ? "Suivi visage actif" : "Chargement du suivi du visage…",
      detector ? "ready" : "loading"
    );
    return selectedEffect;
  }

  function updatePickerSelection() {
    if (!picker) return;
    for (const button of picker.querySelectorAll("[data-people-face-effect]")) {
      const active = button.dataset.peopleFaceEffect === selectedEffect;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function updatePickerStatus(text, state = "") {
    if (!pickerStatus) return;
    pickerStatus.textContent = text || "";
    pickerStatus.dataset.state = state;
  }

  function ensurePicker() {
    if (picker) return picker;

    picker = document.createElement("section");
    picker.id = "peopleCameraEffectsPicker";
    picker.className = "people-camera-effects-picker hidden";
    picker.setAttribute("role", "dialog");
    picker.setAttribute("aria-label", "Effets de visage");

    picker.innerHTML = `
      <div class="people-camera-effects-head">
        <div>
          <strong>Effets visage</strong>
          <span>Appliqués à ta caméra en appel</span>
        </div>
        <button class="people-camera-effects-close" type="button" aria-label="Fermer">✕</button>
      </div>
      <div class="people-camera-effects-grid">
        ${EFFECTS.map((effect) => `
          <button
            class="people-camera-effect-card"
            type="button"
            data-people-face-effect="${effect.id}"
            aria-pressed="false"
            title="${effect.label}"
          >
            <span class="people-camera-effect-icon">${effect.icon}</span>
            <small>${effect.label}</small>
          </button>
        `).join("")}
      </div>
      <div class="people-camera-effects-foot">
        <span class="people-camera-effects-dot"></span>
        <span class="people-camera-effects-status"></span>
      </div>
    `;

    document.body.appendChild(picker);
    pickerStatus = picker.querySelector(".people-camera-effects-status");

    picker.querySelector(".people-camera-effects-close")?.addEventListener("click", closePicker);
    picker.querySelector(".people-camera-effects-grid")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-people-face-effect]");
      if (!button) return;
      void setEffect(button.dataset.peopleFaceEffect);
    });

    updatePickerSelection();
    updatePickerStatus(
      selectedEffect === "none"
        ? "Choisis un effet — la caméra brute reste disponible"
        : (detector ? "Suivi visage actif" : "L'effet sera chargé avec la caméra"),
      detector ? "ready" : "idle"
    );

    return picker;
  }

  function placePicker(anchor) {
    if (!picker) return;

    const mobile = window.matchMedia("(max-width: 720px)").matches;
    picker.classList.toggle("mobile", mobile);
    picker.style.left = "";
    picker.style.right = "";
    picker.style.top = "";
    picker.style.bottom = "";

    if (mobile || !anchor?.getBoundingClientRect) return;

    const rect = anchor.getBoundingClientRect();
    const width = Math.min(386, Math.max(300, window.innerWidth - 24));
    let left = rect.right - width;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    const pickerHeight = 430;
    let top = rect.top - pickerHeight - 10;
    if (top < 12) top = Math.min(window.innerHeight - pickerHeight - 12, rect.bottom + 10);

    picker.style.width = `${width}px`;
    picker.style.left = `${left}px`;
    picker.style.top = `${Math.max(12, top)}px`;
  }

  function openPicker(anchor = null) {
    ensurePicker();
    activeAnchor = anchor || activeAnchor;
    placePicker(activeAnchor);
    picker.classList.remove("hidden");
    updatePickerSelection();

    if (selectedEffect !== "none" && sourceTrack && !detector && !detectorError) {
      void ensureDetector().catch(() => {});
    } else if (detectorError) {
      updatePickerStatus(detectorError, "error");
    } else if (detector) {
      updatePickerStatus("Suivi visage actif", "ready");
    }
  }

  function closePicker() {
    picker?.classList.add("hidden");
  }

  function togglePicker(anchor = null) {
    ensurePicker();
    if (picker.classList.contains("hidden")) {
      openPicker(anchor);
    } else {
      closePicker();
    }
  }

  document.addEventListener("pointerdown", (event) => {
    if (!picker || picker.classList.contains("hidden")) return;
    if (picker.contains(event.target)) return;
    if (activeAnchor?.contains?.(event.target)) return;
    closePicker();
  });


  // === PEOPLE_CAMERA_FACE_EFFECTS_V1_1_UI_GUARD_START ===
  // Le bouton d'effets doit rester visible même si l'UI d'appel est reconstruite
  // dynamiquement ou si un ancien markup est encore présent pendant un refresh.
  function buildEffectsButton({ id, className, compact = false } = {}) {
    const button = document.createElement("button");
    button.id = id;
    button.className = className;
    button.type = "button";
    button.title = "Effets de visage";
    button.setAttribute("aria-label", "Effets de visage");

    if (compact) {
      button.textContent = "✨";
    } else {
      button.innerHTML = "<span>✨</span><small>Effets</small>";
    }

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePicker(button);
    });

    return button;
  }

  function syncGuardedButtonState(button, cameraActive, hidden = false) {
    if (!button) return;
    const info = effectInfo();
    button.classList.toggle("people-face-effects-active", selectedEffect !== "none");
    button.classList.toggle("hidden", Boolean(hidden));
    button.disabled = !cameraActive;
    button.title = cameraActive
      ? `Effets de visage${selectedEffect !== "none" ? ` • ${info?.label || selectedEffect}` : ""}`
      : "Active la caméra pour utiliser les effets de visage";
  }

  function ensureDmEffectsControl() {
    const actions = document.getElementById("peopleDmCallActiveActions");
    const cameraButton = document.getElementById("peopleDmCallCamera");
    if (!actions || !cameraButton) return null;

    let button = document.getElementById("peopleDmCallEffects");
    if (!button) {
      button = buildEffectsButton({
        id: "peopleDmCallEffects",
        className: "people-dm-call-control people-dm-effects-control"
      });
      cameraButton.insertAdjacentElement("afterend", button);
    }

    const cameraActive = cameraButton.classList.contains("active") ||
      /cam\s*active/i.test(cameraButton.textContent || "");
    syncGuardedButtonState(button, cameraActive, false);
    return button;
  }

  function ensureServerEffectsControl() {
    const tile = document.querySelector(".video-tile.local");
    if (!tile) return null;

    let button = document.getElementById("peopleServerVideoEffects");
    if (!button) {
      button = buildEffectsButton({
        id: "peopleServerVideoEffects",
        className: "people-video-effects-button",
        compact: true
      });
      tile.appendChild(button);
    }

    const video = tile.querySelector("video");
    const cameraActive = Boolean(video && !video.classList.contains("hidden") && video.srcObject);
    syncGuardedButtonState(button, cameraActive, !cameraActive);
    return button;
  }

  function ensureControls() {
    ensureDmEffectsControl();
    ensureServerEffectsControl();
  }

  let controlsSyncQueued = false;
  function queueControlsSync() {
    if (controlsSyncQueued) return;
    controlsSyncQueued = true;
    requestAnimationFrame(() => {
      controlsSyncQueued = false;
      ensureControls();
    });
  }

  if (document.body && typeof MutationObserver !== "undefined") {
    const controlsObserver = new MutationObserver(queueControlsSync);
    controlsObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "src"]
    });
  }

  document.addEventListener("click", (event) => {
    if (event.target?.closest?.("#peopleDmCallCamera, #peopleCameraBtn, #cameraButton")) {
      setTimeout(ensureControls, 0);
      setTimeout(ensureControls, 180);
    }
  }, true);

  window.addEventListener("people-camera-effect-changed", queueControlsSync);
  window.addEventListener("people-camera-effect-track-changed", queueControlsSync);
  queueControlsSync();
  // === PEOPLE_CAMERA_FACE_EFFECTS_V1_1_UI_GUARD_END ===

  window.addEventListener("resize", () => {
    if (picker && !picker.classList.contains("hidden")) placePicker(activeAnchor);
  });

  window.PeopleCameraEffects = Object.freeze({
    effects: EFFECTS,
    attachSource,
    detachSource,
    getOutputTrack(track = sourceTrack) {
      if (!track) return null;
      return track === sourceTrack ? (outputTrack || track) : track;
    },
    getSelectedEffect() {
      return selectedEffect;
    },
    getSelectedEffectInfo() {
      return effectInfo();
    },
    async setEffect(id) {
      return setEffect(id);
    },
    openPicker,
    closePicker,
    togglePicker,
    ensureControls,
    isActive() {
      return selectedEffect !== "none";
    }
  });

  emitEffectChanged();
})();
