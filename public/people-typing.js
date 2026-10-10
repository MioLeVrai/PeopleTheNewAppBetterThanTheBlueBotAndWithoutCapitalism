(() => {
  "use strict";
  const socket = window.peopleSocket;
  const inputs = [{ input: document.getElementById("dmInput"), form: document.getElementById("dmForm"), kind: "dm" }, { input: document.getElementById("messageInput"), form: document.getElementById("messageForm"), kind: "server" }];
  const incoming = new Map();
  function target(kind) {
    if (kind === "dm") return { kind, username: document.getElementById("dmHeaderName")?.textContent.trim() };
    return { kind, serverId: window.PeopleServerRuntime?.getActiveServerId?.(), channelId: window.PeopleServerRuntime?.getActiveTextChannelId?.() };
  }
  for (const entry of inputs) {
    if (!entry.input || !entry.form) continue;
    const label = document.createElement("div"); label.className = "people-typing-label"; label.setAttribute("aria-live", "polite"); label.hidden = true;
    entry.form.append(label); entry.label = label;
    let sent = 0, stopTimer, previous;
    const stop = () => { clearTimeout(stopTimer); if (previous) socket?.emit("people-typing", { ...previous, active: false }); previous = null; sent = 0; };
    entry.stop = stop;
    entry.input.addEventListener("input", () => {
      if (!entry.input.value.trim()) return stop();
      const next = target(entry.kind);
      if (previous && JSON.stringify(previous) !== JSON.stringify(next)) stop();
      previous = next;
      if (Date.now() - sent >= 1800) { socket?.emit("people-typing", { ...next, active: true }); sent = Date.now(); }
      clearTimeout(stopTimer); stopTimer = setTimeout(stop, 2800);
    });
    entry.input.addEventListener("blur", stop);
    entry.form.addEventListener("submit", stop);
  }
  socket?.on("people-typing", state => {
    const id = state.device + ":" + state.kind;
    if (state.active) incoming.set(id, { ...state, expires: Date.now() + 4500 }); else incoming.delete(id);
    render();
  });
  function render() {
    for (const [id, state] of incoming) if (state.expires < Date.now()) incoming.delete(id);
    for (const entry of inputs) {
      if (!entry.label) continue;
      const current = target(entry.kind);
      const names = [...new Set([...incoming.values()].filter(s => s.kind === entry.kind && (s.kind === "dm" ? s.username === current.username : s.serverId === String(current.serverId) && s.channelId === String(current.channelId))).map(s => s.username))];
      entry.label.hidden = !names.length;
      const text = names.length ? `${names.join(", ")} ${names.length === 1 ? "is" : "are"} typing...` : "";
      if (entry.label.textContent !== text) entry.label.textContent = text;
    }
  }
  function reset() { inputs.forEach(entry => entry.stop?.()); incoming.clear(); render(); }
  socket?.on("disconnect", reset);
  window.addEventListener("people-server-channel-state", reset);
  setInterval(render, 300);
})();
