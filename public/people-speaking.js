(() => {
  "use strict";
  let context;
  const meters = new Map();
  const key = name => String(name || "").toLocaleLowerCase("fr-FR");
  function resume() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    context ||= new Audio();
    void context.resume().catch(error => console.warn("[People speaking] Audio analysis unavailable", error));
  }
  document.addEventListener("pointerdown", resume, { passive: true });
  document.addEventListener("keydown", resume);
  setInterval(() => {
    const active = new Set(), speaking = new Map();
    const calls = window.PeopleCallBar?.getStates() || [];
    for (const call of calls) {
      if (call.phase !== "active") continue;
      const names = new Set(); speaking.set(call.id, names);
      const controller = call.type === "dm" ? window.PeopleDmCalls?.getSlot(call.id) : window.PeopleCallBar.getServerController(call.id);
      const samples = controller?.getAudioSamples?.() || [];
      for (const sample of samples.slice(1)) {
        const track = sample.stream?.getAudioTracks().find(track => track.readyState === "live");
        if (!track || !context) continue;
        active.add(track);
        let meter = meters.get(track);
        if (!meter) {
          const source = context.createMediaStreamSource(sample.stream);
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
        if (track.enabled && !track.muted && performance.now() < meter.until) names.add(key(sample.username));
      }
    }
    for (const [track, meter] of meters) if (!active.has(track)) { meter.source.disconnect(); meter.analyser.disconnect(); meters.delete(track); }
    document.querySelectorAll('.voice-user [data-people-avatar-username], .people-server-voice-member-avatar, .video-stage [data-people-avatar-username], .people-dm-call-avatar, .people-call-participant-avatar').forEach(el => {
      let callId = el.closest(".video-stage[data-call-id]")?.dataset.callId;
      const dm = el.closest(".people-dm-call-overlay");
      if (dm) callId = window.PeopleDmCalls?.getStates()[dm.id.endsWith("Second") ? 1 : 0]?.callId;
      const member = el.closest(".people-server-voice-member");
      if (member) callId = calls.find(c => c.type === "server" && String(c.serverId) === member.dataset.serverId && String(c.channelId) === member.dataset.channelId)?.id;
      if (!callId && el.closest(".voice-user")) callId = "server-primary";
      const on = speaking.get(callId)?.has(key(el.dataset.peopleAvatarUsername)) || false;
      if (el.classList.contains("people-speaking") !== on) el.classList.toggle("people-speaking", on);
    });
  }, 80);
})();
