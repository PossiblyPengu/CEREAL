import { useEffect } from 'react';
import type { Game, Settings, ChiakiSession, ImportProgress } from '../types';
import { applyTheme, applyUiScale } from '../utils';

interface ListenerSetters {
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  setCats: React.Dispatch<React.SetStateAction<string[]>>;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  setGamesLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  setViewMode: React.Dispatch<React.SetStateAction<string>>;
  setTab: React.Dispatch<React.SetStateAction<string>>;
  setSelectedPlatforms: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedCategories: React.Dispatch<React.SetStateAction<string[]>>;
  setHideSteamSoftware: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWizard: React.Dispatch<React.SetStateAction<boolean>>;
  setChiakiSessions: React.Dispatch<React.SetStateAction<Record<string, ChiakiSession>>>;
  setImportProgress: React.Dispatch<React.SetStateAction<ImportProgress | null>>;
  setAppUpdate: React.Dispatch<React.SetStateAction<{ status: string; version?: string; progress?: number } | null>>;
  setTabs: React.Dispatch<React.SetStateAction<{ id: string; title: string; closable: boolean; platform: string | null }[]>>;
  setActiveTabId: React.Dispatch<React.SetStateAction<string>>;
  flash: (m: React.ReactNode) => void;
}

export function useInitialDataLoad(setters: Pick<ListenerSetters, 'setGames' | 'setCats' | 'setSettings' | 'setGamesLoaded' | 'setViewMode' | 'setTab' | 'setSelectedPlatforms' | 'setSelectedCategories' | 'setHideSteamSoftware' | 'setShowWizard' | 'setImportProgress'>) {
  const { setGames, setCats, setSettings, setGamesLoaded, setViewMode, setTab, setSelectedPlatforms, setSelectedCategories, setHideSteamSoftware, setShowWizard, setImportProgress } = setters;

  useEffect(() => {
    (async () => {
      if (window.api) {
        const [g, c, s] = await Promise.all([
          window.api.getGames(),
          window.api.getCategories(),
          window.api.getSettings(),
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
        ] as Game[]);
        setGamesLoaded(true);
      }
    })();
    let unsubImport: (() => void) | null = null;
    if (window.api?.onImportProgress) {
      unsubImport = window.api.onImportProgress((data: ImportProgress) => {
        setImportProgress(data);
      });
    }
    return () => { if (unsubImport) unsubImport(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function useChiakiAndRefreshListeners(
  flash: (m: React.ReactNode) => void,
  setChiakiSessions: ListenerSetters['setChiakiSessions'],
  setGames: ListenerSetters['setGames'],
) {
  useEffect(() => {
    let unsubChiaki: (() => void) | null = null;
    let unsubRefresh: (() => void) | null = null;
    if (window.api?.onChiakiEvent) {
      unsubChiaki = window.api.onChiakiEvent!((evt: ChiakiSession) => {
        const gid = evt.gameId;
        if (!gid) return;
        if (evt.type === 'title_change') {
          setChiakiSessions(prev => {
            const n = { ...prev };
            n[gid] = { ...(n[gid] || {}), ...evt, detectedTitle: (evt.titleName as string) || evt.gameName || '' };
            return n;
          });
          if (evt.gameName) flash('Now playing: ' + evt.gameName);
          return;
        }
        setChiakiSessions(prev => {
          const n = { ...prev };
          if ((evt.type === 'disconnected' || evt.type === 'chiaki_disconnect') && evt.reason !== 'transient_error') delete n[gid];
          else n[gid] = { ...(n[gid] || {}), ...evt };
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
            const prevStamp = prevG?._imgStamp || 0;
            const newStamp = ng._imgStamp || 0;
            const stamp = Math.max(prevStamp, newStamp);
            return stamp ? { ...ng, _imgStamp: stamp } : ng;
          });
        });
      });
    }
    return () => { unsubChiaki?.(); unsubRefresh?.(); };
  }, [flash, setChiakiSessions, setGames]);
}

export function useTabListeners(
  setTabs: ListenerSetters['setTabs'],
  setActiveTabId: ListenerSetters['setActiveTabId'],
) {
  useEffect(() => {
    const api = window.api as unknown as Record<string, unknown>;
    const u1 = typeof api?.onTabsOpened === 'function'
      ? (api.onTabsOpened as (cb: (d: { id: string; title: string; platform: string }) => void) => () => void)(
          data => { setTabs(p => [...p, { id: data.id, title: data.title, closable: true, platform: data.platform }]); setActiveTabId(data.id); (api.switchTab as (id: string) => void)?.(data.id); }
        )
      : null;
    const u2 = typeof api?.onTabsClosed === 'function'
      ? (api.onTabsClosed as (cb: (d: { id: string }) => void) => () => void)(
          data => { setTabs(p => p.filter(t => t.id !== data.id)); setActiveTabId(p => p === data.id ? 'launcher' : p); }
        )
      : null;
    return () => { u1?.(); u2?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function useAutoUpdateListener(
  setAppUpdate: ListenerSetters['setAppUpdate'],
) {
  useEffect(() => {
    if (!window.api?.onUpdateEvent) return;
    return window.api.onUpdateEvent(({ type, data }) => {
      const d = data as { version?: string; percent?: number } | null | undefined;
      if (type === 'update-available') setAppUpdate({ status: 'downloading', version: d?.version });
      else if (type === 'download-progress') setAppUpdate(prev => ({ ...prev!, status: 'downloading', progress: Math.round(d?.percent || 0) }));
      else if (type === 'update-downloaded') setAppUpdate(prev => ({ ...prev!, status: 'ready' }));
      else if (type === 'error') setAppUpdate(null);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
