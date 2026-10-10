const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

// Run the real application against disposable data, leaving existing accounts intact.
async function main() {
  const root = path.resolve(__dirname, "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "people-admin-test-"));
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
    const owner = await register("OwnerTest");
    const admin = await register("AdminTest");
    const member = await register("MemberTest");
    const outsider = await register("OutsideTest");
    const server = (await api(owner.cookie, "/api/servers", "POST", { name: "Test server" }, 201)).server;
    const route = "/api/servers/" + server.id;
    server.inviteCode = (await api(owner.cookie, route + "/invite")).invitePath.split("/").pop();
    for (const user of [admin, member]) await api(user.cookie, `/api/servers/invite/${server.inviteCode}/join`, "POST", {});
    const adminRole = (await api(owner.cookie, route + "/roles", "POST", { name: "Admin", color: "#FF3366", permissions: ["ADMINISTRATOR"] }, 201)).role;
    const memberRole = (await api(owner.cookie, route + "/roles", "POST", { name: "Member", color: "#33CCFF", permissions: [] }, 201)).role;
    await api(owner.cookie, `${route}/roles/${memberRole.id}`, "PATCH", { position: 1 });
    await api(owner.cookie, `${route}/members/${admin.id}/roles`, "PUT", { roleIds: [adminRole.id] });
    await api(owner.cookie, `${route}/members/${member.id}/roles`, "PUT", { roleIds: [memberRole.id] });
    const permissions = (await api(admin.cookie, route + "/permissions/me")).permissions;
    for (const permission of ["MANAGE_SERVER", "MANAGE_CHANNELS", "MANAGE_ROLES", "BAN_MEMBERS", "MOVE_MEMBERS"]) assert(permissions.names.includes(permission));
    await api(admin.cookie, route, "PATCH", { name: "Admin renamed server" });
    await api(member.cookie, route, "PATCH", { name: "Forbidden" }, 403);
    const channel = (await api(admin.cookie, route + "/channels", "POST", { type: "text", name: "admin-created" }, 201)).channel;
    await api(owner.cookie, `${route}/channels/${channel.id}/role-overrides/${adminRole.id}`, "PUT", { deny: ["VIEW_CHANNEL", "SEND_MESSAGES"], allow: [] });
    const effective = (await api(admin.cookie, `${route}/permissions/me?channelId=${channel.id}`)).permissions;
    assert(effective.names.includes("VIEW_CHANNEL"));
    assert(effective.names.includes("SEND_MESSAGES"));
    await api(admin.cookie, `${route}/channels/${channel.id}/role-overrides/${adminRole.id}`, "DELETE", undefined, 403);
    await api(owner.cookie, `${route}/channels/${channel.id}/role-overrides/${adminRole.id}`, "DELETE");
    await api(admin.cookie, `${route}/members/${owner.id}/roles`, "PUT", { roleIds: [memberRole.id] }, 400);
    await api(admin.cookie, `${route}/members/${admin.id}/roles`, "PUT", { roleIds: [] }, 400);
    await api(admin.cookie, `${route}/bans/${owner.id}`, "PUT", {}, 403);
    await api(admin.cookie, `${route}/members/${member.id}/voice`, "DELETE");
    const roster = (await api(admin.cookie, route + "/members")).members;
    assert.deepEqual(roster.find(user => user.id === admin.id).roleIds, [adminRole.id]);
    const profile = (await api(member.cookie, `/api/profile/AdminTest?serverId=${server.id}`)).profile;
    assert.equal(profile.serverMember.roles[0].name, "Admin");
    assert.equal(profile.serverMember.roleColor, "#FF3366");
    await api(outsider.cookie, `/api/profile/AdminTest?serverId=${server.id}`, "GET", undefined, 403);
    await api(member.cookie, route + "/audit", "GET", undefined, 403);
    assert((await api(admin.cookie, route + "/audit")).entries.some(entry => entry.actor_id === admin.id));
    if (process.argv.includes("--browser")) {
      const textChannel = (await api(member.cookie, route + "/channels")).channels.find(item => item.type === "text");
      await api(member.cookie, `${route}/channels/${textChannel.id}/messages`, "POST", { text: "Message de test modération" });
      await require("./browser-smoke.cjs")({ base, cookie: admin.cookie, server });
    }
    const socket = await connect(admin.cookie);
    const memberSocket = await connect(member.cookie);
    const voiceChannel = (await api(member.cookie, route + "/channels")).channels.find(channel => channel.type === "voice");
    assert.equal((await memberSocket.emit("server-select", { serverId: server.id })).ok, true);
    assert.equal((await memberSocket.emit("voice-join", { serverId: server.id, channelId: voiceChannel.id, muted: true })).ok, true);
    await api(admin.cookie, `${route}/members/${member.id}/voice`, "DELETE");
    await memberSocket.poll();
    assert(memberSocket.packets.some(packet => packet.includes("voice-disconnected-by-admin")));
    await api(member.cookie, `${route}/members/${admin.id}/voice`, "DELETE", undefined, 403);
    for (const status of ["online", "idle", "dnd", "invisible"]) {
      await api(admin.cookie, "/api/presence/me", "PUT", { status });
      const profile = (await api(member.cookie, "/api/profile/AdminTest")).profile;
      assert.equal(profile.status, status === "invisible" ? "offline" : status);
      assert.equal(profile.online, status !== "invisible");
    }
    await api(admin.cookie, "/api/presence/me", "PUT", { status: "invalid" }, 400);
    await api("", "/api/presence/me", "PUT", { status: "online" }, 401);
    await socket.poll();
    assert(socket.packets.some(packet => packet.includes("people-presence-changed") && packet.includes('"status":"offline"')));
    const invisible = (await api(member.cookie, route + "/members")).members.find(user => user.id === admin.id);
    assert.equal(invisible.online, false);
    assert.equal(invisible.connections, 0);
    await api(admin.cookie, `${route}/bans/${member.id}`, "PUT", { reason: "Test ban" });
    await api(member.cookie, `/api/servers/invite/${server.inviteCode}/join`, "POST", {}, 403);
    await api(admin.cookie, `${route}/bans/${member.id}`, "DELETE");
    await api(member.cookie, `/api/servers/invite/${server.inviteCode}/join`, "POST", {});
    await stop();
    await start();
    assert.equal((await api(admin.cookie, "/api/presence/me")).status, "invisible");
    assert.equal((await api(member.cookie, "/api/profile/AdminTest")).profile.status, "offline");
    assert((await api(admin.cookie, route + "/audit")).entries.length > 0);
    for (const asset of ["/manifest.webmanifest", "/people-app-192.png", "/people-app-512.png", "/people-presence.js", "/people-presence.css"]) assert.equal((await fetch(base + asset)).status, 200, asset);
    console.log("PASS: admin permissions, hierarchy, bans, audit, role profiles, live presence, invisibility, restart persistence, PWA assets.");
  } finally {
    await stop();
    // Only remove the unique disposable directory created by this test.
    assert(path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith("people-admin-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
