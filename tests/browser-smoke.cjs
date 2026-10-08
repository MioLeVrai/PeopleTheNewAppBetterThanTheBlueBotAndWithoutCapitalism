const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

module.exports = async ({ base, cookie, server }) => {
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
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
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
    await evaluate(`window.PeopleServers.openServer(${JSON.stringify(server)})`);
    await waitFor('Boolean(document.querySelector(".online-user-info strong") && document.getElementById("peopleServerChannelTree").children.length)');
    await evaluate('document.getElementById("onlinePanelToggle").click()');
    assert.equal(await evaluate('getComputedStyle([...document.querySelectorAll(".online-user-info strong")].find(el => el.textContent.startsWith("AdminTest"))).color'), "rgb(255, 51, 102)");
    await waitFor('Boolean(document.querySelector("#peopleMain .people-message-unit"))');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#peopleMain .people-profile-name-trigger")).color'), "rgb(51, 204, 255)");
    await evaluate('document.querySelector("#peopleMain .people-message-unit").dispatchEvent(new PointerEvent("pointerdown", {bubbles:true, pointerType:"touch", clientX:160, clientY:200}))');
    await waitFor('Boolean(document.querySelector(".people-message-context-menu .delete"))');
    assert.equal(await evaluate('Boolean(document.querySelector(".people-message-context-menu .edit"))'), false, "Admin cannot edit another member's text");
    await evaluate('document.querySelector(".people-message-context-menu .delete").click()');
    await waitFor('!document.querySelector("#peopleMain .people-message-unit")');
    await evaluate('window.dispatchEvent(new CustomEvent("people-open-profile", {detail:{username:"AdminTest"}}))');
    await waitFor('Boolean(document.querySelector("#peopleProfileRoles .people-role-badge"))');
    assert((await evaluate('document.getElementById("peopleProfileRoles").textContent')).includes("Admin"));
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, "Mobile horizontal overflow");
    await evaluate('document.getElementById("profileModalClose").click(); document.getElementById("onlinePanelClose").click(); document.getElementById("serverSettingsButton").click()');
    await waitFor('Boolean(document.querySelector(".people-server-settings-overlay"))');
    await evaluate('document.querySelector("[data-section=roles]").click()');
    await waitFor('Boolean(document.querySelector(".people-role-member-checks input"))');
    assert.equal(await evaluate('document.querySelector(".people-server-settings-shell").getBoundingClientRect().width <= window.innerWidth'), true);
    const overflow = await evaluate('[...document.querySelectorAll(".people-server-settings-content input, .people-server-settings-content select, .people-server-settings-card")].filter(el => el.getBoundingClientRect().right > window.innerWidth + 2).map(el => el.className)');
    assert.deepEqual(overflow, [], "Mobile settings controls overflow");
    for (const width of [320, 768]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
      await delay(150);
      const overflow = await evaluate('[...document.querySelectorAll(".people-server-settings-content input, .people-server-settings-content select, .people-server-settings-card")].filter(el => el.getBoundingClientRect().right > window.innerWidth + 2).map(el => el.className)');
      assert.deepEqual(overflow, [], `Settings overflow at ${width}px`);
    }
    await evaluate('document.querySelector(".people-server-settings-close").click()');
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
