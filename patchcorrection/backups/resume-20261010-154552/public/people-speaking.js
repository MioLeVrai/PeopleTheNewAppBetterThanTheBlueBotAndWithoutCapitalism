(() => {
  "use strict";
  let context;
  const meters = new Map();
  const key = name => String(name || "").toLocaleLowerCase("fr-FR");
  function resume() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    context ||= new Audio();
    void context.resume().catch(() => {});
  }
  document.addEventListener("pointerdown", resume, { passive: true });
  document.addEventListener("keydown", resume);
  setInterval(() => {
    const active = new Set(), speaking = new Set();
    for (const call of window.PeopleCallBar?.getStates() || []) {
      if (call.phase !== "active") continue;
      const controller = call.type === "dm" ? window.PeopleDmCalls?.getSlot(call.id) : window.PeopleCallBar.getServerController(call.id);
      for (const sample of controller?.getAudioSamples?.() || []) {
        const track = sample.stream?.getAudioTracks().find(track => track.readyState === "live");
        if (!track || !context) continue;
        active.add(track);
        let meter = meters.get(track);
        if (!meter) {
          const source = context.createMediaStreamSource(new MediaStream([track]));
          const analyser = context.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = .15;
          source.connect(analyser); // Never connect to destination: media elements own playback.
          meter = { source, analyser, data: new Float32Array(512), hits: 0, until: 0 };
          meters.set(track, meter);
        }
        meter.analyser.getFloatTimeDomainData(meter.data);
        const rms = Math.sqrt(meter.data.reduce((sum, v) => sum + v * v, 0) / meter.data.length);
        const loud = context.state === "running" && track.enabled && !track.muted && rms > .025;
        meter.hits = loud ? meter.hits + 1 : 0;
        if (meter.hits >= 2) meter.until = performance.now() + 240;
        if (track.enabled && !track.muted && performance.now() < meter.until) speaking.add(key(sample.username));
      }
    }
    for (const [track, meter] of meters) if (!active.has(track)) { meter.source.disconnect(); meter.analyser.disconnect(); meters.delete(track); }
    document.querySelectorAll('.voice-user [data-people-avatar-username], .people-server-voice-member-avatar, .video-stage [data-people-avatar-username], .people-dm-call-avatar, .people-call-participant-avatar').forEach(el => {
      const on = speaking.has(key(el.dataset.peopleAvatarUsername));
      if (el.classList.contains("people-speaking") !== on) el.classList.toggle("people-speaking", on);
    });
  }, 80);
})();
