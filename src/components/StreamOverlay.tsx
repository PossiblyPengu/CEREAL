import { useState, useEffect, useMemo, useRef } from 'react';
import { PLATFORMS } from '../constants';
import type { Game, ChiakiSession } from '../types';

interface StreamOverlayProps {
  sessions: Record<string, ChiakiSession>;
  games: Game[];
  onStop: (gameId: string) => void;
}

/**
 * Active-stream UI. Shared between PlayStation Remote Play (chiaki-ng) and
 * Xbox Cloud Gaming (xCloud).
 *
 * The component is intentionally platform-aware:
 *   - Title bar shows the platform's SVG logo and accent color.
 *   - Connecting body uses a large branded glyph with staged progress copy
 *     that matches what the backend can actually report (Waking → Connecting
 *     → Streaming for PS; Loading → Streaming for Xbox).
 *   - Both PS and Xbox sessions surface live quality stats (bitrate / fps /
 *     latency) with a colour-coded connection-quality indicator. PS stats
 *     come from chiaki-ng; Xbox stats are scraped from the embedded webview's
 *     `RTCPeerConnection.getStats()` via the xCloud preload bridge in
 *     `electron/preload-xcloud.js`.
 */

type SessionEntry = {
  gameId: string;
  sess: ChiakiSession;
  isXbox: boolean;
};

/** Human-friendly labels for the various backend states. */
function stateLabel(state: string, isXbox: boolean): string {
  if (state === 'streaming') return 'Streaming';
  if (state === 'reconnecting') return 'Reconnecting';
  if (state === 'disconnected') return 'Disconnected';
  if (isXbox) {
    if (state === 'loading') return 'Loading';
    if (state === 'connecting') return 'Connecting';
    return 'Starting';
  }
  if (state === 'launching') return 'Starting chiaki-ng';
  if (state === 'connecting') return 'Connecting to console';
  if (state === 'wakeup' || state === 'waking') return 'Waking console';
  if (state === 'registration') return 'Registering';
  return state;
}

/** Stage index (0–2) used by the progress rail in the connecting body. */
function stageIndex(state: string, isXbox: boolean): number {
  if (isXbox) {
    if (state === 'loading') return 0;
    if (state === 'connecting') return 1;
    if (state === 'streaming') return 2;
    return 0;
  }
  if (state === 'launching' || state === 'wakeup' || state === 'waking') return 0;
  if (state === 'connecting' || state === 'registration') return 1;
  if (state === 'streaming') return 2;
  return 0;
}

const STAGES_PS: string[] = ['Wake', 'Connect', 'Stream'];
const STAGES_XBOX: string[] = ['Load', 'Authenticate', 'Stream'];

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  return (hh > 0 ? hh + ':' : '') + pad(mm) + ':' + pad(ss);
}

/** Connection-quality bucket from bitrate + packet loss. Used for the chip dot. */
function qualityBucket(q: { bitrate?: number; packetLoss?: number; latencyMs?: number } | undefined):
  { color: string; label: string } {
  if (!q || q.bitrate == null) return { color: 'var(--text-4)', label: '—' };
  if ((q.packetLoss != null && q.packetLoss > 0.04) || (q.latencyMs != null && q.latencyMs > 120)) {
    return { color: 'var(--red, #f87171)', label: 'Poor' };
  }
  if (q.bitrate < 6 || (q.latencyMs != null && q.latencyMs > 60)) {
    return { color: 'var(--yellow, #fdca52)', label: 'OK' };
  }
  return { color: 'var(--green, #6dc849)', label: 'Good' };
}

