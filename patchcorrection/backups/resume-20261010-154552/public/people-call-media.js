(() => {
  "use strict";
  const blocked = new Set();
  const unlock = document.createElement("button");
  unlock.type = "button"; unlock.className = "people-audio-unlock"; unlock.hidden = true;
  unlock.textContent = "Enable call audio";
  unlock.title = "Your browser paused call audio. Click to start playback.";
  document.body.append(unlock);
  function reconcile() {
    for (const node of blocked) if (!node.isConnected || !node.srcObject?.getAudioTracks().some(t => t.readyState === "live")) blocked.delete(node);
    unlock.hidden = !blocked.size;
  }
  async function play(node) {
    if (!node?.srcObject?.getAudioTracks().length) return;
    try { await node.play(); blocked.delete(node); }
    catch { if (node.isConnected) blocked.add(node); }
    reconcile();
  }
  unlock.addEventListener("click", () => { for (const node of blocked) void play(node); });
  window.PeopleCallMedia = { play };
  setInterval(reconcile, 1000);
  function cameraPicker(toolbar) {
    if (toolbar.querySelector(".people-call-camera-picker")) return;
    const select = document.createElement("select");
    select.className = "people-call-camera-picker"; select.setAttribute("aria-label", "Camera");
    async function populate() {
      try {
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
        select.replaceChildren(new Option(devices.length ? "Default camera" : "No camera available", ""));
        devices.forEach((device, i) => select.append(new Option(device.label || `Camera ${i + 1}`, device.deviceId)));
        select.value = window.PeopleAudioDevices?.getCameraId?.() || "";
        select.disabled = !devices.length;
      } catch { select.replaceChildren(new Option("Camera unavailable", "")); select.disabled = true; }
    }
    select.addEventListener("focus", populate);
    select.addEventListener("change", () => window.PeopleAudioDevices?.setCameraId?.(select.value));
    toolbar.append(select); void populate();
  }
  function decorate() { document.querySelectorAll(".people-server-call-controls, .people-dm-call-active-actions").forEach(cameraPicker); }
  new MutationObserver(decorate).observe(document.body, { childList: true, subtree: true });
  decorate();
})();
