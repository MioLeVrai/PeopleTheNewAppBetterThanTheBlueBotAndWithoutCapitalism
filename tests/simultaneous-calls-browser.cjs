const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

module.exports = async ({ base, cookie, peerCookie, targets, answer }) => {
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
    const debugBrowser = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    ws = new WebSocket(debugBrowser.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let nextId = 0;
    let primarySession;
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
    const command = (method, params = {}, sessionId = primarySession) => new Promise((resolve, reject) => {
      if (method.startsWith("Target.") || method.startsWith("Browser.")) sessionId = undefined;
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const evaluate = async expression => {
      const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }).catch(error => { throw new Error(expression + "\n" + error.message); });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async expression => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(100); }
      const state = await evaluate('({ dm: document.getElementById("dmHeaderName")?.textContent, calls: window.PeopleDmCalls?.getStates(), statuses: [...document.querySelectorAll(".people-dm-call-identity span")].map(n => n.textContent) })');
      throw new Error("Browser wait failed: " + expression + "\n" + JSON.stringify(state) + "\n" + exceptions.join("\n"));
    };
    primarySession = (await command("Target.attachToTarget", { targetId: debugTargets.find(target => target.type === "page").id, flatten: true })).sessionId;
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
    await waitFor('window.PeopleDmCalls.getStates().every(s => s.phase === "active")');
    const checkBar = async (count = 2) => {
      await waitFor('document.querySelectorAll("#peopleCallBar button").length === ' + count);
      const geometry = await evaluate('({style:document.getElementById("peopleCallBar").outerHTML,css:["height","minHeight","maxHeight","padding","boxSizing","transform","zoom"].map(k=>[k,getComputedStyle(document.getElementById("peopleCallBar"))[k]]),bar:document.getElementById("peopleCallBar").getBoundingClientRect().toJSON(), viewport:[innerWidth,innerHeight], buttons:[...document.querySelectorAll("#peopleCallBar button")].map(b=>{ const r=b.getBoundingClientRect(); return {rect:r.toJSON(),hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.outerHTML}; })})');
      assert.equal(await evaluate('(() => { const r = document.getElementById("peopleCallBar").getBoundingClientRect(); return r.height === 40 && r.top === 0 && r.right <= innerWidth && [...document.querySelectorAll("#peopleCallBar button")].every(b => { const r = b.getBoundingClientRect(); return r.width > 40 && b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }); })()'), true, "Compact bar visible and clickable: " + JSON.stringify(geometry));
      assert.equal(await evaluate('[...document.querySelectorAll(".people-dm-call-overlay")].filter(p => p.getClientRects().length).length'), 0, "No automatic large call panels");
    };
    const initialIds = await evaluate('window.PeopleDmCalls.getStates().map(s => s.callId)');
    await checkBar();
    await evaluate('window.peopleSocket.disconnect(); window.peopleSocket.connect(); void 0');
    await waitFor('window.peopleSocket.connected && window.PeopleDmCalls.getStates().every(s => s.phase === "active") && document.querySelector(\'section[aria-label="Utilisateurs en double appel"]\').textContent.includes("BrowserCaller")');
    assert.deepEqual(await evaluate('window.PeopleDmCalls.getStates().map(s => s.callId)'), initialIds, "DM sessions rejoined after transport reconnect");
    for (const width of [320, 390, 1440]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: width === 320 ? 568 : 900, deviceScaleFactor: 1, mobile: width < 500 });
      await waitFor('parseInt(document.documentElement.style.getPropertyValue("--people-viewport-height")) === innerHeight');
      await delay(150);
      await checkBar();
      assert.equal(await evaluate('(() => { const r = document.getElementById("dmForm").getBoundingClientRect(); return r.height > 0 && r.bottom <= innerHeight && r.top >= 40; })()'), true, "Compact row keeps the message composer within the viewport: " + JSON.stringify(await evaluate('({width:innerWidth,height:innerHeight,nodes:["peopleAppShell","homeMain","dmView","dmForm"].map(id=>{const n=document.getElementById(id);return {id,rect:n?.getBoundingClientRect().toJSON(),height:n&&getComputedStyle(n).height,max:n&&getComputedStyle(n).maxHeight,transform:n&&getComputedStyle(n).transform};})})')));
      const shot = await command("Page.captureScreenshot", { format: "png" });
      const artifactDir = path.resolve(__dirname, "../patchcorrection/verification/compact-calls");
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.writeFileSync(path.join(artifactDir, "bar-" + width + ".png"), Buffer.from(shot.data, "base64"));
    }
    assert.equal(await evaluate('document.getElementById("peopleCallBar").textContent.includes(' + JSON.stringify(targets[0]) + ')'), false, "Names hidden by default");
    await evaluate('document.querySelectorAll("#peopleCallBar button")[1].click()');
    await waitFor('document.getElementById("peopleDmCallOverlaySecond").getClientRects().length > 0');
    assert.equal(await evaluate('document.getElementById("peopleDmCallOverlay").getClientRects().length'), 0);
    await evaluate('document.getElementById("peopleDmCallMuteSecond").click()');
    await waitFor('window.PeopleDmCalls.getStates()[1].muted');
    assert.equal(await evaluate('window.PeopleDmCalls.getStates()[0].muted'), false);
    await evaluate('document.querySelector("#peopleDmCallOverlaySecond .people-global-extra-controls button").click()');
    assert.equal(await evaluate('document.getElementById("peopleDmCallRemoteAudioSecond").muted'), true);
    await evaluate('window.PeopleCallBar.close()');
    await evaluate('document.querySelectorAll("#peopleCallBar button")[0].click()');
    await waitFor('Boolean(document.querySelector("#peopleDmCallOverlay .people-global-extra-controls button"))');
    await evaluate('document.querySelector("#peopleDmCallOverlay .people-global-extra-controls button").click()');
    await delay(1300);
    assert.equal(await evaluate('document.getElementById("peopleDmCallRemoteAudio").muted'), true, "First DM sound stays muted when existing local volume preferences refresh");
    await evaluate('window.PeopleCallBar.close()');
    // Real UI navigation and real authenticated server creation, not injected state.
    const fixture = await evaluate('(async () => { const server = (await (await fetch("/api/servers", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name:"Browser voice server"})})).json()).server; const channels = (await (await fetch("/api/servers/" + server.id + "/channels")).json()).channels; const second = (await (await fetch("/api/servers/" + server.id + "/channels", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({type:"voice",name:"Second voice"})})).json()).channel; await window.PeopleServers.refresh(); return {server, first:channels.find(c => c.type === "voice"), second, text:channels.find(c => c.type === "text")}; })()');
    const navigate = async () => {
      for (let i = 0; i < 2; i++) {
        await evaluate('document.getElementById("homeRailButton").click()');
        await checkBar();
        await evaluate('window.PeopleSocialNavigation.openDm(' + JSON.stringify(targets[i]) + ')');
        await checkBar();
        await evaluate('window.PeopleServers.openServer(' + JSON.stringify(fixture.server) + ')');
        await checkBar();
        await evaluate('window.PeopleServerRuntime.selectTextChannel(' + JSON.stringify(fixture.text.id) + ')');
        await checkBar();
        await evaluate('document.getElementById("peopleSettingsButton").click()');
        await checkBar();
        await evaluate('document.getElementById("peopleSettingsModal").classList.add("hidden")');
      }
    };
    await navigate();
    assert.deepEqual(await evaluate('window.PeopleDmCalls.getStates().map(s => s.callId)'), initialIds, "DM ids preserved across navigation");
    assert.equal(await evaluate('window.PeopleDmCalls.getStates().every(s => s.phase === "active")'), true);
    await evaluate('document.getElementById("peopleSettingsButton").click()');
    const privacyInput = '[...document.querySelectorAll("#peopleSettingsModal label")].find(n => n.textContent.includes("double appel")).querySelector("input")';
    await waitFor('!(' + privacyInput + ').disabled');
    await evaluate('(' + privacyInput + ').click()');
    await waitFor('document.getElementById("peopleCallBar").textContent.includes(' + JSON.stringify(targets[0]) + ')');
    await waitFor('!(' + privacyInput + ').disabled');
    await evaluate('(' + privacyInput + ').click()');
    await waitFor('!document.getElementById("peopleCallBar").textContent.includes(' + JSON.stringify(targets[0]) + ')');
    assert.equal(await evaluate('[...document.querySelectorAll("#peopleCallBar button")].some(b => b.title.includes(' + JSON.stringify(targets[0]) + '))'), false, "Titles anonymized too");
    await evaluate('document.getElementById("peopleSettingsModal").classList.add("hidden")');
    await evaluate('document.querySelectorAll("#peopleCallBar button")[1].click(); document.getElementById("peopleDmCallHangupSecond").click()');
    await waitFor('window.PeopleDmCalls.getStates().filter(s => s.exists).length === 1');
    await checkBar(1);
    assert.equal(await evaluate('window.PeopleDmCalls.getStates()[0].callId'), initialIds[0]);
    await evaluate('window.PeopleServers.openServer(' + JSON.stringify(fixture.server) + ')');
    await evaluate('window.PeopleServerRuntime.joinVoiceChannel(' + JSON.stringify(fixture.first.id) + ')');
    await waitFor('window.PeopleCallBar.getStates().filter(s => s.type === "server" && s.phase === "active").length === 1');
    await checkBar();
    await navigate();
    assert.equal(await evaluate('window.PeopleDmCalls.getStates()[0].callId'), initialIds[0], "Mixed calls preserved");
    await evaluate('window.PeopleCallBar.open(' + JSON.stringify(initialIds[0]) + '); document.getElementById("peopleDmCallHangup").click()');
    await waitFor('window.PeopleDmCalls.getStates().every(s => !s.exists)');
    await checkBar(1);
    await evaluate('window.PeopleServers.openServer(' + JSON.stringify(fixture.server) + ')');
    await evaluate('window.PeopleServerRuntime.joinVoiceChannel(' + JSON.stringify(fixture.second.id) + ')');
    await waitFor('window.PeopleCallBar.getStates().filter(s => s.type === "server" && s.phase === "active").length === 2');
    const invite = await evaluate('(async () => (await (await fetch("/api/servers/' + fixture.server.id + '/invite")).json()).invitePath)()');
    const joinResponse = await fetch(base + "/api/servers/invite/" + invite.split("/").pop() + "/join", { method: "POST", headers: { Cookie: peerCookie, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(joinResponse.status, 200);
    const context = await command("Target.createBrowserContext");
    const peerTarget = await command("Target.createTarget", { url: "about:blank", browserContextId: context.browserContextId });
    const peerSession = (await command("Target.attachToTarget", { targetId: peerTarget.targetId, flatten: true })).sessionId;
    const peerSplit = peerCookie.indexOf("=");
    await command("Network.enable", {}, peerSession);
    await command("Network.setCookie", { name: peerCookie.slice(0, peerSplit), value: peerCookie.slice(peerSplit + 1), url: base, httpOnly: true }, peerSession);
    await command("Page.navigate", { url: base }, peerSession);
    const peerEval = async expression => {
      const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, peerSession);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    for (let i = 0; i < 100 && !await peerEval('Boolean(window.PeopleServers && window.peopleSocket?.connected && document.getElementById("joinScreen").classList.contains("hidden"))'); i++) await delay(100);
    await delay(600);
    await peerEval('window.PeopleServers.openServer(' + JSON.stringify(fixture.server) + ')');
    assert.equal(await peerEval('window.PeopleServerRuntime.joinVoiceChannel(' + JSON.stringify(fixture.second.id) + ')'), true);
    await waitFor('[...document.querySelectorAll(".people-global-remote-media")].some(v => v.srcObject?.getAudioTracks().length && !v.paused && v.readyState >= 2)');
    for (let i = 0; i < 100 && !await peerEval('[...document.querySelectorAll("#audioContainer audio")].some(a => a.srcObject?.getAudioTracks().length && !a.paused && a.readyState >= 2)'); i++) await delay(100);
    assert.equal(await peerEval('[...document.querySelectorAll("#audioContainer audio")].some(a => a.srcObject?.getAudioTracks().length && !a.paused && a.readyState >= 2)'), true, "Secondary voice carries real bidirectional WebRTC audio");
    await checkBar();
    await navigate();
    assert.deepEqual(await evaluate('window.PeopleCallBar.getStates().map(s => s.channelId).sort()'), [fixture.first.id, fixture.second.id].sort(), "Two server sessions retained");
    await evaluate('window.PeopleCallBar.open("server-secondary"); document.querySelector("#peopleCallDetails button").click()');
    await waitFor('window.PeopleCallBar.getStates().find(s => s.id === "server-secondary").muted');
    assert.equal(await evaluate('window.PeopleCallBar.getStates().find(s => s.id === "server-primary").muted'), false, "Server microphones independent");
    await evaluate('document.querySelectorAll("#peopleCallDetails button")[1].click()');
    assert.equal(await evaluate('window.PeopleCallBar.getStates().find(s => s.id === "server-secondary").soundMuted'), true);
    assert.equal(await evaluate('[...document.querySelectorAll(".people-global-remote-media")].every(v => v.muted)'), true, "Sound control mutes actual remote media");
    await evaluate('window.PeopleCallBar.close(); window.peopleSocket.disconnect(); window.peopleSocket.connect(); void 0');
    await waitFor('window.peopleSocket.connected && window.PeopleCallBar.getStates().every(s => s.phase === "active")');
    await delay(800);
    await checkBar();
    // Reconnect the secondary transport through its normal Socket.IO lifecycle.
    await evaluate('window.PeopleCallBar.reconnectSecond()');
    await waitFor('window.PeopleCallBar.getStates().find(s => s.id === "server-secondary")?.phase === "active"');
    await waitFor('[...document.querySelectorAll(".people-global-remote-media")].some(v => v.srcObject?.getAudioTracks().length && !v.paused && v.readyState >= 2)');
    await checkBar();
    const other = await evaluate('(async () => { const server = (await (await fetch("/api/servers", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"Other browser server"})})).json()).server; const voice = (await (await fetch("/api/servers/" + server.id + "/channels")).json()).channels.find(c => c.type === "voice"); await window.PeopleServers.refresh(); return {server,voice}; })()');
    await evaluate('window.PeopleServers.openServer(' + JSON.stringify(other.server) + ')');
    await checkBar();
    await evaluate('(() => { window.PeopleCallBar.open("server-secondary"); const move = document.querySelector("#peopleCallDetails select"); move.value = ' + JSON.stringify(other.voice.id) + '; move.dispatchEvent(new Event("change")); })()');
    await waitFor('window.PeopleCallBar.getStates().find(s => s.id === "server-secondary").serverId === ' + JSON.stringify(other.server.id));
    assert.equal(await evaluate('window.PeopleCallBar.getStates().find(s => s.id === "server-primary").channelId'), fixture.first.id, "Moving the secondary call preserves the primary voice");
    await evaluate('window.PeopleCallBar.close()');
    await checkBar();
    await evaluate('window.PeopleServers.openServer(' + JSON.stringify(fixture.server) + ')');
    await evaluate('(() => { window.PeopleCallBar.open("server-secondary"); const move = document.querySelector("#peopleCallDetails select"); move.value = ' + JSON.stringify(fixture.second.id) + '; move.dispatchEvent(new Event("change")); })()');
    await waitFor('window.PeopleCallBar.getStates().find(s => s.id === "server-secondary").channelId === ' + JSON.stringify(fixture.second.id));
    await waitFor('[...document.querySelectorAll(".people-global-remote-media")].some(v => v.srcObject?.getAudioTracks().length && !v.paused && v.readyState >= 2)');
    await evaluate('window.PeopleCallBar.close()');
    await evaluate('window.PeopleCallBar.open("server-secondary"); document.querySelectorAll("#peopleCallDetails button")[4].click()');
    await checkBar(1);
    assert.equal(await evaluate('window.PeopleCallBar.getStates()[0].id'), "server-primary");
    await evaluate('window.PeopleCallBar.open("server-primary"); document.querySelectorAll("#peopleCallDetails button")[4].click()');
    await waitFor('window.PeopleCallBar.getStates().length === 0 && document.getElementById("peopleCallBar").hidden && !document.body.classList.contains("people-has-calls")');
    assert.deepEqual(exceptions, [], "Browser JavaScript errors");
    console.log("PASS: real browser compact global bar, two accepted DMs, mixed calls, two server voices in one tab, bidirectional WebRTC audio with another browser, navigation through DMs/servers/text/settings, cross-server move preserving the other call, 320/390/1440 widths and reachable composer, privacy including titles, independent microphones/sound/hangup, DM/primary/secondary reconnect, clean final hide, no JavaScript errors.");
  } finally {
    ws?.close(); browser.kill(); await delay(1000);
    assert(path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith("people-calls-browser-test-"));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
};
