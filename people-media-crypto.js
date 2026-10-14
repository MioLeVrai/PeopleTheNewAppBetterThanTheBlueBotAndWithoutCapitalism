"use strict";
/* PEOPLE_MEDIA_AT_REST_V1: authenticated storage encryption, domain-separated from messages. */
const crypto = require("node:crypto");
const MAGIC = Buffer.from("PEOPMED1", "ascii");
const PREFIX = "people-media:v1:";
const SALT = Buffer.from("People secure media 2026 / key separation", "utf8");
module.exports = function createPeopleMediaCrypto(master) {
  if (!Buffer.isBuffer(master) || master.length !== 32) throw new Error("Existing message master key is missing or invalid (32 bytes required).");
  const cache = new Map();
  const keyFor = kind => {
    if (!["story", "avatar", "server-icon"].includes(kind)) throw new Error("Unexpected media kind");
    if (!cache.has(kind)) cache.set(kind, Buffer.from(crypto.hkdfSync("sha256", master, SALT, Buffer.from("People/media/v1/" + kind), 32)));
    return cache.get(kind);
  };
  const aadFor = (kind, id) => Buffer.from("People/media/v1/" + kind + "/" + String(id), "utf8");
  const isEncrypted = data => Buffer.isBuffer(data) && data.length >= MAGIC.length && data.subarray(0,MAGIC.length).equals(MAGIC);
  function sealBuffer(data, kind, id) {
    if (!Buffer.isBuffer(data)) throw new TypeError("Media must be a Buffer");
    if (isEncrypted(data)) throw new Error("Attempt to encrypt an already encrypted media buffer");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", keyFor(kind), iv);
    cipher.setAAD(aadFor(kind,id));
    const payload = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([MAGIC,iv,cipher.getAuthTag(),payload]);
  }
  function openBuffer(data, kind, id) {
    if (!Buffer.isBuffer(data)) throw new TypeError("Stored media must be a Buffer");
    if (!isEncrypted(data)) return data; // backwards-compatible read; migration is explicit
    if (data.length < MAGIC.length + 12 + 16) throw new Error("Invalid encrypted media envelope");
    const iv=data.subarray(MAGIC.length,MAGIC.length+12);
    const tag=data.subarray(MAGIC.length+12,MAGIC.length+28);
    const ciphertext=data.subarray(MAGIC.length+28);
    const decipher=crypto.createDecipheriv("aes-256-gcm",keyFor(kind),iv);
    decipher.setAAD(aadFor(kind,id));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext),decipher.final()]);
  }
  function sealText(value,kind,id) {
    if (typeof value !== "string") throw new TypeError("Media text must be a string");
    if (value.startsWith(PREFIX)) throw new Error("Attempt to encrypt already encrypted media text");
    return PREFIX + sealBuffer(Buffer.from(value,"utf8"),kind,id).toString("base64url");
  }
  function openText(value,kind,id) {
    if (value === null || value === undefined || value === "") return value;
    if (typeof value !== "string" || !value.startsWith(PREFIX)) return value; // legacy
    const encoded=value.slice(PREFIX.length);
    const packed=Buffer.from(encoded,"base64url");
    if (!isEncrypted(packed)) throw new Error("Invalid encrypted media text");
    return openBuffer(packed,kind,id).toString("utf8");
  }
  return {sealBuffer,openBuffer,isEncrypted,sealText,openText,isEncryptedText:value=>typeof value==="string" && value.startsWith(PREFIX)};
};
