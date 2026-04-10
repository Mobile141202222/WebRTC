# Ephemeral Voice & Text Chat

React frontend + Firebase Realtime Database + PeerJS signaling server for short-lived voice, video, screen share, and text rooms.

The app now also includes a dedicated `Direct Calling` flow for JWT-authenticated 1-to-1 calls with targeted signaling, optional TURN credentials, and PWA push registration hooks.

## Structure

- `client/` - React + Vite frontend
- `server.js` - Express server with PeerJS signaling and production static serving
- `server/` - direct-calling auth, rate limiting, presence store, TURN, and push helpers
- `client/src/services/RoomManager.js` - room, participant, and message lifecycle
- `client/src/providers/ChatProvider.jsx` - realtime message subscription with `onChildAdded`
- `client/src/services/VoiceEngine.js` - PeerJS/WebRTC media mesh management
- `client/src/services/DirectCallWebRtc.js` - 1-to-1 WebRTC offer/answer + ICE flow
- `client/src/services/DirectCallSocket.js` - JWT-authenticated direct-call signaling socket
- `client/src/pages/DirectCallPage.jsx` - direct-call UI and state machine
- `client/src/hooks/CleanupHook.js` - `onDisconnect()` registration for presence cleanup

## Local setup

1. Copy `client/.env.example` to `client/.env`
2. Fill in Firebase Realtime Database credentials
3. Copy `.env.example` to `.env` if you want to change the backend port, direct-call auth, TURN, or push settings
4. Install dependencies:

```powershell
npm.cmd install --cache .npm-cache
npm.cmd --prefix client install --cache ..\\.npm-cache
```

5. Run the app:

```powershell
npm.cmd run dev
```

Frontend defaults to `http://localhost:5173` and the PeerJS/Express server defaults to `http://localhost:3001`.

For browser push, also add `VITE_FIREBASE_VAPID_KEY` to `client/.env`.

Example direct-calling env values:

```powershell
AUTH_JWT_SECRET=replace-me
ALLOW_INSECURE_DEV_AUTH=false
TURN_URLS=turn:your-turn-host:3478?transport=udp,turns:your-turn-host:5349?transport=tcp
TURN_SHARED_SECRET=replace-me
FCM_PROJECT_ID=your-firebase-project
FCM_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## Workflow

1. Landing page creates a room ID or joins an existing invite
2. Host writes room metadata and participant presence into Firebase
3. Guests join the same room node and publish their peer IDs
4. Messages sync through Firebase in real time
5. Media connections are established directly between browsers through PeerJS/WebRTC
6. Explicit leave removes the participant and deletes the room if it becomes empty
7. Browser close uses Firebase `onDisconnect()` as a fallback cleanup path

## Direct calling flow

1. The browser opens `/direct-call` and authenticates with a JWT whose `sub` claim is used as the user ID
2. The direct-call WebSocket registers a user-to-socket mapping in memory
3. The caller sends `call-request` with the callee's user ID
4. The backend forwards `incoming-call` to the callee's live socket and can trigger FCM push if the user is backgrounded or offline
5. When the callee accepts, the frontend exchanges WebRTC `offer`, `answer`, and `ICE candidates` over the authenticated socket
6. TURN credentials are issued on demand from `/api/direct-call/turn-credentials`
7. `end-call`, disconnect cleanup, and call timeout release call state and presence bindings

## Render free plan

- The backend already exposes `GET /api/health`
- If your free Render service sleeps, use an external uptime monitor to call `/api/health` every 10-15 minutes
- A timer inside the same sleeping Render instance will not wake the service back up after Render suspends it

## Notes

- WebRTC exposes network information by design. Add a TURN server if you need stricter privacy or better NAT traversal.
- `onDisconnect()` is best-effort. For production, add a scheduled Firebase cleanup job for stale rooms older than 24 hours.
- React escapes rendered text, and the app also trims and sanitizes names and messages before storing them.
- The included push adapter uses Firebase Cloud Messaging for web clients. If you must support Safari/iOS home-screen web push, add a standards-based Web Push adapter in addition to FCM.
