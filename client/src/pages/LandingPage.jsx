import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFirebaseConfigError, isFirebaseReady } from '../lib/firebase.js';
import { generateRoomId } from '../lib/roomId.js';
import { sanitizeDisplayName, sanitizeRoomId } from '../lib/sanitize.js';

const STORAGE_KEY = 'ephemeral-chat-display-name';

function LandingPage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem(STORAGE_KEY) || '',
  );
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  function rememberDisplayName(nextValue) {
    const cleanName = sanitizeDisplayName(nextValue);
    localStorage.setItem(STORAGE_KEY, cleanName);
    return cleanName;
  }

  function handleCreateRoom() {
    setError('');

    if (!isFirebaseReady()) {
      setError(getFirebaseConfigError());
      return;
    }

    rememberDisplayName(displayName);
    navigate(`/room/${generateRoomId()}?host=1`);
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
      setError('Add a valid 6-character room code first.');
      return;
    }

    rememberDisplayName(displayName);
    navigate(`/room/${cleanRoomId}`);
  }

  return (
    <main className="landing-page">
      <section className="hero-panel">
        <span className="eyebrow">React + Firebase + PeerJS</span>
        <h1>Spin up a disposable voice room in seconds.</h1>
        <p className="hero-copy">
          Each room keeps text in Firebase Realtime Database, opens direct
          WebRTC audio between browsers, and fades away once the room is no
          longer active.
        </p>
      </section>

      <section className="landing-grid">
        <article className="card create-card">
          <span className="eyebrow">Step 1</span>
          <h2>Set your display name</h2>
          <input
            className="text-input"
            maxLength={24}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Bas, Mint, Team Lead..."
            value={displayName}
          />
          <button className="primary-button" onClick={handleCreateRoom} type="button">
            Create new room
          </button>
        </article>

        <article className="card join-card">
          <span className="eyebrow">Step 2</span>
          <h2>Join from an invite</h2>
          <form className="join-form" onSubmit={handleJoinRoom}>
            <input
              className="text-input"
              maxLength={6}
              onChange={(event) => setJoinCode(sanitizeRoomId(event.target.value))}
              placeholder="ROOMID"
              value={joinCode}
            />
            <button className="secondary-button" type="submit">
              Join room
            </button>
          </form>
        </article>
      </section>

      <section className="card workflow-card">
        <div className="section-heading">
          <span className="eyebrow">System workflow</span>
          <h2>How the room moves from empty to live</h2>
        </div>
        <div className="workflow-grid">
          <article>
            <strong>1. Create</strong>
            <p>Generate a room ID and register the host in Firebase.</p>
          </article>
          <article>
            <strong>2. Share</strong>
            <p>Send the URL so guests can resolve the same room node instantly.</p>
          </article>
          <article>
            <strong>3. Join</strong>
            <p>Guests publish their peer IDs and presence state under participants.</p>
          </article>
          <article>
            <strong>4. Talk</strong>
            <p>Messages sync through Firebase while voice rides directly over WebRTC.</p>
          </article>
        </div>
      </section>

      {error ? <p className="feedback error">{error}</p> : null}
    </main>
  );
}

export default LandingPage;
