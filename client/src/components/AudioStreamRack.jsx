import { useEffect, useRef } from 'react';

function RemoteAudioCard({ stream, label }) {
  const audioRef = useRef(null);

  useEffect(() => {
    if (!audioRef.current) {
      return;
    }

    audioRef.current.srcObject = stream;
  }, [stream]);

  return (
    <article className="audio-card">
      <div>
        <strong>{label}</strong>
        <p>Live voice channel</p>
      </div>
      <audio autoPlay playsInline ref={audioRef} />
    </article>
  );
}

function AudioStreamRack({ remoteStreams, participants }) {
  if (remoteStreams.length === 0) {
    return (
      <section className="card audio-rack empty">
        <div className="section-heading">
          <span className="eyebrow">Voice mesh</span>
          <h2>Waiting for someone to unmute</h2>
        </div>
        <p className="muted">
          Once another participant grants microphone access, their live audio
          card will appear here automatically.
        </p>
      </section>
    );
  }

  return (
    <section className="card audio-rack">
      <div className="section-heading">
        <span className="eyebrow">Voice mesh</span>
        <h2>Live connections</h2>
      </div>
      <div className="audio-grid">
        {remoteStreams.map((remoteStream) => {
          const participant = participants.find(
            (entry) => entry.id === remoteStream.participantId,
          );

          return (
            <RemoteAudioCard
              key={remoteStream.participantId}
              label={participant?.name || 'Guest'}
              stream={remoteStream.stream}
            />
          );
        })}
      </div>
    </section>
  );
}

export default AudioStreamRack;
