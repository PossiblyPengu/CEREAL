import { useState, useEffect, useRef } from 'react';
import { PLATFORMS } from '../constants';
import { platformLabel, fmtTime, resolveGameImage } from '../utils';
import type { Game } from '../types';

interface SearchOverlayProps {
  show: boolean;
  onClose: () => void;
  games: Game[];
  onSelect: (game: Game) => void;
  onLaunch?: (game: Game) => void;
}

export function SearchOverlay({ show, onClose, games, onSelect, onLaunch }: SearchOverlayProps) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(-1);
  const [searchPlat, setSearchPlat] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (show) { setQ(''); setSel(-1); setSearchPlat(null); setTimeout(() => inputRef.current?.focus(), 100); }
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [show, onClose]);

  if (!show) return null;

  const allHits = q.length > 0 ? games.filter(g => g.name.toLowerCase().includes(q.toLowerCase())) : [];
  const hits = (searchPlat ? allHits.filter(g => g.platform === searchPlat) : allHits).slice(0, 12);
  const activePlats = q.length > 0
    ? [...new Set(allHits.map(g => g.platform))].filter(p => PLATFORMS[p])
    : [];

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, -1)); }
    else if (e.key === 'Enter' && e.ctrlKey) {
      const target = hits[sel >= 0 ? sel : 0];
      if (target && onLaunch) { onLaunch(target); onClose(); }
    } else if (e.key === 'Enter' && sel >= 0 && hits[sel]) {
      onSelect(hits[sel]); onClose();
    }
  };

  return (
    <div className="search-overlay" onClick={onClose}>
      <button className="search-esc">ESC</button>
      <input
        ref={inputRef}
        value={q}
        onChange={e => { setQ(e.target.value); setSel(-1); }}
        onKeyDown={onKey}
        placeholder="Search games..."
        onClick={e => e.stopPropagation()}
      />
      <div className="search-results" onClick={e => e.stopPropagation()} role="listbox">
        {activePlats.length > 1 && (
          <div className="search-plat-chips">
            <button className={'search-plat-chip' + (searchPlat === null ? ' active' : '')} onClick={() => setSearchPlat(null)}>All</button>
            {activePlats.map(p => (
              <button key={p} className={'search-plat-chip' + (searchPlat === p ? ' active' : '')} onClick={() => setSearchPlat(p === searchPlat ? null : p)} style={{ color: searchPlat === p ? undefined : PLATFORMS[p].color }}>
                {PLATFORMS[p].label}
              </button>
            ))}
          </div>
        )}
        {hits.map((g, i) => {
          const src = resolveGameImage(g, 'coverUrl');
          return (
            <div key={g.id} className={'search-hit' + (i === sel ? ' selected' : '')} onClick={() => { onSelect(g); onClose(); }} role="option" aria-selected={i === sel}>
              <div className="search-hit-cover">
                {src ? <img src={src} alt={g.name} onLoad={e => (e.target as HTMLImageElement).style.display = ''} onError={e => (e.target as HTMLImageElement).style.display = 'none'} /> : g.name.charAt(0)}
              </div>
              <div>
                <div className="search-hit-name">{g.name}</div>
                <div className="search-hit-meta">{platformLabel(g.platform)} &middot; {fmtTime(g.playtimeMinutes)}</div>
              </div>
              {onLaunch && (
                <button className="btn-sm primary" style={{ marginLeft: 'auto', flexShrink: 0 }} onClick={e => { e.stopPropagation(); onLaunch(g); onClose(); }} title="Launch (Ctrl+Enter)">▶</button>
              )}
            </div>
          );
        })}
        {q && hits.length === 0 && <div className="art-picker-empty" style={{ padding: '20px' }}>No matches</div>}
      </div>
    </div>
  );
}
