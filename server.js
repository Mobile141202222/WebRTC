const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const cors = require('cors');
const { ExpressPeerServer } = require('peer');
const { config } = require('./server/config');
const { createDirectCallServer } = require('./server/directCallServer');

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin is not allowed by CORS'));
    },
    credentials: true,
  }),
);
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({
    directCallWsPath: config.directCallWsPath,
    ok: true,
    peerPath: config.peerPath,
    timestamp: new Date().toISOString(),
  });
});

const httpServer = app.listen(config.serverPort, () => {
  console.log(`Ephemeral chat server listening on http://localhost:${config.serverPort}`);
});

createDirectCallServer({
  app,
  authConfig: config.auth,
  callConfig: config.calls,
  httpServer,
  pushConfig: config.push,
  turnConfig: config.turn,
  wsPath: config.directCallWsPath,
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

app.use(config.peerPath, peerServer);

if (fs.existsSync(config.buildDirectory)) {
  app.use(express.static(config.buildDirectory));

  app.use((_request, response) => {
    response.sendFile(path.join(config.buildDirectory, 'index.html'));
  });
}
