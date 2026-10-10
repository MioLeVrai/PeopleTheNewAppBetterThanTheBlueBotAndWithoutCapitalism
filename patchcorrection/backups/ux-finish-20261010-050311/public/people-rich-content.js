(() => {
  "use strict";

  const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
  const MAX_ATTACHMENT_TRANSPORT_BYTES = 26 * 1024 * 1024;
  const MAX_ATTACHMENT_FILES = 10;
  const ATTACHMENT_BUNDLE_MIME = "application/x-people-attachment-bundle";
  const ATTACHMENT_BUNDLE_MAGIC = new TextEncoder().encode(
    "PEOPLE-ATTACHMENT-BUNDLE-V1\n"
  );
  const ATTACHMENT_BUNDLE_MAX_HEADER_BYTES = 64 * 1024;
  const INLINE_IMAGE_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif"
  ]);
  const INLINE_VIDEO_TYPES = new Set([
    "video/mp4",
    "video/webm",
    "video/ogg",
    "video/quicktime"
  ]);

  function isInlineAudio(mime) {
    return String(mime || "").toLowerCase().startsWith("audio/");
  }

  const TRAILING_URL_PUNCTUATION_RE = /[.,!?;:)\]}]$/;
  const MESSAGE_URL_RE = /https?:\/\/[^\s<>"']+/gi;

  function installAttachmentStyles() {
    if (document.getElementById("people-attachment-styles-v1")) return;
    const style = document.createElement("style");
    style.id = "people-attachment-styles-v1";
    style.textContent = `
      .people-message-attachment{margin-top:7px;max-width:min(560px,100%);white-space:normal}
      .people-message-attachment-loading,.people-message-attachment-error{display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:9px;background:rgba(0,0,0,.16);color:#b5bac1;font-size:12px}
      .people-message-image-link{display:block;width:max-content;max-width:100%;text-decoration:none}
      .people-message-image{display:block;max-width:min(520px,100%);max-height:430px;border-radius:10px;object-fit:contain;background:#111214;cursor:zoom-in}
      .people-message-video{display:block;width:min(560px,100%);max-height:430px;border-radius:10px;background:#0b0c0f}
      .people-message-audio{display:block;width:min(520px,100%);height:42px;margin-top:2px}
      .people-message-attachment-meta{display:flex;align-items:center;gap:8px;margin-top:5px;color:#949ba4;font-size:11px;min-width:0}
      .people-message-attachment-meta a{color:#b9b7e8;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .people-message-attachment-meta a:hover{text-decoration:underline}
      .people-file-card{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:10px;max-width:520px;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(0,0,0,.16);color:inherit;text-decoration:none}
      .people-file-card:hover{background:rgba(255,255,255,.045)}
      .people-file-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:9px;background:rgba(255,255,255,.07);font-size:21px}
      .people-file-copy{min-width:0;display:grid;gap:2px}
      .people-file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e3e5e8;font-size:13px;font-weight:750}
      .people-file-size{color:#949ba4;font-size:11px}
      .people-file-download{color:#b9b7e8;font-size:18px}
      .people-message-attachment-bundle{display:grid;gap:8px;max-width:min(560px,100%)}
      .people-message-attachment-bundle>.people-message-attachment{margin-top:0}
      .people-message-attachment-bundle>.people-message-attachment+.people-message-attachment{margin-top:0}

      /* La preview n'est plus flottante : elle devient une vraie ligne du composer. */
      .composer.people-has-attachment{
        display:grid!important;
        grid-template-columns:42px minmax(0,1fr) auto!important;
        grid-template-rows:auto 44px!important;
        align-items:center!important;
        gap:8px 10px!important;
        min-height:62px!important;
        max-height:none!important;
        padding:8px 18px 12px!important;
      }
      .composer.people-has-attachment>.composer-image-button{grid-column:1!important;grid-row:2!important}
      .composer.people-has-attachment>input:not([type=file]){grid-column:2!important;grid-row:2!important;min-width:0!important;width:100%!important}
      .composer.people-has-attachment>button[type=submit]{grid-column:3!important;grid-row:2!important}
      .composer-image-preview{
        display:flex;
        align-items:center!important;
        gap:8px;
        grid-column:1/-1!important;
        grid-row:1!important;
        position:relative!important;
        inset:auto!important;
        z-index:4;
        width:100%!important;
        max-width:none!important;
        min-width:0;
        height:auto!important;
        min-height:104px!important;
        align-self:stretch!important;
        padding:10px 12px!important;
        margin:0!important;
        overflow-x:auto;
        overflow-y:hidden;
        border:1px solid rgba(255,255,255,.07);
        border-radius:11px;
        background:#17141f;
        box-shadow:none!important;
      }
      .composer-image-preview.hidden{display:none!important}
      .people-composer-attachment-preview{
        position:relative;
        display:grid;
        grid-template-columns:auto minmax(0,1fr) auto;
        gap:8px;
        align-items:center;
        flex:0 0 auto;
        width:240px;
        min-width:220px;
        max-width:300px;
        min-height:64px;
        padding:7px 8px;
        border:1px solid rgba(255,255,255,.06);
        border-radius:10px;
        background:#211d30;
      }
      .people-composer-attachment-preview.is-audio{width:340px;max-width:380px}
      .people-composer-preview-visual{
        width:44px;
        height:44px;
        min-width:44px;
        padding:0!important;
        border:0!important;
        border-radius:8px!important;
        overflow:hidden;
        background:#111214!important;
        cursor:zoom-in;
      }
      .people-composer-preview-visual img,.people-composer-preview-visual video{display:block;width:100%;height:100%;object-fit:cover;background:#111214}
      .people-composer-preview-visual.video{cursor:pointer}
      .people-composer-attachment-preview>.people-file-icon{width:44px;height:44px;font-size:22px}
      .people-composer-attachment-copy{min-width:0;display:grid;gap:3px}
      .people-composer-attachment-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:800;color:#f2f3f5}
      .people-composer-attachment-size{font-size:10px;color:#949ba4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .people-composer-audio-wrap{grid-column:1/3;display:grid;grid-template-columns:40px minmax(0,1fr);gap:8px;align-items:center;min-width:0}
      .people-composer-audio-icon{display:grid;place-items:center;width:40px;height:40px;border-radius:8px;background:rgba(255,255,255,.07);font-size:19px}
      .people-composer-audio-main{display:grid;gap:3px;min-width:0}
      .people-composer-audio{width:100%;min-width:180px;height:32px}
      .composer-image-remove{position:absolute!important;top:5px!important;right:5px!important;width:24px!important;min-width:24px!important;height:24px!important;min-height:24px!important;padding:0!important;border:0;border-radius:7px;cursor:pointer;align-self:start!important}
      .people-attachment-drop-zone{position:relative}
      .people-attachment-drop-zone.people-attachment-drop-active::after{
        content:"Dépose tes fichiers ici";
        position:absolute;
        inset:12px;
        z-index:9999;
        display:grid;
        place-items:center;
        border:2px dashed rgba(174,157,235,.86);
        border-radius:14px;
        background:rgba(20,17,29,.9);
        color:#eeeafd;
        font-size:16px;
        font-weight:850;
        letter-spacing:.01em;
        pointer-events:none;
        backdrop-filter:blur(3px)
      }

      .people-local-preview-backdrop{position:fixed;inset:0;z-index:10050;display:grid;place-items:center;padding:24px;background:rgba(7,6,11,.9);backdrop-filter:blur(4px)}
      .people-local-preview-backdrop.hidden{display:none!important}
      .people-local-preview-card{position:relative;display:grid;place-items:center;width:min(980px,95vw);max-height:90vh;padding:42px 18px 18px;border:1px solid rgba(255,255,255,.09);border-radius:14px;background:#121019;box-shadow:0 24px 90px rgba(0,0,0,.55)}
      .people-local-preview-card img,.people-local-preview-card video{display:block;max-width:100%;max-height:calc(90vh - 78px);object-fit:contain;border-radius:10px;background:#09090c}
      .people-local-preview-card audio{width:min(680px,85vw)}
      .people-local-preview-close{position:absolute!important;right:10px!important;top:10px!important;width:32px!important;min-width:32px!important;height:32px!important;min-height:32px!important;padding:0!important;border:0!important;border-radius:8px!important;background:#2b253f!important;color:#fff!important;font-size:22px!important;line-height:1!important;cursor:pointer}
      .people-local-preview-title{position:absolute;left:16px;top:13px;right:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d9d4e4;font-size:12px;font-weight:750}

      @media (max-width:720px){
        .people-message-image,.people-message-video{max-width:100%}
        .people-file-card{max-width:100%}
        .composer.people-has-attachment{grid-template-columns:42px minmax(0,1fr) auto!important;padding-left:8px!important;padding-right:8px!important}
        .composer-image-preview{max-width:none!important}
        .people-composer-attachment-preview{width:220px;min-width:200px}
        .people-composer-attachment-preview.is-audio{width:min(320px,88vw);max-width:88vw}
        .people-composer-audio{min-width:0}
      }
    `;
    document.head.appendChild(style);
  }

  function normalizeMime(value) {
    const mime = String(value || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)
      ? mime
      : "application/octet-stream";
  }

  function cleanFileName(value, fallback = "fichier") {
    const cleaned = String(value || "")
      .replace(/[\\/\u0000-\u001f\u007f<>:"|?*]+/g, "_")
      .trim()
      .slice(0, 180);
    return cleaned || fallback;
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} Ko`;
    return `${(bytes / (1024 ** 2)).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} Mo`;
  }

  function defaultNameForMime(mime) {
    if (INLINE_IMAGE_TYPES.has(mime)) return "image";
    if (INLINE_VIDEO_TYPES.has(mime)) return "video";
    return "fichier";
  }

  function decodeHeaderFileName(response, mime) {
    const raw = response.headers.get("X-People-File-Name") || "";
    if (raw) {
      try { return cleanFileName(decodeURIComponent(raw), defaultNameForMime(mime)); } catch {}
    }
    return defaultNameForMime(mime);
  }

  function mayBeYoutubeUrl(value) {
    const source = String(value || "").toLowerCase();
    return source.includes("youtu.be/") || source.includes("youtube.com/") || source.includes("m.youtube.com/");
  }

  function cleanUrlTail(value) {
    let url = String(value || "");
    let tail = "";
    while (url && TRAILING_URL_PUNCTUATION_RE.test(url)) {
      tail = url.slice(-1) + tail;
      url = url.slice(0, -1);
    }
    return { url, tail };
  }

  function youtubeId(value) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      let id = "";
      if (host === "youtu.be") {
        id = url.pathname.split("/").filter(Boolean)[0] || "";
      } else if (host === "youtube.com" || host === "m.youtube.com") {
        if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
        else {
          const parts = url.pathname.split("/").filter(Boolean);
          if (["shorts", "embed", "live"].includes(parts[0])) id = parts[1] || "";
        }
      }
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    } catch { return null; }
  }

  function appendTextWithLinks(container, text) {
    const source = String(text || "");
    const youtubeIds = [];
    const seenYoutube = new Set();
    MESSAGE_URL_RE.lastIndex = 0;
    let cursor = 0;
    let match;
    while ((match = MESSAGE_URL_RE.exec(source))) {
      if (match.index > cursor) container.appendChild(document.createTextNode(source.slice(cursor, match.index)));
      const cleaned = cleanUrlTail(match[0]);
      if (cleaned.url) {
        const link = document.createElement("a");
        link.href = cleaned.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "people-message-link";
        link.textContent = cleaned.url;
        container.appendChild(link);
        const id = mayBeYoutubeUrl(cleaned.url) ? youtubeId(cleaned.url) : null;
        if (id && !seenYoutube.has(id) && youtubeIds.length < 2) {
          seenYoutube.add(id);
          youtubeIds.push(id);
        }
      }
      if (cleaned.tail) container.appendChild(document.createTextNode(cleaned.tail));
      cursor = match.index + match[0].length;
    }
    if (cursor < source.length) container.appendChild(document.createTextNode(source.slice(cursor)));
    return youtubeIds;
  }

  function appendYoutube(container, id) {
    const wrap = document.createElement("div");
    wrap.className = "people-youtube-preview";
    const iframe = document.createElement("iframe");
    iframe.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id);
    iframe.title = "Prévisualisation YouTube";
    iframe.loading = "lazy";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    wrap.appendChild(iframe);
    container.appendChild(wrap);
  }

  function normalizeLoadedAttachment(loaded, fallbackUrl = "") {
    if (loaded instanceof Blob) {
      return {
        blob: loaded,
        url: "",
        mime: normalizeMime(loaded.type),
        name: defaultNameForMime(normalizeMime(loaded.type)),
        size: loaded.size,
        direct: false
      };
    }
    const object = loaded && typeof loaded === "object" ? loaded : {};
    const blob = object.blob instanceof Blob ? object.blob : null;
    const mime = normalizeMime(object.mime || blob?.type || "application/octet-stream");
    return {
      blob,
      url: String(object.url || fallbackUrl || ""),
      mime,
      name: cleanFileName(object.name, defaultNameForMime(mime)),
      size: Number.isFinite(Number(object.size)) ? Number(object.size) : (blob?.size || 0),
      direct: Boolean(object.direct || (!blob && (object.url || fallbackUrl)))
    };
  }

  async function loadDirectAttachmentMeta(id) {
    const url = "/api/chat/image/" + encodeURIComponent(id);
    const response = await fetch(url, {
      method: "HEAD",
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!response.ok) throw new Error("Impossible de charger la pièce jointe.");
    const mime = normalizeMime(response.headers.get("Content-Type"));
    const size = Number(response.headers.get("X-People-Original-Size") || response.headers.get("Content-Length") || 0);
    return {
      url,
      direct: true,
      mime,
      name: decodeHeaderFileName(response, mime),
      size
    };
  }

  function addObjectUrl(owner, blob) {
    const url = URL.createObjectURL(blob);
    owner.dataset.peopleObjectUrl = url;
    return url;
  }

  function renderSingleAttachmentInto(wrap, loaded) {
    const info = normalizeLoadedAttachment(loaded);
    const mime = info.mime;
    let sourceUrl = info.url;
    if (info.blob) sourceUrl = addObjectUrl(wrap, info.blob);
    if (!sourceUrl) throw new Error("Pièce jointe vide.");

    wrap.replaceChildren();
    wrap.className = "people-message-attachment";

    if (INLINE_IMAGE_TYPES.has(mime)) {
      const link = document.createElement("a");
      link.className = "people-message-image-link";
      link.href = sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const image = document.createElement("img");
      image.className = "people-message-image";
      image.alt = info.name || "Image envoyée";
      image.loading = "lazy";
      image.decoding = "async";
      image.fetchPriority = "low";
      link.appendChild(image);
      wrap.appendChild(link);
      image.src = sourceUrl;
      return;
    }

    if (INLINE_VIDEO_TYPES.has(mime)) {
      const video = document.createElement("video");
      video.className = "people-message-video";
      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;
      video.src = sourceUrl;
      wrap.appendChild(video);

      const meta = document.createElement("div");
      meta.className = "people-message-attachment-meta";
      const link = document.createElement("a");
      link.href = sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.download = info.name || "video";
      link.textContent = info.name || "Vidéo";
      meta.appendChild(link);
      if (info.size) meta.appendChild(document.createTextNode(" · " + formatBytes(info.size)));
      wrap.appendChild(meta);
      return;
    }

    if (isInlineAudio(mime)) {
      const audio = document.createElement("audio");
      audio.className = "people-message-audio";
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = sourceUrl;
      wrap.appendChild(audio);

      const meta = document.createElement("div");
      meta.className = "people-message-attachment-meta";
      const link = document.createElement("a");
      link.href = sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.download = info.name || "audio";
      link.textContent = info.name || "Audio";
      meta.appendChild(link);
      if (info.size) meta.appendChild(document.createTextNode(" · " + formatBytes(info.size)));
      wrap.appendChild(meta);
      return;
    }

    const link = document.createElement("a");
    link.className = "people-file-card";
    link.href = sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.download = info.name || "fichier";

    const icon = document.createElement("span");
    icon.className = "people-file-icon";
    icon.textContent = "📄";

    const copy = document.createElement("span");
    copy.className = "people-file-copy";
    const name = document.createElement("span");
    name.className = "people-file-name";
    name.textContent = info.name || "Fichier";
    const size = document.createElement("span");
    size.className = "people-file-size";
    size.textContent = info.size ? `${formatBytes(info.size)} · ${mime}` : mime;
    copy.append(name, size);

    const download = document.createElement("span");
    download.className = "people-file-download";
    download.textContent = "⬇";
    download.setAttribute("aria-hidden", "true");
    link.append(icon, copy, download);
    wrap.appendChild(link);
  }

  async function unpackAttachmentBundle(blob) {
    if (!(blob instanceof Blob) || blob.size <= ATTACHMENT_BUNDLE_MAGIC.length + 8) {
      throw new Error("Conteneur de pièces jointes invalide.");
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength > MAX_ATTACHMENT_TRANSPORT_BYTES) {
      throw new Error("Conteneur de pièces jointes trop lourd.");
    }

    for (let index = 0; index < ATTACHMENT_BUNDLE_MAGIC.length; index += 1) {
      if (bytes[index] !== ATTACHMENT_BUNDLE_MAGIC[index]) {
        throw new Error("Format de pièces jointes inconnu.");
      }
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerLength = view.getUint32(ATTACHMENT_BUNDLE_MAGIC.length, false);
    if (headerLength < 16 || headerLength > ATTACHMENT_BUNDLE_MAX_HEADER_BYTES) {
      throw new Error("En-tête de pièces jointes invalide.");
    }

    const headerStart = ATTACHMENT_BUNDLE_MAGIC.length + 4;
    const headerEnd = headerStart + headerLength;
    if (headerEnd > bytes.byteLength) {
      throw new Error("Conteneur de pièces jointes tronqué.");
    }

    let header;
    try {
      header = JSON.parse(new TextDecoder().decode(bytes.subarray(headerStart, headerEnd)));
    } catch {
      throw new Error("Métadonnées de pièces jointes invalides.");
    }

    if (
      header?.v !== 1 ||
      !Array.isArray(header.files) ||
      header.files.length < 2 ||
      header.files.length > MAX_ATTACHMENT_FILES
    ) {
      throw new Error("Liste de pièces jointes invalide.");
    }

    const files = [];
    let cursor = headerEnd;
    for (const item of header.files) {
      const size = Number(item?.size);
      const mime = normalizeMime(item?.mime);
      const name = cleanFileName(item?.name, defaultNameForMime(mime));
      if (
        mime === ATTACHMENT_BUNDLE_MIME ||
        !Number.isInteger(size) ||
        size <= 0 ||
        size > MAX_ATTACHMENT_BYTES ||
        cursor + size > bytes.byteLength
      ) {
        throw new Error("Pièce jointe du conteneur invalide.");
      }

      const part = bytes.slice(cursor, cursor + size);
      files.push({
        blob: new Blob([part], { type: mime }),
        mime,
        name,
        size,
        direct: false
      });
      cursor += size;
    }

    if (cursor !== bytes.byteLength) {
      throw new Error("Taille du conteneur de pièces jointes incohérente.");
    }
    return files;
  }

  async function renderAttachmentInto(wrap, loaded) {
    const info = normalizeLoadedAttachment(loaded);
    if (info.mime !== ATTACHMENT_BUNDLE_MIME) {
      renderSingleAttachmentInto(wrap, info);
      return;
    }

    let bundleBlob = info.blob;
    if (!bundleBlob && info.url) {
      const response = await fetch(info.url, {
        credentials: "same-origin",
        cache: "no-store"
      });
      if (!response.ok) throw new Error("Impossible de charger les pièces jointes.");
      bundleBlob = await response.blob();
    }
    if (!bundleBlob) throw new Error("Conteneur de pièces jointes vide.");

    const files = await unpackAttachmentBundle(bundleBlob);
    wrap.replaceChildren();
    wrap.className = "people-message-attachment people-message-attachment-bundle";

    for (const file of files) {
      const item = document.createElement("div");
      item.className = "people-message-attachment";
      wrap.appendChild(item);
      renderSingleAttachmentInto(item, file);
    }
  }

  function appendAttachment(container, imageId, imageLoader = null) {
    const id = String(imageId || "").trim();
    if (!id) return;

    const wrap = document.createElement("div");
    wrap.className = "people-message-attachment people-message-attachment-loading";
    wrap.textContent = "📎 Chargement de la pièce jointe…";
    container.appendChild(wrap);

    Promise.resolve(
      typeof imageLoader === "function"
        ? imageLoader(id)
        : loadDirectAttachmentMeta(id)
    ).then((loaded) => {
      if (!wrap.isConnected) return null;
      return renderAttachmentInto(wrap, loaded);
    }).catch((err) => {
      console.warn("[People attachment/load]", err);
      if (!wrap.isConnected) return;
      wrap.className = "people-message-attachment people-message-attachment-error";
      wrap.textContent = "⚠️ Pièce jointe indisponible";
    });
  }

  function render(container, { text = "", imageId = null, imageLoader = null } = {}) {
    if (!container) return;
    container.querySelectorAll?.("[data-people-object-url]").forEach((element) => {
      const objectUrl = element.dataset?.peopleObjectUrl;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    });

    const fragment = document.createDocumentFragment();
    const youtubeIds = appendTextWithLinks(fragment, text);
    for (const id of youtubeIds) appendYoutube(fragment, id);
    appendAttachment(fragment, imageId, imageLoader);
    container.replaceChildren(fragment);
  }

  function validateImage(file) {
    if (!file) throw new Error("Aucun fichier sélectionné.");
    if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("Chaque pièce jointe doit faire moins de 25 Mo.");
    }
  }

  function validateFiles(files) {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) throw new Error("Aucun fichier sélectionné.");
    if (list.length > MAX_ATTACHMENT_FILES) {
      throw new Error(`Tu peux envoyer ${MAX_ATTACHMENT_FILES} fichiers maximum dans un message.`);
    }

    let total = 0;
    for (const file of list) {
      validateImage(file);
      total += Number(file.size) || 0;
    }
    if (total > MAX_ATTACHMENT_BYTES) {
      throw new Error("Les pièces jointes doivent faire moins de 25 Mo au total par message.");
    }
    return list;
  }

  async function packFiles(files) {
    const list = validateFiles(files);
    if (list.length === 1) return list[0];

    const metadata = list.map((file) => ({
      name: cleanFileName(file.name, "fichier"),
      mime: normalizeMime(file.type),
      size: file.size
    }));
    const headerBytes = new TextEncoder().encode(JSON.stringify({
      v: 1,
      files: metadata
    }));
    if (headerBytes.byteLength > ATTACHMENT_BUNDLE_MAX_HEADER_BYTES) {
      throw new Error("Trop de métadonnées dans les pièces jointes.");
    }

    const lengthBytes = new Uint8Array(4);
    new DataView(lengthBytes.buffer).setUint32(0, headerBytes.byteLength, false);
    const parts = [
      ATTACHMENT_BUNDLE_MAGIC,
      lengthBytes,
      headerBytes,
      ...list
    ];
    const name = `${list.length}-pieces-jointes.peoplebundle`;
    let bundle;
    if (typeof File === "function") {
      bundle = new File(parts, name, {
        type: ATTACHMENT_BUNDLE_MIME,
        lastModified: Date.now()
      });
    } else {
      bundle = new Blob(parts, { type: ATTACHMENT_BUNDLE_MIME });
      try {
        Object.defineProperty(bundle, "name", { value: name });
      } catch {}
    }

    if (bundle.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("Les pièces jointes doivent faire moins de 25 Mo au total par message.");
    }
    return bundle;
  }

  async function uploadImagePayload(payload, contentType, fileName = "") {
    if (!payload || typeof payload.size !== "number" || payload.size <= 0 || payload.size > MAX_ATTACHMENT_TRANSPORT_BYTES) {
      throw new Error("La pièce jointe chiffrée est trop lourde.");
    }

    const originalType = normalizeMime(contentType || payload.type || "application/octet-stream");
    const headers = {
      // Toujours octet-stream ici : le serveur a un express.json global et ne doit
      // jamais essayer de parser un .json envoyé comme fichier.
      "Content-Type": "application/octet-stream",
      "X-People-File-Type": encodeURIComponent(originalType)
    };
    if (fileName) headers["X-People-File-Name"] = encodeURIComponent(cleanFileName(fileName));

    const response = await fetch("/api/chat/image", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: payload
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false || !data.imageId) {
      throw new Error(data.error || "Impossible d'envoyer la pièce jointe.");
    }
    return String(data.imageId);
  }

  async function uploadImage(file) {
    validateImage(file);
    return uploadImagePayload(file, normalizeMime(file.type), file.name || "fichier");
  }

  async function uploadFiles(files) {
    const payload = await packFiles(files);
    return uploadImage(payload);
  }

  function ensureLocalPreview() {
    let backdrop = document.getElementById("peopleLocalAttachmentPreview");
    if (backdrop) return backdrop;

    backdrop = document.createElement("div");
    backdrop.id = "peopleLocalAttachmentPreview";
    backdrop.className = "people-local-preview-backdrop hidden";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");

    const card = document.createElement("div");
    card.className = "people-local-preview-card";
    const title = document.createElement("div");
    title.className = "people-local-preview-title";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "people-local-preview-close";
    close.setAttribute("aria-label", "Fermer l'aperçu");
    close.textContent = "×";
    const body = document.createElement("div");
    body.className = "people-local-preview-body";
    card.append(title, close, body);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    const hide = () => {
      body.querySelectorAll("video,audio").forEach((media) => {
        try { media.pause(); } catch {}
      });
      body.replaceChildren();
      backdrop.classList.add("hidden");
    };
    close.addEventListener("click", hide);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) hide();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !backdrop.classList.contains("hidden")) hide();
    });
    backdrop._peoplePreview = { title, body, hide };
    return backdrop;
  }

  function openLocalPreview(file, objectUrl) {
    if (!file || !objectUrl) return;
    const mime = normalizeMime(file.type);
    const backdrop = ensureLocalPreview();
    const state = backdrop._peoplePreview;
    state.body.replaceChildren();
    state.title.textContent = cleanFileName(file.name, "Aperçu");

    let media = null;
    if (INLINE_IMAGE_TYPES.has(mime)) {
      media = document.createElement("img");
      media.alt = cleanFileName(file.name, "Image");
    } else if (INLINE_VIDEO_TYPES.has(mime)) {
      media = document.createElement("video");
      media.controls = true;
      media.playsInline = true;
      media.preload = "metadata";
    } else if (isInlineAudio(mime)) {
      media = document.createElement("audio");
      media.controls = true;
      media.preload = "metadata";
    }
    if (!media) return;
    media.src = objectUrl;
    state.body.appendChild(media);
    backdrop.classList.remove("hidden");
  }

  function createImagePicker({ button, input, preview, pasteTarget }) {
    let selectedFiles = [];
    let objectUrls = [];
    let busy = false;
    const composer = preview?.closest?.(".composer") || null;
    const dropZone = composer?.parentElement || composer || pasteTarget || null;

    function setComposerState(hasAttachment) {
      composer?.classList.toggle("people-has-attachment", Boolean(hasAttachment));
    }

    function revokePreviewUrls() {
      for (const url of objectUrls) {
        try { URL.revokeObjectURL(url); } catch {}
      }
      objectUrls = [];
    }

    function clear() {
      selectedFiles = [];
      if (input) input.value = "";
      const localPreview = document.getElementById("peopleLocalAttachmentPreview");
      localPreview?._peoplePreview?.hide?.();
      revokePreviewUrls();
      if (preview) {
        preview.replaceChildren();
        preview.classList.add("hidden");
      }
      setComposerState(false);
    }

    function createVisualButton(kind, file, url) {
      const visualButton = document.createElement("button");
      visualButton.type = "button";
      visualButton.className = "people-composer-preview-visual " + kind;
      visualButton.title = kind === "image" ? "Agrandir l'image" : "Prévisualiser la vidéo";
      visualButton.setAttribute("aria-label", visualButton.title);

      let media;
      if (kind === "image") {
        media = document.createElement("img");
        media.alt = "Aperçu de " + cleanFileName(file.name, "l'image");
      } else {
        media = document.createElement("video");
        media.muted = true;
        media.preload = "metadata";
        media.playsInline = true;
      }
      media.src = url;
      visualButton.appendChild(media);
      visualButton.addEventListener("click", () => openLocalPreview(file, url));
      return visualButton;
    }

    function renderSelected() {
      const localPreview = document.getElementById("peopleLocalAttachmentPreview");
      localPreview?._peoplePreview?.hide?.();
      revokePreviewUrls();

      if (!preview) {
        setComposerState(selectedFiles.length > 0);
        return;
      }

      preview.replaceChildren();
      if (!selectedFiles.length) {
        preview.classList.add("hidden");
        setComposerState(false);
        return;
      }

      selectedFiles.forEach((file, index) => {
        const row = document.createElement("div");
        row.className = "people-composer-attachment-preview";
        const mime = normalizeMime(file.type);
        const safeName = cleanFileName(file.name, "fichier");

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "composer-image-remove";
        remove.title = "Retirer cette pièce jointe";
        remove.setAttribute("aria-label", `Retirer ${safeName}`);
        remove.textContent = "×";
        remove.addEventListener("click", () => {
          if (busy) return;
          selectedFiles.splice(index, 1);
          renderSelected();
        });

        if (INLINE_IMAGE_TYPES.has(mime) || INLINE_VIDEO_TYPES.has(mime)) {
          const url = URL.createObjectURL(file);
          objectUrls.push(url);
          const visual = createVisualButton(
            INLINE_IMAGE_TYPES.has(mime) ? "image" : "video",
            file,
            url
          );

          const copy = document.createElement("span");
          copy.className = "people-composer-attachment-copy";
          const name = document.createElement("span");
          name.className = "people-composer-attachment-name";
          name.textContent = safeName;
          const size = document.createElement("span");
          size.className = "people-composer-attachment-size";
          size.textContent = `${formatBytes(file.size)} · ${mime}`;
          const action = document.createElement("span");
          action.className = "people-composer-attachment-size";
          action.textContent = INLINE_IMAGE_TYPES.has(mime)
            ? "Clique pour agrandir"
            : "Clique pour lire";
          copy.append(name, size, action);
          row.append(visual, copy, remove);
        } else if (isInlineAudio(mime)) {
          row.classList.add("is-audio");
          const url = URL.createObjectURL(file);
          objectUrls.push(url);
          const audioWrap = document.createElement("div");
          audioWrap.className = "people-composer-audio-wrap";
          const icon = document.createElement("span");
          icon.className = "people-composer-audio-icon";
          icon.textContent = "🎵";
          const main = document.createElement("div");
          main.className = "people-composer-audio-main";
          const name = document.createElement("span");
          name.className = "people-composer-attachment-name";
          name.textContent = safeName;
          const audio = document.createElement("audio");
          audio.className = "people-composer-audio";
          audio.controls = true;
          audio.preload = "metadata";
          audio.src = url;
          const size = document.createElement("span");
          size.className = "people-composer-attachment-size";
          size.textContent = `${formatBytes(file.size)} · ${mime}`;
          main.append(name, audio, size);
          audioWrap.append(icon, main);
          row.append(audioWrap, remove);
        } else {
          const icon = document.createElement("span");
          icon.className = "people-file-icon";
          icon.textContent = "📄";
          const copy = document.createElement("span");
          copy.className = "people-composer-attachment-copy";
          const name = document.createElement("span");
          name.className = "people-composer-attachment-name";
          name.textContent = safeName;
          const size = document.createElement("span");
          size.className = "people-composer-attachment-size";
          size.textContent = `${formatBytes(file.size)} · ${mime}`;
          const note = document.createElement("span");
          note.className = "people-composer-attachment-size";
          note.textContent = "Envoyé chiffré";
          copy.append(name, size, note);
          row.append(icon, copy, remove);
        }

        preview.appendChild(row);
      });

      preview.classList.remove("hidden");
      setComposerState(true);
    }

    function addFiles(files, { replace = false } = {}) {
      const incoming = Array.from(files || []).filter(Boolean);
      if (!incoming.length) return;
      const next = replace ? incoming : [...selectedFiles, ...incoming];
      validateFiles(next);
      selectedFiles = next;
      renderSelected();
    }

    function show(file) {
      addFiles([file], { replace: true });
    }

    button?.addEventListener("click", () => {
      if (!busy) input?.click();
    });

    if (input) {
      input.multiple = true;
      input.addEventListener("change", () => {
        const files = Array.from(input.files || []);
        input.value = "";
        if (!files.length) return;
        try {
          addFiles(files);
        } catch (err) {
          alert(err.message || "Impossible d'ajouter ces fichiers.");
        }
      });
    }

    pasteTarget?.addEventListener("paste", (event) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      let files = Array.from(clipboard.files || []);
      if (!files.length) {
        files = Array.from(clipboard.items || [])
          .filter((candidate) => candidate.kind === "file")
          .map((candidate) => candidate.getAsFile?.())
          .filter(Boolean);
      }
      if (!files.length) return;
      try {
        addFiles(files);
        event.preventDefault();
      } catch (err) {
        alert(err.message || "Impossible de coller ces fichiers.");
      }
    });

    if (dropZone) {
      dropZone.classList.add("people-attachment-drop-zone");
      let dragDepth = 0;
      const containsFiles = (event) =>
        Array.from(event.dataTransfer?.types || []).includes("Files");

      dropZone.addEventListener("dragenter", (event) => {
        if (!containsFiles(event)) return;
        event.preventDefault();
        dragDepth += 1;
        dropZone.classList.add("people-attachment-drop-active");
      });

      dropZone.addEventListener("dragover", (event) => {
        if (!containsFiles(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        dropZone.classList.add("people-attachment-drop-active");
      });

      dropZone.addEventListener("dragleave", (event) => {
        if (!containsFiles(event)) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) dropZone.classList.remove("people-attachment-drop-active");
      });

      dropZone.addEventListener("drop", (event) => {
        if (!containsFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth = 0;
        dropZone.classList.remove("people-attachment-drop-active");
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return;
        try {
          addFiles(files);
        } catch (err) {
          alert(err.message || "Impossible d'ajouter ces fichiers.");
        }
      });
    }

    return {
      getFile() { return selectedFiles[0] || null; },
      getFiles() { return [...selectedFiles]; },
      clear,
      show,
      addFiles,
      setBusy(value) {
        busy = Boolean(value);
        if (button) button.disabled = busy;
        if (input) input.disabled = busy;
        if (preview) preview.toggleAttribute("aria-busy", busy);
      }
    };
  }

  installAttachmentStyles();

  window.PeopleRichContent = {
    render,
    uploadImage,
    uploadFiles,
    uploadImagePayload,
    packFiles,
    createImagePicker,
    youtubeId,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_FILES,
    ATTACHMENT_BUNDLE_MIME
  };
})();
