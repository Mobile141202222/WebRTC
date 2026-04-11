import { useEffect, useRef, useState } from 'react';
import {
  CollapseWideIcon,
  ExpandWideIcon,
  FullscreenIcon,
  LinkIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  TrashIcon,
} from './Icons.jsx';

const YOUTUBE_SCRIPT_SRC = 'https://www.youtube.com/iframe_api';
let youtubeApiPromise = null;

function loadYouTubeApi() {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youtubeApiPromise) {
    return youtubeApiPromise;
  }

  youtubeApiPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-youtube-api="true"]');

    if (!existingScript) {
      const script = document.createElement('script');
      script.src = YOUTUBE_SCRIPT_SRC;
      script.async = true;
      script.dataset.youtubeApi = 'true';
      script.onerror = () => reject(new Error('Unable to load YouTube API'));
      document.body.appendChild(script);
    }

    const previousHandler = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousHandler === 'function') {
        previousHandler();
      }

      resolve(window.YT);
    };
  });

  return youtubeApiPromise;
}

function extractYouTubeVideoId(input) {
  const value = String(input || '').trim();

  if (!value) {
    return '';
  }

  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);

    if (url.hostname.includes('youtu.be')) {
      return url.pathname.replace('/', '').slice(0, 11);
    }

    if (url.searchParams.get('v')) {
      return url.searchParams.get('v').slice(0, 11);
    }

    const pathMatch = url.pathname.match(/\/(embed|shorts)\/([a-zA-Z0-9_-]{11})/);
    return pathMatch?.[2] || '';
  } catch {
    return '';
  }
}

function getSyncedPosition(watchParty) {
  if (!watchParty) {
    return 0;
  }

  const basePosition = Number(watchParty.position || 0);

  if (watchParty.status !== 'playing') {
    return basePosition;
  }

  const syncedAt = Number(watchParty.syncedAt || Date.now());
  return Math.max(0, basePosition + (Date.now() - syncedAt) / 1000);
}

function syncPlayerToWatchParty(player, watchParty, { force = false } = {}) {
  if (!player || !watchParty?.videoId || !window.YT?.PlayerState) {
    return;
  }

  const targetPosition = getSyncedPosition(watchParty);
  const currentTime = player.getCurrentTime?.() || 0;
  const playerState = player.getPlayerState?.();
  const currentVideoId = player.getVideoData?.().video_id;
  const drift = Math.abs(currentTime - targetPosition);

  if (currentVideoId !== watchParty.videoId) {
    if (watchParty.status === 'playing') {
      player.loadVideoById({
        startSeconds: targetPosition,
        videoId: watchParty.videoId,
      });
    } else {
      player.cueVideoById({
        startSeconds: targetPosition,
        videoId: watchParty.videoId,
      });
    }
    return;
  }

  if (force || drift > 0.9) {
    player.seekTo(targetPosition, true);
  }

  if (watchParty.status === 'playing' && playerState !== window.YT.PlayerState.PLAYING) {
    player.playVideo();
  }

  if (watchParty.status === 'paused' && playerState !== window.YT.PlayerState.PAUSED) {
    player.pauseVideo();
  }
}

function PanelControls({ isExpanded, onToggleExpand, onToggleFullscreen }) {
  return (
    <div className="panel-zoom-controls">
      <button
        aria-label={isExpanded ? 'Reduce panel size' : 'Expand panel'}
        className="secondary-button icon-button control-icon"
        onClick={onToggleExpand}
        title={isExpanded ? 'Reduce' : 'Expand'}
        type="button"
      >
        {isExpanded ? <CollapseWideIcon /> : <ExpandWideIcon />}
      </button>
      <button
        aria-label="Fullscreen"
        className="secondary-button icon-button control-icon"
        onClick={onToggleFullscreen}
        title="Fullscreen"
        type="button"
      >
        <FullscreenIcon />
      </button>
    </div>
  );
}

