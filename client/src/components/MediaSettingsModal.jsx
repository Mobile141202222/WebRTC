import { useEffect, useState } from 'react';
import { CloseIcon, RefreshIcon, SettingsIcon } from './Icons.jsx';

function buildOptions(devices = [], fallbackLabel) {
  return [{ deviceId: '', label: fallbackLabel }, ...devices];
}

function MediaSettingsModal({
  devices,
  onApply,
  onClose,
  onRefresh,
  open,
  roomMediaMode,
  screenShareSupported,
  selectedDevices,
}) {
  const [draft, setDraft] = useState(selectedDevices);

  useEffect(() => {
    setDraft(selectedDevices);
  }, [selectedDevices]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <section
        aria-label="Media settings"
        className="modal-card elevated-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-head">
          <div className="heading-group">
            <span className="eyebrow">Settings</span>
            <h2>Media devices</h2>
          </div>
          <button
            aria-label="Close settings"
            className="secondary-button icon-button control-icon"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="modal-summary">
          <span className="info-chip">{roomMediaMode === 'video' ? 'Video room' : 'Voice room'}</span>
          <span className="info-chip">{screenShareSupported ? 'Screen share ready' : 'Screen share unavailable'}</span>
        </div>

        <label className="field-label" htmlFor="audio-input-select">
          Microphone
        </label>
        <select
          className="text-input select-input"
          id="audio-input-select"
          onChange={(event) => setDraft((current) => ({
            ...current,
            audioInputId: event.target.value,
          }))}
          value={draft.audioInputId || ''}
        >
          {buildOptions(devices.audioInputs, 'Default microphone').map((device) => (
            <option key={device.deviceId || 'audio-default'} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>

        <label className="field-label" htmlFor="video-input-select">
          Camera
        </label>
        <select
          className="text-input select-input"
          id="video-input-select"
          onChange={(event) => setDraft((current) => ({
            ...current,
            videoInputId: event.target.value,
          }))}
          value={draft.videoInputId || ''}
        >
          {buildOptions(devices.videoInputs, 'Default camera').map((device) => (
            <option key={device.deviceId || 'video-default'} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>

        <div className="modal-actions">
          <button className="secondary-button action-button" onClick={onRefresh} type="button">
            <RefreshIcon />
            <span>Refresh</span>
          </button>
          <button className="primary-button action-button" onClick={() => onApply(draft)} type="button">
            <SettingsIcon />
            <span>Apply</span>
          </button>
        </div>
      </section>
    </div>
  );
}

export default MediaSettingsModal;
