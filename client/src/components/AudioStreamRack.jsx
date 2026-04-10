import { useEffect, useRef, useState } from 'react';
import { CollapseWideIcon, ExpandWideIcon, FullscreenIcon, MicOffIcon } from './Icons.jsx';

function getInitials(label = '') {
  const [first = '?', second = ''] = label.trim().split(/\s+/);
  return `${first[0] || ''}${second[0] || ''}`.toUpperCase() || '?';
}

function getScreenTrack(videoTracks, prefersScreen = false) {
  if (!videoTracks.length) {
    return null;
  }

  const explicitScreenTrack = videoTracks.find((track) => Boolean(track.getSettings?.().displaySurface));

  if (explicitScreenTrack) {
    return explicitScreenTrack;
  }

  if (prefersScreen && videoTracks.length > 1) {
    return videoTracks[videoTracks.length - 1];
  }

  return null;
}

function buildDisplayStream({ audioTracks = [], videoTrack = null }) {
  const stream = new MediaStream();

  if (videoTrack) {
    stream.addTrack(videoTrack);
  }

  for (const track of audioTracks) {
    stream.addTrack(track);
  }

  return stream;
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

function MediaTile({ compact = false, entry, featured = false }) {
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

  const cardClass = featured
    ? `featured-share-tile ${isSpeaking ? 'speaking' : ''}`
    : `media-tile ${compact ? 'compact' : ''} ${hasVideoTrack ? 'video' : 'audio'} ${isSpeaking ? 'speaking' : ''}`;
  const surfaceClass = featured ? 'featured-share-surface' : 'media-surface';
  const placeholderClass = featured
    ? 'media-placeholder featured-share-placeholder'
    : 'media-placeholder';

  return (
    <article className={cardClass}>
      <div className={surfaceClass}>
        {hasVideoTrack ? (
          <video autoPlay muted={entry.muted} playsInline ref={videoRef} />
        ) : (
          <div className={placeholderClass}>
            <span className="media-avatar premium-avatar">{getInitials(entry.label)}</span>
          </div>
        )}
        {!hasVideoTrack && entry.stream ? <audio autoPlay muted={entry.muted} playsInline ref={audioRef} /> : null}
      </div>
      <div className={featured ? 'featured-share-footer' : 'media-caption media-caption-extended'}>
        <div>
          <strong>{entry.label}</strong>
          <span>{entry.screenSharing ? 'Screen share' : entry.role}</span>
        </div>
        <div className="media-side-meta">
          <AudioLevelMeter level={level} />
          {!entry.screenSharing && entry.audioEnabled === false ? (
            <div title="Muted" style={{ display: 'grid', placeItems: 'center', background: 'var(--danger-surface)', color: 'var(--danger-text)', borderRadius: '50%', width: '22px', height: '22px', border: '1px solid currentColor' }}>
              <MicOffIcon style={{ width: '12px', height: '12px' }} />
            </div>
          ) : null}
          <span className="media-badge">{entry.screenSharing ? 'Screen live' : hasVideoTrack ? 'Video' : 'Audio'}</span>
        </div>
      </div>
    </article>
  );
}

function createSplitEntries({ id, label, muted, role, screenSharing, stream, previewStream = null, audioEnabled = true, videoEnabled = false }) {
  const audioTracks = stream?.getAudioTracks() || [];
  const videoTracks = stream?.getVideoTracks() || [];
  const screenTrack = getScreenTrack(videoTracks, screenSharing);
  const cameraTrack = previewStream?.getVideoTracks?.()[0] || videoTracks.find((track) => track !== screenTrack) || null;

  if (screenSharing && screenTrack) {
    const entries = [
      {
        id: `${id}-screen`,
        label,
        muted,
        role: 'Screen share',
        screenSharing: true,
        stream: buildDisplayStream({ audioTracks, videoTrack: screenTrack }),
        audioEnabled,
        videoEnabled,
      },
    ];

    if (cameraTrack) {
      entries.push({
        id: `${id}-camera`,
        label,
        muted,
        role: 'Webcam',
        screenSharing: false,
        stream: buildDisplayStream({ videoTrack: cameraTrack }),
        audioEnabled,
        videoEnabled,
      });
    }

    return entries;
  }

  return [
    {
      id,
      label,
      muted,
      role,
      screenSharing: false,
      stream,
      audioEnabled,
      videoEnabled,
    },
  ];
}

function buildEntries({ localPreviewStream, localScreenSharing, localStream, localAudioEnabled, localVideoEnabled, participants, remoteStreams }) {
  const entries = [];

  if (localStream) {
    entries.push(
      ...createSplitEntries({
        id: 'local',
        label: 'You',
        muted: true,
        previewStream: localPreviewStream,
        role: localScreenSharing ? 'Screen share' : 'Local',
        screenSharing: localScreenSharing,
        stream: localStream,
        audioEnabled: localAudioEnabled ?? true,
        videoEnabled: localVideoEnabled ?? false,
      }),
    );
  }

  for (const remoteStream of remoteStreams) {
    const participant = participants.find((entry) => entry.id === remoteStream.participantId);

    entries.push(
      ...createSplitEntries({
        id: remoteStream.participantId,
        label: participant?.name || 'Guest',
        muted: false,
        role: participant?.screenSharing ? 'Screen share' : 'Remote',
        screenSharing: Boolean(participant?.screenSharing),
        stream: remoteStream.stream,
        audioEnabled: participant?.audioEnabled ?? true,
        videoEnabled: participant?.videoEnabled ?? false,
      }),
    );
  }

  return entries;
}

function EmptyStage({ mediaMode, title }) {
  return (
    <div className="stage-empty">
      <p className="muted">
        {mediaMode === 'video'
          ? title || 'Turn on mic or camera when ready'
          : 'Turn on mic to start talking'}
      </p>
    </div>
  );
}

function AudioStreamRack({
  isExpanded = false,
  layoutMode = 'default',
  localPreviewStream = null,
  localScreenSharing = false,
  localStream,
  localAudioEnabled,
  localVideoEnabled,
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
    localAudioEnabled,
    localVideoEnabled,
    participants,
    remoteStreams,
  });
  const liveCount = entries.length;
  const featuredEntry = entries.find((entry) => entry.screenSharing) || null;
  const railEntries = entries.filter((entry) => !entry.screenSharing);
  const isSoloSelfStage = entries.length === 1 && entries[0]?.id === 'local';

  if (layoutMode === 'rail') {
    return (
      <section className="card media-stage rail-only-stage elevated-card">
        <div className="panel-head">
          <div className="heading-group">
            <span className="eyebrow">Live</span>
            <h2>Webcam</h2>
          </div>
          <div className="panel-head-actions">
            <span className="count-badge">{railEntries.length}</span>
            <PanelControls
              isExpanded={isExpanded}
              onToggleExpand={onToggleExpand}
              onToggleFullscreen={onToggleFullscreen}
            />
          </div>
        </div>

        {railEntries.length ? (
          <div className="media-rail-list">
            {railEntries.map((entry) => (
              <MediaTile compact entry={entry} key={entry.id} />
            ))}
          </div>
        ) : (
          <EmptyStage mediaMode={mediaMode} title="Webcam shows here when available" />
        )}
      </section>
    );
  }

  if (layoutMode === 'screen') {
    return (
      <section className="card media-stage elevated-card share-priority-stage">
        <div className="panel-head">
          <div className="heading-group">
            <span className="eyebrow">Stage</span>
            <h2>Shared screen</h2>
          </div>
          <div className="panel-head-actions">
            <span className="count-badge">{featuredEntry ? 1 : 0}</span>
            <PanelControls
              isExpanded={isExpanded}
              onToggleExpand={onToggleExpand}
              onToggleFullscreen={onToggleFullscreen}
            />
          </div>
        </div>

        {featuredEntry ? (
          <MediaTile entry={featuredEntry} featured key={featuredEntry.id} />
        ) : (
          <EmptyStage mediaMode={mediaMode} title="Shared screen appears here" />
        )}
      </section>
    );
  }

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
        <EmptyStage mediaMode={mediaMode} />
      </section>
    );
  }

  return (
    <section className={`card media-stage elevated-card ${isSoloSelfStage ? 'solo-self-stage' : ''}`}>
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
          <MediaTile entry={entry} key={entry.id} />
        ))}
      </div>
    </section>
  );
}

export default AudioStreamRack;
