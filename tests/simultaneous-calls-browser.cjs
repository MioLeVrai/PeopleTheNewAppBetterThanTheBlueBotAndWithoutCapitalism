const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

module.exports = async ({ base, cookie, targets, answer }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "people-calls-browser-test-"));
  const browser = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", [
    "--headless=new", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"
  ], { windowsHide: true, stdio: "ignore" });
  let ws;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    const portFile = path.join(dir, "DevToolsActivePort");
    for (let i = 0; i < 300 && !fs.existsSync(portFile); i++) await delay(100);
    assert(fs.existsSync(portFile), "Headless browser failed to start");
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0];
    const debugTargets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    ws = new WebSocket(debugTargets.find(target => target.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let nextId = 0;
    const pending = new Map();
    const networkPending = new Set();
    const exceptions = [];
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method === "Network.requestWillBeSent" && ["Fetch", "XHR"].includes(message.params.type) && !message.params.request.url.includes("/socket.io/")) networkPending.add(message.params.requestId);
      if (["Network.loadingFinished", "Network.loadingFailed"].includes(message.method)) networkPending.delete(message.params.requestId);
      if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (!message.id) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    };
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async expression => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(100); }
      const state = await evaluate('({ dm: document.getElementById("dmHeaderName")?.textContent, calls: window.PeopleDmCalls?.getStates(), statuses: [...document.querySelectorAll(".people-dm-call-identity span")].map(n => n.textContent) })');
      throw new Error("Browser wait failed: " + expression + "\n" + JSON.stringify(state) + "\n" + exceptions.join("\n"));
    };
    await command("Runtime.enable");
    await command("Page.enable");
    await command("Network.enable");
    await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const split = cookie.indexOf("=");
    await command("Network.setCookie", { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base, httpOnly: true });
    await command("Page.navigate", { url: base });
    await waitFor('Boolean(window.PeopleServers && window.PeoplePresence && window.peopleSocket?.connected && document.getElementById("joinScreen").classList.contains("hidden"))');
    // Authentication starts asynchronous server/social loading which returns to
    // the friends view. Let those requests finish before opening the first DM.
    let idleSince = Date.now();
    for (let i = 0; i < 100; i++) {
      if (networkPending.size) idleSince = Date.now();
      if (Date.now() - idleSince >= 500) break;
      await delay(100);
    }
    assert.equal(networkPending.size, 0, "Initial application requests finished");
    assert.equal(await evaluate('window.PeopleDmCalls.getStates().length'), 2);
    const startCall = async username => {
      await evaluate(`window.PeopleSocialNavigation.openDm(${JSON.stringify(username)})`);
      await waitFor(`!document.getElementById("dmView").classList.contains("hidden") && document.getElementById("dmHeaderName").textContent.trim() === ${JSON.stringify(username)}`);
      await evaluate('window.PeopleDmCalls.start()');
    };
    await startCall(targets[0]);
    await waitFor('window.PeopleDmCalls.getStates().filter(s => s.exists).length === 1');
    await delay(3100);
    await startCall(targets[1]);
    await waitFor('window.PeopleDmCalls.getStates().filter(s => s.exists).length === 2');
    for (let i = 0; i < 2; i++) await answer(i, await evaluate(`window.PeopleDmCalls.getStates()[${i}].callId`));
    assert.equal(await evaluate('new Set(window.PeopleDmCalls.getStates().map(s => s.callId)).size'), 2);
    assert.equal(await evaluate('document.getElementById("peopleDmCallButtonSecond").getClientRects().length'), 0);
    assert.equal(await evaluate('document.getElementById("peopleDmCallOverlaySecond").getBoundingClientRect().right <= innerWidth'), true);
    const checkPanels = async () => {
      await waitFor('document.body.classList.contains("people-dm-dual-call")');
      await waitFor('["", "Second"].every(s => document.getElementById("peopleDmCallOverlay" + s).getBoundingClientRect().width > 0)');
      const geometry = await evaluate(`({ viewport: [innerWidth, innerHeight], panels: ["", "Second"].map(s => {
        const panel = document.getElementById("peopleDmCallOverlay" + s);
        const button = document.getElementById("peopleDmCallHangup" + s);
        const r = button.getBoundingClientRect();
        return { panel: panel.getBoundingClientRect().toJSON(), card: panel.querySelector("section").getBoundingClientRect().toJSON(), button: r.toJSON(), hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.outerHTML };
      }) })`);
      assert.equal(await evaluate(`(() => {
        const panels = ["", "Second"].map(s => document.getElementById("peopleDmCallOverlay" + s).querySelector(".people-dm-call-card").getBoundingClientRect());
        const inside = r => r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
        const [a, b] = panels;
        return panels.every(inside) && (a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
          && ["", "Second"].every(s => {
            const button = document.getElementById("peopleDmCallHangup" + s);
            const r = button.getBoundingClientRect();
            return inside(r) && button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
          });
      })()`), true, "Both panels and hangup controls are visible, reachable and do not overlap: " + JSON.stringify(geometry));
    };
    await checkPanels();
    await command("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
    await delay(200);
    await checkPanels();
    await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await delay(200);
    await checkPanels();
    await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(200);
    await checkPanels();
    await evaluate('window.PeopleDmCalls.toggleMute()');
    await waitFor('window.PeopleDmCalls.getStates()[1].muted === true');
    assert.equal(await evaluate('window.PeopleDmCalls.getStates()[0].muted'), false, "Muting the second call leaves the first microphone unchanged");
    await evaluate('window.PeopleDmCalls.toggleMute()');
    await waitFor('window.PeopleDmCalls.getStates()[1].muted === false');
    await startCall(targets[0]);
    await checkPanels();
    assert.equal(await evaluate('window.PeopleDmCalls.getState().username'), targets[0], "Global controls follow the selected conversation");
    const presenceText = 'document.querySelector(\'section[aria-label="Utilisateurs en double appel"]\').textContent';
    await waitFor(`${presenceText}.includes("BrowserCaller — En double appel")`);
    assert.equal(await evaluate(`${presenceText}.includes(" avec ")`), false, "Default privacy keeps interlocutors anonymous");
    await evaluate('document.getElementById("peopleSettingsButton").click()');
    const privacyInput = '[...document.querySelectorAll("#peopleSettingsModal label")].find(n => n.textContent.includes("double appel")).querySelector("input")';
    await waitFor(`!(${privacyInput}).disabled`);
    assert.equal(await evaluate(`(${privacyInput}).checked`), false);
    await evaluate(`(${privacyInput}).click()`);
    await waitFor(`${presenceText}.includes(${JSON.stringify(targets[0])}) && ${presenceText}.includes(${JSON.stringify(targets[1])})`);
    await waitFor(`!(${privacyInput}).disabled`);
    assert.equal(await evaluate('(async () => (await (await fetch("/api/call-privacy")).json()).showInterlocutors)()'), true);
    await evaluate(`(${privacyInput}).click()`);
    await waitFor(`!${presenceText}.includes(" avec ") && ${presenceText}.includes("BrowserCaller — En double appel")`);
    await waitFor(`!(${privacyInput}).disabled`);
    assert.equal(await evaluate('(async () => (await (await fetch("/api/call-privacy")).json()).showInterlocutors)()'), false);
    await evaluate('document.getElementById("peopleSettingsModal").classList.add("hidden")');
    await evaluate('window.alert = message => { window.lastCallAlert = message; }');
    await startCall(targets[2]);
    assert.match(await evaluate('window.lastCallAlert'), /limite de 2 appels/);
    await evaluate('document.getElementById("peopleDmCallHangupSecond").click()');
    await waitFor('window.PeopleDmCalls.getStates().filter(s => s.exists).length === 1');
    await waitFor('!document.body.classList.contains("people-dm-dual-call")');
    assert.equal(await evaluate('window.PeopleDmCalls.getStates()[0].username'), targets[0]);
    await delay(3100);
    await startCall(targets[2]);
    await waitFor('window.PeopleDmCalls.getStates().filter(s => s.exists).length === 2');
    await delay(1300);
    assert.equal(await evaluate('document.getElementById("peopleDmCallOverlaySecond").classList.contains("hidden")'), false);
    await checkPanels();
    await evaluate('document.getElementById("peopleDmCallHangupSecond").click(); document.getElementById("peopleDmCallHangup").click()');
    await waitFor('window.PeopleDmCalls.getStates().every(s => !s.exists)');
    assert.equal(await evaluate('Boolean([...document.querySelectorAll("#peopleSettingsModal label")].find(n => n.textContent.includes("double appel")))'), true);
    assert.deepEqual(exceptions, [], "Browser JavaScript errors");
    console.log("PASS: browser two accepted DM calls, non-overlapping desktop/mobile panels with reachable controls, privacy setting saves and anonymizes the double-call indicator, third-call message, independent hangup, slot reuse, no JavaScript errors.");
  } finally {
    ws?.close(); browser.kill(); await delay(1000);
    assert(path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith("people-calls-browser-test-"));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
};