export function StreamOverlay({ sessions, games, onStop }: StreamOverlayProps) {
  const [isFs, setIsFs] = useState(false);
  const [barVisible, setBarVisible] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  // Periodic tick (1Hz) to drive the session timer without re-rendering everything else.
  const [, setTick] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active streaming/connecting sessions across both backends.
  const entries: SessionEntry[] = useMemo(() => {
    const out: SessionEntry[] = [];
    for (const [gameId, sess] of Object.entries(sessions)) {
      const state = (sess.state as string | undefined) || '';
      if (!state || state === 'disconnected' || state === 'gui') continue;
      const isXbox = (sess as { platform?: string }).platform === 'xbox';
      out.push({ gameId, sess, isXbox });
    }
    return out;
  }, [sessions]);

  useEffect(() => {
    if (window.api?.isFullscreen) {
      (window.api as unknown as { isFullscreen: () => Promise<boolean> }).isFullscreen().then(setIsFs);
    }
  }, []);

  // Keep activeIdx in range when sessions come and go.
  useEffect(() => {
    if (activeIdx >= entries.length) setActiveIdx(Math.max(0, entries.length - 1));
  }, [entries.length, activeIdx]);

  // 1Hz tick — only running while at least one session is alive.
  useEffect(() => {
    if (entries.length === 0) return;
    const id = setInterval(() => setTick(t => (t + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, [entries.length]);

  const showBar = () => {
    setBarVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!pinned) hideTimer.current = setTimeout(() => setBarVisible(false), 3000);
  };

  // Auto-hide management. Bar reveals when the cursor approaches the top edge;
  // pinned mode disables auto-hide entirely.
  useEffect(() => {
    if (entries.length === 0) return;
    if (pinned) {
      setBarVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      return;
    }
    const onMove = (e: MouseEvent) => { if (e.clientY < 60) showBar(); };
    window.addEventListener('mousemove', onMove);
    hideTimer.current = setTimeout(() => setBarVisible(false), 3000);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, entries.length]);

  // Keyboard shortcuts. Only active while at least one stream session exists.
  useEffect(() => {
    if (entries.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFs(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); setPinned(p => !p); return; }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (confirmStop) { setConfirmStop(false); return; }
        showBar();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length, pinned, isFs, confirmStop]);

  if (entries.length === 0) return null;

  const safeIdx = Math.min(activeIdx, entries.length - 1);
  const { gameId, sess, isXbox } = entries[safeIdx];
  const game = games.find(g => g.id === gameId);

  const platKey = isXbox ? 'xbox' : 'psn';
  const plat = PLATFORMS[platKey];
  const accent = plat?.color || '#0070d1';
  const platformLabel = isXbox ? 'Xbox Cloud Gaming' : 'PS Remote Play';

  const state = (sess.state as string | undefined) || '';
  const isStreamingState = state === 'streaming';
  const isEmbedded = isXbox ? isStreamingState : !!(sess as { embedded?: boolean }).embedded;

  const displayName = isXbox
    ? ((game && game.name) || 'Xbox Cloud Gaming')
    : (sess.detectedTitle || (game && game.name) || 'PlayStation Remote Play');

  const startTime = (sess as { startTime?: number }).startTime || 0;
  const elapsed = startTime ? Date.now() - startTime : 0;

  const quality = (sess as { quality?: { bitrate?: number; fpsActual?: number; latencyMs?: number; packetLoss?: number } }).quality;
  const streamInfo = (sess as { streamInfo?: { resolution?: string; fps?: number; codec?: string } }).streamInfo;
  const host = (sess as { host?: string }).host;
  const consoleName = (sess as { console?: string }).console;

  const stage = stageIndex(state, isXbox);
  const stages = isXbox ? STAGES_XBOX : STAGES_PS;

  const toggleFs = async () => {
    const api = window.api as unknown as { fullscreen?: () => Promise<boolean> };
    if (api?.fullscreen) {
      const fs = await api.fullscreen();
      setIsFs(fs);
    }
  };

  const armStop = () => {
    if (confirmStop) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      setConfirmStop(false);
      onStop(gameId);
      return;
    }
    setConfirmStop(true);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmStop(false), 3500);
  };

  const dotState = isStreamingState ? 'streaming' : (state === 'reconnecting' ? 'reconnecting' : 'connecting');
  // Both PS Remote Play and Xbox Cloud now publish WebRTC stats (the latter
  // via the preload bridge that scrapes RTCPeerConnection.getStats inside the
  // xCloud WebContentsView). One quality bucket helper, two platforms.
  const qb = qualityBucket(quality);

  // Convert the accent into a soft tint we can apply inline (no CSS color-mix dependency).
  const accentSoft = accent + '24';
  const accentBorder = accent + '55';

  return (
    <div
      className="stream-overlay"
      style={{ ['--stream-accent' as string]: accent, ['--stream-accent-soft' as string]: accentSoft, ['--stream-accent-border' as string]: accentBorder }}
    >
      <div
        className={'stream-overlay-bar' + (barVisible ? '' : ' stream-bar-hidden') + (pinned ? ' pinned' : '')}
        onMouseEnter={showBar}
      >
        <div className="stream-bar-brand" aria-hidden>
          <span className="stream-bar-logo" style={{ color: accent }}>{plat?.icon}</span>
        </div>

        {entries.length > 1 ? (
          <div className="stream-bar-tabs" role="tablist">
            {entries.map((e, i) => {
              const g = games.find(x => x.id === e.gameId);
              const label = e.isXbox
                ? ((g && g.name) || 'Xbox')
                : ((e.sess.detectedTitle as string) || (g && g.name) || 'PlayStation');
              const eColor = (PLATFORMS[e.isXbox ? 'xbox' : 'psn']?.color) || accent;
              return (
                <button
                  key={e.gameId}
                  role="tab"
                  aria-selected={i === safeIdx}
                  className={'stream-bar-tab' + (i === safeIdx ? ' active' : '')}
                  style={i === safeIdx ? { color: eColor, borderColor: eColor + '55' } : undefined}
                  onClick={() => setActiveIdx(i)}
                  title={label}
                >
                  <span className="stream-bar-tab-dot" style={{ background: eColor }} />
                  <span className="stream-bar-tab-lbl">{label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="stream-bar-title-grp">
            <div className={'stream-bar-state-dot ' + dotState} aria-hidden />
            <div className="stream-bar-title-stack">
              <div className="stream-bar-title" title={displayName}>{displayName}</div>
              <div className="stream-bar-sub">
                <span className="stream-bar-platform" style={{ color: accent }}>{platformLabel}</span>
                <span className="stream-bar-sep">·</span>
                <span>{stateLabel(state, isXbox)}</span>
                {startTime > 0 && <>
                  <span className="stream-bar-sep">·</span>
                  <span className="stream-bar-time" title="Session duration">{formatDuration(elapsed)}</span>
                </>}
              </div>
            </div>
          </div>
        )}

        <div className="stream-bar-stats-grp">
          {isStreamingState && quality?.bitrate != null && qb && (
            <div className="stream-bar-stats" aria-label="Connection quality">
              <div className="stream-stat" title={'Quality: ' + qb.label}>
                <span className="stream-stat-dot" style={{ background: qb.color }} />
                <span className="stream-stat-val">{quality.bitrate.toFixed(1)}</span>
                <span className="stream-stat-lbl">Mbps</span>
              </div>
              {quality.fpsActual != null && (
                <div className="stream-stat">
                  <span className="stream-stat-val">{Math.round(quality.fpsActual)}</span>
                  <span className="stream-stat-lbl">FPS</span>
                </div>
              )}
              {quality.latencyMs != null && (
                <div className="stream-stat">
                  <span className="stream-stat-val">{Math.round(quality.latencyMs)}</span>
                  <span className="stream-stat-lbl">ms</span>
                </div>
              )}
            </div>
          )}
          {!isXbox && streamInfo?.resolution && (
            <span className="stream-bar-resolution" title="Negotiated resolution">
              {streamInfo.resolution}{streamInfo.fps ? '@' + streamInfo.fps : ''}
            </span>
          )}
        </div>

        <button
          className={'stream-bar-btn' + (pinned ? ' active' : '')}
          onClick={() => setPinned(p => !p)}
          title={pinned ? 'Unpin bar (Ctrl+B)' : 'Pin bar (Ctrl+B)'}
          aria-pressed={pinned}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
            <line x1="12" y1="17" x2="12" y2="22" />
            <path d="M5 17h14l-1.4-2.8a4 4 0 0 1-.4-1.8V8a3 3 0 0 0-3-3h-4.4a3 3 0 0 0-3 3v4.4a4 4 0 0 1-.4 1.8z" />
          </svg>
        </button>
        <button className="stream-bar-btn" onClick={toggleFs} title={isFs ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}>
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
        <button
          className={'stream-float-stop' + (confirmStop ? ' confirming' : '')}
          onClick={armStop}
          title={confirmStop ? 'Click again to confirm' : 'Stop streaming'}
        >
          {confirmStop ? 'Confirm stop' : 'Stop'}
        </button>
      </div>

      {/* Subtle reveal-edge — gives the user a clue that the bar is hidden up top. */}
      {!barVisible && (
        <div className="stream-reveal" onMouseEnter={showBar} aria-hidden />
      )}

      {!isEmbedded && (
        <div className="stream-overlay-body">
          <div className="stream-connect-card">
            <div className="stream-connect-glyph" style={{ color: accent, boxShadow: '0 0 80px ' + accent + '55' }} aria-hidden>
              {plat?.icon}
            </div>
            <div className="stream-connect-title">{displayName}</div>
            <div className="stream-connect-sub">
              <span style={{ color: accent }}>{platformLabel}</span>
              {host && <><span className="stream-bar-sep">·</span>{consoleName || host}</>}
              {startTime > 0 && <>
                <span className="stream-bar-sep">·</span>
                <span title="Elapsed">{formatDuration(elapsed)}</span>
              </>}
            </div>

            <div className="stream-stages" role="status" aria-live="polite">
              {stages.map((label, i) => {
                const done = i < stage;
                const active = i === stage;
                return (
                  <div key={label} className={'stream-stage' + (active ? ' active' : '') + (done ? ' done' : '')}>
                    <div className="stream-stage-dot" style={active ? { background: accent, boxShadow: '0 0 10px ' + accent } : (done ? { background: accent } : undefined)} />
                    <div className="stream-stage-label">{label}</div>
                    {i < stages.length - 1 && (
                      <div className={'stream-stage-rail' + (done ? ' done' : '')} style={done ? { background: accent } : undefined} />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="stream-connect-status">{stateLabel(state, isXbox)}…</div>

            <button className="stream-connect-cancel" onClick={armStop}>
              {confirmStop ? 'Click again to cancel' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
