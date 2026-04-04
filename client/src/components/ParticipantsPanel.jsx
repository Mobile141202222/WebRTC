function ParticipantsPanel({ participants, selfParticipantId }) {
  return (
    <section className="card participants-panel">
      <div className="section-heading">
        <span className="eyebrow">Presence</span>
        <h2>{participants.length} people in the room</h2>
      </div>

      <div className="participant-list">
        {participants.map((participant) => (
          <article className="participant-card" key={participant.id}>
            <div>
              <strong>
                {participant.name}
                {participant.id === selfParticipantId ? ' (You)' : ''}
              </strong>
              <p>{participant.isHost ? 'Host' : 'Guest'}</p>
            </div>
            <span className="participant-chip">
              {participant.peerId ? 'Voice ready' : 'Joining...'}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

export default ParticipantsPanel;
