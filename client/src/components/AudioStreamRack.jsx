import { useEffect, useRef, useState } from 'react';

function getInitials(label = '') {
  const [first = '?', second = ''] = label.trim().split(/\s+/);
  return `${first[0] || ''}${second[0] || ''}`.toUpperCase() || '?';
}

function useAudioLevel(stream) {
  const [level, setLevel] = useState(0);
  const lastLevelRef = useRef(0);

  useEffect(() => {
    if (!stream) {
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

function MediaTile({ label, muted = false, role, screenSharing = false, stream }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const hasVideoTrack = (stream?.getVideoTracks() || []).length > 0;
  const level = useAudioLevel(stream);
  const isSpeaking = level > 0.12;

  useEffect(() => {
    if (!stream) {
      return;
    }

    if (hasVideoTrack && videoRef.current) {
      videoRef.current.srcObject = stream;
      return;
    }

    if (audioRef.current) {
      audioRef.current.srcObject = stream;
    }
  }, [hasVideoTrack, stream]);

  return (
    <article className={`media-tile ${hasVideoTrack ? 'video' : 'audio'} ${isSpeaking ? 'speaking' : ''}`}>
      <div className="media-surface">
        {hasVideoTrack ? (
          <video autoPlay muted={muted} playsInline ref={videoRef} />
        ) : (
          <div className="media-placeholder">
            <span className="media-avatar premium-avatar">{getInitials(label)}</span>
          </div>
        )}
        {!hasVideoTrack && stream ? <audio autoPlay muted={muted} playsInline ref={audioRef} /> : null}
      </div>
      <div className="media-caption media-caption-extended">
        <div>
          <strong>{label}</strong>
          <span>{role}</span>
        </div>
        <div className="media-side-meta">
          <AudioLevelMeter level={level} />
          <span className="media-badge">{screenSharing ? 'Screen' : hasVideoTrack ? 'Video' : 'Audio'}</span>
        </div>
      </div>
    </article>
  );
}

function AudioStreamRack({
  localScreenSharing = false,
  localStream,
  mediaMode,
  participants,
  remoteStreams,
}) {
  const liveCount = remoteStreams.length + (localStream ? 1 : 0);
  const hasRemoteStreams = remoteStreams.length > 0;

  if (!localStream && !hasRemoteStreams) {
    return (
      <section className="card media-stage empty elevated-card">
        <div className="panel-head">
          <div className="heading-group">
            <span className="eyebrow">Stage</span>
            <h2>Waiting for stream</h2>
          </div>
          <span className="count-badge">{mediaMode === 'video' ? 'Video' : 'Voice'}</span>
        </div>
        <div className="stage-empty">
          <p className="muted">{mediaMode === 'video' ? 'เปิด mic หรือ camera เมื่อพร้อม' : 'เปิด mic เพื่อเริ่มคุย'}</p>
        </div>
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
        <span className="count-badge">{liveCount}</span>
      </div>

      <div className="media-grid">
        {localStream ? (
          <MediaTile
            label="You"
            muted
            role={localScreenSharing ? 'Screen share' : 'Local'}
            screenSharing={localScreenSharing}
            stream={localStream}
          />
        ) : null}

        {remoteStreams.map((remoteStream) => {
          const participant = participants.find(
            (entry) => entry.id === remoteStream.participantId,
          );

          return (
            <MediaTile
              key={remoteStream.participantId}
              label={participant?.name || 'Guest'}
              role={participant?.screenSharing ? 'Screen share' : 'Remote'}
              screenSharing={participant?.screenSharing}
              stream={remoteStream.stream}
            />
          );
        })}
      </div>
    </section>
  );
}

export default AudioStreamRack;
