const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

// Run the real application against disposable data, leaving existing accounts intact.
async function main() {
  const root = path.resolve(__dirname, "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "people-calls-test-"));
  fs.copyFileSync(path.join(root, "server.js"), path.join(dir, "server.js"));
  const port = await new Promise(resolve => {
    const listener = net.createServer();
    listener.listen(0, "127.0.0.1", () => {
      const port = listener.address().port;
      listener.close(() => resolve(port));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  let child;
  let logs = "";
  const start = async () => {
    child = spawn(process.execPath, [path.join(dir, "server.js")], {
      cwd: root, windowsHide: true,
      env: { ...process.env, PORT: String(port), DATABASE_URL: "", NODE_ENV: "test", SESSION_SECRET: "test-secret-only", NODE_PATH: path.join(root, "node_modules") }
    });
    child.stdout.on("data", chunk => { logs += chunk; });
    child.stderr.on("data", chunk => { logs += chunk; });
    child.on("error", err => { logs += err.stack; });
    for (let i = 0; i < 600; i++) {
      try { if ((await fetch(base + "/health")).ok) return; } catch {}
      if (child.exitCode !== null) throw new Error(logs);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Startup timed out: " + logs);
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill();
    await exited;
  };
  const api = async (cookie, route, method = "GET", body, expected = 200) => {
    const response = await fetch(base + route, {
      method, headers: { Cookie: cookie || "", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
    return data;
  };
  const register = async username => {
    const response = await fetch(base + "/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "test-password-123" })
    });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return { cookie: response.headers.get("set-cookie").split(";")[0], ...data.user };
  };
  // Minimal Engine.IO polling client exercises authenticated presence without new dependencies.
  const connect = async cookie => {
    const query = "/socket.io/?EIO=4&transport=polling";
    const open = await (await fetch(base + query, { headers: { Cookie: cookie } })).text();
    const sid = JSON.parse(open.slice(1)).sid;
    const endpoint = base + query + "&sid=" + encodeURIComponent(sid);
    const send = async packet => {
      const response = await fetch(endpoint, { method: "POST", headers: { Cookie: cookie, "Content-Type": "text/plain" }, body: packet });
      assert.equal(response.status, 200);
    };
    await send("40");
    const packets = [];
    const poll = async () => {
      const response = await fetch(endpoint, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) });
      const data = await response.text();
      for (const packet of data.split("\x1e")) {
        if (packet === "2") await send("3");
        else packets.push(packet);
      }
    };
    await poll();
    await send('42["join"]');
    await poll();
    let nextAck = 0;
    const emit = async (event, payload) => {
      const id = ++nextAck;
      await send(`42${id}${JSON.stringify([event, payload])}`);
      for (let i = 0; i < 15; i++) {
        const packet = packets.find(packet => packet.startsWith(`43${id}[`));
        if (packet) return JSON.parse(packet.slice(String(id).length + 2))[0];
        await poll();
      }
      throw new Error("Socket acknowledgement missing: " + event);
    };
    return { send, poll, packets, emit };
  };
  try {
    await start();
    const a = await register("CallAlice");
    const b = await register("CallBob");
    const c = await register("CallCarol");
    const d = await register("CallDavid");
    const sa = await connect(a.cookie), sb = await connect(b.cookie), sc = await connect(c.cookie), sd = await connect(d.cookie);
    if (process.argv.includes("--browser")) {
      const browserUser = await register("BrowserCaller");
      const browserPeer = await register("BrowserVoicePeer");
      await require("./simultaneous-calls-browser.cjs")({ base, cookie: browserUser.cookie, peerCookie: browserPeer.cookie, targets: [b.username, c.username, d.username], answer: async (index, callId) => {
        assert.equal((await [sb, sc][index].emit("dm-call-answer", { callId })).ok, true);
      } });
    }
    const sa2 = await connect(a.cookie), sa3 = await connect(a.cookie);
    const server = (await api(a.cookie, "/api/servers", "POST", { name: "Calls server" }, 201)).server;
    const route = "/api/servers/" + server.id;
    const channels = (await api(a.cookie, route + "/channels")).channels;
    const v1 = channels.find(channel => channel.type === "voice");
    const v2 = (await api(a.cookie, route + "/channels", "POST", { type: "voice", name: "second" }, 201)).channel;
    const v3 = (await api(a.cookie, route + "/channels", "POST", { type: "voice", name: "third" }, 201)).channel;
    const barrier = async client => { assert.equal((await client.emit("server-select", { serverId: server.id })).ok, true); };
    for (const client of [sa, sa2, sa3]) await barrier(client);
    const voice = (client, channel) => client.emit("voice-join", { serverId: server.id, channelId: channel.id, muted: true });
    const lastPresence = client => {
      const packet = client.packets.findLast(packet => packet.startsWith('42["people-call-presence",'));
      assert(packet, "presence snapshot received");
      return JSON.parse(packet.slice(2))[1].find(state => state.accountId === a.id);
    };
    const hangup = async (client, callId) => { await client.send('42' + JSON.stringify(["dm-call-hangup", { callId }])); await barrier(client); };
    const cooldown = () => new Promise(resolve => setTimeout(resolve, 3050));
    const first = await sa.emit("dm-call-start", { targetUsername: b.username });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal((await sb.emit("dm-call-answer", { callId: first.callId })).ok, true);
    const pendingIncoming = await sd.emit("dm-call-start", { targetUsername: a.username });
    assert.equal(pendingIncoming.ok, true);
    await cooldown();
    const second = await sa.emit("dm-call-start", { targetUsername: c.username });
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal((await sc.emit("dm-call-answer", { callId: second.callId })).ok, true);
    const third = await sa2.emit("dm-call-start", { targetUsername: d.username });
    assert.equal(third.ok, false);
    assert.match(third.error, /limite de 2 appels/);
    assert.equal((await voice(sa3, v1)).code, "VOICE_LIMIT");
    const e = await register("CallErin");
    const se = await connect(e.cookie);
    const incoming = await se.emit("dm-call-start", { targetUsername: a.username });
    assert.equal(incoming.ok, false); assert.match(incoming.error, /limite de 2 appels/);
    assert.equal((await sa3.emit("dm-call-answer", { callId: pendingIncoming.callId })).reason, "limit", "answer also enforces global quota");
    await barrier(sa);
    assert.deepEqual(lastPresence(sa), { accountId: a.id, username: a.username, doubleCall: true });
    await sc.emit("server-select", { serverId: server.id });
    assert.deepEqual(lastPresence(sc), { accountId: a.id, username: a.username, doubleCall: true }, "Other users receive no peer identifiers in anonymous mode");
    await api("", "/api/call-privacy", "PUT", { showInterlocutors: true }, 401);
    await api(a.cookie, "/api/call-privacy", "PUT", { showInterlocutors: "yes" }, 400);
    await api(a.cookie, "/api/call-privacy", "PUT", { showInterlocutors: true });
    await barrier(sa2);
    assert.deepEqual(lastPresence(sa2).interlocutors.sort(), [b.username, c.username].sort());
    await sc.emit("server-select", { serverId: server.id });
    assert.deepEqual(lastPresence(sc).interlocutors.sort(), [b.username, c.username].sort());
    assert(sa2.packets.some(packet => packet.includes('"people-call-privacy",{"showInterlocutors":true}')));
    await api(a.cookie, "/api/call-privacy", "PUT", { showInterlocutors: false });
    await barrier(sa2);
    assert.deepEqual(lastPresence(sa2), { accountId: a.id, username: a.username, doubleCall: true });
    await sc.emit("server-select", { serverId: server.id });
    assert.deepEqual(lastPresence(sc), { accountId: a.id, username: a.username, doubleCall: true }, "Disabling privacy removes details from the next observer snapshot");
    await hangup(sa, first.callId);
    assert.equal(lastPresence(sa).doubleCall, false);
    assert.equal((await sa3.emit("dm-call-answer", { callId: pendingIncoming.callId })).ok, true, "pending incoming can be answered after freeing a slot");
    await hangup(sa3, pendingIncoming.callId);
    assert.equal((await voice(sa2, v1)).ok, true, "slot released: DM + server voice");
    assert.equal((await voice(sa3, v2)).code, "VOICE_LIMIT");
    await hangup(sa, second.callId);
    assert.equal((await voice(sa3, v2)).ok, true, "two server voices in one server");
    assert.equal((await voice(sa, v3)).code, "VOICE_LIMIT");
    assert.equal((await voice(sa3, v3)).ok, true, "switch at capacity replaces own voice");
    assert.equal((await voice(sa, v2)).code, "VOICE_LIMIT");
    await sa2.send('42["voice-leave"]'); await barrier(sa2);
    assert.equal(lastPresence(sa2).doubleCall, false);
    assert.equal((await voice(sa, v2)).ok, true, "server leave releases slot");
    await sa.send('42["voice-leave"]'); await barrier(sa);
    await sa3.send('42["voice-leave"]'); await barrier(sa3);
    await cooldown();
    const ringing = await sa.emit("dm-call-start", { targetUsername: d.username });
    assert.equal(ringing.ok, true);
    assert.equal((await voice(sa2, v1)).ok, true);
    assert.equal((await voice(sa3, v2)).code, "VOICE_LIMIT", "outgoing ringing reserves a slot");
    await hangup(sa, ringing.callId);
    assert.equal((await voice(sa3, v2)).ok, true);
    await sa3.send("41");
    await barrier(sa);
    assert.equal((await voice(sa, v2)).ok, true, "disconnect releases slot");
    const reconnect = await connect(a.cookie);
    await barrier(reconnect);
    assert.equal(lastPresence(reconnect).doubleCall, true, "new device receives current state");
    assert.equal((await voice(reconnect, v3)).code, "VOICE_LIMIT");
    assert.equal((await voice(sd, v1)).ok, false, "membership permissions preserved");
    for (const client of [sa, sa2, reconnect]) { await client.send('42["voice-leave"]'); await barrier(client); }
    const otherServer = (await api(a.cookie, "/api/servers", "POST", { name: "Other calls server" }, 201)).server;
    const otherVoice = (await api(a.cookie, `/api/servers/${otherServer.id}/channels`)).channels.find(channel => channel.type === "voice");
    assert.equal((await voice(sa, v1)).ok, true);
    assert.equal((await sa2.emit("voice-join", { serverId: otherServer.id, channelId: otherVoice.id, muted: true, camera: true, screen: true })).ok, true);
    assert.equal((await voice(reconnect, v2)).code, "VOICE_LIMIT", "Quota applies across different servers, camera and screen sharing");
    assert.equal((await sa.emit("dm-call-start", { targetUsername: b.username })).ok, false, "Two server voices also prevent a third DM");
    assert.equal((await voice(sa2, v2)).ok, true, "Moving between servers replaces the same slot at capacity");
    for (const client of [sa, sa2]) { await client.send('42["voice-leave"]'); await barrier(client); }
    const concurrent = await Promise.all([voice(sa, v1), voice(sa2, v2), voice(reconnect, v3)]);
    assert.equal(concurrent.filter(result => result.ok).length, 2, "Concurrent joins cannot overbook the account");
    assert.equal(concurrent.filter(result => result.code === "VOICE_LIMIT").length, 1);
    await api(a.cookie, "/api/call-privacy", "PUT", { showInterlocutors: true });
    await stop(); await start();
    assert.equal((await api(a.cookie, "/api/call-privacy")).showInterlocutors, true);
    console.log("PASS: two DMs, mixed calls, two server voices, cross-server camera/screen quota, concurrent joins, third rejected, ringing reservation, leave/disconnect release, switching, permissions, anonymous observer payloads, device synchronization, reconnect snapshot, preference restart persistence.");
  } finally {
    await stop();
    assert(path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith("people-calls-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
