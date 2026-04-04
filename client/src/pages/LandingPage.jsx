import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightIcon, PlusIcon, VideoIcon, VoiceIcon } from '../components/Icons.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { getFirebaseConfigError, isFirebaseReady } from '../lib/firebase.js';
import { generateRoomId } from '../lib/roomId.js';
import { sanitizeDisplayName, sanitizeRoomId } from '../lib/sanitize.js';

const STORAGE_KEY = 'ephemeral-chat-display-name';
const ROOM_MODE_STORAGE_KEY = 'ephemeral-chat-room-mode';

function LandingPage({ onToggleTheme, theme }) {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem(STORAGE_KEY) || '',
  );
  const [joinCode, setJoinCode] = useState('');
  const [createMode, setCreateMode] = useState(
    () => localStorage.getItem(ROOM_MODE_STORAGE_KEY) || 'voice',
  );
  const [error, setError] = useState('');

  function rememberDisplayName(nextValue) {
    const cleanName = sanitizeDisplayName(nextValue);
    localStorage.setItem(STORAGE_KEY, cleanName);
    return cleanName;
  }

  function handleSelectMode(mode) {
    setCreateMode(mode);
    localStorage.setItem(ROOM_MODE_STORAGE_KEY, mode);
  }

  function handleCreateRoom() {
    setError('');

    if (!isFirebaseReady()) {
      setError(getFirebaseConfigError());
      return;
    }

    rememberDisplayName(displayName);
    navigate(`/room/${generateRoomId()}?host=1&mode=${createMode}`);
  }

  function handleJoinRoom(event) {
    event.preventDefault();
    setError('');

    if (!isFirebaseReady()) {
      setError(getFirebaseConfigError());
      return;
    }

    const cleanRoomId = sanitizeRoomId(joinCode);

    if (!cleanRoomId) {
      setError('Enter room code');
      return;
    }

    rememberDisplayName(displayName);
    navigate(`/room/${cleanRoomId}`);
  }

  return (
    <main className="landing-page page-shell">
      <header className="page-topbar">
        <div className="brand-lockup brand-lockup-compact">
          <span className="brand-mark">ROOMKIT</span>
          <h1>Instant Rooms</h1>
        </div>
        <ThemeToggle onToggleTheme={onToggleTheme} theme={theme} />
      </header>

      <section className="hero-panel hero-grid">
        <div className="hero-copy-block">
          <span className="eyebrow">Private room experience</span>
          <h2>Private Meeting</h2>
          <p className="hero-copy">แชร์ลิงก์เดียวแล้วเริ่มคุยได้ทันที ทั้ง voice, video และ chat ใน layout ที่อ่านง่าย</p>
          <div className="hero-tags">
            <span className="info-chip">Ready to share</span>
            <span className="info-chip">Realtime sync</span>
            <span className="info-chip">Focused UI</span>
          </div>
        </div>

        <div className="hero-surface">
          <div className="mini-stat">
            <span>Mode</span>
            <strong>{createMode === 'video' ? 'Video room' : 'Voice room'}</strong>
          </div>
          <div className="mini-stat">
            <span>Invite</span>
            <strong>Single link</strong>
          </div>
          <div className="mini-stat">
            <span>Flow</span>
            <strong>Open and go</strong>
          </div>
        </div>
      </section>

      <section className="landing-grid landing-grid-compact">
        <article className="card create-card elevated-card">
          <div className="panel-head">
            <div className="heading-group">
              <span className="eyebrow">Create</span>
              <h3>New room</h3>
            </div>
            <span className="count-badge">{createMode === 'video' ? 'Video' : 'Voice'}</span>
          </div>

          <label className="field-label" htmlFor="display-name">
            Name
          </label>
          <input
            className="text-input"
            id="display-name"
            maxLength={24}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Your name"
            value={displayName}
          />

          <div className="mode-picker">
            <span className="field-label">Mode</span>
            <div className="choice-grid">
              <button
                className={`choice-button ${createMode === 'voice' ? 'active' : ''}`}
                onClick={() => handleSelectMode('voice')}
                type="button"
              >
                <span className="choice-icon"><VoiceIcon /></span>
                <strong>Voice</strong>
                <span>Audio + chat</span>
              </button>
              <button
                className={`choice-button ${createMode === 'video' ? 'active' : ''}`}
                onClick={() => handleSelectMode('video')}
                type="button"
              >
                <span className="choice-icon"><VideoIcon /></span>
                <strong>Video</strong>
                <span>Camera + audio</span>
              </button>
            </div>
          </div>

          <button className="primary-button action-button" onClick={handleCreateRoom} type="button">
            <PlusIcon />
            <span>Create</span>
          </button>
        </article>

        <article className="card join-card elevated-card">
          <div className="panel-head">
            <div className="heading-group">
              <span className="eyebrow">Join</span>
              <h3>Existing room</h3>
            </div>
            <span className="count-badge">Code</span>
          </div>

          <form className="join-form" onSubmit={handleJoinRoom}>
            <label className="field-label" htmlFor="join-code">
              Room code
            </label>
            <input
              className="text-input"
              id="join-code"
              maxLength={6}
              onChange={(event) => setJoinCode(sanitizeRoomId(event.target.value))}
              placeholder="AB12CD"
              value={joinCode}
            />
            <button className="secondary-button strong-secondary wide-button action-button" type="submit">
              <ArrowRightIcon />
              <span>Join</span>
            </button>
          </form>
        </article>
      </section>

      {error ? <p className="feedback error">{error}</p> : null}
    </main>
  );
}

export default LandingPage;
