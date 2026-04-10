function stopStream(stream) {
  if (!stream) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function serializeDescription(description) {
  if (!description) {
    return null;
  }

  return {
    sdp: description.sdp,
    type: description.type,
  };
}

function serializeCandidate(candidate) {
  if (!candidate) {
    return null;
  }

  return {
    candidate: candidate.candidate,
    sdpMLineIndex: candidate.sdpMLineIndex,
    sdpMid: candidate.sdpMid,
    usernameFragment: candidate.usernameFragment,
  };
}

export class DirectCallWebRtc {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.callId = '';
    this.localMediaMode = 'audio';
    this.localStream = null;
    this.pendingCandidates = [];
    this.peerConnection = null;
    this.remoteStream = null;
  }

  async prepareLocalStream({ mediaMode = 'audio' } = {}) {
    const needsVideo = mediaMode === 'video';
    const hasVideoTrack = (this.localStream?.getVideoTracks() || []).length > 0;

    if (
      this.localStream
      && this.localMediaMode === mediaMode
      && (!needsVideo || hasVideoTrack)
    ) {
      return this.localStream;
    }

    stopStream(this.localStream);

    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: needsVideo
        ? {
            facingMode: 'user',
            height: { ideal: 720 },
            width: { ideal: 1280 },
          }
        : false,
    });
    this.localMediaMode = mediaMode;
    this.callbacks.onLocalStream?.(this.localStream);
    this.callbacks.onLocalStateChange?.(this.getLocalState());
    return this.localStream;
  }

  getLocalState() {
    return {
      audioEnabled: (this.localStream?.getAudioTracks() || []).some((track) => track.enabled),
      videoEnabled: (this.localStream?.getVideoTracks() || []).some((track) => track.enabled),
      hasVideo: (this.localStream?.getVideoTracks() || []).length > 0,
    };
  }

  createRemoteStream() {
    this.remoteStream = new MediaStream();
    this.callbacks.onRemoteStream?.(this.remoteStream);
    return this.remoteStream;
  }

  async ensurePeerConnection({
    callId,
    iceServers,
    iceTransportPolicy = 'all',
    mediaMode,
  }) {
    await this.prepareLocalStream({ mediaMode });

    if (this.peerConnection && this.callId === callId) {
      return this.peerConnection;
    }

    this.resetPeerConnection();
    this.callId = callId;
    this.pendingCandidates = [];

    const connection = new RTCPeerConnection({
      iceCandidatePoolSize: 10,
      iceServers,
      iceTransportPolicy,
    });
    const remoteStream = this.createRemoteStream();

    connection.addEventListener('icecandidate', (event) => {
      if (!event.candidate) {
        return;
      }

      this.callbacks.onIceCandidate?.(serializeCandidate(event.candidate));
    });

    connection.addEventListener('track', (event) => {
      const targetStream = this.remoteStream || remoteStream;

      for (const track of event.streams?.[0]?.getTracks?.() || [event.track]) {
        if (!targetStream.getTracks().some((entry) => entry.id === track.id)) {
          targetStream.addTrack(track);
        }
      }

      this.callbacks.onRemoteStream?.(targetStream);
    });

    connection.addEventListener('connectionstatechange', () => {
      this.callbacks.onConnectionStateChange?.(connection.connectionState);
    });

    for (const track of this.localStream.getTracks()) {
      connection.addTrack(track, this.localStream);
    }

    this.peerConnection = connection;
    return connection;
  }

  async startOutgoingCall({ callId, iceServers, iceTransportPolicy, mediaMode }) {
    const connection = await this.ensurePeerConnection({
      callId,
      iceServers,
      iceTransportPolicy,
      mediaMode,
    });
    const offer = await connection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: mediaMode === 'video',
    });

    await connection.setLocalDescription(offer);
    return serializeDescription(connection.localDescription);
  }

  async createAnswerForOffer({
    callId,
    description,
    iceServers,
    iceTransportPolicy,
    mediaMode,
  }) {
    const connection = await this.ensurePeerConnection({
      callId,
      iceServers,
      iceTransportPolicy,
      mediaMode,
    });

    await connection.setRemoteDescription(description);
    await this.flushPendingCandidates();

    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    return serializeDescription(connection.localDescription);
  }

  async applyRemoteAnswer(description) {
    if (!this.peerConnection) {
      throw new Error('Peer connection is not ready');
    }

    await this.peerConnection.setRemoteDescription(description);
    await this.flushPendingCandidates();
  }

  async addIceCandidate(candidate) {
    if (!candidate) {
      return;
    }

    // Remote ICE can arrive before the offer/answer pair finishes setting descriptions.
    if (!this.peerConnection || !this.peerConnection.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }

    await this.peerConnection.addIceCandidate(candidate);
  }

  async flushPendingCandidates() {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) {
      return;
    }

    // Apply deferred candidates in order once the peer connection can consume them.
    while (this.pendingCandidates.length > 0) {
      const nextCandidate = this.pendingCandidates.shift();
      await this.peerConnection.addIceCandidate(nextCandidate);
    }
  }

  toggleAudio() {
    for (const track of this.localStream?.getAudioTracks() || []) {
      track.enabled = !track.enabled;
    }

    const nextState = this.getLocalState();
    this.callbacks.onLocalStateChange?.(nextState);
    return nextState;
  }

  toggleVideo() {
    for (const track of this.localStream?.getVideoTracks() || []) {
      track.enabled = !track.enabled;
    }

    const nextState = this.getLocalState();
    this.callbacks.onLocalStateChange?.(nextState);
    return nextState;
  }

  resetPeerConnection() {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.remoteStream = null;
    this.callbacks.onRemoteStream?.(null);
  }

  teardownCall({ releaseMedia = true } = {}) {
    this.resetPeerConnection();
    this.callId = '';
    this.pendingCandidates = [];

    if (releaseMedia) {
      stopStream(this.localStream);
      this.localStream = null;
      this.callbacks.onLocalStream?.(null);
    }
  }

  destroy() {
    this.teardownCall();
  }
}
