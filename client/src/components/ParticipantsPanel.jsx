function getPresenceChip(participant, roomMediaMode) {
  if (participant.screenSharing) {
    return 'Screen live';
  }

  if (!participant.peerId) {
    return 'Chat only';
  }

  if (roomMediaMode === 'video') {
    if (participant.videoEnabled) {
      return 'Video on';
    }

    return participant.audioEnabled ? 'Voice only' : 'Muted';
  }

  return participant.audioEnabled ? 'Voice live' : 'Muted';
}

function getInitials(name = '') {
  const [first = '?', second = ''] = name.trim().split(/\s+/);
  return `${first[0] || ''}${second[0] || ''}`.toUpperCase() || '?';
}

function ParticipantsPanel({ participants, roomMediaMode, selfParticipantId }) {
  return (
    <section className="card participants-panel elevated-card">
      <div className="panel-head">
        <div className="heading-group">
          <span className="eyebrow">People</span>
          <h2>Participants</h2>
        </div>
        <span className="count-badge">{participants.length}</span>
      </div>

      <div className="participant-list refined-list">
        {participants.map((participant) => (
          <article className={`participant-card refined-card ${participant.screenSharing ? 'speaking' : ''}`} key={participant.id}>
            <div className="participant-main">
              <span className="participant-avatar premium-avatar">{getInitials(participant.name)}</span>
              <div className="participant-meta">
                <strong>
                  {participant.name}
                  {participant.id === selfParticipantId ? ' (You)' : ''}
                </strong>
                <span>{participant.isHost ? 'Host' : 'Guest'}</span>
              </div>
            </div>
            <span className="participant-chip">{getPresenceChip(participant, roomMediaMode)}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

export default ParticipantsPanel;
