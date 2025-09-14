// server.js - static file + WebSocket signaling server
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static client files from 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Map of rooms: roomId -> Map(clientId -> ws)
const rooms = new Map();

// Helper to send JSON messages
function send(ws, msg) {
  try { ws.send(JSON.stringify(msg)); } catch(e) {}
}

wss.on('connection', (ws) => {
  ws.id = Math.random().toString(36).substr(2, 9);
  ws.roomId = null;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch(e) { return; }
    const { type } = data;

    if (type === 'join') {
      const room = data.room || 'default';
      ws.roomId = room;
      if (!rooms.has(room)) rooms.set(room, new Map());
      const roomMap = rooms.get(room);

      // Tell new client about existing peers
      const existing = Array.from(roomMap.keys());
      send(ws, { type: 'welcome', id: ws.id, peers: existing });

      // Notify existing peers about new client
      for (const [peerId, peerWs] of roomMap.entries()) {
        send(peerWs, { type: 'new-peer', id: ws.id });
      }

      roomMap.set(ws.id, ws);
      console.log(`Client ${ws.id} joined ${room}`);
      return;
    }

    // Forward signaling messages
    if (['offer', 'answer', 'candidate'].includes(type)) {
      const { target } = data;
      const roomMap = rooms.get(ws.roomId);
      if (!roomMap) return;
      const targetWs = roomMap.get(target);
      if (!targetWs) return;
      send(targetWs, { ...data, from: ws.id });
      return;
    }

    if (type === 'leave') {
      ws.close();
      return;
    }
  });

  ws.on('close', () => {
    const room = ws.roomId;
    if (!room) return;
    const roomMap = rooms.get(room);
    if (!roomMap) return;
    roomMap.delete(ws.id);
    for (const [peerId, peerWs] of roomMap.entries()) {
      send(peerWs, { type: 'peer-left', id: ws.id });
    }
    if (roomMap.size === 0) rooms.delete(room);
    console.log(`Client ${ws.id} left ${room}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
