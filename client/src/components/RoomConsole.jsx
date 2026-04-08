import {
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
  embedded = false,
  mediaConnected,
  muted,
  onLeave,
  onOpenSettings,
  onToggleCamera,
  onToggleMute,
  onToggleScreenShare,
  onToggleWatchParty,
  roomMediaMode,
  screenShareSupported,
  screenSharing,
  watchPartyOpen,
}) {
  const consoleCardClass = embedded
    ? 'console-card sidebar-section'
    : 'card console-card elevated-card';
  const exitCardClass = embedded
    ? 'exit-card sidebar-section'
    : 'card exit-card elevated-card';

  return (
    <div className="console-stack">
      <section className={consoleCardClass}>
        <div className="panel-head">
          <div className="heading-group">
            <span className="eyebrow">Controls</span>
            <h2>Room</h2>
          </div>
        </div>

        <div className="icon-toolbar icon-toolbar-room">
          <button
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            className="secondary-button icon-button control-icon"
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
              className="secondary-button icon-button control-icon"
              disabled={!mediaConnected || !cameraAvailable}
              onClick={onToggleCamera}
              title={cameraEnabled ? 'Hide video' : 'Show video'}
              type="button"
            >
              {cameraEnabled ? <VideoOffIcon /> : <VideoIcon />}
            </button>
          ) : null}

          <button
            aria-label={screenSharing ? 'Stop screen share' : 'Start screen share'}
            className="secondary-button icon-button control-icon"
            disabled={!mediaConnected || !screenShareSupported}
            onClick={onToggleScreenShare}
            title={screenSharing ? 'Stop share' : 'Share screen'}
            type="button"
          >
            {screenSharing ? <ScreenStopIcon /> : <ScreenShareIcon />}
          </button>

          <button
            aria-label={watchPartyOpen ? 'Hide shared video' : 'Open shared video'}
            className={`secondary-button icon-button control-icon ${watchPartyOpen ? 'is-active' : ''}`}
            onClick={onToggleWatchParty}
            title={watchPartyOpen ? 'Hide shared video' : 'Shared video'}
            type="button"
          >
            <PlayIcon />
          </button>

          <button
            aria-label="Open media settings"
            className="secondary-button icon-button control-icon"
            onClick={onOpenSettings}
            title="Settings"
            type="button"
          >
            <SettingsIcon />
          </button>
        </div>

        {!cameraAvailable && roomMediaMode === 'video' ? (
          <p className="micro-copy">Camera unavailable</p>
        ) : null}
      </section>

      <section className={exitCardClass}>
        <div className="panel-head panel-head-spacious">
          <div className="heading-group">
            <span className="eyebrow">Exit</span>
            <h2>Leave room</h2>
          </div>
        </div>
        <button
          aria-label="Leave room"
          className="danger-button icon-button exit-button"
          onClick={onLeave}
          title="Leave room"
          type="button"
        >
          <ExitIcon />
          <span>Leave</span>
        </button>
      </section>
    </div>
  );
}

export default RoomConsole;
