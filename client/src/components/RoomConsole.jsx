import {
  ChatIcon,
  ExitIcon,
  MicIcon,
  MicOffIcon,
  PlayIcon,
  ScreenShareIcon,
  ScreenStopIcon,
  SettingsIcon,
  VideoIcon,
  VideoOffIcon,
} from './Icons.jsx';

function RoomConsole({
  cameraAvailable,
  cameraEnabled,
  chatOpen,
  embedded = false,
  mediaConnected,
  muted,
  onLeave,
  onOpenSettings,
  onToggleCamera,
  onToggleChat,
  onToggleMute,
  onToggleScreenShare,
  onToggleWatchParty,
  roomMediaMode,
  screenShareSupported,
  screenSharing,
  voiceStatus,
  watchPartyOpen,
}) {
  return (
    <div className={`room-bottom-toolbar-inner ${embedded ? 'embedded' : ''}`}>
      <div className="toolbar-group">
        {voiceStatus ? <p className="micro-copy status-text">{voiceStatus}</p> : null}
        {!cameraAvailable && roomMediaMode === 'video' ? (
          <p className="micro-copy status-text">Camera unavailable</p>
        ) : null}
      </div>

      <div className="icon-toolbar toolbar-center">
        <button
          aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
          className={`toolbar-button ${muted ? 'danger-state' : ''}`}
          disabled={!mediaConnected}
          onClick={onToggleMute}
          title={muted ? 'Unmute' : 'Mute'}
          type="button"
        >
          {muted ? <MicOffIcon /> : <MicIcon />}
        </button>

        {roomMediaMode === 'video' ? (
          <button
            aria-label={cameraEnabled ? 'Hide video' : 'Show video'}
            className={`toolbar-button ${!cameraEnabled ? 'danger-state' : ''}`}
            disabled={!mediaConnected || !cameraAvailable}
            onClick={onToggleCamera}
            title={cameraEnabled ? 'Hide video' : 'Show video'}
            type="button"
          >
            {cameraEnabled ? <VideoIcon /> : <VideoOffIcon />}
          </button>
        ) : null}

        <button
          aria-label={screenSharing ? 'Stop screen share' : 'Start screen share'}
          className={`toolbar-button ${screenSharing ? 'active-state' : ''}`}
          disabled={!mediaConnected || !screenShareSupported}
          onClick={onToggleScreenShare}
          title={screenSharing ? 'Stop share' : 'Share screen'}
          type="button"
        >
          {screenSharing ? <ScreenStopIcon /> : <ScreenShareIcon />}
        </button>

        <button
          aria-label={watchPartyOpen ? 'Hide shared video' : 'Open shared video'}
          className={`toolbar-button ${watchPartyOpen ? 'active-state' : ''}`}
          onClick={onToggleWatchParty}
          title={watchPartyOpen ? 'Hide shared video' : 'Shared video'}
          type="button"
        >
          <PlayIcon />
        </button>

        <button
          aria-label={chatOpen ? 'Hide chat' : 'Open chat'}
          className={`toolbar-button ${chatOpen ? 'active-state' : ''}`}
          onClick={onToggleChat}
          title={chatOpen ? 'Hide chat' : 'Open chat'}
          type="button"
        >
          <ChatIcon />
        </button>

        <button
          aria-label="Open media settings"
          className="toolbar-button"
          onClick={onOpenSettings}
          title="Settings"
          type="button"
        >
          <SettingsIcon />
        </button>
      </div>

      <div className="toolbar-group toolbar-right">
        <button
          aria-label="Leave room"
          className="danger-button exit-button-pill"
          onClick={onLeave}
          title="Leave room"
          type="button"
        >
          <ExitIcon />
          <span>Leave</span>
        </button>
      </div>
    </div>
  );
}

export default RoomConsole;
