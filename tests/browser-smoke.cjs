const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

module.exports = async ({ base, cookie, server, dmTarget }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "people-browser-test-"));
  const browser = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"
  ], { windowsHide: true, stdio: "ignore" });
  let ws;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    const portFile = path.join(dir, "DevToolsActivePort");
    for (let i = 0; i < 300 && !fs.existsSync(portFile); i++) await delay(100);
    assert(fs.existsSync(portFile), "Headless browser failed to start");
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let nextId = 0;
    const pending = new Map();
    const exceptions = [];
    const networkPending = new Set();
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
      throw new Error("Browser wait failed: " + expression + "\n" + exceptions.join("\n"));
    };
    await command("Runtime.enable");
    await command("Page.enable");
    await command("Network.enable");
    await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const split = cookie.indexOf("=");
    await command("Network.setCookie", { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base, httpOnly: true });
    await command("Page.navigate", { url: base });
    await waitFor('Boolean(window.PeopleServers && window.PeoplePresence && window.peopleSocket?.connected && document.getElementById("joinScreen").classList.contains("hidden"))');
    let idleSince = Date.now();
    for (let i = 0; i < 100; i++) {
      if (networkPending.size) idleSince = Date.now();
      if (Date.now() - idleSince >= 500) break;
      await delay(100);
    }
    assert.equal(networkPending.size, 0, "Initial application requests finished");
    await evaluate(`window.PeopleServers.openServer(${JSON.stringify(server)})`);
    await waitFor('Boolean(document.querySelector(".online-user-info strong") && document.getElementById("peopleServerChannelTree").children.length)');
    const renderedDates = await evaluate(`(() => {
      const target = document.createElement("div"); target.id = "dateRenderFixture"; target.className = "messages"; document.body.append(target);
      const now = Date.now();
      addChatMessage({ username: "DateFixture", text: "Yesterday", time: new Date(now - 86400000).toISOString() }, target, false);
      addChatMessage({ username: "DateFixture", text: "Today one", time: new Date(now).toISOString() }, target, false);
      addChatMessage({ username: "DateFixture", text: "Today two", time: new Date(now + 60000).toISOString() }, target, false);
      const result = { days: target.querySelectorAll(".people-message-day").length, rows: target.querySelectorAll(".message").length, grouped: target.querySelectorAll(".people-grouped-message-line").length, times: [...target.querySelectorAll("time")].map(time => ({ text: time.textContent, dateTime: time.dateTime, title: time.title })) };
      target.remove(); return result;
    })()`);
    assert.equal(renderedDates.days, 2, "Server messages render a separator for each day");
    assert.equal(renderedDates.rows, 2, "Messages from the same sender are grouped within a day");
    assert.equal(renderedDates.grouped, 1, "A grouped server message retains its individual time");
    assert(renderedDates.times.every(time => time.text && time.dateTime && time.title), "Server message times include visible, machine-readable, and full-date values");
    await evaluate('window.PeopleSocialNavigation.setMode("server")');
    assert.equal(await evaluate('document.querySelector(".people-quick-launch").getClientRects().length'), 0, "Search stays hidden outside the friends menu");
    await evaluate('document.getElementById("friendsNavButton").click()');
    assert.equal(await evaluate('document.querySelector("#friendsView .people-quick-launch").getClientRects().length > 0'), true, "Search is available in the friends menu");
    await evaluate('document.querySelector(".people-quick-launch").click()');
    await waitFor('document.querySelector(".people-quick-dialog").open');
    assert.equal(await evaluate('document.activeElement.id'), "peopleQuickInput", "Search receives keyboard focus");
    assert.equal(await evaluate('document.querySelector(".people-quick-dialog").getBoundingClientRect().right <= window.innerWidth'), true, "Search fits mobile viewport");
    await evaluate('document.getElementById("peopleQuickInput").value = "inexistant-aucun-resultat"; document.getElementById("peopleQuickInput").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('document.querySelectorAll(".people-quick-result").length'), 0, "Search filters destinations");
    await evaluate('document.getElementById("peopleQuickInput").value = "friends"; document.getElementById("peopleQuickInput").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('document.querySelectorAll(".people-quick-result").length'), 1, "Search finds friends");
    await evaluate('document.getElementById("peopleQuickInput").dispatchEvent(new KeyboardEvent("keydown", {key:"Enter", bubbles:true}))');
    await waitFor('!document.querySelector(".people-quick-dialog").open && !document.getElementById("friendsView").classList.contains("hidden")');
    await evaluate(`window.PeopleServers.openServer(${JSON.stringify(server)})`);
    await waitFor('Boolean(document.querySelector("#peopleMain .people-message-unit"))');
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", {key:"k", ctrlKey:true, bubbles:true}))');
    assert.equal(await evaluate('document.querySelector(".people-quick-dialog").open'), true, "Ctrl K opens search");
    await evaluate('document.querySelector(".people-quick-head button").click()');
    await evaluate('document.getElementById("messageInput").value = "a".repeat(850); document.getElementById("messageInput").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('document.getElementById("messageInputCount").hidden'), false, "Character limit feedback appears");
    await evaluate('document.getElementById("messageInput").value = ""; document.getElementById("messageInput").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('document.getElementById("messageInputCount").hidden'), true, "Character feedback clears");
    await evaluate('const spacer = document.createElement("div"); spacer.id = "ergonomicsTestSpacer"; spacer.style.height = "2000px"; document.getElementById("messages").append(spacer); document.getElementById("messages").scrollTop = 0; document.getElementById("messages").dispatchEvent(new Event("scroll"))');
    assert.equal(await evaluate('document.querySelector("#messageForm .people-jump-latest").hidden'), false, "Return button appears while reading history");
    assert.equal(await evaluate('document.querySelector("#messageForm .people-jump-latest").getBoundingClientRect().height'), 28, "Return button stays compact on mobile");
    for (const width of [320, 390, 1440]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 500 });
      await delay(100);
      const geometry = await evaluate('(() => { const button=document.querySelector("#messageForm .people-jump-latest").getBoundingClientRect(), form=document.getElementById("messageForm").getBoundingClientRect(); return { centered:Math.abs(button.left + button.width / 2 - (form.left + form.width / 2)) < 2, compact:button.height === 28, clearOfComposer:button.bottom < form.top }; })()');
      assert.equal(geometry.centered && geometry.compact && geometry.clearOfComposer, true, `Server return button is centered, compact, and above the composer at ${width}px: ${JSON.stringify(geometry)}`);
    }
    await evaluate('document.querySelector("#messageForm .people-jump-latest").click()');
    assert.equal(await evaluate('document.querySelector("#messageForm .people-jump-latest").hidden'), true, "Return button scrolls to latest messages");
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#messageForm .people-jump-latest")).display'), "none", "Composer styles cannot reveal the hidden return button");
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#dmForm .people-jump-latest")).display'), "none", "DM return button stays hidden too");
    await evaluate('document.getElementById("ergonomicsTestSpacer").remove()');
    if (dmTarget) {
      await evaluate(`window.PeopleSocialNavigation.openDm(${JSON.stringify(dmTarget)})`);
      await waitFor(`!document.getElementById("dmView").classList.contains("hidden") && document.getElementById("dmHeaderName").textContent.trim() === ${JSON.stringify(dmTarget)}`);
      await evaluate('(() => { const spacer = document.createElement("div"); spacer.id = "dmErgonomicsTestSpacer"; spacer.style.height = "2000px"; document.getElementById("dmMessages").append(spacer); })()');
      for (const width of [320, 390, 1440]) {
        await command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 500 });
        await delay(100);
        await evaluate('(() => { const messages=document.getElementById("dmMessages"); messages.scrollTop = 0; messages.dispatchEvent(new Event("scroll")); })()');
        const geometry = await evaluate('(() => { const latest=document.querySelector("#dmForm .people-jump-latest"), messages=document.getElementById("dmMessages"), button=latest.getBoundingClientRect(), form=document.getElementById("dmForm").getBoundingClientRect(); return { visible:!latest.hidden, centered:Math.abs(button.left + button.width / 2 - (form.left + form.width / 2)) < 2, compact:button.height === 28, clearOfComposer:button.bottom < form.top, scrollHeight:messages.scrollHeight, scrollTop:messages.scrollTop, clientHeight:messages.clientHeight, button:button.toJSON(), form:form.toJSON() }; })()');
        assert.equal(geometry.visible && geometry.centered && geometry.compact && geometry.clearOfComposer, true, `DM return button is centered, compact, and above the composer at ${width}px: ${JSON.stringify(geometry)}`);
      }
      await evaluate('document.querySelector("#dmForm .people-jump-latest").click(); document.getElementById("dmErgonomicsTestSpacer").remove()');
    }
    await evaluate('document.getElementById("onlinePanelToggle").click()');
    assert.equal(await evaluate('getComputedStyle([...document.querySelectorAll(".online-user-info strong")].find(el => el.textContent.startsWith("AdminTest"))).color'), "rgb(255, 51, 102)");
    await waitFor('Boolean(document.querySelector("#peopleMain .people-message-unit"))');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#peopleMain .people-profile-name-trigger")).color'), "rgb(51, 204, 255)");
    await evaluate('document.querySelector("#peopleMain .people-message-unit").dispatchEvent(new PointerEvent("pointerdown", {bubbles:true, pointerType:"touch", clientX:160, clientY:200}))');
    await waitFor('Boolean(document.querySelector(".people-message-context-menu .delete"))');
    assert.equal(await evaluate('Boolean(document.querySelector(".people-message-context-menu .edit"))'), false, "Admin cannot edit another member's text");
    await evaluate('document.querySelector(".people-message-context-menu .delete").click()');
    await waitFor('!document.querySelector("#peopleMain .people-message-unit")');
    await evaluate('window.dispatchEvent(new CustomEvent("people-open-profile", {detail:{username:"AdminTest", serverId:' + JSON.stringify(server.id) + '}}))');
    await waitFor('Boolean(document.querySelector("#peopleProfileRoles .people-role-badge"))');
    assert((await evaluate('document.getElementById("peopleProfileRoles").textContent')).includes("Admin"));
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, "Mobile horizontal overflow");
    await evaluate('document.getElementById("profileModalClose").click(); document.getElementById("onlinePanelClose").click(); document.getElementById("serverSettingsButton").click()');
    await waitFor('Boolean(document.querySelector(".people-server-settings-overlay"))');
    const originalIcon = await evaluate(`(async () => (await (await fetch('/api/servers')).json()).servers.find(s => s.id === ${JSON.stringify(server.id)}).iconData)()`);
    await evaluate('(() => { const peer=document.createElement("iframe"); peer.id="iconPeerClient"; peer.style.cssText="position:fixed;left:-10000px;width:390px;height:844px"; peer.src=location.origin; document.body.append(peer); })()');
    const peerWindow = 'document.getElementById("iconPeerClient").contentWindow';
    await waitFor(peerWindow + '.peopleSocket?.connected && Boolean(' + peerWindow + '.PeopleServers)');
    await evaluate(`(async () => { const client=${peerWindow}; const server=(await (await client.fetch('/api/servers')).json()).servers.find(s => s.id === ${JSON.stringify(server.id)}); await client.PeopleServers.openServer(server); })()`);
    const fixtureIcons = [
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5yQAAAAASUVORK5CYII=",
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    ];
    const iconRoute = '/api/servers/' + server.id + '/icon';
    for (const encoded of fixtureIcons) {
      await evaluate(`(() => { const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(encoded)}), c => c.charCodeAt(0))], "icon.png", {type:"image/png"})); const input = document.querySelector('.people-server-settings-icon-column input[type=file]'); input.files = transfer.files; input.dispatchEvent(new Event('change')); })()`);
      await waitFor('document.querySelector(".people-server-settings-icon-state").textContent.includes("Preview")');
      const preview = await evaluate('document.querySelector(".people-server-settings-server-icon img").src');
      assert.notEqual(preview, await evaluate(`(async () => (await (await fetch('/api/servers')).json()).servers.find(s => s.id === ${JSON.stringify(server.id)}).iconData)()`), "Preview does not save before confirmation");
      await evaluate('document.querySelector(".people-server-settings-overview-card form").requestSubmit()');
      await waitFor('document.querySelector(".people-server-settings-save-state").textContent === "Changes saved."');
      assert.equal(await evaluate(`(async () => (await (await fetch('/api/servers')).json()).servers.find(s => s.id === ${JSON.stringify(server.id)}).iconData)()`), preview, "Save Changes persists the preview image");
      await waitFor('window.PeopleServers.getActiveServer().iconData === ' + JSON.stringify(preview));
      await waitFor(peerWindow + '.PeopleServers.getActiveServer()?.iconData === ' + JSON.stringify(preview));
      assert.equal(await evaluate(peerWindow + '.document.querySelector("#activeServerIcon img").src'), preview, "Another live client immediately displays the saved icon");
    }
    await evaluate(peerWindow + '.location.reload()');
    await waitFor(peerWindow + '.peopleSocket?.connected && Boolean(' + peerWindow + '.PeopleServers)');
    await waitFor(peerWindow + '.document.querySelector(' + JSON.stringify('.dynamic-server-button[data-server-id="' + server.id + '"] img') + ')?.src === ' + JSON.stringify(await evaluate('document.querySelector(".people-server-settings-server-icon img").src')));
    await evaluate('document.getElementById("iconPeerClient").remove()');
    await evaluate(`(async () => { const r = await fetch(${JSON.stringify(iconRoute)}, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({iconData:${JSON.stringify(originalIcon)}})}); if (!r.ok) throw new Error('Could not restore test fixture icon'); })()`);
    await evaluate('document.querySelector(".people-server-settings-close").click(); document.getElementById("serverSettingsButton").click()');
    await waitFor('Boolean(document.querySelector("[data-section=roles]"))');
    await evaluate('document.querySelector("[data-section=roles]").click()');
    await waitFor('Boolean(document.querySelector(".people-role-member-checks input"))');
    await evaluate('[...document.querySelectorAll(".people-server-settings-content button")].find(button => button.textContent.trim() === "Member").click()');
    await waitFor('Boolean(document.querySelector(".people-role-card:not([hidden]) .people-role-name-input:not([disabled])"))');
    await evaluate('(() => { const card=document.querySelector(".people-role-card:not([hidden])"); const name=card.querySelector(".people-role-name-input:not([disabled])"); name.value="Member Browser Saved"; name.dispatchEvent(new Event("input", {bubbles:true})); card.querySelector(".people-role-actions button").click(); })()');
    await waitFor('document.querySelector(".people-role-card:not([hidden]) .people-role-inline-state")?.textContent === "Saved."');
    assert.equal(await evaluate(`(async () => (await (await fetch('/api/servers/${server.id}/roles')).json()).roles.some(role => role.name === 'Member Browser Saved'))()`), true, "Save Changes persists role edits through the backend");
    await waitFor('Boolean([...document.querySelectorAll(".people-role-choices button")].find(button => button.textContent.trim() === "Member Browser Saved"))');
    await evaluate('[...document.querySelectorAll(".people-role-choices button")].find(button => button.textContent.trim() === "Member Browser Saved").click()');
    await waitFor('document.querySelector(".people-role-card:not([hidden]) .people-role-name-input")?.value === "Member Browser Saved"');
    assert.equal(await evaluate('document.querySelector(".people-server-settings-shell").getBoundingClientRect().width <= window.innerWidth'), true);
    const overflow = await evaluate('[...document.querySelectorAll(".people-server-settings-content input, .people-server-settings-content select, .people-server-settings-card")].filter(el => el.getBoundingClientRect().right > window.innerWidth + 2).map(el => el.className)');
    assert.deepEqual(overflow, [], "Mobile settings controls overflow");
    for (const width of [320, 390, 1440]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
      await delay(150);
      const overflow = await evaluate('[...document.querySelectorAll(".people-server-settings-content input, .people-server-settings-content select, .people-server-settings-card")].filter(el => el.getBoundingClientRect().right > window.innerWidth + 2).map(el => el.className)');
      assert.deepEqual(overflow, [], `Settings overflow at ${width}px`);
    }
    await evaluate('document.querySelector(".people-server-settings-close").click()');
    for (const width of [320, 768, 1280]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 780 });
      await evaluate('document.querySelector(".people-quick-launch").click()');
      assert.equal(await evaluate('document.querySelector(".people-quick-dialog").getBoundingClientRect().right <= window.innerWidth && document.querySelector(".people-quick-dialog").getBoundingClientRect().left >= 0'), true, `Search fits at ${width}px`);
      await evaluate('document.querySelector(".people-quick-head button").click()');
    }
    await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 460, deviceScaleFactor: 1, mobile: true });
    await delay(200);
    assert.equal(await evaluate('document.querySelector(".composer").getBoundingClientRect().bottom <= window.innerHeight + 2'), true, "Composer below keyboard viewport");
    assert.deepEqual(exceptions, [], "Browser JavaScript errors");
    console.log("PASS: mobile browser, role colors, profile badges, admin settings, keyboard viewport, no JavaScript errors.");
  } finally {
    ws?.close();
    browser.kill();
    await delay(1000);
    assert(path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith("people-browser-test-"));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
};
