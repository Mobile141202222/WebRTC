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

function stopStream(stream) {
  if (!stream) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function buildParticipantMediaKey(participant) {
  return [
    participant.peerId || '',
    participant.videoEnabled ? 'video' : 'audio',
    participant.screenSharing ? 'screen' : 'camera',
  ].join(':');
}

export class VoiceEngine {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.calls = new Map();
    this.localParticipantId = '';
    this.localStream = null;
    this.localMediaMode = 'voice';
    this.mediaUnavailable = false;
    this.peer = null;
    this.peerId = '';
    this.preferredDevices = {
      audioInputId: '',
      videoInputId: '',
    };
    this.availableDevices = {
      audioInputs: [],
      videoInputs: [],
    };
    this.audioSourceStream = null;
    this.cameraSourceStream = null;
    this.screenStream = null;
    this.isScreenSharing = false;
    this.deviceChangeHandler = null;
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

    if (navigator.mediaDevices?.addEventListener) {
      this.deviceChangeHandler = () => {
        void this.refreshDevices();
      };
      navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeHandler);
    }

    await this.refreshDevices();
    return this.peerId;
  }

  supportsScreenShare() {
    return Boolean(navigator.mediaDevices?.getDisplayMedia);
  }

  getPreferredDevices() {
    return { ...this.preferredDevices };
  }

  getAvailableDevices() {
    return this.availableDevices;
  }

  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return this.availableDevices;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices
      .filter((device) => device.kind === 'audioinput')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`,
      }));
    const videoInputs = devices
      .filter((device) => device.kind === 'videoinput')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      }));

    this.availableDevices = {
      audioInputs,
      videoInputs,
    };

    if (
      this.preferredDevices.audioInputId
      && !audioInputs.some((device) => device.deviceId === this.preferredDevices.audioInputId)
    ) {
      this.preferredDevices.audioInputId = '';
    }

    if (
      this.preferredDevices.videoInputId
      && !videoInputs.some((device) => device.deviceId === this.preferredDevices.videoInputId)
    ) {
      this.preferredDevices.videoInputId = '';
    }

    this.callbacks.onDevicesChanged?.(this.availableDevices);
    return this.availableDevices;
  }

  buildAudioConstraint() {
    if (!this.preferredDevices.audioInputId) {
      return true;
    }

    return {
      deviceId: { exact: this.preferredDevices.audioInputId },
    };
  }

  buildVideoConstraint() {
    if (!this.preferredDevices.videoInputId) {
      return true;
    }

    return {
      deviceId: { exact: this.preferredDevices.videoInputId },
    };
  }

  async requestUserMedia(constraints, fallbackConstraints = null) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      if (!fallbackConstraints) {
        throw error;
      }

      return navigator.mediaDevices.getUserMedia(fallbackConstraints);
    }
  }

  async buildCompositeStream({ mediaMode = this.localMediaMode } = {}) {
    const audioSourceStream = await this.requestUserMedia(
      {
        audio: this.buildAudioConstraint(),
        video: false,
      },
      {
        audio: true,
        video: false,
      },
    );

    let cameraSourceStream = this.screenStream ? this.cameraSourceStream : null;
    let videoTrack = this.screenStream?.getVideoTracks()?.[0] || null;

    if (mediaMode === 'video' && !videoTrack) {
      cameraSourceStream = await this.requestUserMedia(
        {
          audio: false,
          video: this.buildVideoConstraint(),
        },
        {
          audio: false,
          video: true,
        },
      );
    }

    if (!videoTrack && cameraSourceStream) {
      videoTrack = cameraSourceStream.getVideoTracks()[0] || null;
    }

    const stream = new MediaStream();

    for (const track of audioSourceStream.getAudioTracks()) {
      stream.addTrack(track);
    }

    if (videoTrack) {
      stream.addTrack(videoTrack);
    }

    return {
      audioSourceStream,
      cameraSourceStream,
      stream,
    };
  }

  commitLocalMedia({ audioSourceStream, cameraSourceStream, stream }) {
    if (this.audioSourceStream && this.audioSourceStream !== audioSourceStream) {
      stopStream(this.audioSourceStream);
    }

    if (this.cameraSourceStream && this.cameraSourceStream !== cameraSourceStream) {
      stopStream(this.cameraSourceStream);
    }

    this.audioSourceStream = audioSourceStream;
    this.cameraSourceStream = cameraSourceStream;
    this.localStream = stream;
    this.callbacks.onLocalStream?.(stream);
    this.callbacks.onLocalPreviewStream?.(cameraSourceStream);
  }

  async ensureLocalStream({ mediaMode = 'voice' } = {}) {
    if (this.localStream) {
      return this.localStream;
    }

    if (this.mediaUnavailable) {
      throw new Error('Media unavailable');
    }

    this.localMediaMode = mediaMode;

    try {
      const nextMedia = await this.buildCompositeStream({ mediaMode });
      this.commitLocalMedia(nextMedia);
      await this.refreshDevices();
      return this.localStream;
    } catch (error) {
      if (mediaMode === 'video') {
        this.callbacks.onStatusChange?.('Camera unavailable');
        const nextMedia = await this.buildCompositeStream({ mediaMode: 'voice' });
        this.commitLocalMedia(nextMedia);
        await this.refreshDevices();
        return this.localStream;
      }

      this.mediaUnavailable = true;
      throw error;
    }
  }

  async applyDevicePreferences(preferences, { mediaMode = this.localMediaMode } = {}) {
    this.preferredDevices = {
      ...this.preferredDevices,
      ...preferences,
    };
    this.mediaUnavailable = false;
    this.localMediaMode = mediaMode;

    const nextMedia = await this.buildCompositeStream({ mediaMode });
    this.commitLocalMedia(nextMedia);
    await this.refreshDevices();
    return this.getLocalState();
  }

  async startScreenShare() {
    if (!this.supportsScreenShare()) {
      throw new Error('Screen share unavailable');
    }

    this.localMediaMode = 'video';

    if (!this.localStream) {
      await this.ensureLocalStream({ mediaMode: 'video' });
    }

    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    const screenTrack = screenStream.getVideoTracks()[0];

    if (!screenTrack) {
      throw new Error('Screen share unavailable');
    }

    screenTrack.onended = () => {
      void this.stopScreenShare();
      this.callbacks.onStatusChange?.('Screen share ended');
    };

    this.screenStream = screenStream;
    this.isScreenSharing = true;

    const nextMedia = await this.buildCompositeStream({ mediaMode: 'video' });
    this.commitLocalMedia(nextMedia);
    return this.getLocalState();
  }

  async stopScreenShare() {
    if (this.screenStream) {
      stopStream(this.screenStream);
      this.screenStream = null;
    }

    this.isScreenSharing = false;

    const nextMedia = await this.buildCompositeStream({ mediaMode: this.localMediaMode });
    this.commitLocalMedia(nextMedia);
    return this.getLocalState();
  }

  getLocalState() {
    const audioTracks = this.localStream?.getAudioTracks() || [];
    const videoTracks = this.localStream?.getVideoTracks() || [];

    return {
      audioEnabled: audioTracks.some((track) => track.enabled),
      cameraAvailable: this.availableDevices.videoInputs.length > 0,
      hasVideoTrack: videoTracks.length > 0,
      screenSharing: this.isScreenSharing,
      videoEnabled: videoTracks.some((track) => track.enabled),
      ...this.getPreferredDevices(),
    };
  }

  resetConnections() {
    for (const record of this.calls.values()) {
      record.call.close();
    }

    this.calls.clear();
  }

  async reconnectParticipants(participants, selfParticipantId) {
    this.resetConnections();
    await this.syncParticipants(participants, selfParticipantId);
  }

  async answerIncomingCall(call) {
    try {
      const stream = await this.ensureLocalStream({ mediaMode: this.localMediaMode });
      const remoteParticipantId = call.metadata?.participantId || call.peer;
      const mediaKey = call.metadata?.mediaKey || remoteParticipantId;

      call.answer(stream);
      this.attachCall(remoteParticipantId, call, mediaKey);
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
      const mediaKey = buildParticipantMediaKey(participant);
      const existingRecord = this.calls.get(participant.id);

      if (existingRecord && existingRecord.mediaKey !== mediaKey) {
        existingRecord.call.close();
        this.calls.delete(participant.id);
      }

      if (this.calls.has(participant.id)) {
        continue;
      }

      if (!shouldInitiateCall(selfParticipantId, participant.id)) {
        continue;
      }

      try {
        const stream = await this.ensureLocalStream({ mediaMode: this.localMediaMode });
        const outgoingCall = this.peer.call(participant.peerId, stream, {
          metadata: {
            mediaKey,
            mediaMode: this.localMediaMode,
            participantId: selfParticipantId,
          },
        });

        if (outgoingCall) {
          this.attachCall(participant.id, outgoingCall, mediaKey);
          this.callbacks.onStatusChange?.('Media live');
        }
      } catch (error) {
        this.callbacks.onError?.(error);
      }
    }

    for (const [participantId, record] of this.calls.entries()) {
      if (activeParticipants.has(participantId)) {
        continue;
      }

      record.call.close();
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
    if (!this.localStream || this.isScreenSharing) {
      return this.getLocalState();
    }

    const videoTracks = this.localStream.getVideoTracks();

    if (videoTracks.length === 0) {
      return this.getLocalState();
    }

    for (const track of videoTracks) {
      track.enabled = enabled;
    }

    this.callbacks.onStatusChange?.(enabled ? 'Camera on' : 'Camera off');
    return this.getLocalState();
  }

  destroy() {
    this.resetConnections();
    stopStream(this.audioSourceStream);
    stopStream(this.cameraSourceStream);
    stopStream(this.screenStream);

    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
    }

    if (this.deviceChangeHandler && navigator.mediaDevices?.removeEventListener) {
      navigator.mediaDevices.removeEventListener('devicechange', this.deviceChangeHandler);
    }

    this.callbacks.onLocalStream?.(null);
    this.callbacks.onLocalPreviewStream?.(null);
    this.audioSourceStream = null;
    this.cameraSourceStream = null;
    this.screenStream = null;
    this.localStream = null;
    this.mediaUnavailable = false;
    this.peer = null;
    this.peerId = '';
    this.isScreenSharing = false;
    this.deviceChangeHandler = null;
  }

  attachCall(participantId, call, mediaKey = participantId) {
    const currentRecord = this.calls.get(participantId);

    if (currentRecord && currentRecord.call !== call) {
      currentRecord.call.close();
    }

    this.calls.set(participantId, {
      call,
      mediaKey,
    });

    call.on('stream', (stream) => {
      this.callbacks.onRemoteStream?.({
        participantId,
        stream,
      });
    });

    call.on('close', () => {
      const current = this.calls.get(participantId);

      if (current?.call === call) {
        this.calls.delete(participantId);
      }

      this.callbacks.onRemoteDisconnect?.(participantId);
    });

    call.on('error', (error) => {
      this.callbacks.onError?.(error);
    });
  }
}
