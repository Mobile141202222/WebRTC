import Peer from 'peerjs';

function buildPeerConfig() {
  const secure = import.meta.env.VITE_PEER_SECURE === 'true';

  return {
    debug: 1,
    host: import.meta.env.VITE_PEER_HOST || window.location.hostname,
    path: import.meta.env.VITE_PEER_PATH || '/peerjs',
    port: Number(import.meta.env.VITE_PEER_PORT || (secure ? 443 : 3001)),
    secure,
  };
}

function shouldInitiateCall(selfId, remoteId) {
  return selfId.localeCompare(remoteId) > 0;
}

export class VoiceEngine {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.calls = new Map();
    this.localParticipantId = '';
    this.localStream = null;
    this.peer = null;
    this.peerId = '';
  }

  async initialize({ participantId }) {
    if (this.peerId) {
      return this.peerId;
    }

    this.localParticipantId = participantId;

    const peer = new Peer(buildPeerConfig());
    this.peer = peer;

    peer.on('call', (incomingCall) => {
      void this.answerIncomingCall(incomingCall);
    });

    peer.on('disconnected', () => {
      this.callbacks.onStatusChange?.('Signaling disconnected. Retrying...');
      peer.reconnect();
    });

    peer.on('error', (error) => {
      this.callbacks.onError?.(error);
    });

    this.peerId = await new Promise((resolve, reject) => {
      const cleanup = () => {
        peer.off('error', handleError);
        peer.off('open', handleOpen);
      };

      const handleOpen = (nextPeerId) => {
        cleanup();
        this.callbacks.onStatusChange?.('PeerJS signaling ready.');
        resolve(nextPeerId);
      };

      const handleError = (error) => {
        cleanup();
        reject(error);
      };

      peer.on('open', handleOpen);
      peer.on('error', handleError);
    });

    return this.peerId;
  }

  async ensureLocalStream() {
    if (this.localStream) {
      return this.localStream;
    }

    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });

    return this.localStream;
  }

  async answerIncomingCall(call) {
    try {
      const stream = await this.ensureLocalStream();
      const remoteParticipantId = call.metadata?.participantId || call.peer;

      call.answer(stream);
      this.attachCall(remoteParticipantId, call);
      this.callbacks.onStatusChange?.('Voice bridge active.');
    } catch (error) {
      this.callbacks.onError?.(error);
    }
  }

  async syncParticipants(participants, selfParticipantId) {
    if (!this.peer || !this.peerId) {
      return;
    }

    const activeParticipants = new Set();

    for (const participant of participants) {
      if (participant.id === selfParticipantId || !participant.peerId) {
        continue;
      }

      activeParticipants.add(participant.id);

      if (this.calls.has(participant.id)) {
        continue;
      }

      if (!shouldInitiateCall(selfParticipantId, participant.id)) {
        continue;
      }

      try {
        const stream = await this.ensureLocalStream();
        const outgoingCall = this.peer.call(participant.peerId, stream, {
          metadata: {
            participantId: selfParticipantId,
          },
        });

        if (outgoingCall) {
          this.attachCall(participant.id, outgoingCall);
          this.callbacks.onStatusChange?.(`Voice linked with ${participant.name}.`);
        }
      } catch (error) {
        this.callbacks.onError?.(error);
      }
    }

    for (const [participantId, activeCall] of this.calls.entries()) {
      if (activeParticipants.has(participantId)) {
        continue;
      }

      activeCall.close();
      this.calls.delete(participantId);
    }
  }

  setMuted(muted) {
    if (!this.localStream) {
      return;
    }

    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }

    this.callbacks.onStatusChange?.(muted ? 'Microphone muted.' : 'Microphone live.');
  }

  destroy() {
    for (const activeCall of this.calls.values()) {
      activeCall.close();
    }

    this.calls.clear();

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
    }

    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
    }

    this.localStream = null;
    this.peer = null;
    this.peerId = '';
  }

  attachCall(participantId, call) {
    const currentCall = this.calls.get(participantId);

    if (currentCall && currentCall !== call) {
      currentCall.close();
    }

    this.calls.set(participantId, call);

    call.on('stream', (stream) => {
      this.callbacks.onRemoteStream?.({
        participantId,
        stream,
      });
    });

    call.on('close', () => {
      if (this.calls.get(participantId) === call) {
        this.calls.delete(participantId);
      }

      this.callbacks.onRemoteDisconnect?.(participantId);
    });

    call.on('error', (error) => {
      this.callbacks.onError?.(error);
    });
  }
}
