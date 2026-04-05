import {
  ExitIcon,
  MicIcon,
  MicOffIcon,
  ScreenShareIcon,
  ScreenStopIcon,
  SettingsIcon,
  VideoIcon,
  VideoOffIcon,
} from './Icons.jsx';

function RoomConsole({
  cameraAvailable,
  cameraEnabled,
  mediaConnected,
  muted,
  onLeave,
  onOpenSettings,
  onToggleCamera,
  onToggleMute,
  onToggleScreenShare,
  roomMediaMode,
  screenShareSupported,
  screenSharing,
  voiceStatus,
}) {
  return (
    <div className="console-stack">
      <section className="card console-card elevated-card">
        <div className="panel-head">
          <div className="heading-group">
            <span className="eyebrow">Controls</span>
            <h2>Room</h2>
          </div>
        </div>

        <div className="status-pills">
          <span className="status-pill">{voiceStatus}</span>
          <span className="status-pill">{mediaConnected ? 'Signal live' : 'Chat only'}</span>
          <span className="status-pill">{roomMediaMode === 'video' ? 'Video room' : 'Voice room'}</span>
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
              disabled={!mediaConnected || !cameraAvailable || screenSharing}
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

      <section className="card exit-card elevated-card">
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
