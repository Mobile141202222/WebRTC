function RoomHeader({
  copyState,
  inviteLink,
  muted,
  onCopyInvite,
  onLeave,
  onToggleMute,
  participantCount,
  roomId,
  voiceStatus,
}) {
  return (
    <header className="room-header card">
      <div className="room-heading">
        <span className="eyebrow">Ephemeral room</span>
        <h1>Room {roomId}</h1>
        <p>
          Share the invite, talk live, and let Firebase clean up the room state
          when everyone is gone.
        </p>
      </div>

      <div className="header-metrics">
        <div className="metric-pill">
          <span>Participants</span>
          <strong>{participantCount}</strong>
        </div>
        <div className="metric-pill">
          <span>Voice status</span>
          <strong>{voiceStatus}</strong>
        </div>
      </div>

      <div className="invite-box">
        <label htmlFor="invite-link">Invite link</label>
        <div className="invite-row">
          <input id="invite-link" readOnly value={inviteLink} />
          <button className="secondary-button" onClick={onCopyInvite} type="button">
            {copyState}
          </button>
        </div>
      </div>

      <div className="room-actions">
        <button className="secondary-button" onClick={onToggleMute} type="button">
          {muted ? 'Unmute mic' : 'Mute mic'}
        </button>
        <button className="danger-button" onClick={onLeave} type="button">
          Leave room
        </button>
      </div>
    </header>
  );
}

export default RoomHeader;
