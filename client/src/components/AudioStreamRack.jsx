import { useEffect, useRef, useState } from 'react';
import { CollapseWideIcon, ExpandWideIcon, FullscreenIcon } from './Icons.jsx';

function getInitials(label = '') {
  const [first = '?', second = ''] = label.trim().split(/\s+/);
  return `${first[0] || ''}${second[0] || ''}`.toUpperCase() || '?';
}

function useAudioLevel(stream) {
  const [level, setLevel] = useState(0);
  const lastLevelRef = useRef(0);

  useEffect(() => {
    const hasAudioTrack = Boolean(stream?.getAudioTracks?.().length);

    if (!stream || !hasAudioTrack) {
      const resetFrame = window.requestAnimationFrame(() => {
        lastLevelRef.current = 0;
        setLevel(0);
      });
      return () => window.cancelAnimationFrame(resetFrame);
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      const resetFrame = window.requestAnimationFrame(() => {
        lastLevelRef.current = 0;
        setLevel(0);
      });
      return () => window.cancelAnimationFrame(resetFrame);
    }

    let animationFrameId = 0;
    const audioContext = new AudioContextClass();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.88;
    const data = new Uint8Array(analyser.fftSize);
    source.connect(analyser);

    const updateLevel = () => {
      analyser.getByteTimeDomainData(data);

      let sumSquares = 0;
      for (const value of data) {
        const normalized = (value - 128) / 128;
        sumSquares += normalized * normalized;
      }

      const rms = Math.sqrt(sumSquares / data.length);
      const rawLevel = Math.min(1, rms * 5.2);
      const targetLevel = rawLevel < 0.03 ? 0 : rawLevel;
      const smoothedLevel = (lastLevelRef.current * 0.76) + (targetLevel * 0.24);
      const nextLevel = smoothedLevel < 0.035 ? 0 : smoothedLevel;

      lastLevelRef.current = nextLevel;
      setLevel(nextLevel);
      animationFrameId = window.requestAnimationFrame(updateLevel);
    };

    void audioContext.resume().catch(() => {});
    updateLevel();

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close().catch(() => {});
      window.requestAnimationFrame(() => {
        lastLevelRef.current = 0;
        setLevel(0);
      });
    };
  }, [stream]);

  return level;
}

function AudioLevelMeter({ level }) {
  const bars = 8;
  const activeBars = Math.round(level * bars);

  return (
    <div aria-label={`Audio level ${Math.round(level * 100)} percent`} className="audio-meter" role="img">
      {Array.from({ length: bars }, (_, index) => (
        <span
          className={`audio-meter-bar ${index < activeBars ? 'active' : ''}`}
          key={index}
          style={{ height: `${30 + index * 8}%` }}
        />
      ))}
    </div>
  );
}

function PanelControls({ isExpanded, onToggleExpand, onToggleFullscreen }) {
  return (
    <div className="panel-zoom-controls">
      <button
        aria-label={isExpanded ? 'Reduce panel size' : 'Expand panel'}
        className="secondary-button icon-button control-icon"
        onClick={onToggleExpand}
        title={isExpanded ? 'Reduce' : 'Expand'}
        type="button"
      >
        {isExpanded ? <CollapseWideIcon /> : <ExpandWideIcon />}
      </button>
      <button
        aria-label="Fullscreen"
        className="secondary-button icon-button control-icon"
        onClick={onToggleFullscreen}
        title="Fullscreen"
        type="button"
      >
        <FullscreenIcon />
      </button>
    </div>
  );
}

