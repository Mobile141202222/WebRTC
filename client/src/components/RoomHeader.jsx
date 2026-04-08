import { CheckIcon, CopyIcon, SendIcon } from './Icons.jsx';
import ThemeToggle from './ThemeToggle.jsx';

function RoomHeader({
  copyState,
  inviteLink,
  onCopyInvite,
  onCopyRoomId,
  onShareInvite,
  onToggleTheme,
  roomCodeState,
  roomId,
  shareState,
  theme,
}) {
  const copiedLink = copyState === 'Copied';
  const copiedRoom = roomCodeState === 'Copied';
  const shared = shareState === 'Shared';

  return (
    <header className="room-banner card elevated-card">
      <div className="room-title-row">
        <div className="heading-group room-heading-stack">
          <span className="eyebrow">Room</span>
          <div className="room-code-row">
            <h1>{roomId}</h1>
            <div className="room-code-actions">
              <button
                aria-label={roomCodeState}
                className="secondary-button icon-button"
                onClick={onCopyRoomId}
                title={roomCodeState}
                type="button"
              >
                {copiedRoom ? <CheckIcon /> : <CopyIcon />}
                <span className="sr-only">{roomCodeState}</span>
              </button>
              <button
                aria-label={shareState}
                className="secondary-button icon-button"
                onClick={onShareInvite}
                title={shareState}
                type="button"
              >
                {shared ? <CheckIcon /> : <SendIcon />}
                <span className="sr-only">{shareState}</span>
              </button>
            </div>
          </div>
        </div>
        <ThemeToggle onToggleTheme={onToggleTheme} theme={theme} />
      </div>

      <div className="invite-panel compact-panel">
        <span className="field-label invite-label">Share link</span>
        <div className="invite-row compact-row invite-compact-row">
          <div aria-label="Invite link" className="invite-link-frame" id="invite-link" title={inviteLink}>
            {inviteLink}
          </div>
          <button
            aria-label={copyState}
            className="secondary-button icon-button"
            onClick={onCopyInvite}
            title={copyState}
            type="button"
          >
            {copiedLink ? <CheckIcon /> : <CopyIcon />}
            <span className="sr-only">{copyState}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

export default RoomHeader;
