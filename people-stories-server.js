"use strict";
/* PEOPLE_STORIES_V1: authenticated, expiring, size- and duration-validated stories. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");
const runProbe = promisify(execFile);

module.exports = function registerPeopleStories({ app, io, getPool, sessionForRequest, findAccount, findAccountById, isDeleted, dataDir, mediaCrypto }) {
  const MAX_BYTES = 50 * 1024 * 1024;
  const MAX_PARTS = 10;
  const TTL = 24 * 60 * 60 * 1000;
  const storeDir = path.join(dataDir || __dirname, "people-stories");
  const indexPath = path.join(storeDir, "stories.json");
  if (!mediaCrypto || typeof mediaCrypto.sealBuffer !== "function") throw new Error("Media encryption unavailable");
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
  // Read the actual WebM Info elements. A raw byte scan can mistake video
  // payload for Duration and incorrectly reject otherwise valid recordings.
  function ebmlDuration(buffer) {
    const limit = Math.min(buffer.length, 128 * 1024);
    function vint(pos) {
      if (pos >= buffer.length) return null;
      let mask = 0x80, length = 1;
      while (!(buffer[pos] & mask)) { mask >>= 1; length++; if (length > 8) return null; }
      if (pos + length > buffer.length) return null;
      let size = BigInt(buffer[pos] & (mask - 1));
      for (let i = 1; i < length; i++) size = (size << 8n) | BigInt(buffer[pos + i]);
      if (size === (1n << BigInt(length * 7)) - 1n || size > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      return { length, size: Number(size) };
    }
    function idAt(pos) {
      if (pos >= buffer.length) return null;
      let mask = 0x80, length = 1;
      while (!(buffer[pos] & mask)) { mask >>= 1; length++; if (length > 4) return null; }
      if (pos + length > buffer.length) return null;
      return { length, id: buffer.toString("hex", pos, pos + length) };
    }
    for (let i = 0; i < limit - 12; i++) {
      if (buffer[i] !== 0x15 || buffer[i+1] !== 0x49 || buffer[i+2] !== 0xa9 || buffer[i+3] !== 0x66) continue;
      const header = vint(i + 4);
      if (!header || header.size > 8192) continue;
      const start = i + 4 + header.length, end = start + header.size;
      if (end > buffer.length) continue;
      let scale = 1000000, duration = NaN, position = start, valid = true;
      while (position < end) {
        const id = idAt(position);
        const size = id && vint(position + id.length);
        if (!id || !size) { valid = false; break; }
        const dataStart = position + id.length + size.length;
        const dataEnd = dataStart + size.size;
        if (dataEnd > end) { valid = false; break; }
        if (id.id === "2ad7b1" && size.size >= 1 && size.size <= 8) {
          let value = 0;
          for (let j = dataStart; j < dataEnd; j++) value = value * 256 + buffer[j];
          if (value > 0 && Number.isSafeInteger(value)) scale = value;
        }
        if (id.id === "4489") {
          if (size.size === 4) duration = buffer.readFloatBE(dataStart);
          else if (size.size === 8) duration = buffer.readDoubleBE(dataStart);
        }
        position = dataEnd;
      }
      if (valid && position === end && Number.isFinite(duration) && duration > 0 && scale > 0) {
        const seconds = duration * scale / 1e9;
        if (Number.isFinite(seconds) && seconds > 0) return seconds;
      }
    }
    return NaN;
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
      await pool.query(`CREATE TABLE IF NOT EXISTS people_story_views (
        part_id UUID NOT NULL REFERENCES people_stories(id) ON DELETE CASCADE,
        viewer_id BIGINT NOT NULL REFERENCES people_accounts(id) ON DELETE CASCADE,
        viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (part_id, viewer_id)
      )`);
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
  async function parts(accountId, viewerId = null) {
    await cleanup();
    const id = String(accountId);
    const pool = getPool();
    if (pool) {
      const result = await pool.query(`SELECT s.id, s.mime_type, s.created_at, s.expires_at,
        EXISTS(SELECT 1 FROM people_story_views v WHERE v.part_id=s.id AND v.viewer_id=$2) AS seen
        FROM people_stories s WHERE s.account_id=$1 AND s.expires_at > NOW()
        ORDER BY s.created_at,s.id`, [id, viewerId]);
      return result.rows.map(x => ({ id: x.id, mime: x.mime_type, createdAt: new Date(x.created_at).toISOString(), expiresAt: new Date(x.expires_at).toISOString(), seen: Boolean(x.seen) }));
    }
    return local.filter(x => x.accountId === id && x.expiresAt > now()).sort((a,b)=> a.createdAt - b.createdAt).map(x => ({ id:x.id, mime:x.mime, createdAt: new Date(x.createdAt).toISOString(), expiresAt:new Date(x.expiresAt).toISOString(), seen: viewerId !== null && (x.seenBy || []).includes(String(viewerId)) }));
  }
  async function getRecord(id, withData) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const pool = getPool();
    if (pool) {
      const row = (await pool.query(`SELECT id, account_id, mime_type, expires_at${withData ? ', media_data' : ''} FROM people_stories WHERE id=$1 AND expires_at > NOW()`, [id])).rows[0];
      if (!row) return null;
      return { id:row.id, accountId:String(row.account_id), mime:row.mime_type, data:withData ? mediaCrypto.openBuffer(row.media_data, "story", id) : undefined };
    }
    const record = local.find(x => x.id === id && x.expiresAt > now());
    if (!record) return null;
    const file = path.join(storeDir, record.id + "." + types[record.mime]);
    return { ...record, data:withData ? mediaCrypto.openBuffer(await fs.promises.readFile(file), "story", id) : undefined };
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
        const result = await pool.query(`SELECT a.username, COUNT(s.id)::int AS count,
          COUNT(s.id) FILTER (WHERE NOT EXISTS(
            SELECT 1 FROM people_story_views v WHERE v.part_id=s.id AND v.viewer_id=$2
          ))::int AS unseen_count
          FROM people_accounts a
          JOIN people_stories s ON s.account_id=a.id AND s.expires_at>NOW()
          WHERE a.username_key = ANY($1::text[]) AND a.password_hash NOT LIKE '!deleted:%'
          GROUP BY a.id,a.username`, [names.map(nameKey), String(session.id)]);
        users = result.rows.map(r => ({ username:r.username, count:r.count, unseenCount:r.unseen_count }));
      } else {
        users = [];
        for (const username of names) {
          const account = await findAccount(username);
          if (!account || isDeleted(account.id)) continue;
          const count = (await parts(account.id)).length;
          if (count) {
            const unseenCount = local.filter(x => x.accountId === String(account.id) && x.expiresAt > now() && !(x.seenBy || []).includes(String(session.id))).length;
            users.push({ username:account.username, count, unseenCount });
          }
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
      return res.json({ok:true, username:account.username, isSelf:String(account.id)===String(session.id), parts:await parts(account.id, session.id)});
    } catch (err) { console.error("[People stories/list]",err); res.status(500).json({ok:false,error:"Unable to load stories."}); }
  });
  // A story counts as seen only after the viewer actually opens that part.
  app.post("/api/stories/:id/view", async (req,res) => {
    const session = sessionForRequest(req,res); if (!session) return;
    try {
      const id = String(req.params.id);
      const record = await getRecord(id,false);
      if (!record) return res.status(404).json({ok:false,error:"Story not found."});
      const author = await findAccountById(record.accountId);
      if (!author || isDeleted(author.id)) return res.status(404).json({ok:false,error:"Story not found."});
      if (getPool()) await getPool().query("INSERT INTO people_story_views(part_id, viewer_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[id,String(session.id)]);
      else {
        const existing = local.find(part => part.id === id);
        if (!existing) return res.status(404).json({ok:false,error:"Story not found."});
        existing.seenBy ||= [];
        if (!existing.seenBy.includes(String(session.id))) { existing.seenBy.push(String(session.id)); writeLocal(); }
      }
      res.setHeader("Cache-Control","private, no-store");
      return res.json({ok:true});
    } catch(err) {console.error("[People stories/view]",err);return res.status(500).json({ok:false,error:"Unable to save story view."});}
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
          await client.query("INSERT INTO people_stories (id,account_id,mime_type,media_data,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6)", [id,owner,mime,mediaCrypto.sealBuffer(buffer, "story", id),new Date(createdAt),new Date(expiresAt)]);
          await client.query("COMMIT");
        } catch(err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
      } else {
        const file = path.join(storeDir,id+"."+types[mime]);
        await fs.promises.writeFile(file,mediaCrypto.sealBuffer(buffer,"story",id),{flag:"wx"});
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
  // Explicit opt-in: all currently active legacy story payloads are converted in place.
  async function migrate() {
    if (process.env.PEOPLE_MEDIA_MIGRATE !== "1") return;
    let converted=0;
    const pool=getPool();
    if (pool) {
      let after="00000000-0000-0000-0000-000000000000";
      for (;;) {
        const result=await pool.query("SELECT id,media_data FROM people_stories WHERE id>$1 ORDER BY id LIMIT 10",[after]);
        if(!result.rows.length)break;
        for(const row of result.rows) {
          after=String(row.id);
          if(mediaCrypto.isEncrypted(row.media_data)) {mediaCrypto.openBuffer(row.media_data,"story",after);continue;}
          const ciphertext=mediaCrypto.sealBuffer(row.media_data,"story",after);
          const updated=await pool.query("UPDATE people_stories SET media_data=$1 WHERE id=$2 AND media_data=$3",[ciphertext,after,row.media_data]);
          converted+=updated.rowCount;
        }
      }
    } else {
      for (const record of local) {
        const file=path.join(storeDir,record.id+"."+types[record.mime]);
        if(!fs.existsSync(file))continue;
        const raw=fs.readFileSync(file);
        if(mediaCrypto.isEncrypted(raw)) {mediaCrypto.openBuffer(raw,"story",record.id);continue;}
        const temp=file+"."+crypto.randomUUID()+".tmp";
        fs.writeFileSync(temp,mediaCrypto.sealBuffer(raw,"story",record.id),{flag:"wx",mode:0o600});
        fs.renameSync(temp,file);converted++;
      }
    }
    console.log(`[People stories] Secure storage migration: ${converted} stories converted.`);
  }
  return { init, migrate };
};