function FeaturedTile({ entry }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const hasVideoTrack = (entry.stream?.getVideoTracks() || []).length > 0;
  const level = useAudioLevel(entry.stream);
  const isSpeaking = level > 0.12;

  useEffect(() => {
    const videoElement = videoRef.current;
    const audioElement = audioRef.current;

    if (videoElement) {
      videoElement.srcObject = hasVideoTrack && entry.stream ? entry.stream : null;

      if (hasVideoTrack && entry.stream) {
        void videoElement.play?.().catch(() => {});
      }
    }

    if (audioElement) {
      audioElement.srcObject = !hasVideoTrack && entry.stream ? entry.stream : null;

      if (!hasVideoTrack && entry.stream) {
        void audioElement.play?.().catch(() => {});
      }
    }

    return () => {
      if (videoElement) {
        videoElement.srcObject = null;
      }

      if (audioElement) {
        audioElement.srcObject = null;
      }
    };
  }, [entry.stream, hasVideoTrack]);

  return (
    <article className={`featured-share-tile ${isSpeaking ? 'speaking' : ''}`}>
      <div className="featured-share-surface">
        {hasVideoTrack ? (
          <video autoPlay muted={entry.muted} playsInline ref={videoRef} />
        ) : (
          <div className="media-placeholder featured-share-placeholder">
            <span className="media-avatar premium-avatar">{getInitials(entry.label)}</span>
          </div>
        )}
        {!hasVideoTrack && entry.stream ? <audio autoPlay muted={entry.muted} playsInline ref={audioRef} /> : null}
      </div>
      <div className="featured-share-footer">
        <div>
          <strong>{entry.label}</strong>
          <span>{entry.screenSharing ? 'Screen share' : entry.role}</span>
        </div>
        <div className="media-side-meta">
          <AudioLevelMeter level={level} />
          <span className="media-badge">{entry.screenSharing ? 'Screen live' : hasVideoTrack ? 'Video' : 'Audio'}</span>
        </div>
      </div>
    </article>
  );
}

function CompactPresenceCard({ entry }) {
  const level = useAudioLevel(entry.stream);
  const isSpeaking = level > 0.12;

  return (
    <article className={`presence-card ${isSpeaking ? 'speaking' : ''}`}>
      <span className={`presence-avatar premium-avatar ${isSpeaking ? 'active' : ''}`}>
        {getInitials(entry.label)}
      </span>
      <div className="presence-copy">
        <strong>{entry.label}</strong>
        <span>{entry.screenSharing ? 'Sharing' : entry.role}</span>
      </div>
      <span className={`presence-dot ${isSpeaking ? 'active' : ''}`} />
    </article>
  );
}

function StandardTile({ entry }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const hasVideoTrack = (entry.stream?.getVideoTracks() || []).length > 0;
  const level = useAudioLevel(entry.stream);
  const isSpeaking = level > 0.12;

  useEffect(() => {
    const videoElement = videoRef.current;
    const audioElement = audioRef.current;

    if (videoElement) {
      videoElement.srcObject = hasVideoTrack && entry.stream ? entry.stream : null;

      if (hasVideoTrack && entry.stream) {
        void videoElement.play?.().catch(() => {});
      }
    }

    if (audioElement) {
      audioElement.srcObject = !hasVideoTrack && entry.stream ? entry.stream : null;

      if (!hasVideoTrack && entry.stream) {
        void audioElement.play?.().catch(() => {});
      }
    }

    return () => {
      if (videoElement) {
        videoElement.srcObject = null;
      }

      if (audioElement) {
        audioElement.srcObject = null;
      }
    };
  }, [entry.stream, hasVideoTrack]);

  return (
    <article className={`media-tile ${hasVideoTrack ? 'video' : 'audio'} ${isSpeaking ? 'speaking' : ''}`}>
      <div className="media-surface">
        {hasVideoTrack ? (
          <video autoPlay muted={entry.muted} playsInline ref={videoRef} />
        ) : (
          <div className="media-placeholder">
            <span className="media-avatar premium-avatar">{getInitials(entry.label)}</span>
          </div>
        )}
        {!hasVideoTrack && entry.stream ? <audio autoPlay muted={entry.muted} playsInline ref={audioRef} /> : null}
      </div>
      <div className="media-caption media-caption-extended">
        <div>
          <strong>{entry.label}</strong>
          <span>{entry.role}</span>
        </div>
        <div className="media-side-meta">
          <AudioLevelMeter level={level} />
          <span className="media-badge">{entry.screenSharing ? 'Screen' : hasVideoTrack ? 'Video' : 'Audio'}</span>
        </div>
      </div>
    </article>
  );
}

