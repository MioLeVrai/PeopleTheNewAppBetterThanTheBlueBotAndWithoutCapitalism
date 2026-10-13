"use strict";
/* PEOPLE_STORIES_V1: authenticated, expiring, size- and duration-validated stories. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");
const runProbe = promisify(execFile);

module.exports = function registerPeopleStories({ app, io, getPool, sessionForRequest, findAccount, findAccountById, isDeleted, dataDir }) {
  const MAX_BYTES = 50 * 1024 * 1024;
  const MAX_PARTS = 10;
  const TTL = 24 * 60 * 60 * 1000;
  const storeDir = path.join(dataDir || __dirname, "people-stories");
  const indexPath = path.join(storeDir, "stories.json");
  const activeUploads = new Set();
  let local = [];
  let lastCleanup = 0;
  const types = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm" };
  const now = () => Date.now();
  const nameKey = x => String(x || "").trim().normalize("NFKC").toLocaleLowerCase("fr-FR");
  function validBuffer(buffer, type) {
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES || !types[type]) return false;
    if (type === "image/png") return buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
    if (type === "image/jpeg") return buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
    if (type === "image/gif") return /^GIF8[79]a$/.test(buffer.toString("ascii", 0, 6));
    if (type === "image/webp") return buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
    if (type === "video/webm") return buffer.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex"));
    if (type === "video/mp4") return buffer.length >= 16 && buffer.toString("ascii", 4, 8) === "ftyp";
    return false;
  }
  // Parse the MP4 movie header when ffprobe is not installed on Windows.
  function mp4Duration(buffer) {
    function search(start, end, depth) {
      if (depth > 5) return NaN;
      let p = start;
      while (p + 8 <= end) {
        let length = buffer.readUInt32BE(p), head = 8;
        const kind = buffer.toString("ascii", p + 4, p + 8);
        if (length === 1) { if (p + 16 > end) break; const wide = Number(buffer.readBigUInt64BE(p + 8)); if (!Number.isSafeInteger(wide)) break; length = wide; head = 16; }
        if (length === 0) length = end - p;
        if (length < head || p + length > end) break;
        if (kind === "mvhd") {
          const v = buffer[p + head]; const offset = p + head + (v === 1 ? 20 : 12);
          if (v === 1 && offset + 12 <= p + length) { const scale = buffer.readUInt32BE(offset); return scale ? Number(buffer.readBigUInt64BE(offset + 4)) / scale : NaN; }
          if (v === 0 && offset + 8 <= p + length) { const scale = buffer.readUInt32BE(offset); return scale ? buffer.readUInt32BE(offset + 4) / scale : NaN; }
        }
        if (["moov", "trak", "mdia"].includes(kind)) { const value = search(p + head, p + length, depth + 1); if (Number.isFinite(value)) return value; }
        p += length;
      }
      return NaN;
    }
    return search(0, buffer.length, 0);
  }
  function ebmlDuration(buffer) {
    // Duration (0x4489) is a float in seconds-of-timecode, usually scaled at 1ms.
    let scale = 1000000, duration = NaN;
    const limit = Math.min(buffer.length, 3 * 1024 * 1024);
    for (let i = 0; i < limit - 12; i++) {
      if (buffer[i] === 0x2a && buffer[i+1] === 0xd7 && buffer[i+2] === 0xb1) {
        const size = buffer[i+3] & 0x7f;
        if (size >= 1 && size <= 4 && i+4+size <= limit) { scale = 0; for (let k = 0; k < size; k++) scale = scale * 256 + buffer[i+4+k]; }
      }
      if (buffer[i] === 0x44 && buffer[i+1] === 0x89) {
        const size = buffer[i+2] & 0x7f;
        if (size === 4 && i+7 <= limit) duration = buffer.readFloatBE(i+3);
        if (size === 8 && i+11 <= limit) duration = buffer.readDoubleBE(i+3);
      }
    }
    return duration * scale / 1e9;
  }
  async function durationSeconds(data, type) {
    const suffix = types[type];
    const temp = path.join(os.tmpdir(), "people-story-" + crypto.randomUUID() + "." + suffix);
    try {
      await fs.promises.writeFile(temp, data, { flag: "wx" });
      const { stdout } = await runProbe("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", temp], { timeout: 10000, maxBuffer: 2048, windowsHide: true });
      const duration = Number(stdout.trim());
      if (Number.isFinite(duration)) return duration;
    } catch (_) { /* ffprobe optional; fallback below */ }
    finally { try { await fs.promises.unlink(temp); } catch (_) {} }
    return type === "video/mp4" ? mp4Duration(data) : ebmlDuration(data);
  }
  async function init() {
    fs.mkdirSync(storeDir, { recursive: true });
    const pool = getPool();
    if (pool) {
      await pool.query(`CREATE TABLE IF NOT EXISTS people_stories (
        id UUID PRIMARY KEY, account_id BIGINT NOT NULL REFERENCES people_accounts(id) ON DELETE CASCADE,
        mime_type VARCHAR(32) NOT NULL, media_data BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL
      )`);
      await pool.query("CREATE INDEX IF NOT EXISTS people_stories_active_idx ON people_stories(account_id, expires_at)");
    } else {
      try { const records = JSON.parse(fs.readFileSync(indexPath, "utf8")); local = Array.isArray(records) ? records : []; } catch (_) { local = []; }
    }
    await cleanup(true);
  }
  function writeLocal() {
    const temp = indexPath + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(local), "utf8");
    fs.renameSync(temp, indexPath);
  }
  async function cleanup(force = false) {
    if (!force && now() - lastCleanup < 60 * 1000) return;
    lastCleanup = now();
    const pool = getPool();
    if (pool) await pool.query("DELETE FROM people_stories WHERE expires_at <= NOW()");
    else {
      const expired = local.filter(x => Number(x.expiresAt) <= now());
      if (expired.length) {
        local = local.filter(x => Number(x.expiresAt) > now());
        writeLocal();
        expired.forEach(x => { try { fs.unlinkSync(path.join(storeDir, x.id + "." + types[x.mime])); } catch (_) {} });
      }
    }
  }
  async function parts(accountId) {
    await cleanup();
    const id = String(accountId);
    const pool = getPool();
    if (pool) {
      const result = await pool.query("SELECT id, mime_type, created_at, expires_at FROM people_stories WHERE account_id=$1 AND expires_at > NOW() ORDER BY created_at,id", [id]);
      return result.rows.map(x => ({ id: x.id, mime: x.mime_type, createdAt: new Date(x.created_at).toISOString(), expiresAt: new Date(x.expires_at).toISOString() }));
    }
    return local.filter(x => x.accountId === id && x.expiresAt > now()).sort((a,b)=> a.createdAt - b.createdAt).map(x => ({ id:x.id, mime:x.mime, createdAt: new Date(x.createdAt).toISOString(), expiresAt:new Date(x.expiresAt).toISOString() }));
  }
  async function getRecord(id, withData) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const pool = getPool();
    if (pool) {
      const row = (await pool.query(`SELECT id, account_id, mime_type, expires_at${withData ? ', media_data' : ''} FROM people_stories WHERE id=$1 AND expires_at > NOW()`, [id])).rows[0];
      if (!row) return null;
      return { id:row.id, accountId:String(row.account_id), mime:row.mime_type, data:row.media_data };
    }
    const record = local.find(x => x.id === id && x.expiresAt > now());
    if (!record) return null;
    const file = path.join(storeDir, record.id + "." + types[record.mime]);
    return { ...record, data:withData ? await fs.promises.readFile(file) : undefined };
  }
  function notify(username) { io.emit("people-stories-changed", { username }); }
  app.post("/api/stories/active", async (req, res) => {
    const session = sessionForRequest(req, res); if (!session) return;
    const requested = Array.isArray(req.body?.usernames) ? req.body.usernames.slice(0, 100) : [];
    const names = [...new Set(requested.filter(x => typeof x === "string" && x.length <= 64).map(x => x.trim()))];
    try {
      const pool = getPool();
      let users;
      if (pool) {
        const result = await pool.query(`SELECT a.username, COUNT(s.id)::int AS count FROM people_accounts a
          JOIN people_stories s ON s.account_id=a.id AND s.expires_at>NOW()
          WHERE a.username_key = ANY($1::text[]) AND a.password_hash NOT LIKE '!deleted:%'
          GROUP BY a.id,a.username`, [names.map(nameKey)]);
        users = result.rows.map(r => ({ username:r.username, count:r.count }));
      } else {
        users = [];
        for (const username of names) {
          const account = await findAccount(username);
          if (!account || isDeleted(account.id)) continue;
          const count = (await parts(account.id)).length;
          if (count) users.push({ username:account.username, count });
        }
      }
      res.setHeader("Cache-Control", "private, no-store"); res.json({ok:true, users});
    } catch (err) { console.error("[People stories/active]", err); res.status(500).json({ok:false,error:"Unable to load stories."}); }
  });
  app.get("/api/stories/:username", async (req,res) => {
    const session = sessionForRequest(req,res); if (!session) return;
    try {
      const account = await findAccount(req.params.username);
      if (!account || isDeleted(account.id)) return res.status(404).json({ok:false,error:"User not found."});
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ok:true, username:account.username, isSelf:String(account.id)===String(session.id), parts:await parts(account.id)});
    } catch (err) { console.error("[People stories/list]",err); res.status(500).json({ok:false,error:"Unable to load stories."}); }
  });
  app.post("/api/stories", require("express").raw({type: "application/octet-stream", limit:MAX_BYTES+1024}), async (req,res) => {
    const session = sessionForRequest(req,res); if (!session) return;
    const owner = String(session.id);
    if (activeUploads.has(owner)) return res.status(429).json({ok:false,error:"Please wait for the current story upload."});
    activeUploads.add(owner);
    try {
      const account = await findAccountById(owner);
      if (!account || isDeleted(owner)) return res.status(403).json({ok:false,error:"Account unavailable."});
      const mime = String(req.get("x-people-story-type") || "").toLowerCase();
      const buffer = req.body;
      if (!validBuffer(buffer,mime)) return res.status(400).json({ok:false,error:"Unsupported file or file larger than 50 MB."});
      if (mime.startsWith("video/")) {
        const duration = await durationSeconds(buffer,mime);
        if (!Number.isFinite(duration) || duration <= 0 || duration > 10) return res.status(400).json({ok:false,error:"Videos must be 10 seconds or shorter and have a readable duration (MP4/WebM)."});
      }
      let count = (await parts(owner)).length;
      if (count >= MAX_PARTS) return res.status(409).json({ok:false,error:"Maximum 10 story parts. Remove an existing part or wait for it to expire."});
      const id = crypto.randomUUID(), createdAt = now(), expiresAt = createdAt+TTL;
      if (getPool()) {
        const client = await getPool().connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["people-story:"+owner]);
          const row = await client.query("SELECT COUNT(*)::int AS count FROM people_stories WHERE account_id=$1 AND expires_at>NOW()", [owner]);
          count = row.rows[0].count;
          if (count >= MAX_PARTS) { await client.query("ROLLBACK"); return res.status(409).json({ok:false,error:"Maximum 10 story parts."}); }
          await client.query("INSERT INTO people_stories (id,account_id,mime_type,media_data,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6)", [id,owner,mime,buffer,new Date(createdAt),new Date(expiresAt)]);
          await client.query("COMMIT");
        } catch(err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
      } else {
        const file = path.join(storeDir,id+"."+types[mime]);
        await fs.promises.writeFile(file,buffer,{flag:"wx"});
        local.push({id,accountId:owner,mime,createdAt,expiresAt});
        try {writeLocal();} catch(err) {local=local.filter(x=>x.id!==id);fs.unlinkSync(file);throw err;}
      }
      notify(account.username);
      return res.status(201).json({ok:true,id,expiresAt:new Date(expiresAt).toISOString()});
    } catch(err) { if(err?.type==="entity.too.large") return res.status(413).json({ok:false,error:"Maximum 50 MB per story part."}); console.error("[People stories/upload]",err);return res.status(500).json({ok:false,error:"Story upload failed."}); }
    finally {activeUploads.delete(owner);}
  });
  app.delete("/api/stories/:id",async (req,res)=>{
    const session=sessionForRequest(req,res); if(!session)return;
    try {
      const record=await getRecord(String(req.params.id),false);
      if(!record)return res.status(404).json({ok:false,error:"Story not found."});
      if(record.accountId!==String(session.id))return res.status(403).json({ok:false,error:"Not your story."});
      if(getPool())await getPool().query("DELETE FROM people_stories WHERE id=$1 AND account_id=$2",[record.id,session.id]);
      else {local=local.filter(x=>x.id!==record.id);writeLocal();try{fs.unlinkSync(path.join(storeDir,record.id+"."+types[record.mime]));}catch(_){}}
      const account=await findAccountById(session.id); if(account)notify(account.username);
      res.json({ok:true});
    } catch(err){console.error("[People stories/delete]",err);res.status(500).json({ok:false,error:"Unable to delete story."});}
  });
  app.get("/api/stories/media/:id",async(req,res)=>{
    const session=sessionForRequest(req,res);if(!session)return;
    try {
      const record=await getRecord(String(req.params.id),true);
      if(!record)return res.status(404).end();
      const account=await findAccountById(record.accountId);
      if(!account || isDeleted(account.id)) return res.status(404).end();
      const data=record.data;
      res.setHeader("Content-Type",record.mime);
      res.setHeader("Cache-Control","private, no-store");
      res.setHeader("X-Content-Type-Options","nosniff");
      res.setHeader("Accept-Ranges","bytes");
      const header=String(req.headers.range||"");
      if(header) {
        const match=/^bytes=(\d*)-(\d*)$/.exec(header);
        if(!match || (!match[1] && !match[2]))return res.status(416).set("Content-Range",`bytes */${data.length}`).end();
        let start=match[1]?Number(match[1]):0, end=match[2]?Number(match[2]):data.length-1;
        if(!match[1])start=Math.max(0,data.length-end);
        if(!match[1])end=data.length-1;
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=data.length||start>end)return res.status(416).set("Content-Range",`bytes */${data.length}`).end();
        end=Math.min(end,data.length-1);
        res.status(206).set("Content-Range",`bytes ${start}-${end}/${data.length}`).set("Content-Length",String(end-start+1));
        return res.end(data.subarray(start,end+1));
      }
      res.setHeader("Content-Length",String(data.length));return res.end(data);
    } catch(err){console.error("[People stories/media]",err);res.status(500).end();}
  });
  return { init };
};
