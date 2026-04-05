import { useEffect, useRef, useState } from 'react';
import { LinkIcon, PauseIcon, PlayIcon, RefreshIcon, TrashIcon } from './Icons.jsx';

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

function WatchPartyPanel({ onClear, onSyncState, participantId, watchParty }) {
  const [draftUrl, setDraftUrl] = useState(watchParty?.sourceUrl || '');
  const [panelError, setPanelError] = useState('');
  const [playerReady, setPlayerReady] = useState(false);
  const playerHostRef = useRef(null);
  const playerRef = useRef(null);
  const latestWatchPartyRef = useRef(watchParty);
  const suppressEventsRef = useRef(false);
  const releaseSuppressTimerRef = useRef(0);

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
          suppressEventsRef.current = true;
          playerRef.current.stopVideo();
          window.clearTimeout(releaseSuppressTimerRef.current);
          releaseSuppressTimerRef.current = window.setTimeout(() => {
            suppressEventsRef.current = false;
          }, 250);
        }
        return;
      }

      const YT = await loadYouTubeApi();

      if (cancelled || !playerHostRef.current) {
        return;
      }

      const startSeconds = getSyncedPosition(watchParty);

      if (!playerRef.current) {
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
            },
            onStateChange: (event) => {
              const latestWatchParty = latestWatchPartyRef.current;

              if (suppressEventsRef.current || !latestWatchParty?.videoId) {
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

      suppressEventsRef.current = true;

      if (currentVideoId !== watchParty.videoId) {
        if (watchParty.status === 'playing') {
          playerRef.current.loadVideoById({
            startSeconds,
            videoId: watchParty.videoId,
          });
        } else {
          playerRef.current.cueVideoById({
            startSeconds,
            videoId: watchParty.videoId,
          });
        }
      } else {
        const currentTime = playerRef.current.getCurrentTime?.() || 0;
        if (Math.abs(currentTime - startSeconds) > 1.3) {
          playerRef.current.seekTo(startSeconds, true);
        }

        const playerState = playerRef.current.getPlayerState?.();

        if (watchParty.status === 'playing' && playerState !== window.YT.PlayerState.PLAYING) {
          playerRef.current.playVideo();
        }

        if (watchParty.status === 'paused' && playerState !== window.YT.PlayerState.PAUSED) {
          playerRef.current.pauseVideo();
        }
      }

      window.clearTimeout(releaseSuppressTimerRef.current);
      releaseSuppressTimerRef.current = window.setTimeout(() => {
        suppressEventsRef.current = false;
      }, 400);
    }

    void setupPlayer();

    return () => {
      cancelled = true;
    };
  }, [onSyncState, participantId, watchParty]);

  useEffect(() => () => {
    window.clearTimeout(releaseSuppressTimerRef.current);
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

    suppressEventsRef.current = true;

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

    window.clearTimeout(releaseSuppressTimerRef.current);
    releaseSuppressTimerRef.current = window.setTimeout(() => {
      suppressEventsRef.current = false;
    }, 250);
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
        <span className="count-badge">{watchParty?.videoId ? 'Live' : 'Idle'}</span>
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
        {watchParty?.videoId ? (
          <div className="watch-party-player" ref={playerHostRef} />
        ) : (
          <div className="watch-party-empty">
            <p>Paste a YouTube link to start a shared clip.</p>
          </div>
        )}
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

