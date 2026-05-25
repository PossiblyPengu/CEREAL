import { useState, useEffect, useRef } from 'react';
import { PLATFORMS } from '../constants';
import { I } from '../constants';
import { platformLabel, fmtTime, fmtDate, resolveGameImage, steamImgFallback } from '../utils';
import type { Game, FlashFn } from '../types';

interface FocusViewProps {
  game: Game | null;
  onClose: () => void;
  onLaunch: (game: Game) => void;
  onFav: (id: string) => void;
  onEdit: (game: Game) => void;
  onDelete: (id: string) => void;
  onToggleHidden?: (game: Game) => void;
  onRefreshGame?: (game: Game) => void;
  flash?: FlashFn;
  gpFocusIdx?: number;
}

export function FocusView({ game: gameProp, onClose, onLaunch, onFav, onEdit, onDelete, onToggleHidden, onRefreshGame, flash, gpFocusIdx }: FocusViewProps) {
  const [closing, setClosing] = useState(false);
  const [renderedGame, setRenderedGame] = useState<Game | null>(gameProp);
  const [refreshing, setRefreshing] = useState(false);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [moreActionsBusy, setMoreActionsBusy] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // synchronize local renderedGame for open/close animation
    // schedule state updates asynchronously to avoid synchronous setState in effect
    if (gameProp) {
      // schedule on next animation frame to avoid cascading renders
      requestAnimationFrame(() => {
        setRenderedGame(gameProp);
        setClosing(false);
        // focus after the state update is committed (another frame)
        requestAnimationFrame(() => closeRef.current?.focus());
      });
    } else if (renderedGame) {
      // schedule closing asynchronously
      requestAnimationFrame(() => setClosing(true));
    }
    // Reset transient action state whenever the focused game changes
    setConfirmingDelete(false);
    setMoreActionsBusy(null);
  }, [gameProp, renderedGame]);

  // Focus trap inside dialog
  useEffect(() => {
    if (!renderedGame || closing) return;
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const overlay = document.querySelector('.focus-overlay');
      if (!overlay) return;
      const focusable = Array.from(overlay.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'
      ));
      if (focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
      else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
    };
    window.addEventListener('keydown', trap, true);
    return () => window.removeEventListener('keydown', trap, true);
  }, [renderedGame, closing]);

  useEffect(() => {
    if (!zoomSrc) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setZoomSrc(null); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [zoomSrc]);

  useEffect(() => {
    if (!renderedGame) return;
    const h = (e: KeyboardEvent) => {
      if (zoomSrc) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onLaunch(renderedGame); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        // Mirror the click-twice-to-confirm pattern already used by the Remove button
        // below — replaces the old `window.confirm()` native dialog.
        if (confirmingDelete) { onDelete(renderedGame.id); return; }
        setConfirmingDelete(true);
        setTimeout(() => setConfirmingDelete(false), 4000);
      }
      else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); onEdit(renderedGame); }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); onFav(renderedGame.id); }
      else if ((e.key === 'h' || e.key === 'H') && onToggleHidden) { e.preventDefault(); onToggleHidden(renderedGame); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [renderedGame, zoomSrc, onLaunch, onDelete, onEdit, onFav, onToggleHidden, confirmingDelete]);

  if (!renderedGame) return null;

  const game = renderedGame;
  const p = PLATFORMS[game.platform];
  const bgImg = resolveGameImage(game, 'headerUrl') || resolveGameImage(game, 'coverUrl');

  const doRefresh = async () => {
    const api = (window.api as unknown as { applyMetadata?: (id: string, force?: boolean) => Promise<{ success?: boolean; game?: Game }>; });
    if (!api?.applyMetadata) return;
    setRefreshing(true);
    try {
      const r = await api.applyMetadata(game.id, true);
      if (r?.success && r.game && onRefreshGame) onRefreshGame(r.game);
    } catch (e) { void e; }
    setRefreshing(false);
  };
  const g = game as unknown as {
    metacritic?: number;
    developer?: string;
    publisher?: string;
    releaseDate?: string;
    description?: string;
    notes?: string;
    screenshots?: string[];
    favorite?: boolean;
    id: string;
    name: string;
    playtimeMinutes?: number;
    lastPlayed?: string | number;
    platform?: string;
    website?: string;
  };
  const PLATFORM_CLIENTS: Record<string, string> = {
    steam: 'Steam', epic: 'Epic Games', gog: 'GOG Galaxy',
    ea: 'EA App', battlenet: 'Battle.net', ubisoft: 'Ubisoft Connect',
    itchio: 'itch.io',
  };
  const clientName = (g.platform && PLATFORM_CLIENTS[g.platform]) || null;
  const installApi = (window.api as unknown as { installGame?: (id: string) => Promise<{ success?: boolean; error?: string }> }).installGame;
  const openInClientApi = (window.api as unknown as { openGameInClient?: (id: string) => Promise<{ success?: boolean; error?: string }> }).openGameInClient;
  const isStreaming = g.platform === 'psn' || g.platform === 'psremote' || g.platform === 'xbox';
  const isCustom = g.platform === 'custom';
  const mcColor: string = g.metacritic != null && g.metacritic > 0 ? (g.metacritic >= 75 ? '#6dc849' : g.metacritic >= 50 ? '#fdca52' : '#fc4b37') : '#888888';
  const coverSrc = resolveGameImage(game, 'coverUrl');
  const screenshots = g.screenshots ?? [];

  return (
    <div className={'focus-overlay' + (closing ? ' closing' : '')} role="dialog" aria-modal="true" aria-label={game.name} onClick={onClose} onAnimationEnd={() => { if (closing) setRenderedGame(null); }}>
      {bgImg && <div className="focus-bg" style={{ backgroundImage: 'url(' + bgImg + ')' }} />}
      <div className="focus-dim" />
      <button className="focus-close" ref={closeRef} onClick={onClose} aria-label="Close">&times;</button>
      <div className="focus-content" onClick={e => e.stopPropagation()}>
        <div className="focus-art">
          {coverSrc && <img src={coverSrc} alt="" onLoad={e => { (e.target as HTMLImageElement).style.display = ''; ((e.target as HTMLElement).nextSibling as HTMLElement).style.display = 'none'; }} onError={e => { steamImgFallback(game, e as React.SyntheticEvent<HTMLImageElement>); const img = e.target as HTMLImageElement; const sib = img.nextSibling as HTMLElement; if (img.style.display === 'none' && sib) sib.style.display = 'flex'; }} />}
          <div className="focus-art-fallback" style={coverSrc ? { display: 'none' } : {}}>{game.name.charAt(0)}</div>
        </div>
        <div className="focus-details">
          <div className="focus-platform-row">
            <div className="focus-platform" style={{ borderColor: p?.color, color: p?.color }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: p?.color, display: 'inline-block' }} />
              {platformLabel(game.platform)}
            </div>
            {game.gamePassIncluded && (
              <span className="focus-chip focus-chip-gp" title="Currently included in Xbox Game Pass">
                Game Pass
              </span>
            )}
            {game.xcloudPlayable && (
              <span className="focus-chip focus-chip-cloud" title="Streamable via Xbox Cloud Gaming">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
                Cloud
              </span>
            )}
            <button className="focus-refresh" onClick={doRefresh} disabled={refreshing} title="Refresh metadata from online sources">
              {refreshing ? 'Fetching...' : 'Refresh Info'}
            </button>
          </div>
          <div className="focus-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>{game.name}</span>
            {game.hidden && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}>Hidden</span>}
          </div>
          {g.metacritic != null && <div className="focus-metacritic" style={{ background: mcColor + '22', color: mcColor, border: '1px solid ' + mcColor + '44' }}>{g.metacritic} Metacritic</div>}
          <div className="focus-meta">
            <span>{fmtTime(game.playtimeMinutes)}</span>
            {game.lastPlayed && <><span style={{ color: 'var(--text-4)' }}>|</span><span>Last played {fmtDate(game.lastPlayed)}</span></>}
          </div>
          {(g.developer || g.publisher || g.releaseDate || g.website) && (
            <div className="focus-info-grid">
              {g.developer && <div className="focus-info-item"><span className="focus-info-label">Developer</span><span className="focus-info-value">{g.developer}</span></div>}
              {g.publisher && <div className="focus-info-item"><span className="focus-info-label">Publisher</span><span className="focus-info-value">{g.publisher}</span></div>}
              {g.releaseDate && <div className="focus-info-item"><span className="focus-info-label">Released</span><span className="focus-info-value">{g.releaseDate}</span></div>}
              {g.website && (
                <div className="focus-info-item">
                  <span className="focus-info-label">Website</span>
                  <a
                    href={g.website}
                    onClick={e => { e.preventDefault(); (window.api as unknown as { openExternal?: (u: string) => void }).openExternal?.(g.website!); }}
                    className="focus-info-value"
                    style={{ color: 'var(--accent)', textDecoration: 'none', cursor: 'pointer', wordBreak: 'break-all' }}
                  >
                    {g.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  </a>
                </div>
              )}
            </div>
          )}
          {game.categories && game.categories.length > 0 && <div className="focus-cats">{game.categories.map(c => <span key={c} className="focus-cat">{c}</span>)}</div>}
          {g.description && <div className="focus-desc">{g.description}</div>}
          {g.notes && <div style={{ marginTop: 8 }}><div className="focus-notes-label">Notes</div><div className="focus-notes">{g.notes}</div></div>}
          {screenshots.length > 0 && <div className="focus-screenshots">{screenshots.slice(0, 6).map((s, i) => <img key={i} src={s} alt="" onClick={e => { e.stopPropagation(); setZoomSrc(s); }} />)}</div>}
          <div className="focus-actions">
            <button className={'btn-play' + (gpFocusIdx === 0 ? ' gp-focus' : '')} onClick={() => onLaunch(game)}><span style={{ display: 'flex', width: 14, height: 14 }}>{I.play}</span> Play</button>
            <button className={'btn-ghost' + (gpFocusIdx === 1 ? ' gp-focus' : '')} onClick={() => onFav(game.id)}><span style={{ display: 'flex', width: 14, height: 14 }}>{game.favorite ? I.starFill : I.star}</span>{game.favorite ? 'Unfav' : 'Fav'}</button>
            <button className={'btn-ghost' + (gpFocusIdx === 2 ? ' gp-focus' : '')} onClick={() => onEdit(game)}><span style={{ display: 'flex', width: 14, height: 14 }}>{I.edit}</span> Edit</button>
            {onToggleHidden && (
              <button
                className={'btn-ghost' + (gpFocusIdx === 3 ? ' gp-focus' : '')}
                onClick={() => onToggleHidden(game)}
                title={game.hidden ? 'Show in library again' : 'Hide from library (use Filters → Show hidden to reveal)'}
              >
                <span style={{ display: 'flex', width: 14, height: 14 }}>{game.hidden ? I.eye : I.eyeOff}</span>
                {game.hidden ? 'Unhide' : 'Hide'}
              </button>
            )}
            <button
              className={'btn-ghost danger' + (gpFocusIdx === (onToggleHidden ? 4 : 3) ? ' gp-focus' : '') + (confirmingDelete ? ' confirming' : '')}
              onClick={() => {
                if (confirmingDelete) { onDelete(game.id); return; }
                setConfirmingDelete(true);
                setTimeout(() => setConfirmingDelete(false), 4000);
              }}
              title={confirmingDelete ? 'Click again to confirm' : 'Remove from library'}
            >
              <span style={{ display: 'flex', width: 14, height: 14 }}>{I.trash}</span>
              {confirmingDelete && <span style={{ marginLeft: 6, fontSize: 11 }}>Confirm</span>}
            </button>
          </div>
          {/* "Stream on Xbox Cloud" — explicit cloud-launch alternative.
              Surfaces whenever the default Play button does NOT already go
              to xCloud, i.e. either:
                • Xbox-platform game with a local UWP install (Play = local)
                • Non-Xbox game that also lives in the Game Pass catalog
                  (Play = native client). */}
          {(game.xcloudPlayable || game.xcloudProductId)
            && !(game.platform === 'xbox' && !game.xboxAumid) && (
            <div className="focus-actions" style={{ marginTop: 8 }}>
              <button
                className="btn-ghost"
                onClick={async () => {
                  // Route through launchGame with forceCloud so the main
                  // process owns the URL construction + DRY paths with the
                  // standard launch (streamUrl override, catalog lookup,
                  // Discord presence, lastPlayed bookkeeping).
                  const r = await window.api.launchGame(game.id, { forceCloud: true });
                  if (r && r.success === false && r.error) {
                    flash?.('xCloud launch failed: ' + r.error, { severity: 'error' });
                  } else {
                    flash?.(`Streaming ${game.name} on Xbox Cloud Gaming…`, { severity: 'info' });
                  }
                }}
                title="Open this title in Xbox Cloud Gaming (requires Game Pass Ultimate)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
                Stream on Xbox Cloud
              </button>
            </div>
          )}
          {/* Secondary actions: install / open in client (non-streaming, non-custom only) */}
          {!isStreaming && !isCustom && clientName && (installApi || openInClientApi) && (
            <div className="focus-actions" style={{ marginTop: 8 }}>
              {game.installed === false && installApi && (
                <button
                  className="btn-ghost"
                  disabled={moreActionsBusy === 'install'}
                  onClick={async () => {
                    setMoreActionsBusy('install');
                    try {
                      const r = await installApi(game.id);
                      if (r && r.success === false && r.error) {
                        flash?.('Install failed: ' + r.error, { severity: 'error' });
                      } else if (r && r.success) {
                        flash?.('Opening installer for ' + game.name + '…', { severity: 'info' });
                      }
                    } finally { setMoreActionsBusy(null); }
                  }}
                >
                  <span style={{ display: 'flex', width: 14, height: 14 }}>{I.download}</span>
                  {moreActionsBusy === 'install' ? 'Opening…' : 'Install'}
                </button>
              )}
              {openInClientApi && (
                <button
                  className="btn-ghost"
                  disabled={moreActionsBusy === 'client'}
                  onClick={async () => {
                    setMoreActionsBusy('client');
                    try {
                      const r = await openInClientApi(game.id);
                      if (r && r.success === false && r.error) {
                        flash?.('Couldn’t open ' + clientName + ': ' + r.error, { severity: 'error' });
                      }
                    } finally { setMoreActionsBusy(null); }
                  }}
                >
                  {moreActionsBusy === 'client' ? 'Opening…' : 'Open in ' + clientName}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="focus-esc">ESC · close{onToggleHidden ? ' · H hide' : ''} · Enter play · F fav · E edit</div>
      {zoomSrc && <div className="screenshot-zoom" onClick={() => setZoomSrc(null)}><img src={zoomSrc} alt="" onClick={e => e.stopPropagation()} /></div>}
    </div>
  );
}
