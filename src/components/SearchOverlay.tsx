import { useState, useEffect, useMemo, useRef } from 'react';
import { PLATFORMS } from '../constants';
import { platformLabel, fmtTime, resolveGameImage, steamImgFallback } from '../utils';
import type { Game } from '../types';

interface SearchOverlayProps {
  show: boolean;
  onClose: () => void;
  games: Game[];
  onSelect: (game: Game) => void;
  onLaunch?: (game: Game) => void;
}

// Capped result size by default. The user can opt-in to "show all" if there are more.
const INITIAL_RESULT_CAP = 12;

// Short, human-friendly platform aliases. Lets users type "ps" → PlayStation,
// "xbox cloud" → xCloud, etc. Used in addition to the canonical label.
const PLATFORM_ALIASES: Record<string, string[]> = {
  steam:     ['valve'],
  epic:      ['egs', 'epic games'],
  gog:       ['gog galaxy', 'good old games'],
  battlenet: ['blizzard', 'bnet', 'battle.net'],
  ea:        ['origin', 'ea app'],
  ubisoft:   ['uplay', 'connect'],
  itchio:    ['itch.io', 'itch'],
  xbox:      ['xcloud', 'xbox cloud', 'xbox cloud gaming', 'gamepass'],
  psn:       ['ps', 'playstation', 'sony', 'ps4', 'ps5'],
  psremote:  ['ps', 'playstation', 'chiaki', 'remote play'],
  custom:    ['executable', 'exe'],
};

/**
 * Score how well a game matches the query. Higher = better match.
 * 0 means no match. Order roughly:
 *   100 — exact name match
 *    80 — name starts with query
 *    60 — name contains query at a word boundary
 *    40 — name contains query anywhere
 *    25 — developer/publisher match
 *    15 — category match
 *    10 — platform label/alias match
 */
function scoreGame(g: Game, qLower: string): number {
  if (!qLower) return 0;
  let best = 0;

  const name = (g.name || '').toLowerCase();
  if (name === qLower) best = Math.max(best, 100);
  else if (name.startsWith(qLower)) best = Math.max(best, 80);
  else if (new RegExp('\\b' + qLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(name)) best = Math.max(best, 60);
  else if (name.includes(qLower)) best = Math.max(best, 40);

  const dev = (g.developer || '').toLowerCase();
  const pub = (g.publisher || '').toLowerCase();
  if (dev.includes(qLower) || pub.includes(qLower)) best = Math.max(best, 25);

  if (g.categories?.some(c => c.toLowerCase().includes(qLower))) best = Math.max(best, 15);

  const plat = PLATFORMS[g.platform];
  const platLabel = (plat?.label || '').toLowerCase();
  const aliases = PLATFORM_ALIASES[g.platform] || [];
  if (platLabel.includes(qLower) || aliases.some(a => a.toLowerCase().includes(qLower))) {
    best = Math.max(best, 10);
  }

  // Game Pass / xCloud awareness. Typing "gamepass" or "cloud" should surface
  // titles flagged in our Xbox library cross-reference. We score these lower
  // than name/dev hits but higher than a bare platform-alias hit so the
  // results are intuitively ordered.
  if (g.gamePassIncluded && /\b(gamepass|game pass|xgp|gp)\b/.test(qLower)) {
    best = Math.max(best, 30);
  }
  if (g.xcloudPlayable && /\b(cloud|xcloud|streamable|stream)\b/.test(qLower)) {
    best = Math.max(best, 20);
  }

  return best;
}

export function SearchOverlay({ show, onClose, games, onSelect, onLaunch }: SearchOverlayProps) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(-1);
  const [searchPlat, setSearchPlat] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (show) { setQ(''); setSel(-1); setSearchPlat(null); setShowAll(false); setTimeout(() => inputRef.current?.focus(), 100); }
  }, [show]);

  useEffect(() => { setShowAll(false); setSel(-1); }, [q, searchPlat]);

  useEffect(() => {
    if (!show) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [show, onClose]);

  const { ranked, activePlats } = useMemo(() => {
    if (!q.trim()) return { ranked: [] as Game[], activePlats: [] as string[] };
    const qLower = q.toLowerCase().trim();
    const scored: { game: Game; score: number }[] = [];
    for (const g of games) {
      const s = scoreGame(g, qLower);
      if (s > 0) scored.push({ game: g, score: s });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tiebreak: more recently played first, then alphabetical.
      const lpA = a.game.lastPlayed ? new Date(a.game.lastPlayed).getTime() : 0;
      const lpB = b.game.lastPlayed ? new Date(b.game.lastPlayed).getTime() : 0;
      if (lpA !== lpB) return lpB - lpA;
      return a.game.name.localeCompare(b.game.name);
    });
    const ranked = scored.map(s => s.game);
    const activePlats = [...new Set(ranked.map(g => g.platform))].filter(p => PLATFORMS[p]);
    return { ranked, activePlats };
  }, [q, games]);

  if (!show) return null;

  const filtered = searchPlat ? ranked.filter(g => g.platform === searchPlat) : ranked;
  const hits = showAll ? filtered : filtered.slice(0, INITIAL_RESULT_CAP);
  const hiddenCount = Math.max(0, filtered.length - hits.length);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, -1)); }
    else if (e.key === 'Enter' && e.ctrlKey) {
      const target = hits[sel >= 0 ? sel : 0];
      if (target && onLaunch) { onLaunch(target); onClose(); }
    } else if (e.key === 'Enter' && sel >= 0 && hits[sel]) {
      onSelect(hits[sel]); onClose();
    } else if (e.key === 'Enter' && sel === -1 && hits[0]) {
      // Pressing Enter without arrowing selects the best match.
      onSelect(hits[0]); onClose();
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
        placeholder="Search games, developer, category, platform…"
        onClick={e => e.stopPropagation()}
      />
      <div className="search-overlay-hint" style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 6, textAlign: 'center' }}>
        ↑↓ select · Enter open details · Ctrl+Enter launch
        {q && filtered.length > 0 && (
          <> · <span style={{ color: 'var(--text-3)' }}>{filtered.length} match{filtered.length === 1 ? '' : 'es'}</span></>
        )}
      </div>
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
                {src ? <img src={src} alt={g.name} onLoad={e => (e.target as HTMLImageElement).style.display = ''} onError={e => steamImgFallback(g, e as React.SyntheticEvent<HTMLImageElement>)} /> : g.name.charAt(0)}
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
        {hiddenCount > 0 && (
          <button
            className="search-more"
            onClick={() => setShowAll(true)}
            type="button"
          >Show {hiddenCount} more {hiddenCount === 1 ? 'match' : 'matches'}</button>
        )}
        {q && hits.length === 0 && <div className="art-picker-empty" style={{ padding: '20px' }}>No matches</div>}
      </div>
    </div>
  );
}
