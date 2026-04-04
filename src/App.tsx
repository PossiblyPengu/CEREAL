import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import ReactDOM from 'react-dom';
import type { Game, Settings, ChiakiSession } from './types';
import { PLATFORMS, STREAMING_PLATFORMS, CLUSTER_CENTERS, GALAXY_W, GALAXY_H, THEMES, I } from './constants';
import { applyTheme, applyUiScale, resolveGameImage, fmtTime, useGamepad } from './utils';
import { Toast } from './components/Toast';
import { SearchOverlay } from './components/SearchOverlay';
import { FocusView } from './components/FocusView';
import { AddPanel } from './components/AddPanel';
import { DetectPanel } from './components/DetectPanel';
import { ContinueBanner } from './components/ContinueBanner';
import { StartupWizard } from './components/StartupWizard';
import { StreamOverlay } from './components/StreamOverlay';
import { MediaPlayer } from './components/MediaPlayer';

const PlatformsPanel = lazy(() => import('./components/PlatformsPanel').then(m => ({ default: m.PlatformsPanel })));
const ChiakiPanel    = lazy(() => import('./components/ChiakiPanel').then(m => ({ default: m.ChiakiPanel })));
const XcloudPanel    = lazy(() => import('./components/XcloudPanel').then(m => ({ default: m.XcloudPanel })));
const SettingsPanel  = lazy(() => import('./components/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const ArtPicker      = lazy(() => import('./components/ArtPicker').then(m => ({ default: m.ArtPicker })));

// ─── Progressive Card Grid ─────────────────────────────────────────────────
// Renders cards in chunks to avoid 1500+ DOM nodes on initial paint.
const INITIAL_CARDS = 60;
const CARDS_PER_BATCH = 40;

interface PlatformCardSectionProps {
  plat: string;
  games: Game[];
  cardIdxStart: number;
  gpActive: boolean;
  gpArea: string;
  gpIdx: number;
  isDimmed: (g: Game) => boolean;
  onOpen: (g: Game) => void;
  onLaunch: (g: Game) => void;
  onFav: (id: string) => void;
}

const PlatformCardSection = React.memo(function PlatformCardSection({ plat, games: sortedGms, cardIdxStart, gpActive, gpArea, gpIdx, isDimmed, onOpen, onLaunch, onFav }: PlatformCardSectionProps) {
  const p = PLATFORMS[plat];
  const [visibleCount, setVisibleCount] = useState(Math.min(sortedGms.length, INITIAL_CARDS));
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevGamesLen = useRef(sortedGms.length);

  // Reset visible count when game list changes significantly (filter/sort)
  useEffect(() => {
    if (sortedGms.length !== prevGamesLen.current) {
      setVisibleCount(Math.min(sortedGms.length, INITIAL_CARDS));
      prevGamesLen.current = sortedGms.length;
    }
  }, [sortedGms.length]);

  // IntersectionObserver to load more cards as user scrolls
  useEffect(() => {
    if (visibleCount >= sortedGms.length) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisibleCount(v => Math.min(v + CARDS_PER_BATCH, sortedGms.length));
      }
    }, { rootMargin: '400px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [visibleCount, sortedGms.length]);

  return (
    <div className="card-platform-section">
      <div className="card-platform-header">
        <div className="card-platform-dot" style={{ background: p.color }} />
        <span className="card-platform-name">{p.label}</span>
        <span className="card-platform-count">{sortedGms.length}</span>
      </div>
      <div className="card-grid">
        {sortedGms.slice(0, visibleCount).map((g: Game, gi: number) => {
          const dim = isDimmed(g);
          const cardIdx = cardIdxStart + gi;
          const isFocused = gpActive && gpArea === 'cards' && gpIdx === cardIdx;
          return (
            <GameCard key={g.id}
              game={g}
              dim={dim}
              isFocused={isFocused}
              platColor={p.color}
              platLetter={(p as any).letter}
              animDelay={Math.min(gi, 15) * 0.04 + 's'}
              noAnim={gi >= INITIAL_CARDS}
              onOpen={onOpen}
              onLaunch={onLaunch}
              onFav={onFav}
            />
          );
        })}
      </div>
      {visibleCount < sortedGms.length && (
        <div ref={sentinelRef} style={{ height: 1 }} />
      )}
    </div>
  );
});

interface GameCardProps {
  game: Game;
  dim: boolean;
  isFocused: boolean;
  platColor: string;
  platLetter: string;
  animDelay: string;
  noAnim?: boolean;
  onOpen: (g: Game) => void;
  onLaunch: (g: Game) => void;
  onFav: (id: string) => void;
}
const GameCard = React.memo(function GameCard({ game: g, dim, isFocused, platColor, platLetter, animDelay, noAnim, onOpen, onLaunch, onFav }: GameCardProps) {
  const covSrc = resolveGameImage(g, 'coverUrl');
  return (
    <div
      className={'game-card' + (noAnim ? ' no-anim' : '') + (dim ? ' dimmed' : '') + (isFocused ? ' gp-focus' : '') + (g.installed === false ? ' not-installed' : '')}
      style={noAnim ? undefined : { animationDelay: animDelay }}
      role="button"
      tabIndex={dim ? -1 : 0}
      aria-label={g.name}
      onClick={() => onOpen(g)}
      onDoubleClick={e => { e.preventDefault(); e.stopPropagation(); onLaunch(g); }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(g); return; }
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const cards = Array.from(document.querySelectorAll<HTMLElement>('.game-card[tabindex="0"]'));
          const idx = cards.indexOf(e.currentTarget as HTMLElement);
          if (e.key === 'ArrowRight' && idx < cards.length - 1) { cards[idx + 1].focus(); return; }
          if (e.key === 'ArrowLeft' && idx > 0) { cards[idx - 1].focus(); return; }
          const el = e.currentTarget as HTMLElement;
          const cols = Math.max(1, Math.round((el.parentElement?.offsetWidth ?? el.offsetWidth) / el.offsetWidth));
          if (e.key === 'ArrowDown' && idx + cols < cards.length) cards[idx + cols].focus();
          else if (e.key === 'ArrowUp' && idx - cols >= 0) cards[idx - cols].focus();
        }
      }}>
      <div className="card-cover">
        {covSrc && <img src={covSrc} alt="" loading="lazy" decoding="async" onLoad={e => { (e.target as HTMLImageElement).style.display = ''; const sib = (e.target as HTMLImageElement).nextSibling as HTMLElement; if (sib) sib.style.display = 'none'; }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; const sib = (e.target as HTMLImageElement).nextSibling as HTMLElement; if (sib) sib.style.display = 'flex'; }} />}
        <div className="card-cover-fallback" style={covSrc ? { display: 'none' } : {}}>{g.name.charAt(0)}</div>
        <div className="card-plat-badge" style={{ background: 'rgba(0,0,0,0.55)', color: platColor }}>{platLetter}</div>
        {g.favorite && <div className="card-fav"><svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg></div>}
        {g.installed === false && <div className="card-not-installed-badge" title="Not installed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg></div>}
        <div className="card-hover-actions">
          <button className="card-hover-btn play" onClick={e => { e.stopPropagation(); onLaunch(g); }}>Play</button>
          <button className="card-hover-btn ghost" onClick={e => { e.stopPropagation(); onFav(g.id); }}>{g.favorite ? 'Unfav' : 'Fav'}</button>
        </div>
      </div>
      <div className="card-info">
        <div className="card-name">{g.name}</div>
        <div className="card-meta">{fmtTime(g.playtimeMinutes)}</div>
      </div>
    </div>
  );
});

