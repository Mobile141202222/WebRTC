const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const cors = require('cors');
const { ExpressPeerServer } = require('peer');

const app = express();
const serverPort = Number(process.env.PORT || 3001);
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const peerPath = process.env.PEER_PATH || '/peerjs';
const buildDirectory = path.join(__dirname, 'client', 'dist');

app.use(
  cors({
    origin: clientOrigin,
    credentials: true,
  }),
);
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    peerPath,
    timestamp: new Date().toISOString(),
  });
});

const httpServer = app.listen(serverPort, () => {
  console.log(`Ephemeral chat server listening on http://localhost:${serverPort}`);
});

const peerServer = ExpressPeerServer(httpServer, {
  path: '/',
  generateClientId: () => randomUUID(),
});

peerServer.on('connection', (client) => {
  console.log(`Peer connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`Peer disconnected: ${client.getId()}`);
});

app.use(peerPath, peerServer);

if (fs.existsSync(buildDirectory)) {
  app.use(express.static(buildDirectory));

  app.use((_request, response) => {
    response.sendFile(path.join(buildDirectory, 'index.html'));
  });
}
