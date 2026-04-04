import { useState, useEffect, useRef } from 'react';
import { PLATFORMS } from '../constants';
import { I } from '../constants';
import { platformLabel, fmtTime, fmtDate, resolveGameImage } from '../utils';
import type { Game } from '../types';

interface FocusViewProps {
  game: Game | null;
  onClose: () => void;
  onLaunch: (game: Game) => void;
  onFav: (id: string) => void;
  onEdit: (game: Game) => void;
  onDelete: (id: string) => void;
  onRefreshGame?: (game: Game) => void;
  gpFocusIdx?: number;
}

export function FocusView({ game: gameProp, onClose, onLaunch, onFav, onEdit, onDelete, onRefreshGame, gpFocusIdx }: FocusViewProps) {
  const [closing, setClosing] = useState(false);
  const [renderedGame, setRenderedGame] = useState<Game | null>(gameProp);
  const [refreshing, setRefreshing] = useState(false);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (gameProp) {
      setRenderedGame(gameProp); setClosing(false);
      requestAnimationFrame(() => closeRef.current?.focus());
    } else if (renderedGame) setClosing(true);
  }, [gameProp]);

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
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (window.confirm('Remove "' + renderedGame.name + '" from library?')) onDelete(renderedGame.id); }
      else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); onEdit(renderedGame); }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); onFav(renderedGame.id); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [renderedGame, zoomSrc, onLaunch, onDelete, onEdit, onFav]);

  if (!renderedGame) return null;

  const game = renderedGame;
  const p = PLATFORMS[game.platform];
  const bgImg = resolveGameImage(game, 'headerUrl') || resolveGameImage(game, 'coverUrl');

  const doRefresh = async () => {
    if (!window.api?.applyMetadata) return;
    setRefreshing(true);
    try {
      const r = await (window.api as any).applyMetadata(game.id, true);
      if (r?.success && r.game && onRefreshGame) onRefreshGame(r.game);
    } catch (_) {}
    setRefreshing(false);
  };

  const g = game as any;
  const mcColor: string = g.metacritic != null && g.metacritic > 0 ? (g.metacritic >= 75 ? '#6dc849' : g.metacritic >= 50 ? '#fdca52' : '#fc4b37') : '#888888';
  const coverSrc = resolveGameImage(game, 'coverUrl');

  return (
    <div className={'focus-overlay' + (closing ? ' closing' : '')} role="dialog" aria-modal="true" aria-label={game.name} onClick={onClose} onAnimationEnd={() => { if (closing) setRenderedGame(null); }}>
      {bgImg && <div className="focus-bg" style={{ backgroundImage: 'url(' + bgImg + ')' }} />}
      <div className="focus-dim" />
      <button className="focus-close" ref={closeRef} onClick={onClose} aria-label="Close">&times;</button>
      <div className="focus-content" onClick={e => e.stopPropagation()}>
        <div className="focus-art">
          {coverSrc && <img src={coverSrc} alt="" onLoad={e => { (e.target as HTMLImageElement).style.display = ''; ((e.target as HTMLElement).nextSibling as HTMLElement).style.display = 'none'; }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; ((e.target as HTMLElement).nextSibling as HTMLElement).style.display = 'flex'; }} />}
          <div className="focus-art-fallback" style={coverSrc ? { display: 'none' } : {}}>{game.name.charAt(0)}</div>
        </div>
        <div className="focus-details">
          <div className="focus-platform-row">
            <div className="focus-platform" style={{ borderColor: p?.color, color: p?.color }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: p?.color, display: 'inline-block' }} />
              {platformLabel(game.platform)}
            </div>
            <button className="focus-refresh" onClick={doRefresh} disabled={refreshing} title="Refresh metadata from online sources">
              {refreshing ? 'Fetching...' : 'Refresh Info'}
            </button>
          </div>
          <div className="focus-title">{game.name}</div>
          {g.metacritic != null && <div className="focus-metacritic" style={{ background: mcColor + '22', color: mcColor, border: '1px solid ' + mcColor + '44' }}>{g.metacritic} Metacritic</div>}
          <div className="focus-meta">
            <span>{fmtTime(game.playtimeMinutes)}</span>
            {game.lastPlayed && <><span style={{ color: 'var(--text-4)' }}>|</span><span>Last played {fmtDate(game.lastPlayed)}</span></>}
          </div>
          {(g.developer || g.publisher || g.releaseDate) && (
            <div className="focus-info-grid">
              {g.developer && <div className="focus-info-item"><span className="focus-info-label">Developer</span><span className="focus-info-value">{g.developer}</span></div>}
              {g.publisher && <div className="focus-info-item"><span className="focus-info-label">Publisher</span><span className="focus-info-value">{g.publisher}</span></div>}
              {g.releaseDate && <div className="focus-info-item"><span className="focus-info-label">Released</span><span className="focus-info-value">{g.releaseDate}</span></div>}
            </div>
          )}
          {game.categories && game.categories.length > 0 && <div className="focus-cats">{game.categories.map(c => <span key={c} className="focus-cat">{c}</span>)}</div>}
          {g.description && <div className="focus-desc">{g.description}</div>}
          {g.notes && <div style={{ marginTop: 8 }}><div className="focus-notes-label">Notes</div><div className="focus-notes">{g.notes}</div></div>}
          {g.screenshots?.length > 0 && <div className="focus-screenshots">{g.screenshots.slice(0, 6).map((s: string, i: number) => <img key={i} src={s} alt="" onClick={e => { e.stopPropagation(); setZoomSrc(s); }} />)}</div>}
          <div className="focus-actions">
            <button className={'btn-play' + (gpFocusIdx === 0 ? ' gp-focus' : '')} onClick={() => onLaunch(game)}><span style={{ display: 'flex', width: 14, height: 14 }}>{I.play}</span> Play</button>
            <button className={'btn-ghost' + (gpFocusIdx === 1 ? ' gp-focus' : '')} onClick={() => onFav(game.id)}><span style={{ display: 'flex', width: 14, height: 14 }}>{game.favorite ? I.starFill : I.star}</span>{game.favorite ? 'Unfav' : 'Fav'}</button>
            <button className={'btn-ghost' + (gpFocusIdx === 2 ? ' gp-focus' : '')} onClick={() => onEdit(game)}><span style={{ display: 'flex', width: 14, height: 14 }}>{I.edit}</span> Edit</button>
            <button className={'btn-ghost danger' + (gpFocusIdx === 3 ? ' gp-focus' : '')} onClick={() => onDelete(game.id)}><span style={{ display: 'flex', width: 14, height: 14 }}>{I.trash}</span></button>
          </div>
        </div>
      </div>
      <div className="focus-esc">ESC to close</div>
      {zoomSrc && <div className="screenshot-zoom" onClick={() => setZoomSrc(null)}><img src={zoomSrc} alt="" onClick={e => e.stopPropagation()} /></div>}
    </div>
  );
}
