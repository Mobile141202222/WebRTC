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
    this.mediaUnavailable = false;
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
      this.callbacks.onStatusChange?.('Signal retrying');
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
        this.callbacks.onStatusChange?.('Signal ready');
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

  async ensureLocalStream({ mediaMode = 'voice' } = {}) {
    if (this.localStream) {
      return this.localStream;
    }

    if (this.mediaUnavailable) {
      throw new Error('Media unavailable');
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mediaMode === 'video',
      });
    } catch (error) {
      if (mediaMode === 'video') {
        this.callbacks.onStatusChange?.('Camera unavailable');

        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      } else {
        this.mediaUnavailable = true;
        throw error;
      }
    }

    this.callbacks.onLocalStream?.(this.localStream);
    return this.localStream;
  }

  getLocalState() {
    const audioTracks = this.localStream?.getAudioTracks() || [];
    const videoTracks = this.localStream?.getVideoTracks() || [];

    return {
      audioEnabled: audioTracks.some((track) => track.enabled),
      hasVideoTrack: videoTracks.length > 0,
      videoEnabled: videoTracks.some((track) => track.enabled),
    };
  }

  async answerIncomingCall(call) {
    try {
      const stream = await this.ensureLocalStream({ mediaMode: 'voice' });
      const remoteParticipantId = call.metadata?.participantId || call.peer;

      call.answer(stream);
      this.attachCall(remoteParticipantId, call);
      this.callbacks.onStatusChange?.('Media live');
    } catch (error) {
      this.callbacks.onError?.(error);
    }
  }

  async syncParticipants(participants, selfParticipantId) {
    if (!this.peer || !this.peerId || this.mediaUnavailable) {
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
        const stream = await this.ensureLocalStream({
          mediaMode: participant.videoEnabled ? 'video' : 'voice',
        });
        const outgoingCall = this.peer.call(participant.peerId, stream, {
          metadata: {
            participantId: selfParticipantId,
          },
        });

        if (outgoingCall) {
          this.attachCall(participant.id, outgoingCall);
          this.callbacks.onStatusChange?.('Media live');
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
      return this.getLocalState();
    }

    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }

    this.callbacks.onStatusChange?.(muted ? 'Mic off' : 'Mic on');
    return this.getLocalState();
  }

  setCameraEnabled(enabled) {
    if (!this.localStream) {
      return false;
    }

    const videoTracks = this.localStream.getVideoTracks();

    if (videoTracks.length === 0) {
      return false;
    }

    for (const track of videoTracks) {
      track.enabled = enabled;
    }

    this.callbacks.onStatusChange?.(enabled ? 'Camera on' : 'Camera off');
    return this.getLocalState();
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

    this.callbacks.onLocalStream?.(null);
    this.localStream = null;
    this.mediaUnavailable = false;
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
