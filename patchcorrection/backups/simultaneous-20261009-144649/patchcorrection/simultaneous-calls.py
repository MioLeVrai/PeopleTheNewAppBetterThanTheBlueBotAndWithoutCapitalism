from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
p = root / 'server.js'
s = p.read_text(encoding='utf-8')
s = s.replace('const PEOPLE_MAX_SIMULTANEOUS_VOICES =\n  1;', 'const PEOPLE_MAX_SIMULTANEOUS_VOICES =\n  2;')
s = s.replace("Tu es déjà dans un vocal ou un autre appel.", "Tu as atteint la limite de 2 appels simultanés.").replace("Tu es déjà dans un vocal ou un appel.", "Tu as atteint la limite de 2 appels simultanés.").replace("Cette personne est déjà dans un vocal ou un appel.", "Cette personne a atteint la limite de 2 appels simultanés.").replace("Tu es déjà dans un autre vocal ou un appel.", "Tu as atteint la limite de 2 appels simultanés.")
s = s.replace('  const rooms =\n    peopleVoiceAccountServerIds(\n      accountId\n    );', '  peopleScheduleCallPresence();\n  const rooms =\n    peopleVoiceAccountServerIds(\n      accountId\n    );')
s = s.replace('      peopleDmCallDeliverPendingForAccount(', '      peopleScheduleCallPresence();\n      peopleDmCallDeliverPendingForAccount(')
s = s.replace('Une seule session vocale People est autorisee\n          par compte, quel que soit l\'onglet utilise.', 'Deux sessions vocales People maximum par compte, tous onglets confondus.')
s = s.replace("Un appel qui sonne reserve deja l'unique place vocale.\n    On ne peut donc pas rejoindre un vocal serveur\n    pendant qu'un appel MP est en attente.", "Un appel sortant, même en attente, réserve une des deux places vocales.")
p.write_text(s, encoding='utf-8')

p = root / 'public/people-dm-calls.js'
s = p.read_text(encoding='utf-8')
end = s.index('/* ===== people-dm-calls-v2.js')
first, rest = s[:end], s[end:]
first = first.replace('(() => {', 'function createPeopleDmCallSlot(suffix = "") {', 1)
first = first.rstrip().removesuffix('})();') + '\n}\n'
first = re.sub(r'"(peopleDm[A-Z]\w*)"', r'"\1" + suffix', first)
# HTML lives inside a template literal; interpolate the same suffix for every ID.
first = re.sub(r'id="(peopleDm[A-Z]\w*)" \+ suffix', r'id="\1${suffix}"', first)
first = first.replace('let call = null;', 'let call = null;\n  let starting = false;')
first = first.replace('    return {\n      exists:', '    return {\n      callId: call?.id || "",\n      exists:', 1)
first = first.replace('    window.dispatchEvent(\n      new CustomEvent(\n        "people-dm-call-state",', '    window.dispatchEvent(\n      new CustomEvent(\n        "people-dm-call-slot-state",', 1)
first = first.replace('    if (call) {\n      return;\n    }\n\n    joinableCall =', '    if (call || starting) {\n      return;\n    }\n\n    joinableCall =', 1)
first = first.replace('    unlockCallAudio();\n\n    callButton.disabled =', '    starting = true;\n    unlockCallAudio();\n\n    callButton.disabled =', 1)
first = first.replace('      (response) => {\n        callButton.disabled =', '      (response) => {\n        starting = false;\n        callButton.disabled =', 1)
first = first.replace('    startCall\n  );', '    () => window.PeopleDmCalls.start()\n  );', 1)
first = first.replace('  socket.on(\n    "dm-call-incoming",\n    showIncoming\n  );', '')
first = first.replace('  window.PeopleDmCalls = {', '  const controller = {\n    start: startCall,\n    incoming: showIncoming,\n    available: () => !call && !starting,\n    show: showOverlay,')
first = first.replace('"Tu es déjà dans un vocal ou un appel"', '"Tu as atteint la limite de 2 appels simultanés"')
first = first.replace('  // === PEOPLE_DM_CALLS_V1_END ===', '''  if (suffix) {
    callButton.hidden = true;
    overlay.classList.add("people-dm-second-call");
    overlay.querySelector("section").setAttribute("aria-modal", "false");
  }
  return controller;
  // === PEOPLE_DM_CALLS_V1_END ===''')
manager = '''
(() => {
  const slots = [createPeopleDmCallSlot(), createPeopleDmCallSlot("Second")].filter(Boolean);
  if (!slots.length) return;
  const focused = () => {
    const name = document.getElementById("dmHeaderName")?.textContent?.trim().toLocaleLowerCase();
    return slots.find(slot => slot.getState().exists && slot.getState().username.toLocaleLowerCase() === name)
      || slots.find(slot => slot.getState().exists) || slots[0];
  };
  window.PeopleDmCalls = {
    getState: () => focused().getState(),
    getStates: () => slots.map(slot => slot.getState()),
    start() {
      const name = document.getElementById("dmHeaderName")?.textContent?.trim().toLocaleLowerCase();
      const existing = slots.find(slot => slot.getState().exists && slot.getState().username.toLocaleLowerCase() === name);
      if (existing) return existing.show();
      const free = slots.find(slot => slot.available());
      if (free) return free.start();
      window.alert("Tu as atteint la limite de 2 appels simultanés. Raccroche un appel pour continuer.");
    }
  };
  for (const method of ["toggleMute", "toggleCamera", "toggleScreen", "openEffects", "end"])
    window.PeopleDmCalls[method] = (...args) => focused()[method](...args);
  socket.on("dm-call-incoming", payload => {
    if (slots.some(slot => slot.getState().callId === String(payload.callId))) return;
    slots.find(slot => slot.available())?.incoming(payload);
  });
  window.addEventListener("people-dm-call-slot-state", () => {
    window.dispatchEvent(new CustomEvent("people-dm-call-state", { detail: window.PeopleDmCalls.getState() }));
  });
})();

'''
p.write_text(first + manager + rest, encoding='utf-8')