function WatchPartyPanel({
  isExpanded = false,
  onClear,
  onSyncState,
  onToggleExpand,
  onToggleFullscreen,
  participantId,
  watchParty,
}) {
  const [draftUrl, setDraftUrl] = useState(watchParty?.sourceUrl || '');
  const [panelError, setPanelError] = useState('');
  const [playerReady, setPlayerReady] = useState(false);
  const playerHostRef = useRef(null);
  const playerRef = useRef(null);
  const latestWatchPartyRef = useRef(watchParty);
  const isLocalActionRef = useRef(false);
  const isRemoteActionRef = useRef(false);
  const releaseLocalActionTimerRef = useRef(0);
  const releaseRemoteActionTimerRef = useRef(0);

  function armLocalActionGuard(durationMs = 300) {
    isLocalActionRef.current = true;
    window.clearTimeout(releaseLocalActionTimerRef.current);
    releaseLocalActionTimerRef.current = window.setTimeout(() => {
      isLocalActionRef.current = false;
    }, durationMs);
  }

  function armRemoteActionGuard(durationMs = 500) {
    isRemoteActionRef.current = true;
    window.clearTimeout(releaseRemoteActionTimerRef.current);
    releaseRemoteActionTimerRef.current = window.setTimeout(() => {
      isRemoteActionRef.current = false;
    }, durationMs);
  }

  useEffect(() => {
    latestWatchPartyRef.current = watchParty;
  }, [watchParty]);

  useEffect(() => {
    if (!watchParty?.sourceUrl) {
      return undefined;
    }

    const syncFrame = window.requestAnimationFrame(() => {
      setDraftUrl(watchParty.sourceUrl);
    });

    return () => window.cancelAnimationFrame(syncFrame);
  }, [watchParty?.sourceUrl]);

  useEffect(() => {
    let cancelled = false;

    async function setupPlayer() {
      if (!watchParty?.videoId) {
        if (playerRef.current?.stopVideo) {
          armRemoteActionGuard(250);
          playerRef.current.stopVideo();
        }
        return;
      }

      const YT = await loadYouTubeApi();

      if (cancelled || !playerHostRef.current) {
        return;
      }

      const startSeconds = getSyncedPosition(watchParty);
      const isRemoteUpdate = (
        Boolean(watchParty.actorParticipantId)
        && watchParty.actorParticipantId !== participantId
      );

      if (!playerRef.current) {
        setPlayerReady(false);
        playerRef.current = new YT.Player(playerHostRef.current, {
          height: '100%',
          width: '100%',
          videoId: watchParty.videoId,
          playerVars: {
            playsinline: 1,
            rel: 0,
          },
          events: {
            onReady: () => {
              setPlayerReady(true);
              const latestWatchParty = latestWatchPartyRef.current;

              if (!latestWatchParty?.videoId || !playerRef.current) {
                return;
              }

              if (
                latestWatchParty.actorParticipantId
                && latestWatchParty.actorParticipantId !== participantId
              ) {
                armRemoteActionGuard();
              }
              syncPlayerToWatchParty(playerRef.current, latestWatchParty, {
                force: true,
              });
            },
            onStateChange: (event) => {
              const latestWatchParty = latestWatchPartyRef.current;

              if (
                isRemoteActionRef.current
                || isLocalActionRef.current
                || !latestWatchParty?.videoId
              ) {
                return;
              }

              const currentTime = playerRef.current?.getCurrentTime?.() || 0;

              if (event.data === window.YT.PlayerState.PLAYING) {
                void onSyncState({
                  participantId,
                  position: currentTime,
                  sourceUrl: latestWatchParty.sourceUrl,
                  status: 'playing',
                  videoId: latestWatchParty.videoId,
                });
              }

              if (event.data === window.YT.PlayerState.PAUSED) {
                void onSyncState({
                  participantId,
                  position: currentTime,
                  sourceUrl: latestWatchParty.sourceUrl,
                  status: 'paused',
                  videoId: latestWatchParty.videoId,
                });
              }

              if (event.data === window.YT.PlayerState.ENDED) {
                void onSyncState({
                  participantId,
                  position: 0,
                  sourceUrl: latestWatchParty.sourceUrl,
                  status: 'paused',
                  videoId: latestWatchParty.videoId,
                });
              }
            },
          },
        });

        return;
      }

      const currentVideoId = playerRef.current.getVideoData?.().video_id;
      if (isRemoteUpdate) {
        armRemoteActionGuard();
      }

      if (currentVideoId !== watchParty.videoId) {
        syncPlayerToWatchParty(playerRef.current, watchParty, { force: true });
      } else {
        syncPlayerToWatchParty(playerRef.current, watchParty, {
          force: Math.abs((playerRef.current.getCurrentTime?.() || 0) - startSeconds) > 0.9,
        });
      }
    }

    void setupPlayer();

    return () => {
      cancelled = true;
    };
  }, [onSyncState, participantId, watchParty]);

  useEffect(() => () => {
    window.clearTimeout(releaseLocalActionTimerRef.current);
    window.clearTimeout(releaseRemoteActionTimerRef.current);
    playerRef.current?.destroy?.();
    playerRef.current = null;
  }, []);

  function handleSubmit(event) {
    event.preventDefault();

    const videoId = extractYouTubeVideoId(draftUrl);

    if (!videoId) {
      setPanelError('Invalid YouTube URL');
      return;
    }

    setPanelError('');
    void onSyncState({
      participantId,
      position: 0,
      sourceUrl: draftUrl.trim(),
      status: 'paused',
      videoId,
    });
  }

  function handleTogglePlayback() {
    if (!playerRef.current || !watchParty?.videoId) {
      return;
    }

    const isPlaying = watchParty.status === 'playing';

    armLocalActionGuard();

    if (isPlaying) {
      playerRef.current.pauseVideo();
      void onSyncState({
        participantId,
        position: playerRef.current.getCurrentTime?.() || 0,
        sourceUrl: watchParty.sourceUrl,
        status: 'paused',
        videoId: watchParty.videoId,
      });
    } else {
      playerRef.current.playVideo();
      void onSyncState({
        participantId,
        position: playerRef.current.getCurrentTime?.() || 0,
        sourceUrl: watchParty.sourceUrl,
        status: 'playing',
        videoId: watchParty.videoId,
      });
    }
  }

  function handleResync() {
    if (!playerRef.current || !watchParty?.videoId) {
      return;
    }

    void onSyncState({
      participantId,
      position: playerRef.current.getCurrentTime?.() || 0,
      sourceUrl: watchParty.sourceUrl,
      status: watchParty.status || 'paused',
      videoId: watchParty.videoId,
    });
  }

  return (
    <section className="card watch-party-card elevated-card">
      <div className="panel-head">
        <div className="heading-group">
          <span className="eyebrow">Watch party</span>
          <h2>Shared video</h2>
        </div>
        <div className="panel-head-actions">
          <span className="count-badge">{watchParty?.videoId ? 'Live' : 'Idle'}</span>
          <PanelControls
            isExpanded={isExpanded}
            onToggleExpand={onToggleExpand}
            onToggleFullscreen={onToggleFullscreen}
          />
        </div>
      </div>

      <form className="watch-party-form" onSubmit={handleSubmit}>
        <label className="field-label" htmlFor="watch-party-url">
          YouTube URL
        </label>
        <div className="watch-party-input-row">
          <input
            className="text-input"
            id="watch-party-url"
            onChange={(event) => setDraftUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            value={draftUrl}
          />
          <button className="primary-button action-button" type="submit">
            <LinkIcon />
            <span>Load</span>
          </button>
        </div>
      </form>

      {panelError ? <p className="feedback error">{panelError}</p> : null}

      <div className="watch-party-player-shell">
        <div className="watch-party-player" ref={playerHostRef} />
        {!watchParty?.videoId ? (
          <div className="watch-party-empty">
            <p>Paste a YouTube link to start a shared clip.</p>
          </div>
        ) : null}
      </div>

      <div className="watch-party-toolbar">
        <button
          aria-label={watchParty?.status === 'playing' ? 'Pause video' : 'Play video'}
          className="secondary-button icon-button control-icon"
          disabled={!watchParty?.videoId || !playerReady}
          onClick={handleTogglePlayback}
          title={watchParty?.status === 'playing' ? 'Pause' : 'Play'}
          type="button"
        >
          {watchParty?.status === 'playing' ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          aria-label="Resync clip"
          className="secondary-button icon-button control-icon"
          disabled={!watchParty?.videoId || !playerReady}
          onClick={handleResync}
          title="Resync"
          type="button"
        >
          <RefreshIcon />
        </button>
        <button
          aria-label="Remove shared clip"
          className="danger-button icon-button control-icon"
          disabled={!watchParty?.videoId}
          onClick={onClear}
          title="Remove clip"
          type="button"
        >
          <TrashIcon />
        </button>
      </div>
    </section>
  );
}

export default WatchPartyPanel;