function buildEntries({ localPreviewStream, localScreenSharing, localStream, participants, remoteStreams }) {
  const entries = [];

  if (localStream) {
    entries.push({
      id: localScreenSharing ? 'local-screen' : 'local',
      label: 'You',
      muted: true,
      role: localScreenSharing ? 'Screen share' : 'Local',
      screenSharing: localScreenSharing,
      stream: localStream,
    });
  }

  if (localScreenSharing && localPreviewStream) {
    entries.push({
      id: 'local-camera-preview',
      label: 'You',
      muted: true,
      role: 'Webcam',
      screenSharing: false,
      stream: localPreviewStream,
    });
  }

  for (const remoteStream of remoteStreams) {
    const participant = participants.find((entry) => entry.id === remoteStream.participantId);

    entries.push({
      id: remoteStream.participantId,
      label: participant?.name || 'Guest',
      muted: false,
      role: participant?.screenSharing ? 'Screen share' : 'Remote',
      screenSharing: Boolean(participant?.screenSharing),
      stream: remoteStream.stream,
    });
  }

  return entries;
}

function AudioStreamRack({
  isExpanded = false,
  localPreviewStream = null,
  localScreenSharing = false,
  localStream,
  mediaMode,
  onToggleExpand,
  onToggleFullscreen,
  participants,
  remoteStreams,
}) {
  const entries = buildEntries({
    localPreviewStream,
    localScreenSharing,
    localStream,
    participants,
    remoteStreams,
  });
  const liveCount = entries.length;
  const featuredEntry = entries.find((entry) => entry.screenSharing) || null;

  if (entries.length === 0) {
    return (
      <section className="card media-stage empty elevated-card">
        <div className="panel-head">
          <div className="heading-group">
            <span className="eyebrow">Stage</span>
            <h2>Waiting for stream</h2>
          </div>
          <div className="panel-head-actions">
            <span className="count-badge">{mediaMode === 'video' ? 'Video' : 'Voice'}</span>
            <PanelControls
              isExpanded={isExpanded}
              onToggleExpand={onToggleExpand}
              onToggleFullscreen={onToggleFullscreen}
            />
          </div>
        </div>
        <div className="stage-empty">
          <p className="muted">{mediaMode === 'video' ? 'Turn on mic or camera when ready' : 'Turn on mic to start talking'}</p>
        </div>
      </section>
    );
  }

  if (featuredEntry) {
    const audienceEntries = entries.filter((entry) => entry.id !== featuredEntry.id);

    return (
      <section className="card media-stage elevated-card share-priority-stage">
        <div className="panel-head">
          <div className="heading-group">
            <span className="eyebrow">Stage</span>
            <h2>Shared screen</h2>
          </div>
          <div className="panel-head-actions">
            <span className="count-badge">{liveCount}</span>
            <PanelControls
              isExpanded={isExpanded}
              onToggleExpand={onToggleExpand}
              onToggleFullscreen={onToggleFullscreen}
            />
          </div>
        </div>

        <FeaturedTile entry={featuredEntry} />

        {audienceEntries.length ? (
          <div className="presence-strip">
            {audienceEntries.map((entry) => (
              <CompactPresenceCard entry={entry} key={entry.id} />
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="card media-stage elevated-card">
      <div className="panel-head">
        <div className="heading-group">
          <span className="eyebrow">Stage</span>
          <h2>{mediaMode === 'video' ? 'Live media' : 'Live audio'}</h2>
        </div>
        <div className="panel-head-actions">
          <span className="count-badge">{liveCount}</span>
          <PanelControls
            isExpanded={isExpanded}
            onToggleExpand={onToggleExpand}
            onToggleFullscreen={onToggleFullscreen}
          />
        </div>
      </div>

      <div className="media-grid">
        {entries.map((entry) => (
          <StandardTile entry={entry} key={entry.id} />
        ))}
      </div>
    </section>
  );
}

export default AudioStreamRack;
