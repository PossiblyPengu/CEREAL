import { useState, useEffect, useRef } from 'react';
import type { Game, ChiakiSession } from '../types';

interface StreamOverlayProps {
  sessions: Record<string, ChiakiSession>;
  games: Game[];
  onStop: (gameId: string) => void;
}

export function StreamOverlay({ sessions, games, onStop }: StreamOverlayProps) {
  const [isFs, setIsFs] = useState(false);
  const [barVisible, setBarVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (window.api?.isFullscreen) (window.api as any).isFullscreen().then(setIsFs);
  }, []);

  const toggleFs = async () => {
    if ((window.api as any)?.fullscreen) {
      const fs = await (window.api as any).fullscreen();
      setIsFs(fs);
    }
  };

  const showBar = () => {
    setBarVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setBarVisible(false), 3000);
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (e.clientY < 60 || !barVisible) showBar(); };
    window.addEventListener('mousemove', onMove);
    hideTimer.current = setTimeout(() => setBarVisible(false), 3000);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const entries = Object.entries(sessions).filter(([, s]) =>
    s.state && s.state !== 'disconnected' && s.state !== 'gui'
  );
  if (entries.length === 0) return null;

  const [gameId, sess] = entries[0];
  const game = games.find(g => g.id === gameId);
  const isXbox = (sess as any).platform === 'xbox';
  const displayName = isXbox
    ? ((game && game.name) || 'Xbox Cloud Gaming')
    : (sess.detectedTitle || (game && game.name) || 'PlayStation Remote Play');
  const isEmbedded = isXbox ? (sess.state === 'streaming') : !!(sess as any).embedded;
  const dotClass = 'stream-float-dot' + (sess.state === 'streaming' || isEmbedded ? '' : ' connecting');
  const platformLabel = isXbox ? 'Xbox Cloud Gaming' : 'PS Remote Play';
  const quality = (sess as any).quality;
  const streamInfo = (sess as any).streamInfo;

  return (
    <div className="stream-overlay">
      <div className={'stream-overlay-bar' + (barVisible ? '' : ' stream-bar-hidden')} onMouseEnter={showBar}>
        <div className={dotClass} style={{ flexShrink: 0 }} />
        <div className="stream-overlay-bar-title">{displayName}</div>
        <span style={{ fontSize: 9, color: 'var(--text-4)', flexShrink: 0, padding: '2px 6px', borderRadius: 4, background: 'var(--glass)' }}>{platformLabel}</span>
        {!isXbox && quality?.bitrate && (
          <div className="stream-float-stats">
            <div className="stream-stat">
              <div className="stream-stat-val">{quality.bitrate.toFixed(1)}</div>
              <div className="stream-stat-lbl">Mbps</div>
            </div>
            {quality.fpsActual && (
              <div className="stream-stat">
                <div className="stream-stat-val">{Math.round(quality.fpsActual)}</div>
                <div className="stream-stat-lbl">FPS</div>
              </div>
            )}
            {quality.latencyMs && (
              <div className="stream-stat">
                <div className="stream-stat-val">{Math.round(quality.latencyMs)}</div>
                <div className="stream-stat-lbl">ms</div>
              </div>
            )}
          </div>
        )}
        {!isXbox && streamInfo?.resolution && (
          <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>
            {streamInfo.resolution}{streamInfo.fps ? ' / ' + streamInfo.fps + 'fps' : ''}
          </span>
        )}
        <button className="stream-bar-btn" onClick={toggleFs} title={isFs ? 'Exit Fullscreen' : 'Fullscreen'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 14, height: 14 }}>
            {isFs ? (
              <>
                <path d="M4 14h6v6" /><path d="M20 10h-6V4" />
                <path d="M14 10l7-7" /><path d="M3 21l7-7" />
              </>
            ) : (
              <>
                <path d="M15 3h6v6" /><path d="M9 21H3v-6" />
                <path d="M21 3l-7 7" /><path d="M3 21l7-7" />
              </>
            )}
          </svg>
        </button>
        <button className="stream-float-stop" onClick={() => onStop(gameId)}>Stop</button>
      </div>
      {!isEmbedded && (
        <div className="stream-overlay-body">
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 36, height: 36, border: '2px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
            <div style={{ fontSize: 11, color: 'var(--text-4)', letterSpacing: 1 }}>
              {isXbox ? 'Loading Xbox Cloud Gaming...' : (sess.state === 'connecting' ? 'Connecting to console...' : 'Launching chiaki-ng...')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