export default function App() {
  const [importProgress, setImportProgress] = useState<any>(null);
  const [metaProgress, setMetaProgress] = useState<any>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [games, setGames] = useState<Game[]>([]);
  const [gamesLoaded, setGamesLoaded] = useState(false);
  const [cats, setCats] = useState<string[]>([]);
  const [tab, setTab] = useState('all');
  const [gameFilter, setGameFilter] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState('');
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [showLayoutPicker, setShowLayoutPicker] = useState(false);
  const [hideSteamSoftware, setHideSteamSoftware] = useState(false);
  const [showInstalledOnly, setShowInstalledOnly] = useState(false);
  const [focusGame, setFocusGame] = useState<Game | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showDetect, setShowDetect] = useState(false);
  const [showPlatforms, setShowPlatforms] = useState(false);
  const [showChiaki, setShowChiaki] = useState(false);
  const [showXcloud, setShowXcloud] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    defaultView: 'orbit', theme: 'midnight', starDensity: 'normal',
    showAnimations: true, autoSyncPlaytime: false, minimizeOnLaunch: false,
    closeToTray: false, defaultTab: 'all', discordPresence: false,
    metadataSource: 'steam', toolbarPosition: 'top',
  });
  const [editGame, setEditGame] = useState<Game | null>(null);
  const [chiakiSessions, setChiakiSessions] = useState<Record<string, ChiakiSession>>({});
  const [toast, setToast] = useState<React.ReactNode>('');
  const [entered, setEntered] = useState(false);
  const [ready, setReady] = useState(false);
  const [viewMode, setViewMode] = useState('orbit');
  const [viewTransition, setViewTransition] = useState<string | null>(null);
  const [galaxyEntering, setGalaxyEntering] = useState(false);
  const [sortBy, setSortBy] = useState('default');
  const [continueBannerDismissed, setContinueBannerDismissed] = useState(false);
  const [cam, setCam] = useState({ zoom: 0.4, x: 0, y: 0 });
  const [animating, setAnimating] = useState(false);
  const [gpIdx, setGpIdx] = useState(-1);
  const [gpArea, setGpArea] = useState('cards');
  const [gpActive, setGpActive] = useState(false);
  const [appUpdate, setAppUpdate] = useState<{ status: string; version?: string; progress?: number } | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const camRef = useRef({ zoom: 0.4, x: 0, y: 0 });
  const dragInfo = useRef({ active: false, sx: 0, sy: 0, cx: 0, cy: 0, moved: false });
  const parallaxRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const parallaxSpeeds = [10, 30, 60];
  const [globalArtPicker, setGlobalArtPicker] = useState<any>(null);
  const artResolve = useRef<((url: string | null) => void) | null>(null);
  const gpMouseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openArtPicker = (opts: any) =>
    new Promise<string | null>(resolve => { artResolve.current = resolve; setGlobalArtPicker(opts); });

  // Parallax
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (viewMode === 'cards') return;
      const cx = e.clientX / window.innerWidth - 0.5;
      const cy = e.clientY / window.innerHeight - 0.5;
      for (let i = 0; i < 3; i++) {
        if (parallaxRefs[i].current) {
          parallaxRefs[i].current!.style.transform = `translate(${-cx * parallaxSpeeds[i]}px,${-cy * parallaxSpeeds[i]}px)`;
        }
      }
    };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, [viewMode]);

  useEffect(() => { camRef.current = cam; }, [cam]);

  useEffect(() => {
    const upd = () => {
      const s = Math.min(1, Math.max(0.65, (window.innerWidth - 600) / 1000 * 0.35 + 0.65));
      document.documentElement.style.setProperty('--tb-scale', String(s));
    };
    upd();
    window.addEventListener('resize', upd);
    return () => window.removeEventListener('resize', upd);
  }, []);

  const flash = useCallback((m: React.ReactNode) => { setToast(''); setTimeout(() => setToast(m), 30); }, []);

  const fitAll = () => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const z = Math.min(vw / GALAXY_W, vh / GALAXY_H) * 0.9;
    const nx = (vw - GALAXY_W * z) / 2, ny = (vh - GALAXY_H * z) / 2;
    setAnimating(true); setCam({ zoom: z, x: nx, y: ny }); setTimeout(() => setAnimating(false), 650);
  };

  const flyTo = (cx: number, cy: number, tz?: number) => {
    const z = tz || 1.6;
    const vw = window.innerWidth, vh = window.innerHeight;
    setAnimating(true); setCam({ zoom: z, x: vw / 2 - cx * z, y: vh / 2 - cy * z }); setTimeout(() => setAnimating(false), 650);
  };

  const zoomIn = () => {
    const hw = window.innerWidth / 2, hh = window.innerHeight / 2;
    setAnimating(true);
    setCam(c => { const nz = Math.min(5, c.zoom * 1.4); const r = nz / c.zoom; return { zoom: nz, x: hw - r * (hw - c.x), y: hh - r * (hh - c.y) }; });
    setTimeout(() => setAnimating(false), 350);
  };

  const zoomOut = () => {
    const hw = window.innerWidth / 2, hh = window.innerHeight / 2;
    setAnimating(true);
    setCam(c => { const nz = Math.max(0.15, c.zoom / 1.4); const r = nz / c.zoom; return { zoom: nz, x: hw - r * (hw - c.x), y: hh - r * (hh - c.y) }; });
    setTimeout(() => setAnimating(false), 350);
  };

  const switchView = (mode: string) => {
    if (mode === viewMode || viewTransition) return;
    if (mode === 'orbit' && viewMode === 'cards') {
      setViewTransition('cards-exit');
      setTimeout(() => { setViewMode('orbit'); setViewTransition(null); setGalaxyEntering(true); setTimeout(() => setGalaxyEntering(false), 900); }, 500);
    } else { setViewMode(mode); }
  };

  useEffect(() => {
    if (viewMode === 'orbit') {
      const vw = window.innerWidth, vh = window.innerHeight;
      const z = Math.min(vw / GALAXY_W, vh / GALAXY_H) * 0.9;
      setCam({ zoom: z, x: (vw - GALAXY_W * z) / 2, y: (vh - GALAXY_H * z) / 2 });
    }
  }, [viewMode]);

  // Orbit wheel + drag
  useEffect(() => {
    if (viewMode !== 'orbit') return;
    const vp = viewportRef.current; if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); setAnimating(false);
      const rect = vp.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      setCam(c => { const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; const nz = Math.min(5, Math.max(0.15, c.zoom * f)); const r = nz / c.zoom; return { zoom: nz, x: mx - r * (mx - c.x), y: my - r * (my - c.y) }; });
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return; setAnimating(false);
      const c = camRef.current;
      dragInfo.current = { active: true, sx: e.clientX, sy: e.clientY, cx: c.x, cy: c.y, moved: false };
    };
    let rafId: number | null = null;
    const onMove = (e: MouseEvent) => {
      const d = dragInfo.current; if (!d.active) return;
      if (Math.abs(e.clientX - d.sx) > 3 || Math.abs(e.clientY - d.sy) > 3) d.moved = true;
      const ex = e.clientX, ey = e.clientY;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        setCam(c => ({ ...c, x: d.cx + (ex - d.sx), y: d.cy + (ey - d.sy) }));
      });
    };
    const onUp = () => { dragInfo.current.active = false; };
    vp.addEventListener('wheel', onWheel, { passive: false });
    vp.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      vp.removeEventListener('wheel', onWheel);
      vp.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [viewMode]);

  // Enter / ready animation flags
  useEffect(() => {
    const t1 = setTimeout(() => setEntered(true), 200);
    const t2 = setTimeout(() => setReady(true), 2200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // Chiaki + games refresh listeners
  useEffect(() => {
    let unsubChiaki: (() => void) | null = null;
    let unsubRefresh: (() => void) | null = null;
    if (window.api?.onChiakiEvent) {
      unsubChiaki = window.api.onChiakiEvent!((evt: any) => {
        if (evt.type === 'title_change') {
          setChiakiSessions(prev => {
            const n = { ...prev };
            n[evt.gameId] = { ...(n[evt.gameId] || {}), ...evt, detectedTitle: evt.titleName || evt.gameName || '' };
            return n;
          });
          if (evt.gameName) flash('Now playing: ' + evt.gameName);
          return;
        }
        setChiakiSessions(prev => {
          const n = { ...prev };
          if ((evt.type === 'disconnected' || evt.type === 'chiaki_disconnect') && evt.reason !== 'transient_error') delete n[evt.gameId];
          else n[evt.gameId] = { ...(n[evt.gameId] || {}), ...evt };
          return n;
        });
      });
    }
    if (window.api?.onGamesRefresh) {
      unsubRefresh = window.api.onGamesRefresh!((g: Game[]) => {
        const incoming = g || [];
        setGames(prev => {
          const prevMap = new Map((prev || []).map(x => [x.id, x]));
          return incoming.map((ng: Game) => {
            const prevG = prevMap.get(ng.id);
            const prevStamp = (prevG as any)?._imgStamp || 0;
            const newStamp = (ng as any)._imgStamp || 0;
            const stamp = Math.max(prevStamp, newStamp);
            return stamp ? { ...ng, _imgStamp: stamp } : ng;
          });
        });
      });
    }
    return () => { unsubChiaki?.(); unsubRefresh?.(); };
  }, []);

  // Load initial data
  useEffect(() => {
    (async () => {
      if (window.api) {
        const [g, c, s] = await Promise.all([
          window.api.getGames(),
          window.api.getCategories(),
          (window.api as any).getSettings?.(),
        ]);
        setGames(g || []);
        setCats(c || []);
        if (s) {
            setSettings(s);
            if (s.defaultView) setViewMode(s.defaultView);
            if (s.defaultTab) setTab(s.defaultTab);
            if (s.theme) applyTheme(s.theme);
            if (s.accentColor) {
              document.documentElement.style.setProperty('--accent', s.accentColor);
              document.documentElement.style.setProperty('--accent-soft', s.accentColor + '1f');
              document.documentElement.style.setProperty('--accent-border', s.accentColor + '4d');
            }
            if (s.uiScale) applyUiScale(s.uiScale);
            if (s.filterPlatforms && Array.isArray(s.filterPlatforms)) setSelectedPlatforms(s.filterPlatforms);
            if (s.filterCategories && Array.isArray(s.filterCategories)) setSelectedCategories(s.filterCategories);
            if (s.filterHideSteamSoftware) setHideSteamSoftware(!!s.filterHideSteamSoftware);
            setShowWizard(s.firstRun !== false);
          }
        setGamesLoaded(true);
      } else {
        setCats(['Action', 'Adventure', 'RPG', 'Strategy', 'Puzzle', 'Simulation', 'Sports', 'FPS', 'Indie', 'Multiplayer']);
        setGames([
          { id: '1', name: 'Cyberpunk 2077', platform: 'steam', platformId: '1091500', coverUrl: 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1091500/library_600x900.jpg', categories: ['Action', 'RPG'], playtimeMinutes: 1240, lastPlayed: '2025-01-28T10:30:00Z', addedAt: '2024-06-15', favorite: true },
          { id: '2', name: 'Elden Ring', platform: 'steam', platformId: '1245620', coverUrl: 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1245620/library_600x900.jpg', categories: ['Action', 'RPG', 'Adventure'], playtimeMinutes: 840, lastPlayed: '2025-02-01T14:00:00Z', addedAt: '2024-03-10', favorite: true },
          { id: '3', name: 'Hades', platform: 'steam', platformId: '1145360', coverUrl: 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1145360/library_600x900.jpg', categories: ['Action', 'Indie'], playtimeMinutes: 320, lastPlayed: '2025-01-15T18:00:00Z', addedAt: '2024-08-20', favorite: false },
          { id: '10', name: 'Fortnite', platform: 'epic', coverUrl: '', categories: ['Action', 'Multiplayer', 'FPS'], playtimeMinutes: 3200, lastPlayed: '2025-02-10T22:00:00Z', addedAt: '2024-01-01', favorite: false },
          { id: '13', name: 'The Witcher 3', platform: 'gog', coverUrl: '', categories: ['RPG', 'Adventure'], playtimeMinutes: 560, lastPlayed: '2024-12-20', addedAt: '2024-02-14', favorite: false },
          { id: '21', name: 'Forza Horizon 5', platform: 'xbox', coverUrl: '', categories: ['Sports', 'Simulation'], playtimeMinutes: 90, lastPlayed: '2025-01-22', addedAt: '2024-11-10', favorite: false },
        ]);
        setGamesLoaded(true);
      }
    })();
    let unsubImport: (() => void) | null = null;
    if (window.api && (window.api as any).onImportProgress) {
      unsubImport = (window.api as any).onImportProgress((data: any) => {
        try { setImportProgress(data); } catch (_) {}
      });
    }
    return () => { if (unsubImport) unsubImport(); };
  }, []);

  // Auto-dismiss the import progress overlay once done/error
  useEffect(() => {
    if (!importProgress) return;
    if (importProgress.status === 'done' || importProgress.status === 'error') {
      const t = setTimeout(() => setImportProgress(null), 2000);
      return () => clearTimeout(t);
    }
  }, [importProgress]);

  // Auto-dismiss the metadata progress overlay once done
  useEffect(() => {
    if (!metaProgress) return;
    if (metaProgress.phase === 'done') {
      const t = setTimeout(() => setMetaProgress(null), 3000);
      return () => clearTimeout(t);
    }
  }, [metaProgress]);

  // Signal Electron to show the window only after React has committed the loaded state
  useEffect(() => {
    if (gamesLoaded) {
      (window.api as any)?.signalReady?.();
    }
  }, [gamesLoaded]);

  // Persist filters to settings
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        if ((window.api as any)?.saveSettings) {
          await (window.api as any).saveSettings({ filterPlatforms: selectedPlatforms, filterCategories: selectedCategories, filterHideSteamSoftware: hideSteamSoftware });
        }
        setSettings(prev => ({ ...prev, filterPlatforms: selectedPlatforms, filterCategories: selectedCategories, filterHideSteamSoftware: hideSteamSoftware } as Settings));
      } catch (_) {}
    }, 300);
    return () => clearTimeout(t);
  }, [selectedPlatforms, selectedCategories, hideSteamSoftware]);

  // Auto-sync playtime
  useEffect(() => {
    if (!settings.autoSyncPlaytime || !(window.api as any)?.syncPlaytime) return;
    const sync = async () => {
      const r = await (window.api as any).syncPlaytime();
      if (r?.games) setGames(prev => {
        const prevMap = new Map((prev || []).map((x: any) => [x.id, x]));
        return r.games.map((ng: any) => {
          const prevStamp = prevMap.get(ng.id)?._imgStamp || 0;
          const stamp = Math.max(prevStamp, ng._imgStamp || 0);
          return stamp ? { ...ng, _imgStamp: stamp } : ng;
        });
      });
    };
    const initial = setTimeout(sync, 3000);
    const interval = setInterval(sync, 30 * 60 * 1000);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [settings.autoSyncPlaytime]);

  // Animations body attribute (also consumed by CSS for manual override)
  useEffect(() => {
    if (settings.showAnimations === false) document.body.setAttribute('data-no-anim', '');
    else document.body.removeAttribute('data-no-anim');
  }, [settings.showAnimations]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setShowSearch(true); }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); setShowSettings(true); }
      if (e.key === 'Escape') {
        if (focusGame) { setFocusGame(null); return; }
        if (showThemePicker) { setShowThemePicker(false); return; }
        if (showLayoutPicker) { setShowLayoutPicker(false); return; }
        if (showFilters) { setShowFilters(''); return; }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusGame, showThemePicker, showLayoutPicker, showFilters]);

  // Gamepad mouse visibility
  useEffect(() => {
    if (!gpActive) return;
    const h = () => {
      document.body.classList.remove('gp-active');
      if (gpMouseTimer.current) clearTimeout(gpMouseTimer.current);
      gpMouseTimer.current = setTimeout(() => { if (gpActive) document.body.classList.add('gp-active'); }, 2000);
    };
    window.addEventListener('mousemove', h);
    document.body.classList.add('gp-active');
    return () => { window.removeEventListener('mousemove', h); document.body.classList.remove('gp-active'); if (gpMouseTimer.current) clearTimeout(gpMouseTimer.current); };
  }, [gpActive]);

  // Controller connect/disconnect
  useEffect(() => {
    const onConn = (e: GamepadEvent) => { setGpActive(true); flash('Controller connected: ' + ((e.gamepad.id || 'Gamepad').split('(')[0].trim())); };
    const onDisc = () => { setGpActive(false); setGpIdx(-1); flash('Controller disconnected'); };
    window.addEventListener('gamepadconnected', onConn as EventListener);
    window.addEventListener('gamepaddisconnected', onDisc);
    return () => { window.removeEventListener('gamepadconnected', onConn as EventListener); window.removeEventListener('gamepaddisconnected', onDisc); };
  }, []);

  // App auto-update events
  useEffect(() => {
    if (!(window.api as any)?.onUpdateEvent) return;
    return (window.api as any).onUpdateEvent(({ type, data }: any) => {
      if (type === 'update-available') setAppUpdate({ status: 'downloading', version: data?.version });
      else if (type === 'download-progress') setAppUpdate(prev => ({ ...prev!, status: 'downloading', progress: Math.round(data?.percent || 0) }));
      else if (type === 'update-downloaded') setAppUpdate(prev => ({ ...prev!, status: 'ready' }));
      else if (type === 'error') setAppUpdate(null);
    });
  }, []);

  const _updateGameInState = useCallback((updated: Game) => {
    if (!updated) return;
    setGames(prev => prev.map(x => {
      if (x.id !== updated.id) return x;
      return { ...updated, _imgStamp: (updated as any)._imgStamp || Date.now() };
    }));
  }, [setGames]);

  const doLaunch = useCallback(async (game: Game) => {
    if (window.api) {
      const r = await window.api.launchGame(game.id);
      if (r.success) {
        flash('Launching ' + game.name);
        if (r.lastPlayed) _updateGameInState({ ...game, lastPlayed: r.lastPlayed });
        if (settings.minimizeOnLaunch) (window.api as any).minimize?.();
      } else flash('Error: ' + r.error);
    } else flash('Launching ' + game.name + '...');
  }, [flash, settings.minimizeOnLaunch, _updateGameInState]);

  const doFav = useCallback(async (id: string) => {
    if (window.api) { const u = await window.api.toggleFavorite(id); setGames(g => g.map(x => x.id === id ? { ...u, _imgStamp: (x as any)._imgStamp } : x)); }
    else setGames(g => g.map(x => x.id === id ? { ...x, favorite: !x.favorite } : x));
  }, [setGames]);

  const doAdd = async (f: Partial<Game>) => {
    let created: Game | null = null;
    if (window.api) {
      const n = await window.api.addGame(f as Game);
      if (n) { if (n.coverUrl) (n as any)._imgStamp = Date.now(); setGames(g => [...g, n]); created = n; }
    } else {
      const g: Game = { ...f, id: Date.now() + '', addedAt: new Date().toISOString(), playtimeMinutes: 0, favorite: false } as Game;
      setGames(prev => [...prev, g]); created = g;
    }
    setShowAdd(false); setEditGame(null); flash('Game added');
    return created;
  };

  const doEdit = async (f: Game) => {
    let updated: Game | null = null;
    if (window.api) { const u = await window.api.updateGame(f); if (u) { _updateGameInState(u); updated = u; } }
    else { setGames(g => g.map(x => x.id === f.id ? { ...x, ...f, _imgStamp: f.coverUrl ? Date.now() : (x as any)._imgStamp } as Game : x)); updated = f; }
    setShowAdd(false); setEditGame(null); flash('Game updated');
    return updated;
  };

  const doDelete = async (id: string) => {
    if (window.api) await window.api.deleteGame(id);
    setGames(g => g.filter(x => x.id !== id)); setFocusGame(null); flash('Game removed');
  };

  const doImport = async (list: Game[]) => {
    const results: Game[] = [];
    let failed = 0;
    for (const g of list) {
      if (window.api) { try { const n = await window.api.addGame(g); if (n) results.push(n); } catch (_) { failed++; } }
      else results.push({ ...g, id: Date.now() + '' + Math.random(), addedAt: new Date().toISOString(), playtimeMinutes: 0, favorite: false });
    }
    let added = 0, updated = 0;
    setGames(prev => {
      const next = [...prev];
      for (const n of results) { const idx = next.findIndex(x => x.id === n.id); if (idx >= 0) { next[idx] = n; updated++; } else { next.push(n); added++; } }
      return next;
    });
    setShowDetect(false);
    const parts: string[] = []; if (added) parts.push(added + ' new'); if (updated) parts.push(updated + ' updated'); if (failed) parts.push(failed + ' failed');
    flash('Import: ' + (parts.length ? parts.join(', ') : 'no changes'));
  };

  const doSync = async () => {
    if (!window.api || !(window.api as any).syncPlaytime) { flash('Sync not available'); return; }
    flash('Syncing playtime...');
    const r = await (window.api as any).syncPlaytime();
    if (r.games) setGames(prev => {
      const prevMap = new Map((prev || []).map((x: any) => [x.id, x]));
      return r.games.map((ng: any) => {
        const prevStamp = prevMap.get(ng.id)?._imgStamp || 0;
        const stamp = Math.max(prevStamp, ng._imgStamp || 0);
        return stamp ? { ...ng, _imgStamp: stamp } : ng;
      });
    });
    if (r.updated && r.updated.length > 0) flash('Updated playtime for ' + r.updated.length + ' games');
    else flash('Playtime is up to date');
  };

  const doRescanAll = async () => {
    if (!window.api) { flash('Rescan not available'); return; }
    flash('Scanning all platforms...');
    const scanners = [(window.api as any).detectSteam, (window.api as any).detectEpic, (window.api as any).detectGOG, (window.api as any).detectXbox, (window.api as any).detectEA, (window.api as any).detectBattleNet, (window.api as any).detectItchio, (window.api as any).detectUbisoft];
    const results = await Promise.allSettled(scanners.map(fn => fn?.()));
    const all: Game[] = [];
    for (const r of results) { if (r.status === 'fulfilled' && r.value?.games) all.push(...r.value.games); }
    if (all.length === 0) { flash('No new games found'); return; }
    await doImport(all);
  };

  const doFetchAllMetadata = async () => {
    if (!(window.api as any)?.fetchAllMetadata) { flash('Metadata fetch not available'); return; }
    setMetaProgress({ phase: 'metadata', current: 0, total: games.length, updated: 0, failed: 0, name: '' });
    const cleanupMeta = (window.api as any).onMetadataProgress?.((p: any) => {
      setMetaProgress((prev: any) => ({ ...prev, ...p, phase: 'metadata' }));
    });
    const cleanupCover = (window.api as any).onCoverProgress?.((p: any) => {
      if (p.done) {
        setMetaProgress((prev: any) => prev ? { ...prev, phase: 'done' } : null);
      } else {
        setMetaProgress((prev: any) => {
          if (!prev) return null;
          // Capture the initial cover count on first cover progress event
          const coverTotal = prev.coverTotal || p.remaining;
          return { ...prev, phase: 'covers', coverTotal, coverRemaining: p.remaining };
        });
      }
    });
    try {
      const r = await (window.api as any).fetchAllMetadata();
      // Metadata phase done — covers may still be downloading in background
      setMetaProgress((prev: any) => prev ? {
        ...prev, phase: 'covers', current: r.total, total: r.total, updated: r.updated, failed: r.failed,
      } : null);
      // If no covers to download, mark done directly after a short wait
      setTimeout(() => {
        setMetaProgress((prev: any) => {
          if (prev && prev.phase === 'covers') return { ...prev, phase: 'done' };
          return prev;
        });
      }, 3000);
      if (r.updated > 0) flash('Updated metadata for ' + r.updated + ' of ' + r.total + ' games');
      else flash('All metadata is up to date');
    } catch (_) {
      flash('Metadata fetch failed');
      setMetaProgress(null);
    }
    if (cleanupMeta) cleanupMeta();
    if (cleanupCover) cleanupCover();
  };

  const onSettingsChange = (s: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...s }));
    if (s.defaultView) setViewMode(s.defaultView);
    if (s.theme) applyTheme(s.theme as string);
    if ((s as any).accentColor !== undefined && (s as any).accentColor !== '') {
      document.documentElement.style.setProperty('--accent', (s as any).accentColor);
      document.documentElement.style.setProperty('--accent-soft', (s as any).accentColor + '1f');
      document.documentElement.style.setProperty('--accent-border', (s as any).accentColor + '4d');
    }
    if (s.uiScale) applyUiScale(s.uiScale as string);
  };

  const doEditFromFocus = (game: Game) => { setFocusGame(null); setEditGame(game); setShowAdd(true); };

  const isDimmed = useCallback((game: Game) => {
    if (tab === 'all') return false;
    if (tab === 'favorites') return !game.favorite;
    if (tab === 'recent') return !game.lastPlayed;
    return game.platform !== tab;
  }, [tab]);

  const filteredGames = useMemo(() => {
    let list = games.filter(g => !STREAMING_PLATFORMS.includes(g.platform));
    if (tab === 'favorites') list = list.filter(g => g.favorite);
    else if (tab === 'recent') list = list.filter(g => g.lastPlayed).sort((a, b) => new Date(b.lastPlayed!).getTime() - new Date(a.lastPlayed!).getTime());
    else if (tab !== 'all') list = list.filter(g => g.platform === tab);
    const q = (gameFilter || '').trim().toLowerCase();
    if (q) {
      list = list.filter(g => {
        if ((g.name || '').toLowerCase().includes(q)) return true;
        if ((PLATFORMS[g.platform]?.label || '').toLowerCase().includes(q)) return true;
        if ((g.categories || []).some(c => c.toLowerCase().includes(q))) return true;
        return false;
      });
    }
    if (hideSteamSoftware) {
      list = list.filter(g => {
        if (g.platform !== 'steam') return true;
        if ((g as any).software === true) return false;
        if ((g as any).type && typeof (g as any).type === 'string' && (g as any).type.toLowerCase().includes('soft')) return false;
        if ((g.categories || []).some(c => {
          if (!c || typeof c !== 'string') return false;
          const lc = c.toLowerCase();
          return lc.includes('software') || lc.includes('utility') || lc.includes('utilities');
        })) return false;
        const name = (g.name || '').toLowerCase();
        if (/redistributable|redistrib|steamworks|sdk|runtime|\bruntime\b|dedicated server|devkit|vr runtime|mod tools|soundtrack/i.test(name)) return false;
        return true;
      });
    }
    if (showInstalledOnly) list = list.filter(g => g.installed !== false);
    if (selectedPlatforms && selectedPlatforms.length > 0) list = list.filter(g => selectedPlatforms.includes(g.platform));
    if (selectedCategories && selectedCategories.length > 0) list = list.filter(g => (g.categories || []).some(c => selectedCategories.includes(c)));
    return list;
  }, [games, tab, gameFilter, selectedPlatforms, selectedCategories, hideSteamSoftware, showInstalledOnly]);

  const groupedByPlatform = useMemo(() => {
    const groups: Record<string, Game[]> = {};
    filteredGames.forEach(g => { if (!groups[g.platform]) groups[g.platform] = []; groups[g.platform].push(g); });
    return Object.keys(PLATFORMS).filter(k => groups[k]).map(k => ({ platform: k, games: groups[k] }));
  }, [filteredGames]);

  const sortedGroups = useMemo(() => groupedByPlatform.map(({ platform, games: gms }) => ({
    platform, games: sortBy === 'name' ? [...gms].sort((a, b) => a.name.localeCompare(b.name))
      : sortBy === 'played' ? [...gms].sort((a, b) => (b.playtimeMinutes || 0) - (a.playtimeMinutes || 0))
      : sortBy === 'recent' ? [...gms].sort((a, b) => new Date(b.lastPlayed || 0).getTime() - new Date(a.lastPlayed || 0).getTime())
      : sortBy === 'installed' ? [...gms].sort((a, b) => (b.installed === false ? 0 : 1) - (a.installed === false ? 0 : 1) || a.name.localeCompare(b.name))
      : gms,
  })), [groupedByPlatform, sortBy]);

  const activePlatforms = useMemo(() => {
    const s = new Set(filteredGames.map(g => g.platform));
    return Object.keys(PLATFORMS).filter(k => s.has(k) && !STREAMING_PLATFORMS.includes(k));
  }, [filteredGames]);

  const platformCounts = useMemo(() => {
    const m: Record<string, number> = {};
    games.forEach(g => { if (!STREAMING_PLATFORMS.includes(g.platform)) m[g.platform] = (m[g.platform] || 0) + 1; });
    return m;
  }, [games]);

  const mostRecentGame = useMemo(() => {
    return games.reduce<Game | null>((best, g) => {
      if (!g.lastPlayed || STREAMING_PLATFORMS.includes(g.platform)) return best;
      if (!best || new Date(g.lastPlayed).getTime() > new Date(best.lastPlayed!).getTime()) return g;
      return best;
    }, null);
  }, [games]);

  const activeStations = STREAMING_PLATFORMS;

  const orbData = useMemo(() => {
    const groups: Record<string, Game[]> = {};
    filteredGames.forEach(g => { if (g.installed === false) return; if (!groups[g.platform]) groups[g.platform] = []; groups[g.platform].push(g); });
    const allPt = games.map(g => g.playtimeMinutes || 0);
    const maxPt = Math.max(...allPt, 1);
    const result: any[] = []; let idx = 0;
    Object.entries(groups).forEach(([plat, gms]) => {
      const c = CLUSTER_CENTERS[plat] || { x: 1500, y: 1000 };
      const sortedGms = [...gms].sort(sortBy === 'name' ? (a, b) => a.name.localeCompare(b.name) : sortBy === 'recent' ? (a, b) => new Date(b.lastPlayed || 0).getTime() - new Date(a.lastPlayed || 0).getTime() : sortBy === 'installed' ? (a, b) => (b.installed === false ? 0 : 1) - (a.installed === false ? 0 : 1) || a.name.localeCompare(b.name) : (a, b) => (b.playtimeMinutes || 0) - (a.playtimeMinutes || 0));
      const nArms = Math.max(2, Math.ceil(sortedGms.length / 6));
      sortedGms.forEach((game, i) => {
        const pt = game.playtimeMinutes || 0;
        const t = maxPt > 1 ? Math.log(1 + pt) / Math.log(1 + maxPt) : 0;
        let sz = 36 + t * 36; if (game.favorite) sz = Math.max(sz, 50);
        const arm = i % nArms, ai = Math.floor(i / nArms);
        const armOff = arm * (Math.PI * 2 / nArms);
        const theta = armOff + 0.65 * (ai + 1);
        const r = 70 + 50 * (ai + 1) + sz * 0.3;
        const sc = (Math.random() - 0.5) * 16;
        const sx = sc * Math.cos(theta + Math.PI / 2), sy = sc * Math.sin(theta + Math.PI / 2);
        result.push({ game, x: c.x + r * Math.cos(theta) + sx, y: c.y + r * Math.sin(theta) + sy, size: Math.round(sz), driftX: (Math.random() - 0.5) * 10, driftY: (Math.random() - 0.5) * 8, driftDur: 20 + Math.random() * 18, driftDelay: -Math.random() * 15, enterDelay: idx * 0.04 });
        idx++;
      });
    });
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < result.length; i++) {
        for (let j = i + 1; j < result.length; j++) {
          const a = result[i], b = result[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = (a.size + b.size) / 2 + 12;
          if (dist < minDist && dist > 0) {
            const push = (minDist - dist) / 2 + 2;
            const nx2 = dx / dist, ny2 = dy / dist;
            a.x -= nx2 * push; a.y -= ny2 * push;
            b.x += nx2 * push; b.y += ny2 * push;
          }
        }
      }
    }
    return result;
  }, [filteredGames, sortBy]);

  const starLayers = useMemo(() => {
    const base = (settings as any).starDensity === 'low' ? 120 : (settings as any).starDensity === 'high' ? 500 : 280;
    const layers: any[][] = [[], [], []];
    const counts = [Math.round(base * 0.5), Math.round(base * 0.35), Math.round(base * 0.15)];
    for (let d = 0; d < 3; d++) {
      for (let i = 0; i < counts[d]; i++) {
        const bright = d === 2 ? Math.random() > 0.6 : Math.random() > 0.85;
        layers[d].push({ x: Math.random() * 100, y: Math.random() * 100, sz: d === 0 ? 0.4 + Math.random() : d === 1 ? 0.8 + Math.random() * 1.8 : bright ? 1.8 + Math.random() * 2.5 : 1 + Math.random() * 1.5, op: d === 0 ? 0.03 + Math.random() * 0.1 : d === 1 ? 0.08 + Math.random() * 0.2 : bright ? 0.25 + Math.random() * 0.4 : 0.1 + Math.random() * 0.2, tw: d === 0 ? Math.random() > 0.7 : Math.random() > 0.4, twDur: 3 + Math.random() * 6, twDel: Math.random() * 8 });
      }
    }
    return layers;
  }, [(settings as any).starDensity]);

  const galaxyStars = useMemo(() => {
    const count = (settings as any).starDensity === 'low' ? 250 : (settings as any).starDensity === 'high' ? 800 : 500;
    const s: any[] = [];
    for (let i = 0; i < count; i++) {
      const bright = Math.random() > 0.9;
      const hue = Math.random() > 0.82 ? (Math.random() > 0.5 ? 'rgb(180,200,255)' : 'rgb(255,220,180)') : 'white';
      s.push({ x: Math.random() * GALAXY_W, y: Math.random() * GALAXY_H, sz: bright ? 2 + Math.random() * 3 : 0.3 + Math.random() * 2.5, op: bright ? 0.15 + Math.random() * 0.3 : 0.03 + Math.random() * 0.12, hue, tw: Math.random() > 0.45, twDur: 2.5 + Math.random() * 7, twDel: Math.random() * 10 });
    }
    return s;
  }, [(settings as any).starDensity]);

  const shootingStars = useMemo(() => {
    const s: any[] = [];
    for (let i = 0; i < 8; i++) s.push({ x: 150 + Math.random() * (GALAXY_W - 300), y: 80 + Math.random() * (GALAXY_H - 160), angle: -25 + Math.random() * 50, dur: 4 + Math.random() * 8, del: i * 2.5 + Math.random() * 5 });
    return s;
  }, []);

  const anyPanelOpen = showChiaki || showXcloud || showSettings || showAdd || showDetect || showPlatforms || showSearch || showWizard;
  const liveFocus = useMemo(() => focusGame ? games.find(g => g.id === focusGame.id) || focusGame : null, [focusGame, games]);
  const tbPos: string = (settings as any).toolbarPosition || 'top';
  const isVertical = tbPos === 'left' || tbPos === 'right';

  useGamepad(useCallback((actions: string[]) => {
    if (!gpActive) setGpActive(true);
    for (const act of actions) {
      if (act === 'back') {
        if (focusGame) { setFocusGame(null); setGpArea(viewMode === 'cards' ? 'cards' : 'orbit'); continue; }
        if (showSearch) { setShowSearch(false); continue; }
        if (showAdd) { setShowAdd(false); setEditGame(null); continue; }
        if (showDetect) { setShowDetect(false); continue; }
        if (showChiaki) { setShowChiaki(false); continue; }
        if (showXcloud) { setShowXcloud(false); continue; }
        if (showSettings) { setShowSettings(false); continue; }
        if (showPlatforms) { setShowPlatforms(false); continue; }
        if (showWizard) { setShowWizard(false); continue; }
        if (showFilters) { setShowFilters(''); continue; }
        continue;
      }
      if (act === 'start') { setShowSettings(s => !s); continue; }
      if (act === 'select') { setShowSearch(s => !s); continue; }
      if (act === 'y' && !anyPanelOpen && !focusGame) {
        switchView(viewMode === 'cards' ? 'orbit' : 'cards');
        setGpIdx(0); setGpArea(viewMode === 'cards' ? 'orbit' : 'cards'); continue;
      }
      if (anyPanelOpen) continue;
      if (act === 'lb' || act === 'rb') {
        const tabs = ['all', 'favorites', 'recent', ...activePlatforms];
        let ci = tabs.indexOf(tab); if (ci < 0) ci = 0;
        ci = act === 'rb' ? (ci + 1) % tabs.length : (ci - 1 + tabs.length) % tabs.length;
        const nt = tabs[ci]; setTab(nt); setGpIdx(0);
        if (viewMode === 'orbit') { if (nt === 'all') fitAll(); else { const cc = CLUSTER_CENTERS[nt]; if (cc) flyTo(cc.x, cc.y, 1.6); } }
        continue;
      }
      if (focusGame) {
        const focusBtns = ['play', 'fav', 'edit', 'delete'];
        if (act === 'left') setGpIdx(i => (i - 1 + focusBtns.length) % focusBtns.length);
        if (act === 'right') setGpIdx(i => (i + 1) % focusBtns.length);
        if (act === 'confirm') {
          const fi = gpIdx < 0 ? 0 : gpIdx % focusBtns.length;
          if (focusBtns[fi] === 'play') doLaunch(focusGame);
          else if (focusBtns[fi] === 'fav') doFav(focusGame.id);
          else if (focusBtns[fi] === 'edit') { setFocusGame(null); setEditGame(focusGame); setShowAdd(true); }
          else if (focusBtns[fi] === 'delete') doDelete(focusGame.id);
        }
        if (act === 'x') doFav(focusGame.id);
        setGpArea('focus'); continue;
      }
      if (viewMode === 'cards') {
        const allCards: Game[] = [];
        groupedByPlatform.forEach(g => g.games.forEach(gm => allCards.push(gm)));
        if (allCards.length === 0) continue;
        const cols = Math.max(1, Math.floor((window.innerWidth - 64) / 180));
        let idx = Math.max(0, Math.min(gpIdx, allCards.length - 1));
        if (gpArea === 'pill') {
          const pillCount = STREAMING_PLATFORMS.length;
          if (act === 'left') setGpIdx(i => (i - 1 + pillCount) % pillCount);
          if (act === 'right') setGpIdx(i => (i + 1) % pillCount);
          if (act === 'up') { setGpArea('cards'); setGpIdx(Math.max(0, allCards.length - 1)); }
          if (act === 'confirm') { const sp = STREAMING_PLATFORMS[gpIdx % pillCount]; if (sp === 'psn') setShowChiaki(true); else setShowXcloud(true); }
          continue;
        }
        if (act === 'right') { idx = Math.min(allCards.length - 1, idx + 1); setGpIdx(idx); }
        if (act === 'left') { idx = Math.max(0, idx - 1); setGpIdx(idx); }
        if (act === 'down') { const next = idx + cols; if (next >= allCards.length) { setGpArea('pill'); setGpIdx(0); continue; } setGpIdx(next); }
        if (act === 'up') { idx = Math.max(0, idx - cols); setGpIdx(idx); }
        if (act === 'confirm') { setFocusGame(allCards[Math.min(gpIdx, allCards.length - 1)]); setGpIdx(0); setGpArea('focus'); }
        if (act === 'x' && allCards[idx]) doFav(allCards[idx].id);
        setGpArea('cards');
        setTimeout(() => { const el = document.querySelector('.game-card.gp-focus'); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 16);
        continue;
      }
      if (viewMode === 'orbit') {
        if (act === 'r_left' || act === 'r_right' || act === 'r_up' || act === 'r_down') {
          const allPlats = [...activePlatforms, ...STREAMING_PLATFORMS];
          if (allPlats.length === 0) continue;
          let curPlat = tab !== 'all' && tab !== 'favorites' && tab !== 'recent' ? allPlats.indexOf(tab) : -1;
          if (curPlat < 0) curPlat = 0;
          if (act === 'r_right' || act === 'r_down') curPlat = (curPlat + 1) % allPlats.length;
          if (act === 'r_left' || act === 'r_up') curPlat = (curPlat - 1 + allPlats.length) % allPlats.length;
          const np = allPlats[curPlat]; setTab(np);
          const cc = CLUSTER_CENTERS[np]; if (cc) flyTo(cc.x, cc.y, 1.6);
          const firstOrb = orbData.findIndex((o: any) => o.game.platform === np);
          if (firstOrb >= 0) setGpIdx(firstOrb);
          continue;
        }
        if (orbData.length === 0) continue;
        let oi = Math.max(0, Math.min(gpIdx, orbData.length - 1));
        if (act === 'right') oi = (oi + 1) % orbData.length;
        if (act === 'left') oi = (oi - 1 + orbData.length) % orbData.length;
        if (act === 'down') oi = Math.min(orbData.length - 1, oi + 5);
        if (act === 'up') oi = Math.max(0, oi - 5);
        setGpIdx(oi); setGpArea('orbit');
        if (act === 'confirm') { setFocusGame(orbData[oi].game); setGpIdx(0); setGpArea('focus'); continue; }
        if (act === 'x' && orbData[oi]) doFav(orbData[oi].game.id);
        const fo = orbData[oi]; if (fo) flyTo(fo.x, fo.y, Math.max(camRef.current.zoom, 1.2));
        continue;
      }
    }
  }, [gpActive, focusGame, viewMode, tab, activePlatforms, gpIdx, gpArea, anyPanelOpen, showFilters,
      showSearch, showAdd, showDetect, showChiaki, showXcloud, showSettings, showPlatforms, showWizard,
      groupedByPlatform, orbData]));

  return (
    <div className={'pos-' + tbPos + '-layout'} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div className="void-layer">
        {starLayers.map((layer, d) => (
          <div key={d} ref={parallaxRefs[d]} className={'parallax-layer depth-' + d}>
            {layer.map((s: any, i: number) => (
              <div key={i} className={s.tw ? 'bg-star tw' : 'bg-star'} style={{ left: s.x + '%', top: s.y + '%', width: s.sz + 'px', height: s.sz + 'px', opacity: s.op, '--tw-dur': s.twDur + 's', '--tw-del': s.twDel + 's' } as React.CSSProperties} />
            ))}
          </div>
        ))}
      </div>

      {viewMode === 'orbit' && (
        <div className={'galaxy-viewport' + (galaxyEntering ? ' galaxy-entering' : '')} ref={viewportRef} onDoubleClick={fitAll}>
          <div className={'galaxy-canvas' + (animating ? ' fly' : '')} ref={canvasRef} style={{ transform: `translate(${cam.x}px,${cam.y}px) scale(${cam.zoom})`, width: GALAXY_W, height: GALAXY_H }}>
            {galaxyStars.map((s: any, i: number) => (
              <div key={i} className={'galaxy-star' + (s.tw ? ' tw' : '')} style={{ left: s.x, top: s.y, width: s.sz, height: s.sz, background: s.hue, opacity: s.op, '--tw-dur': s.twDur + 's', '--tw-del': s.twDel + 's' } as React.CSSProperties} />
            ))}
            {shootingStars.map((s: any, i: number) => (
              <div key={'sh' + i} style={{ position: 'absolute', left: s.x, top: s.y, transform: `rotate(${s.angle}deg)`, pointerEvents: 'none' }}>
                <div className="shooting-star" style={{ '--sh-dur': s.dur + 's', '--sh-del': s.del + 's' } as React.CSSProperties} />
              </div>
            ))}
            {/* Nebula ambient glows */}
            <div style={{ position: 'absolute', left: 950, top: 500, width: 400, height: 160, borderRadius: '50%', background: 'rgba(100,192,244,0.08)', filter: 'blur(100px)', opacity: 0.02, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: 1850, top: 480, width: 350, height: 140, borderRadius: '50%', background: 'rgba(180,74,255,0.1)', filter: 'blur(90px)', opacity: 0.015, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: 1050, top: 950, width: 500, height: 200, borderRadius: '50%', background: 'rgba(212,168,83,0.08)', filter: 'blur(110px)', opacity: 0.015, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: 2050, top: 950, width: 400, height: 160, borderRadius: '50%', background: 'rgba(16,124,16,0.08)', filter: 'blur(100px)', opacity: 0.015, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: 600, top: 1000, width: 350, height: 300, borderRadius: '50%', background: 'rgba(0,112,209,0.08)', filter: 'blur(120px)', opacity: 0.01, pointerEvents: 'none' }} />
            {activePlatforms.map(plat => {
              const c = CLUSTER_CENTERS[plat]; const p = PLATFORMS[plat]; const col = p.color;
              return (
                <React.Fragment key={plat}>
                  <div className="nebula" style={{ left: c.x, top: c.y, width: 600, height: 600, background: col, opacity: 0.07 }} />
                  <div className="nebula" style={{ left: c.x + 100, top: c.y - 80, width: 350, height: 350, background: col, opacity: 0.03 }} />
                  <div className="nebula" style={{ left: c.x - 60, top: c.y + 70, width: 280, height: 280, background: col, opacity: 0.02 }} />
                  {[90, 150, 220, 300].map(r => (
                    <div key={r} className="orbit-ring" style={{ left: c.x, top: c.y, width: r * 2, height: r * 2, borderColor: r < 160 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.018)' }} />
                  ))}
                  <div className="galaxy-sun" style={{ left: c.x, top: c.y }}>
                    <div className="galaxy-sun-flare" style={{ width: 200, height: 200, background: `radial-gradient(circle,${col} 0%,transparent 70%)`, opacity: 0.1, left: '50%', top: '50%', transform: 'translate(-50%,-50%)', position: 'absolute' }} />
                    <div className="galaxy-sun-corona" style={{ width: 130, height: 130, background: `radial-gradient(circle,${col} 0%,transparent 65%)`, opacity: 0.35 }} />
                    <div className="galaxy-sun-core" style={{ width: 56, height: 56, background: `radial-gradient(circle at 35% 35%,rgba(255,255,255,0.2),${col})`, border: '2px solid rgba(255,255,255,0.1)', boxShadow: `0 0 30px ${col},0 0 60px ${col}` }}>
                      <span style={{ display: 'flex', width: 24, height: 24, color: 'rgba(255,255,255,0.9)' }}>{p.icon}</span>
                    </div>
                  </div>
                  <div className="cluster-label" style={{ left: c.x, top: c.y, fontSize: 80, color: 'rgba(255,255,255,0.03)' }}>{p.label}</div>
                </React.Fragment>
              );
            })}
            {activeStations.map(plat => {
              const c = CLUSTER_CENTERS[plat]; const p = PLATFORMS[plat]; const col = p.color;
              const onClick = () => { if (!dragInfo.current.moved) { plat === 'psn' ? setShowChiaki(true) : setShowXcloud(true); } };
              return (
                <React.Fragment key={'station-' + plat}>
                  <div className="nebula" style={{ left: c.x, top: c.y, width: 350, height: 350, background: col, opacity: 0.04 }} />
                  <div className="cluster-label" style={{ left: c.x, top: c.y, fontSize: 80, color: 'rgba(255,255,255,0.03)' }}>{p.label}</div>
                  <div className="space-station" style={{ left: c.x, top: c.y }} onClick={onClick}>
                    <div className="station-glow" style={{ background: col }} />
                    <div className="station-spokes" style={{ '--spoke-color': `color-mix(in srgb,${col} 25%,transparent)` } as React.CSSProperties} />
                    <div className="station-ring" style={{ borderColor: col, '--dock-color': col } as React.CSSProperties}>
                      {[0, 1, 2, 3].map(d => <div key={d} className="station-dock" style={{ '--dock-color': col } as React.CSSProperties} />)}
                    </div>
                    <div className="station-ring-inner" style={{ borderColor: col }} />
                    <div className="station-hub" style={{ borderColor: col, boxShadow: `0 0 20px ${col},0 0 40px ${col}`, color: col }}>
                      <span style={{ display: 'flex', width: 18, height: 18 }}>{p.icon}</span>
                    </div>
                    <div className="station-label">{p.label}</div>
                  </div>
                </React.Fragment>
              );
            })}
            {orbData.map((o: any, oi: number) => {
              const p = PLATFORMS[o.game.platform];
              const dimmed = isDimmed(o.game);
              const anim = settings.showAnimations !== false;
              const orbFocused = gpActive && gpArea === 'orbit' && gpIdx === oi;
              return (
                <div key={o.game.id} className="orb" style={{ left: o.x, top: o.y, '--drift-x': anim ? o.driftX + 'px' : '0px', '--drift-y': anim ? o.driftY + 'px' : '0px', '--drift-dur': o.driftDur + 's', '--drift-delay': o.driftDelay + 's', animationPlayState: anim ? 'running' : 'paused' } as React.CSSProperties}>
                  <div
                    className={'orb-body' + (entered ? ' entered' : '') + (dimmed ? ' dimmed' : '') + (orbFocused ? ' gp-focus' : '')}
                    style={{ '--orb-size': o.size + 'px', '--orb-color': p?.color || '#555', '--enter-delay': !ready ? o.enterDelay + 's' : '0s' } as React.CSSProperties}
                    role="button"
                    tabIndex={dimmed ? -1 : 0}
                    aria-label={o.game.name}
                    onClick={() => { if (!dragInfo.current.moved) setFocusGame(o.game); }}
                    onDoubleClick={e => { e.stopPropagation(); doLaunch(o.game); }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFocusGame(o.game); } }}>
                    <div className="orb-visual">
                      {(() => { const src = resolveGameImage(o.game, 'coverUrl'); return src ? <img src={src} alt="" onLoad={e => { (e.target as HTMLImageElement).style.display = ''; const sib = (e.target as HTMLImageElement).nextSibling as HTMLElement; if (sib) sib.style.display = 'none'; }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; const sib = (e.target as HTMLImageElement).nextSibling as HTMLElement; if (sib) sib.style.display = 'flex'; }} /> : null; })()}
                      <div className="orb-fallback" style={resolveGameImage(o.game, 'coverUrl') ? { display: 'none' } : {}}>
                        <span style={{ fontSize: o.size * 0.38 + 'px' }}>{o.game.name.charAt(0)}</span>
                      </div>
                    </div>
                    {o.game.favorite && <div className="orb-fav"><svg viewBox="0 0 24 24" fill="currentColor" width="8" height="8"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg></div>}
                    <div className="orb-name">{o.game.name}{o.game.playtimeMinutes ? ' · ' + fmtTime(o.game.playtimeMinutes) : ''}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(viewMode === 'cards' || viewTransition === 'cards-exit') && gamesLoaded && games.length > 0 && (
        <div className={'card-grid-wrap' + (viewTransition === 'cards-exit' ? ' cards-exiting' : '')}>

          {(() => {
            let _ci = 0;
            return sortedGroups.map(({ platform: plat, games: sortedGms }) => {
              const start = _ci;
              _ci += sortedGms.length;
              return (
                <PlatformCardSection key={plat}
                  plat={plat}
                  games={sortedGms}
                  cardIdxStart={start}
                  gpActive={gpActive}
                  gpArea={gpArea}
                  gpIdx={gpIdx}
                  isDimmed={isDimmed}
                  onOpen={setFocusGame}
                  onLaunch={doLaunch}
                  onFav={doFav}
                />
              );
            });
          })()}
          {filteredGames.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-4)', fontSize: '13px' }}>
              No games match this filter.<br />
              <button className="btn-ghost" style={{ marginTop: 12, fontSize: 11 }} onClick={() => { setGameFilter(''); setSelectedPlatforms([]); setSelectedCategories([]); setTab('all'); }}>Clear all filters</button>
            </div>
          )}
        </div>
      )}

      {viewMode === 'cards' && (
        <div className="stream-pill">
          {STREAMING_PLATFORMS.map((plat, pi) => {
            const p = PLATFORMS[plat];
            return (
              <button key={plat} className={'stream-pill-btn' + (gpActive && gpArea === 'pill' && gpIdx === pi ? ' gp-focus' : '')}
                onClick={() => { plat === 'psn' ? setShowChiaki(true) : setShowXcloud(true); }}>
                <div className="sp-icon" style={{ background: p.color + '33', color: p.color }}>{p.icon}</div>
                {plat === 'psn' ? 'Remote Play' : 'Cloud Gaming'}
              </button>
            );
          })}
        </div>
      )}

      <div className="drag-bar" />
      <div className="win-ctrls">
        <button onClick={() => (window.api as any)?.minimize?.()} aria-label="Minimize">{I.min}</button>
        <button onClick={() => (window.api as any)?.maximize?.()} aria-label="Maximize">{I.max}</button>
        <button onClick={() => (window.api as any)?.close?.()} aria-label="Close">{I.close}</button>
      </div>

      <div className={'nav-pill pos-' + tbPos} onClick={() => { setShowThemePicker(false); setShowLayoutPicker(false); }}>
        <div className="nav-brand">Cereal</div>
        <div className="nav-sep" />
        <button className={'chip' + (tab === 'all' ? ' active' : '')} onClick={() => { setTab('all'); if (viewMode === 'orbit') fitAll(); }}>All</button>
        <button className={'chip' + (tab === 'favorites' ? ' active' : '')} onClick={() => setTab('favorites')}>Fav</button>
        <button className={'chip' + (tab === 'recent' ? ' active' : '')} onClick={() => setTab('recent')}>Recent</button>
        <div className="nav-chips-scroll">
          {activePlatforms.map(p => (
            <button key={p}
              className={'chip' + (tab === p ? ' active' : '') + (selectedPlatforms.includes(p) ? ' filter-active' : '')}
              onClick={() => {
                const nt = tab === p ? 'all' : p; setTab(nt);
                if (viewMode === 'orbit') { if (nt === 'all') fitAll(); else { const c = CLUSTER_CENTERS[p]; if (c) flyTo(c.x, c.y, 1.6); } }
              }}
              title={PLATFORMS[p].label}>
              <span className="chip-icon" style={{ width: 14, height: 14, flexShrink: 0, color: PLATFORMS[p].color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{PLATFORMS[p].icon}</span>
              <span className="chip-label" style={{ marginLeft: 5 }}>{PLATFORMS[p].label}</span>
              {platformCounts[p] > 0 && <span className="chip-count">{platformCounts[p]}</span>}
            </button>
          ))}
        </div>
        <div className="nav-sep" />
        {/* Filter button */}
        {(() => {
          const filterCount = selectedPlatforms.length + selectedCategories.length + (hideSteamSoftware ? 1 : 0) + (gameFilter ? 1 : 0) + (showInstalledOnly ? 1 : 0) + (sortBy !== 'default' ? 1 : 0);
          return (
            <div className="nav-filter-wrap" style={{ position: 'relative' }}>
              <button className="nav-btn" onClick={() => setShowFilters(s => s ? '' : 'open')} title="Filter games" style={{ position: 'relative' }}>
                {I.search}
                {filterCount > 0 && <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 16, background: 'var(--accent)', color: '#07070d', fontSize: 9, fontWeight: 700, padding: '0 4px', boxShadow: '0 4px 12px rgba(0,0,0,0.45)' }}>{filterCount}</span>}
              </button>
              {showFilters && (isVertical ? ReactDOM.createPortal : (c: React.ReactNode) => c)(
                <div style={isVertical ? { position: 'fixed', top: '50%', [tbPos === 'left' ? 'left' : 'right']: 72, transform: 'translateY(-50%)', minWidth: 300, maxWidth: 400, background: 'var(--surface)', border: '1px solid var(--glass-border)', borderRadius: 12, padding: 16, boxShadow: '0 12px 48px rgba(0,0,0,0.7)', zIndex: 300 } : { position: 'absolute', ...(tbPos === 'bottom' ? { bottom: 'calc(100% + 6px)' } : { top: 'calc(100% + 6px)' }), right: 0, minWidth: 320, background: 'var(--surface)', border: '1px solid var(--glass-border)', borderRadius: 10, padding: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 200 }}
                  onClick={e => e.stopPropagation()}>
                  <input value={gameFilter} onChange={e => setGameFilter(e.target.value)} placeholder="Search games..." style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--glass-border)', background: 'var(--glass)', color: 'var(--text-2)', fontSize: 12, width: '100%', marginBottom: 12, boxSizing: 'border-box' }} autoFocus />
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Sort by</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                    {([['default', 'Default'], ['name', 'Name'], ['played', 'Most Played'], ['recent', 'Recent'], ['installed', 'Installed']] as [string, string][]).map(([v, l]) => (
                      <button key={v} className={'tag' + (sortBy === v ? ' sel' : '')} onClick={() => setSortBy(v)}>{l}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Platforms</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    {Object.keys(PLATFORMS).map(pk => {
                      const active = selectedPlatforms.includes(pk);
                      return <button key={pk} className={'tag' + (active ? ' sel' : '')} onClick={() => setSelectedPlatforms(prev => prev.includes(pk) ? prev.filter(x => x !== pk) : [...prev, pk])}>{PLATFORMS[pk].label}</button>;
                    })}
                  </div>
                  {cats.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Categories</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                        {cats.map(cat => {
                          const active = selectedCategories.includes(cat);
                          return <button key={cat} className={'tag' + (active ? ' sel' : '')} onClick={() => setSelectedCategories(prev => prev.includes(cat) ? prev.filter(x => x !== cat) : [...prev, cat])}>{cat}</button>;
                        })}
                      </div>
                    </>
                  )}
                  <div className="toggle-row" style={{ marginBottom: 10 }}>
                    <div role="switch" aria-checked={hideSteamSoftware} tabIndex={0} className={'switch' + (hideSteamSoftware ? ' on' : '')}
                      onClick={() => setHideSteamSoftware(s => !s)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHideSteamSoftware(s => !s); } }}>
                      <div className="switch-knob" />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600 }}>Hide Steam software</div>
                  </div>
                  <div className="toggle-row" style={{ marginBottom: 10 }}>
                    <div role="switch" aria-checked={showInstalledOnly} tabIndex={0} className={'switch' + (showInstalledOnly ? ' on' : '')}
                      onClick={() => setShowInstalledOnly(s => !s)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowInstalledOnly(s => !s); } }}>
                      <div className="switch-knob" />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600 }}>Installed only</div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button className="btn-sm" onClick={() => { setGameFilter(''); setSelectedPlatforms([]); setSelectedCategories([]); setHideSteamSoftware(false); setShowInstalledOnly(false); setSortBy('default'); }}>Reset all</button>
                    <button className="btn-sm primary" onClick={() => setShowFilters('')}>Done</button>
                  </div>
                </div>,
                isVertical ? document.body : undefined as any
              )}
            </div>
          );
        })()}
        <div className="view-toggle">
          <button className={viewMode === 'orbit' ? 'active' : ''} onClick={() => switchView('orbit')} title="Orbit view" aria-label="Orbit view">{I.orbit}</button>
          <button className={viewMode === 'cards' ? 'active' : ''} onClick={() => switchView('cards')} title="Card view" aria-label="Card view">{I.grid}</button>
        </div>
        <div className="nav-sep" />
        {/* Theme picker */}
        {(() => {
          const activeTheme = THEMES[(settings as any).theme || 'midnight'] || THEMES.midnight;
          const chevron = <svg viewBox="0 0 8 8" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 2l3 3 3-3" /></svg>;
          const accentVal = (settings as any).accentColor || activeTheme.accent;
          const applyCustomAccent = async (c: string) => {
            document.documentElement.style.setProperty('--accent', c);
            document.documentElement.style.setProperty('--accent-soft', c + '1f');
            document.documentElement.style.setProperty('--accent-border', c + '4d');
            const saved = await (window.api as any)?.saveSettings?.({ accentColor: c });
            onSettingsChange(saved || { accentColor: c });
          };
          const dots = (
            <div className="theme-picker-popover" style={{ flexDirection: 'column', width: 'auto', ...(tbPos === 'bottom' ? { bottom: 'calc(100% + 6px)', left: 0 } : { top: 'calc(100% + 6px)', left: 0 }) }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', width: 128 }}>
                {Object.entries(THEMES).map(([key, t]) => (
                  <button key={key} className={'theme-dot' + (((settings as any).theme || 'midnight') === key ? ' active' : '')} style={{ background: t.accent }} title={t.label}
                    onClick={async () => { const saved = await (window.api as any)?.saveSettings?.({ theme: key, accentColor: '' }); onSettingsChange(saved || { theme: key, accentColor: '' }); applyTheme(key); setShowThemePicker(false); }} />
                ))}
              </div>
              <div style={{ height: 1, background: 'var(--glass-border)', margin: '6px 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="color" className="settings-color" style={{ width: 28, height: 22 }}
                  value={accentVal}
                  onChange={e => {
                    const c = e.target.value;
                    document.documentElement.style.setProperty('--accent', c);
                    document.documentElement.style.setProperty('--accent-soft', c + '1f');
                    document.documentElement.style.setProperty('--accent-border', c + '4d');
                  }}
                  onBlur={e => applyCustomAccent(e.target.value)}
                />
                <span style={{ fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Custom accent</span>
              </div>
            </div>
          );
          return (
            <div className="theme-picker-wrap" style={{ position: 'relative' }}>
              <button className="theme-picker-btn" onClick={e => { e.stopPropagation(); setShowLayoutPicker(false); setShowThemePicker(s => !s); }} title="Theme">
                <span className="theme-picker-dot" style={{ background: activeTheme.accent }} />
                {chevron}
              </button>
              {showThemePicker && (isVertical
                ? ReactDOM.createPortal(
                    <div style={{ position: 'fixed', zIndex: 400, [tbPos === 'left' ? 'left' : 'right']: 76, top: '50%', transform: 'translateY(-50%)' }} onClick={() => setShowThemePicker(false)}>
                      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--glass-border)', borderRadius: 12, padding: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', gap: 0, width: 'auto', animation: 'popoverIn 0.15s cubic-bezier(0.16,1,0.3,1)' }}>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', width: 128 }}>
                          {Object.entries(THEMES).map(([key, t]) => (
                            <button key={key} className={'theme-dot' + (((settings as any).theme || 'midnight') === key ? ' active' : '')} style={{ background: t.accent }} title={t.label}
                              onClick={async () => { const saved = await (window.api as any)?.saveSettings?.({ theme: key, accentColor: '' }); onSettingsChange(saved || { theme: key, accentColor: '' }); applyTheme(key); setShowThemePicker(false); }} />
                          ))}
                        </div>
                        <div style={{ height: 1, background: 'var(--glass-border)', margin: '6px 0' }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="color" className="settings-color" style={{ width: 28, height: 22 }}
                            value={accentVal}
                            onChange={e => {
                              const c = e.target.value;
                              document.documentElement.style.setProperty('--accent', c);
                              document.documentElement.style.setProperty('--accent-soft', c + '1f');
                              document.documentElement.style.setProperty('--accent-border', c + '4d');
                            }}
                            onBlur={e => applyCustomAccent(e.target.value)}
                          />
                          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Custom accent</span>
                        </div>
                      </div>
                    </div>,
                    document.body
                  )
                : dots
              )}
            </div>
          );
        })()}
        <div className="nav-sep" />
        {(() => {
          const layoutOptions = [
            ['top',    'Top',    <svg viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="1" width="10" height="3.5" rx="1" fill="currentColor"/></svg>],
            ['bottom', 'Bottom', <svg viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="7.5" width="10" height="3.5" rx="1" fill="currentColor"/></svg>],
            ['left',   'Left',   <svg viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="1" width="3.5" height="10" rx="1" fill="currentColor"/></svg>],
            ['right',  'Right',  <svg viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><rect x="7.5" y="1" width="3.5" height="10" rx="1" fill="currentColor"/></svg>],
          ] as [string, string, React.ReactNode][];
          const currentPos = (settings as any).toolbarPosition || 'top';
          const currentIcon = layoutOptions.find(([v]) => v === currentPos)?.[2] ?? layoutOptions[0][2];
          const chevron = <svg viewBox="0 0 8 8" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 2l3 3 3-3" /></svg>;
          const popoverStyle: React.CSSProperties = tbPos === 'bottom'
            ? { bottom: 'calc(100% + 6px)', left: 0 }
            : tbPos === 'left'
            ? { left: 'calc(100% + 8px)', top: 0 }
            : tbPos === 'right'
            ? { right: 'calc(100% + 8px)', top: 0 }
            : { top: 'calc(100% + 6px)', left: 0 };
          const popover = (
            <div className="layout-picker-popover" style={popoverStyle} onClick={e => e.stopPropagation()}>
              {layoutOptions.map(([val, label, icon]) => (
                <button key={val}
                  className={'layout-picker-option' + (currentPos === val ? ' active' : '')}
                  title={label}
                  onClick={async () => { const saved = await (window.api as any)?.saveSettings?.({ toolbarPosition: val }); onSettingsChange(saved || { toolbarPosition: val }); setShowLayoutPicker(false); setShowThemePicker(false); }}>
                  <span className="layout-picker-icon">{icon}</span>
                  <span className="layout-picker-label">{label}</span>
                </button>
              ))}
            </div>
          );
          return (
            <div className="theme-picker-wrap" style={{ position: 'relative' }} onClick={e => { if (showLayoutPicker) { e.stopPropagation(); setShowLayoutPicker(false); } }}>
              <button className="theme-picker-btn" onClick={e => { e.stopPropagation(); setShowThemePicker(false); setShowLayoutPicker(s => !s); }} title="Toolbar position">
                <span style={{ width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)' }}>{currentIcon}</span>
                {chevron}
              </button>
              {showLayoutPicker && (isVertical
                ? ReactDOM.createPortal(
                    <div style={{ position: 'fixed', zIndex: 400, [tbPos === 'left' ? 'left' : 'right']: 76, top: '50%', transform: 'translateY(-50%)' }} onClick={() => setShowLayoutPicker(false)}>
                      <div className="layout-picker-popover" style={{ position: 'static' }} onClick={e => e.stopPropagation()}>
                        {layoutOptions.map(([val, label, icon]) => (
                          <button key={val}
                            className={'layout-picker-option' + (currentPos === val ? ' active' : '')}
                            title={label}
                            onClick={async () => { const saved = await (window.api as any)?.saveSettings?.({ toolbarPosition: val }); onSettingsChange(saved || { toolbarPosition: val }); setShowLayoutPicker(false); }}>
                            <span className="layout-picker-icon">{icon}</span>
                            <span className="layout-picker-label">{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>,
                    document.body
                  )
                : popover
              )}
            </div>
          );
        })()}
        <div className="nav-sep" />
        <div className="nav-actions">
          <button className="nav-btn" title="Add game" aria-label="Add game" onClick={() => { setEditGame(null); setShowAdd(true); }}>{I.plus}</button>
          <button className="nav-btn" title="Settings (Ctrl+,)" aria-label="Settings" onClick={() => setShowSettings(true)}>{I.gear}</button>
        </div>
      </div>

      {gamesLoaded && games.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">:/</div>
          <div className="empty-title">No games yet</div>
          <div className="empty-text">Add games manually or detect from installed platforms.</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-play" onClick={() => { setEditGame(null); setShowAdd(true); }}>Add Game</button>
            <button className="btn-ghost" onClick={() => setShowDetect(true)}>Detect</button>
          </div>
        </div>
      )}

      {mostRecentGame && !continueBannerDismissed && !focusGame && !anyPanelOpen && (
        <ContinueBanner game={mostRecentGame} onPlay={() => doLaunch(mostRecentGame)} onDismiss={() => setContinueBannerDismissed(true)} />
      )}

      <FocusView game={liveFocus} onClose={() => setFocusGame(null)} onLaunch={doLaunch} onFav={doFav} onEdit={doEditFromFocus} onDelete={doDelete}
        onRefreshGame={(g: Game) => { _updateGameInState(g); setFocusGame(g); flash('Metadata updated'); }}
        gpFocusIdx={gpActive && gpArea === 'focus' ? gpIdx : -1} />

      {Object.entries(chiakiSessions).filter(([, s]) => s.state === 'gui').map(([gid]) => {
        const g = games.find(x => x.id === gid); if (!g) return null;
        return (
          <div key={gid} className="stream-float" onClick={() => setShowChiaki(true)}>
            <div className="stream-float-dot connecting" />
            <div className="stream-float-info">
              <div className="stream-float-name">{g.name}</div>
              <div className="stream-float-meta">chiaki-ng GUI open</div>
            </div>
            <button className="stream-float-stop" onClick={async e => {
              e.stopPropagation();
              if (window.api) await (window.api as any).chiakiStopStream?.(gid);
              setChiakiSessions(p => { const n = { ...p }; delete n[gid]; return n; });
              flash('Stream stopped');
            }}>Stop</button>
          </div>
        );
      })}

      <StreamOverlay sessions={chiakiSessions} games={games} onStop={async gid => {
        const s = chiakiSessions[gid];
        if (window.api) { if (s && (s as any).platform === 'xbox') await (window.api as any).xcloudStop?.(gid); else await (window.api as any).chiakiStopStream?.(gid); }
        setChiakiSessions(p => { const n = { ...p }; delete n[gid]; return n; });
        flash('Stream stopped');
      }} />

      <SearchOverlay show={showSearch} onClose={() => setShowSearch(false)} games={games} onSelect={g => setFocusGame(g)} onLaunch={doLaunch} />
      <AddPanel show={showAdd} onClose={() => { setShowAdd(false); setEditGame(null); }} onSave={editGame ? doEdit as any : doAdd as any}
        onUpdated={(g: Game) => { _updateGameInState(g); setShowAdd(false); setEditGame(null); }}
        categories={cats} editGame={editGame} flash={flash} onOpenArtPicker={openArtPicker} />
      <DetectPanel show={showDetect} onClose={() => setShowDetect(false)} onImport={doImport} />
      {showPlatforms && <Suspense fallback={null}><PlatformsPanel show={showPlatforms} onClose={() => setShowPlatforms(false)} flash={flash} setGames={setGames} onOpenChiaki={() => setShowChiaki(true)} onOpenXcloud={() => setShowXcloud(true)} /></Suspense>}
      {showChiaki && <Suspense fallback={null}><ChiakiPanel show={showChiaki} onClose={() => setShowChiaki(false)} flash={flash} games={games} setGames={setGames} chiakiSessions={chiakiSessions} /></Suspense>}
      {showXcloud && <Suspense fallback={null}><XcloudPanel show={showXcloud} onClose={() => setShowXcloud(false)} flash={flash} /></Suspense>}
      {showSettings && <Suspense fallback={null}><SettingsPanel show={showSettings} onClose={() => setShowSettings(false)} flash={flash} settings={settings} onSettingsChange={onSettingsChange as any}
          games={games} setGames={setGames} setCats={setCats}
          onOpenPlatforms={() => { setShowSettings(false); setTimeout(() => setShowPlatforms(true), 150); }}
          onSync={doSync} onFetchMetadata={doFetchAllMetadata} onRunWizard={() => setShowWizard(true)} onRescanAll={doRescanAll} /></Suspense>}
      <StartupWizard show={showWizard} onClose={() => setShowWizard(false)} flash={flash} setGames={setGames} settings={settings} onSettingsChange={onSettingsChange} />

      {globalArtPicker && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ width: 820 }}>
            <Suspense fallback={null}>
              <ArtPicker gameName={globalArtPicker.gameName} platform={globalArtPicker.platform} field={globalArtPicker.field}
                onPick={url => { if (artResolve.current) artResolve.current(url); setGlobalArtPicker(null); }}
                onClose={() => { if (artResolve.current) artResolve.current(null); setGlobalArtPicker(null); }} />
            </Suspense>
          </div>
        </div>
      )}

      <div role="status" aria-live="polite" aria-atomic="true" style={{ position:'fixed', width:1, height:1, overflow:'hidden', clip:'rect(0,0,0,0)', whiteSpace:'nowrap', pointerEvents:'none' }}>{typeof toast === 'string' ? toast : ''}</div>
      {toast !== '' && <Toast msg={toast} onDone={() => setToast('')} />}

      {importProgress && importProgress.status && (
        <div className="subtle-pill" onClick={() => { if (importProgress.status === 'done' || importProgress.status === 'error') setImportProgress(null); }}>
          {importProgress.status !== 'done' && importProgress.status !== 'error'
            ? <div className="subtle-pill-spinner" />
            : <div className="subtle-pill-icon" style={{ background: importProgress.status === 'error' ? 'var(--red)' : 'var(--green)' }}>{importProgress.status === 'error' ? '✕' : '✓'}</div>
          }
          <span className="subtle-pill-text">
            {importProgress.status === 'done' ? 'Import complete' : importProgress.status === 'error' ? 'Import failed'
              : 'Importing ' + (importProgress.provider || '') + (importProgress.processed ? ' · ' + importProgress.processed : '')}
          </span>
        </div>
      )}

      {metaProgress && (
        <div className="subtle-pill" style={importProgress?.status ? { bottom: 46 } : undefined}
          onClick={() => { if (metaProgress.phase === 'done') setMetaProgress(null); }}>
          {metaProgress.phase === 'done'
            ? <div className="subtle-pill-icon" style={{ background: 'var(--green)' }}>✓</div>
            : <div className="subtle-pill-spinner" />
          }
          <span className="subtle-pill-text">
            {metaProgress.phase === 'done'
              ? 'Synced · ' + (metaProgress.updated || 0) + ' updated'
              : metaProgress.phase === 'covers'
                ? 'Syncing' + ((metaProgress.coverRemaining || 0) > 0 ? ' · ' + metaProgress.coverRemaining + ' covers' : '')
                : 'Syncing' + (metaProgress.total > 0 ? ' · ' + (metaProgress.current || 0) + '/' + metaProgress.total : '')}
          </span>
          {metaProgress.phase !== 'done' && (
            <div className="subtle-pill-bar">
              <div className="subtle-pill-bar-fill" style={{ width:
                metaProgress.phase === 'covers'
                  ? (50 + (1 - (metaProgress.coverRemaining || 0) / Math.max(1, metaProgress.coverTotal || 1)) * 50) + '%'
                  : metaProgress.total > 0 ? (((metaProgress.current || 0) / metaProgress.total) * 50) + '%' : '0%'
              }} />
            </div>
          )}
        </div>
      )}

      {appUpdate && (
        <div style={{ position: 'fixed', bottom: 20, left: 20, zIndex: 10100, width: 300, background: 'var(--glass-heavy, rgba(20,20,30,0.96))', border: '1px solid var(--glass-border)', borderRadius: 12, padding: '12px 16px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', gap: 12 }}>
          {appUpdate.status === 'downloading'
            ? <div style={{ width: 22, height: 22, border: '2px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--accent)', borderRadius: '50%', flexShrink: 0, animation: 'spin 0.8s linear infinite' }} />
            : <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#07070d' }}>↑</div>
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>
              {appUpdate.status === 'downloading' ? 'Downloading update…' : 'Update ready'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {appUpdate.status === 'downloading'
                ? (appUpdate.progress != null ? appUpdate.progress + '%' : 'Starting…')
                : 'v' + (appUpdate.version || '?') + ' — Restart to apply'}
            </div>
          </div>
          {appUpdate.status === 'ready'
            ? <button className="btn-sm primary" style={{ flexShrink: 0 }} onClick={() => (window.api as any)?.installUpdate?.()}>Restart</button>
            : <button className="btn-flat" style={{ padding: '2px 6px', fontSize: 11, flexShrink: 0 }} onClick={() => setAppUpdate(null)}>✕</button>
          }
        </div>
      )}

      <MediaPlayer tbPos={tbPos} viewMode={viewMode} />

      {viewMode === 'orbit' && (
        <div className="zoom-hud">
          <button className="zoom-btn" onClick={fitAll} title="Fit all" aria-label="Fit all"><span style={{ display: 'flex', width: 14, height: 14 }}>{I.fit}</span></button>
          <button className="zoom-btn" onClick={zoomOut} title="Zoom out" aria-label="Zoom out"><span style={{ display: 'flex', width: 14, height: 14 }}>{I.zOut}</span></button>
          <div className="zoom-pct" aria-label={'Zoom level ' + Math.round(cam.zoom * 100) + '%'}>{Math.round(cam.zoom * 100)}%</div>
          <button className="zoom-btn" onClick={zoomIn} title="Zoom in" aria-label="Zoom in"><span style={{ display: 'flex', width: 14, height: 14 }}>{I.zIn}</span></button>
        </div>
      )}
    </div>
  );
}

