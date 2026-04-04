import { CheckIcon, CopyIcon } from './Icons.jsx';
import ThemeToggle from './ThemeToggle.jsx';

function describeRoomMode(roomMediaMode) {
  return roomMediaMode === 'video' ? 'Video room' : 'Voice room';
}

function RoomHeader({
  copyState,
  inviteLink,
  onCopyInvite,
  onToggleTheme,
  participantCount,
  roomId,
  roomMediaMode,
  theme,
}) {
  const copied = copyState === 'Copied';

  return (
    <header className="room-banner card elevated-card">
      <div className="room-title-row">
        <div className="heading-group">
          <span className="eyebrow">Room</span>
          <h1>{roomId}</h1>
        </div>
        <ThemeToggle onToggleTheme={onToggleTheme} theme={theme} />
      </div>

      <div className="room-meta-row">
        <span className="info-chip">{participantCount} people</span>
        <span className="info-chip">{describeRoomMode(roomMediaMode)}</span>
      </div>

      <div className="invite-panel compact-panel">
        <div className="invite-row compact-row">
          <input aria-label="Invite link" id="invite-link" readOnly value={inviteLink} />
          <button
            aria-label={copyState}
            className="secondary-button icon-button"
            onClick={onCopyInvite}
            title={copyState}
            type="button"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            <span className="sr-only">{copyState}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

export default RoomHeader;
