const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 20000,
  pingInterval: 10000
});

app.use(express.static("public"));

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, app: "People" });
});

const users = new Map();
const voiceUsers = new Map();

function cleanUsername(value) {
  return String(value || "Invité").trim().slice(0, 24) || "Invité";
}

function emitVoiceState() {
  io.emit(
    "voice-state",
    [...voiceUsers.entries()].map(([id, user]) => ({
      id,
      username: user.username,
      muted: Boolean(user.muted)
    }))
  );
}

function leaveVoice(socket) {
  if (!voiceUsers.has(socket.id)) return;

  voiceUsers.delete(socket.id);
  socket.broadcast.emit("peer-left", socket.id);
  emitVoiceState();
}

io.on("connection", (socket) => {
  socket.on("keepalive", () => {
    // Petit message d'activité pour garder la connexion temps réel saine.
  });
  socket.on("join", ({ username, reconnect } = {}) => {
    const cleanName = cleanUsername(username);
    const wasKnown = users.has(socket.id);

    users.set(socket.id, cleanName);
    io.emit("user-count", users.size);

    if (!wasKnown && !reconnect) {
      io.emit("system-message", {
        text: `${cleanName} a rejoint le serveur`,
        time: Date.now()
      });
    }
  });

  socket.on("chat-message", ({ text } = {}) => {
    const username = users.get(socket.id);
    if (!username) return;

    const cleanText = String(text || "").trim().slice(0, 1000);
    if (!cleanText) return;

    io.emit("chat-message", {
      username,
      text: cleanText,
      time: Date.now()
    });
  });

  socket.on("voice-join", ({ muted } = {}) => {
    const username = users.get(socket.id);
    if (!username) return;

    const existingPeers = [...voiceUsers.entries()]
      .filter(([id]) => id !== socket.id)
      .map(([id, user]) => ({
        id,
        username: user.username,
        muted: Boolean(user.muted)
      }));

    voiceUsers.set(socket.id, {
      username,
      muted: Boolean(muted)
    });

    // Le nouvel arrivant initie les connexions vers les gens déjà présents.
    socket.emit("voice-peers", existingPeers);
    emitVoiceState();
  });

  socket.on("voice-leave", () => {
    leaveVoice(socket);
  });

  socket.on("voice-mute", ({ muted } = {}) => {
    const user = voiceUsers.get(socket.id);
    if (!user) return;

    user.muted = Boolean(muted);
    voiceUsers.set(socket.id, user);
    emitVoiceState();
  });

  socket.on("webrtc-offer", ({ target, sdp } = {}) => {
    if (!voiceUsers.has(socket.id) || !voiceUsers.has(target) || !sdp) return;

    io.to(target).emit("webrtc-offer", {
      from: socket.id,
      username: users.get(socket.id) || "Invité",
      sdp
    });
  });

  socket.on("webrtc-answer", ({ target, sdp } = {}) => {
    if (!voiceUsers.has(socket.id) || !voiceUsers.has(target) || !sdp) return;

    io.to(target).emit("webrtc-answer", {
      from: socket.id,
      sdp
    });
  });

  socket.on("webrtc-ice-candidate", ({ target, candidate } = {}) => {
    if (!voiceUsers.has(socket.id) || !voiceUsers.has(target) || !candidate) return;

    io.to(target).emit("webrtc-ice-candidate", {
      from: socket.id,
      candidate
    });
  });

  socket.on("voice-peer-reconnect", ({ target } = {}) => {
    if (!voiceUsers.has(socket.id) || !voiceUsers.has(target)) return;

    io.to(target).emit("voice-peer-reconnect", {
      from: socket.id
    });
  });

  socket.on("disconnect", () => {
    const username = users.get(socket.id);

    leaveVoice(socket);
    users.delete(socket.id);
    io.emit("user-count", users.size);

    if (username) {
      io.emit("system-message", {
        text: `${username} a quitté le serveur`,
        time: Date.now()
      });
    }
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`People lancé sur http://localhost:${PORT}`);
});
