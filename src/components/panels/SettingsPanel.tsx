import React, { useState, useEffect } from 'react';
import type { Game, Settings } from '../../types';
import { SidePanel } from '../SidePanel';
import { THEMES, PLATFORMS } from '../../constants';
import { applyTheme, applyUiScale, fmtTime } from '../../utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface SystemSpecs {
  cpuModel?: string;
  cpuCount?: number;
  ramGb?: number;
  gpuName?: string;
}

// Hardware-based recommendation (mirrors StartupWizard logic + CS port)
function getPerformanceRecommendation(sp: SystemSpecs | null) {
  if (!sp) return null;
  const ramGb = sp.ramGb || 0;
  const cpuCount = sp.cpuCount || 0;
  const starDensity: 'low' | 'normal' | 'high' =
    (ramGb >= 24 && cpuCount >= 8) ? 'high'
    : (ramGb <= 8 || cpuCount <= 4) ? 'low'
    : 'normal';
  const sw = (typeof window !== 'undefined' && window.screen?.width) || 1920;
  const uiScale: '0.9' | '1' | '1.1' | '1.25' =
    sw >= 2560 ? '1.25' : sw >= 1920 ? '1.1' : sw < 1280 ? '0.9' : '1';
  const tier: 'High' | 'Mid' | 'Low' =
    (ramGb >= 24 && cpuCount >= 8) ? 'High'
    : (ramGb <= 8 || cpuCount <= 4) ? 'Low'
    : 'Mid';
  return { starDensity, uiScale, tier };
}

function getOsLabel() {
  if (typeof navigator === 'undefined') return '';
  const ua = navigator.userAgent || '';
  if (/Windows NT 10\.0/.test(ua)) return 'Windows 10/11';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return navigator.platform || '';
}

interface ApiKeyInfoResult {
  ok?: boolean;
  hasSecret?: boolean;
  fingerprint?: string | null;
}

const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
  <button className={'settings-toggle' + (value ? ' on' : '')} onClick={() => onChange(!value)} />
);

interface SettingsPanelProps {
  show: boolean;
  onClose: () => void;
  flash: (msg: React.ReactNode) => void;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
  games: Game[];
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  setCats: React.Dispatch<React.SetStateAction<string[]>>;
  onOpenPlatforms: () => void;
  onSync: () => void;
  onFetchMetadata: () => void;
  onRunWizard: (run: boolean) => void;
  onRescanAll: () => Promise<void>;
}

const ICONS = {
  appearance: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>,
  behavior:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  library:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>,
  system:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
  about:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>,
  danger:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
};

const NAV_GROUPS: { label: string; danger?: boolean; items: { id: string; label: string; icon: React.ReactNode }[] }[] = [
  { label: 'App',     items: [
    { id: 'appearance', label: 'Appearance', icon: ICONS.appearance },
    { id: 'behavior',   label: 'Behavior',   icon: ICONS.behavior },
  ]},
  { label: 'Content', items: [
    { id: 'library',    label: 'Library',    icon: ICONS.library },
    { id: 'system',     label: 'System',     icon: ICONS.system },
  ]},
  { label: 'Info',    items: [
    { id: 'about',      label: 'About',      icon: ICONS.about },
  ]},
  { label: '', danger: true, items: [
    { id: 'danger',     label: 'Danger Zone',icon: ICONS.danger },
  ]},
];

const PLATFORM_PATHS: ReadonlyArray<{ key: keyof Settings; label: string; letter: string; color: string; desc: string }> = [
  { key: 'steamPath',  label: 'Steam',      letter: 'S', color: '#1b6dff', desc: 'Steam install folder' },
  { key: 'epicPath',   label: 'Epic Games', letter: 'E', color: '#777',    desc: 'Epic Games path'      },
  { key: 'gogPath',    label: 'GOG Galaxy', letter: 'G', color: '#86328a', desc: 'GOG Galaxy path'      },
  { key: 'xboxPath',   label: 'Xbox',       letter: 'X', color: '#107c10', desc: 'XboxGames root'       },
  { key: 'chiakiPath', label: 'chiaki-ng',  letter: 'P', color: '#0072d1', desc: 'Custom Remote Play exe' },
];

// ────────────────────────────────────────────────────────────────────────────
// Reusable building blocks (inline for proximity to usage)
// ────────────────────────────────────────────────────────────────────────────

interface HeroProps {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  chips?: React.ReactNode;
  tone?: 'default' | 'danger';
}
const Hero = ({ eyebrow, title, subtitle, chips, tone = 'default' }: HeroProps) => (
  <div className={'set-hero' + (tone === 'danger' ? ' danger' : '')}>
    {eyebrow && <div className="set-hero-eyebrow">{eyebrow}</div>}
    <div className="set-hero-title">{title}</div>
    {subtitle && <div className="set-hero-sub">{subtitle}</div>}
    {chips && <div className="set-hero-chips">{chips}</div>}
  </div>
);

interface CardProps {
  title?: string;
  subtitle?: React.ReactNode;
  side?: React.ReactNode;
  tone?: 'default' | 'danger' | 'flush';
  children: React.ReactNode;
}
const Card = ({ title, subtitle, side, tone = 'default', children }: CardProps) => (
  <div className={'set-card' + (tone !== 'default' ? ' tone-' + tone : '')}>
    {(title || side) && (
      <div className="set-card-head">
        <div>
          {title && <div className="set-card-title">{title}</div>}
          {subtitle && <div className="set-card-sub">{subtitle}</div>}
        </div>
        {side && <div className="set-card-side">{side}</div>}
      </div>
    )}
    <div className="set-card-body">{children}</div>
  </div>
);

interface RowProps {
  label: React.ReactNode;
  desc?: React.ReactNode;
  control: React.ReactNode;
}
const Row = ({ label, desc, control }: RowProps) => (
  <div className="set-row">
    <div className="set-row-info">
      <div className="set-row-label">{label}</div>
      {desc && <div className="set-row-desc">{desc}</div>}
    </div>
    <div className="set-row-ctrl">{control}</div>
  </div>
);

const Chip = ({ tone, children }: { tone?: 'ok' | 'busy' | 'err' | 'accent' | 'muted'; children: React.ReactNode }) => (
  <span className={'set-chip ' + (tone || 'muted')}>{children}</span>
);

// ────────────────────────────────────────────────────────────────────────────
// Main panel
// ────────────────────────────────────────────────────────────────────────────

export function SettingsPanel({
  show, onClose, flash, settings, onSettingsChange, games, setGames, setCats,
  onOpenPlatforms, onSync, onFetchMetadata, onRunWizard, onRescanAll,
}: SettingsPanelProps) {
  const [local, setLocal] = useState<Settings>({});
  const [dataPath, setDataPath] = useState('');
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearCovers, setConfirmClearCovers] = useState(false);
  const [sgKey, setSgKey] = useState('');
  const [sgSavedKey, setSgSavedKey] = useState<{ hasSecret: boolean; fingerprint: string | null } | null>(null);
  const [sgStatus, setSgStatus] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [discordStatus, setDiscordStatus] = useState<{ ready: boolean; connected: boolean } | null>(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [chiakiUpd, setChiakiUpd] = useState<any>(null);
  const [specs, setSpecs] = useState<any>(null);
  const [specsLoading, setSpecsLoading] = useState(false);
  const [activeSection, setActiveSection] = useState('appearance');

  async function checkChiaki() {
    setChiakiUpd({ checking: true });
    try {
      const s = await (window.api as any)?.getChiakiStatus?.();
      const r = await (window.api as any)?.chiakiCheckUpdate?.();
      if (r?.error) { setChiakiUpd({ error: r.error }); return; }
      const current = r?.current || s?.version || null;
      const installed = !!(s && s.status && s.status !== 'missing');
      if (r?.hasUpdate) setChiakiUpd({ current, latest: r.latest, hasUpdate: true, installed, status: s?.status || null });
      else setChiakiUpd({ current, latest: r?.latest || null, hasUpdate: false, installed, status: s?.status || null });
    } catch (e: any) { setChiakiUpd({ error: e.message }); }
  }

  useEffect(() => {
    if (!show) { requestAnimationFrame(() => { setConfirmClear(false); setConfirmClearCovers(false); }); return; }
    requestAnimationFrame(() => setLocal({ ...settings }));
    (async () => {
      if (window.api?.getDataPath) { const p = await window.api.getDataPath(); setDataPath(p); }
      if (window.api?.getAppVersion) { const v = await window.api.getAppVersion(); setAppVersion(v); }
      if (window.api?.getApiKeyInfo) {
        try {
          const r = (await window.api.getApiKeyInfo('steamgriddb')) as ApiKeyInfoResult | null | undefined;
          setSgSavedKey(r?.ok ? { hasSecret: !!r.hasSecret, fingerprint: r.fingerprint ?? null } : null);
        } catch (e) { void e; }
      }
      if (window.api?.getDiscordStatus) {
        try {
          const ds = (await window.api.getDiscordStatus()) as { ready?: boolean; connected?: boolean } | null | undefined;
          setDiscordStatus(ds ? { ready: !!ds.ready, connected: !!ds.connected } : null);
        } catch (e) { void e; }
      }
      if (window.api?.getSystemSpecs && !specs) {
        setSpecsLoading(true);
        try { const s = await window.api.getSystemSpecs(); setSpecs(s as SystemSpecs); } catch (e) { void e; }
        setSpecsLoading(false);
      }
    })();
    requestAnimationFrame(() => { setChiakiUpd(null); requestAnimationFrame(() => { void checkChiaki(); }); });
  }, [show, settings, specs]);

  useEffect(() => {
    if (!(window.api as any)?.onUpdateEvent) return;
    const unsub = (window.api as any).onUpdateEvent(({ type, data }: any) => {
      if (type === 'checking-for-update') setUpdateStatus('checking');
      else if (type === 'update-available') { setUpdateStatus('downloading'); setAvailableVersion(data?.version || null); }
      else if (type === 'download-progress') { setUpdateStatus('downloading'); setUpdateProgress(Math.round(data?.percent || 0)); }
      else if (type === 'update-downloaded') setUpdateStatus('ready');
      else if (type === 'update-not-available') { setUpdateStatus('up-to-date'); setAvailableVersion(null); }
      else if (type === 'error') { setUpdateStatus('error'); setUpdateError(typeof data === 'string' ? data : 'Update check failed'); }
    });
    return unsub;
  }, []);

  const update = async (key: keyof Settings, val: any) => {
    const next = { ...local, [key]: val } as Settings;
    setLocal(next);
    if ((window.api as any)?.saveSettings) {
      const saved = await (window.api as any).saveSettings({ [key]: val });
      onSettingsChange(saved);
    } else {
      onSettingsChange(next);
    }
  };

  const doExport = async () => {
    if (!(window.api as any)?.exportLibrary) { flash('Export not available'); return; }
    const r = await (window.api as any).exportLibrary();
    if (r.cancelled) return;
    if (r.error) { flash('Export failed: ' + r.error); return; }
    flash('Library exported');
  };

  const doFileImport = async () => {
    if (!(window.api as any)?.importLibrary) { flash('Import not available'); return; }
    const r = await (window.api as any).importLibrary();
    if (r.cancelled) return;
    if (r.error) { flash('Import failed: ' + r.error); return; }
    if (r.games) setGames(r.games);
    if (r.categories) setCats(r.categories);
    flash('Library imported successfully');
  };

  const doClearCovers = async () => {
    if (!confirmClearCovers) { setConfirmClearCovers(true); return; }
    if ((window.api as any)?.clearCovers) {
      const r = await (window.api as any).clearCovers();
      if (r?.games) setGames(r.games);
    }
    setConfirmClearCovers(false);
    flash('Covers reset to defaults');
  };

  const doClearAll = async () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    const prevGames: Game[] = Array.isArray(games) ? [...games] : [];
    if ((window.api as any)?.clearAllGames) await (window.api as any).clearAllGames();
    setGames([]);
    setConfirmClear(false);
    flash(
      <span>All games cleared{' '}
        <button style={{ marginLeft: 8 }} className="btn-sm" onClick={() => { setGames(prevGames); flash('Games restored'); }}>Undo</button>
      </span>
    );
  };

  const doReset = async () => {
    if ((window.api as any)?.resetSettings) {
      const s = await (window.api as any).resetSettings();
      setLocal(s);
      onSettingsChange(s);
    }
    flash('Settings reset to defaults');
  };

  // Derived
  const gameList = Array.isArray(games) ? games : [];
  const gameCount = gameList.length;
  const totalMins = gameList.reduce((s, g) => s + (g.playtimeMinutes || 0), 0);

  // ──────────────────────────────────────────────────────────────────────────
  // Section renderers
  // ──────────────────────────────────────────────────────────────────────────

  const renderAppearance = () => {
    const themeKey = local.theme || 'midnight';
    const accentVal = local.accentColor || (THEMES[themeKey]?.accent ?? '#d4a853');
    return (
      <>
        <Hero
          eyebrow="Personalize"
          title="Appearance"
          subtitle="Choose a theme, accent and how your library is laid out."
          chips={<>
            <Chip tone="accent">{Object.keys(THEMES).length} themes</Chip>
            <Chip>Accent {accentVal.toUpperCase()}</Chip>
          </>}
        />

        <Card title="Theme" subtitle="Pick a base palette — your accent layers on top.">
          <div className="set-theme-grid">
            {Object.entries(THEMES).map(([key, t]) => {
              const active = themeKey === key;
              return (
                <button key={key}
                  className={'set-theme-card' + (active ? ' active' : '')}
                  onClick={() => { update('theme', key); update('accentColor' as any, ''); applyTheme(key); }}
                  title={t.label}
                >
                  <div className="set-theme-preview">
                    <div style={{ background: t.preview[0] }} />
                    <div style={{ background: t.preview[1] || t.preview[0] }} />
                    <div style={{ background: t.preview[2] || t.preview[0] }} />
                    <div className="set-theme-accent-bar" style={{ background: t.accent }} />
                  </div>
                  <div className="set-theme-card-foot">
                    <span className="set-theme-card-name">{t.label}</span>
                    {active && <span className="set-theme-card-active">Active</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card title="Accent" subtitle="Override the active theme's accent colour.">
          <Row
            label="Custom accent"
            desc="Used for highlights, focus rings, and the sun cores."
            control={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="color" className="settings-color" value={accentVal}
                  onChange={e => {
                    const c = e.target.value;
                    setLocal(prev => ({ ...prev, accentColor: c }));
                    document.documentElement.style.setProperty('--accent', c);
                    document.documentElement.style.setProperty('--accent-soft', c + '1f');
                    document.documentElement.style.setProperty('--accent-border', c + '4d');
                  }}
                  onBlur={e => update('accentColor', e.target.value)}
                />
                {local.accentColor && (
                  <button className="btn-flat" style={{ fontSize: 11, padding: '5px 10px' }}
                    onClick={() => { update('accentColor', ''); applyTheme(themeKey); }}>
                    Reset
                  </button>
                )}
              </div>
            }
          />
        </Card>

        <Card title="Layout" subtitle="Where things sit and what greets you on launch.">
          <Row
            label="Default view"
            desc="Shown each time Cereal opens"
            control={
              <select className="settings-select" value={local.defaultView || 'orbit'} onChange={e => update('defaultView', e.target.value as any)}>
                <option value="orbit">Galaxy Orbit</option>
                <option value="cards">Card Grid</option>
              </select>
            }
          />
          <Row
            label="Toolbar position"
            desc="Where the navigation bar lives"
            control={
              <select className="settings-select" value={(local.toolbarPosition || local.navPosition || 'top') as string}
                onChange={e => { update('toolbarPosition', e.target.value as Settings['toolbarPosition']); update('navPosition', e.target.value as Settings['navPosition']); }}>
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            }
          />
        </Card>

        <Card title="Display" subtitle="Visual density and motion.">
          <Row
            label="UI scale"
            desc="Font and zoom level for the whole app"
            control={
              <select className="settings-select" value={String(local.uiScale || '1')} onChange={e => { update('uiScale', e.target.value); applyUiScale(e.target.value); }}>
                <option value="0.9">Small</option>
                <option value="1">Normal</option>
                <option value="1.1">Large</option>
                <option value="1.25">X-Large</option>
              </select>
            }
          />
          <Row
            label="Star density"
            desc="Background star count in the orbit view"
            control={
              <select className="settings-select" value={(local as any).starDensity || 'normal'} onChange={e => update('starDensity' as any, e.target.value)}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            }
          />
          <Row
            label="Animations"
            desc="Orbit drift, transitions and parallax"
            control={<Toggle value={local.showAnimations !== false} onChange={v => update('showAnimations', v)} />}
          />
        </Card>
      </>
    );
  };

  const renderBehavior = () => (
    <>
      <Hero
        eyebrow="Habits"
        title="Behavior"
        subtitle="How Cereal acts when you launch a game or close the window."
        chips={<>
          {discordStatus?.ready && <Chip tone="ok">Discord live</Chip>}
          {local.minimizeToTray && <Chip>Tray on</Chip>}
        </>}
      />

      <Card title="Game launching">
        <Row
          label="Auto-sync playtime"
          desc="Pull recent Steam playtime when you launch the app"
          control={<Toggle value={!!local.autoSyncPlaytime} onChange={v => update('autoSyncPlaytime', v)} />}
        />
        <Row
          label="Minimize on launch"
          desc="Hide Cereal as soon as a game starts"
          control={<Toggle value={!!local.minimizeOnLaunch} onChange={v => update('minimizeOnLaunch', v)} />}
        />
        <Row
          label={
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Discord Rich Presence
              {discordStatus && (
                <span title={discordStatus.connected ? (discordStatus.ready ? 'Discord connected' : 'Discord connecting…') : 'Discord not connected'}
                  style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: discordStatus.ready ? 'var(--green)' : discordStatus.connected ? 'var(--yellow)' : 'var(--text-4)' }} />
              )}
            </span>
          }
          desc="Show currently playing game on Discord"
          control={<Toggle value={!!local.discordPresence} onChange={v => update('discordPresence', v)} />}
        />
      </Card>

      <Card title="Window & tray">
        <Row
          label="Launch on startup"
          desc="Start Cereal automatically when Windows boots"
          control={<Toggle value={!!local.launchOnStartup} onChange={v => update('launchOnStartup', v)} />}
        />
        <Row
          label="Start minimized"
          desc="Open hidden in the system tray"
          control={<Toggle value={!!local.startMinimized} onChange={v => update('startMinimized', v)} />}
        />
        <Row
          label="Minimize to tray"
          desc="Send the window to the tray when minimized"
          control={<Toggle value={!!local.minimizeToTray} onChange={v => update('minimizeToTray', v)} />}
        />
        <Row
          label="Close to tray"
          desc="Keep running in the background when the X is clicked"
          control={<Toggle value={!!local.closeToTray} onChange={v => update('closeToTray', v)} />}
        />
        <Row
          label="Remember window size & position"
          desc="Restore previous bounds on launch"
          control={<Toggle value={local.rememberWindowBounds !== false} onChange={v => update('rememberWindowBounds', v)} />}
        />
      </Card>

      <Card title="Library filters" subtitle="Default filters applied to your collection.">
        <Row
          label="Hide Steam software & tools"
          desc="Filter out SDKs, runtimes, dedicated servers, soundtracks"
          control={<Toggle value={!!local.filterHideSteamSoftware} onChange={v => update('filterHideSteamSoftware', v)} />}
        />
      </Card>
    </>
  );

  const renderLibrary = () => (
    <>
      <Hero
        eyebrow="Your collection"
        title="Library"
        subtitle="Sources, sync and the artwork pipeline."
        chips={<>
          <Chip tone="accent">{gameCount} games</Chip>
          <Chip>{totalMins ? fmtTime(totalMins) : '0h'} played</Chip>
          {sgSavedKey?.hasSecret && <Chip tone="ok">SteamGridDB key saved</Chip>}
        </>}
      />

      <Card title="Quick actions" subtitle="Re-scan platforms, fetch art, manage accounts.">
        <div className="set-action-grid">
          <button className="set-action" onClick={async () => { if (onRescanAll) await onRescanAll(); }}>
            <div className="set-action-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
            <div><div className="set-action-label">Re-scan platforms</div><div className="set-action-desc">Detect newly installed games</div></div>
          </button>
          <button className="set-action" onClick={onFetchMetadata}>
            <div className="set-action-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>
            <div><div className="set-action-label">Fetch metadata</div><div className="set-action-desc">Covers, scores &amp; descriptions</div></div>
          </button>
          <button className="set-action" onClick={onSync}>
            <div className="set-action-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg></div>
            <div><div className="set-action-label">Sync playtime</div><div className="set-action-desc">Pull hours from Steam</div></div>
          </button>
          <button className="set-action" onClick={onOpenPlatforms}>
            <div className="set-action-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div>
            <div><div className="set-action-label">Platforms</div><div className="set-action-desc">Manage connected accounts</div></div>
          </button>
        </div>
      </Card>

      <Card title="Metadata">
        <Row
          label="Metadata source"
          desc="Where descriptions and details come from"
          control={
            <select className="settings-select" value={(local.metadataSource as string) || 'steam'} onChange={e => update('metadataSource', e.target.value)}>
              <option value="steam">Steam (default)</option>
              <option value="wikipedia">Wikipedia</option>
            </select>
          }
        />
      </Card>

      <Card title="Backup">
        <div className="set-action-grid two">
          <button className="set-action" onClick={doExport}>
            <div className="set-action-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
            <div><div className="set-action-label">Export library</div><div className="set-action-desc">Save to JSON file</div></div>
          </button>
          <button className="set-action" onClick={doFileImport}>
            <div className="set-action-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>
            <div><div className="set-action-label">Import library</div><div className="set-action-desc">Restore from JSON file</div></div>
          </button>
        </div>
      </Card>

      <Card
        title="SteamGridDB"
        subtitle={<>Custom artwork search. <a href="#" className="settings-link" onClick={e => { e.preventDefault(); (window.api as any)?.openExternal?.('https://www.steamgriddb.com/profile/preferences/api'); }}>Get a key</a>.</>}
        side={
          sgStatus === 'checking' ? <Chip tone="busy">Checking…</Chip>
          : sgStatus === 'valid' ? <Chip tone="ok">Valid</Chip>
          : sgStatus && sgStatus !== 'valid' ? <Chip tone="err">Invalid</Chip>
          : sgSavedKey?.hasSecret ? <Chip tone="ok">Key saved</Chip>
          : <Chip>No key</Chip>
        }
      >
        <div className="set-key-row">
          <input type="password" value={sgKey} onChange={e => { setSgKey(e.target.value); setSgStatus(null); }}
            placeholder={sgSavedKey?.hasSecret ? 'Saved — paste to replace' : 'Paste API key'} />
          <button className="btn-sm" onClick={async () => {
            if (!(window.api as any)?.readClipboard) return flash('Clipboard not available');
            const txt = await (window.api as any).readClipboard();
            if (!txt) return flash('Clipboard empty');
            setSgKey(txt.trim()); setSgStatus(null);
          }}>Paste</button>
          <button className="btn-sm primary" disabled={!sgKey} onClick={async () => {
            if (!sgKey) return;
            setSgStatus('checking');
            const vr = await (window.api as any).validateApiKey('steamgriddb', sgKey);
            if (vr?.ok) {
              const sr = await (window.api as any).saveApiKey('steamgriddb', sgKey);
              if (sr?.ok) { setSgSavedKey({ hasSecret: true, fingerprint: sr.fingerprint || null }); setSgStatus('valid'); flash('SteamGridDB key saved'); }
            } else { setSgStatus('invalid'); flash('Key is invalid'); }
          }}>Save</button>
          {sgSavedKey?.hasSecret && (
            <button className="btn-sm danger" onClick={async () => {
              const r = await (window.api as any).deleteApiKey('steamgriddb');
              if (r?.ok) { setSgSavedKey(null); setSgKey(''); setSgStatus(null); flash('Key deleted'); } else flash('Delete failed');
            }}>Delete</button>
          )}
        </div>
        {sgSavedKey?.fingerprint && (
          <div className="set-key-fp">FP: {sgSavedKey.fingerprint}</div>
        )}
      </Card>

      {dataPath && (
        <Card title="Data folder" subtitle="Where Cereal stores your library JSON, covers and credentials.">
          <div className="set-data-path">
            <div className="set-data-path-val">{dataPath}</div>
            <button className="btn-sm" onClick={() => (window.api as any)?.openPath?.(dataPath)}>Open</button>
          </div>
        </Card>
      )}
    </>
  );

  const renderSystem = () => (
    <>
      <Hero
        eyebrow="Plumbing"
        title="System"
        subtitle="Where Cereal looks for installs and stays up to date."
      />

      <Card
        title="Platform paths"
        subtitle="Override auto-detection. Leave blank to let Cereal find them."
      >
        <div className="set-paths">
          {PLATFORM_PATHS.map(({ key, label, letter, color, desc }) => (
            <div key={String(key)} className="set-path-row">
              <div className="set-path-badge" style={{ background: color + '22', color, borderColor: color + '55' }}>{letter}</div>
              <div className="set-path-info">
                <div className="set-path-label">{label}</div>
                <div className="set-path-desc">{desc}</div>
              </div>
              <input
                type="text"
                className="set-path-input"
                value={(local[key] as string) || ''}
                placeholder="Auto-detect"
                onChange={e => setLocal(prev => ({ ...prev, [key]: e.target.value }))}
                onBlur={e => update(key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card title="Updates" subtitle="Cereal and bundled tools.">
        <div className="set-update-list">
          <div className="set-update-card">
            <div className="set-update-head">
              <div className="set-update-name">Cereal</div>
              <div className="set-update-ver">v{appVersion}</div>
              {updateStatus === 'ready' && <Chip tone="accent">{availableVersion ? `v${availableVersion} ready` : 'Update ready'}</Chip>}
              {updateStatus === 'downloading' && <Chip tone="busy">{availableVersion ? `v${availableVersion} — ${updateProgress}%` : `Downloading ${updateProgress}%`}</Chip>}
              {updateStatus === 'checking' && <Chip tone="busy">Checking…</Chip>}
              {updateStatus === 'up-to-date' && <Chip tone="ok">Up to date</Chip>}
              {updateStatus === 'error' && <Chip tone="err">Error</Chip>}
            </div>
            <div className="set-update-actions">
              <button className="btn-sm" disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                onClick={async () => {
                  setUpdateStatus('checking');
                  const r = await (window.api as any)?.checkForUpdate?.();
                  if (r?.error) { setUpdateStatus('error'); setUpdateError(r.error); }
                }}>
                Check
              </button>
              {availableVersion && updateStatus !== 'ready' && updateStatus !== 'downloading' && (
                <button className="btn-sm" onClick={async () => {
                  setUpdateStatus('downloading');
                  const r = await (window.api as any)?.checkForUpdate?.();
                  if (r?.error) { setUpdateStatus('error'); setUpdateError(r.error); }
                }}>Download</button>
              )}
              {updateStatus === 'ready' && (
                <button className="btn-sm primary" onClick={() => (window.api as any)?.installUpdate?.()}>Install &amp; Restart</button>
              )}
            </div>
            {updateError && <div className="set-update-err" title={updateError}>{updateError}</div>}
          </div>

          <div className="set-update-card">
            <div className="set-update-head">
              <div className="set-update-name">chiaki-ng</div>
              {(chiakiUpd?.current || chiakiUpd?.hasUpdate === false) && (
                <div className="set-update-ver">v{chiakiUpd.current}</div>
              )}
              {chiakiUpd?.hasUpdate && <Chip tone="accent">v{chiakiUpd.latest} available</Chip>}
              {chiakiUpd?.hasUpdate === false && <Chip tone="ok">Up to date</Chip>}
              {chiakiUpd?.checking && <Chip tone="busy">Checking…</Chip>}
              {chiakiUpd?.updating && <Chip tone="busy">Updating…</Chip>}
              {chiakiUpd?.done && <Chip tone="ok">Updated to v{chiakiUpd.version}</Chip>}
              {chiakiUpd?.error && <Chip tone="err">Error</Chip>}
            </div>
            <div className="set-update-desc">PlayStation Remote Play engine</div>
            <div className="set-update-actions">
              <button className="btn-sm" disabled={chiakiUpd?.checking || chiakiUpd?.updating} onClick={() => checkChiaki()}>Check</button>
              {chiakiUpd?.hasUpdate && (
                <button className="btn-sm primary" disabled={chiakiUpd?.updating}
                  onClick={async () => {
                    setChiakiUpd((prev: any) => ({ ...prev, updating: true }));
                    try {
                      const r = await (window.api as any)?.chiakiUpdate?.();
                      if (r?.ok) setChiakiUpd({ done: true, version: r.version });
                      else setChiakiUpd({ error: r?.error || 'Update failed' });
                    } catch (e: any) { setChiakiUpd({ error: e.message }); }
                  }}>{chiakiUpd?.installed ? 'Update' : 'Install'}</button>
              )}
              {chiakiUpd?.installed && (
                <button className="btn-sm danger" disabled={chiakiUpd?.updating || chiakiUpd?.checking}
                  onClick={async () => {
                    if (!confirm('Uninstall chiaki-ng and remove downloaded files?')) return;
                    setChiakiUpd((prev: any) => ({ ...prev, uninstalling: true }));
                    try {
                      const r = await (window.api as any)?.chiakiUninstall?.();
                      if (r?.ok) { setChiakiUpd(null); if (typeof flash === 'function') flash('chiaki-ng uninstalled'); }
                      else setChiakiUpd({ error: r?.error || 'Uninstall failed' });
                    } catch (e: any) { setChiakiUpd({ error: e.message }); }
                  }}>Uninstall</button>
              )}
            </div>
          </div>
        </div>
      </Card>
    </>
  );

  const renderAbout = () => {
    const installedCount = gameList.filter(g => g.installed !== false).length;
    const favoriteCount = gameList.filter(g => g.favorite).length;
    const platCounts: Record<string, number> = {};
    for (const g of gameList) { const p = g.platform || 'custom'; platCounts[p] = (platCounts[p] || 0) + 1; }
    const platRows = Object.entries(platCounts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, label: PLATFORMS[key]?.label || key, color: (PLATFORMS[key] as any)?.color || 'var(--text-3)', count }));
    const maxPlat = Math.max(...platRows.map(r => r.count), 1);
    const mostPlayed = [...gameList].filter(g => (g.playtimeMinutes || 0) > 0)
      .sort((a, b) => (b.playtimeMinutes || 0) - (a.playtimeMinutes || 0)).slice(0, 5);

    return (
      <>
        {/* Hero */}
        <div className="set-about-hero">
          <div className="set-about-hero-name">Cereal</div>
          <div className="set-about-hero-tag">Your universal game launcher · v{appVersion}</div>
        </div>

        <Card title="Library snapshot">
          <div className="set-stat-grid">
            <div className="set-stat"><div className="set-stat-val">{gameCount}</div><div className="set-stat-lbl">Games</div></div>
            <div className="set-stat"><div className="set-stat-val">{installedCount}</div><div className="set-stat-lbl">Installed</div></div>
            <div className="set-stat"><div className="set-stat-val">{favoriteCount}</div><div className="set-stat-lbl">Favorites</div></div>
            <div className="set-stat"><div className="set-stat-val">{totalMins ? fmtTime(totalMins) : '—'}</div><div className="set-stat-lbl">Playtime</div></div>
          </div>
        </Card>

        {platRows.length > 0 && (
          <Card title="Platform breakdown">
            <div className="set-plat-list">
              {platRows.map(({ key, label, color, count }) => (
                <div className="set-plat-row" key={key}>
                  <div className="set-plat-name" style={{ color }}>{label}</div>
                  <div className="set-plat-bar"><div style={{ width: `${(count / maxPlat) * 100}%`, background: color + '66' }} /></div>
                  <div className="set-plat-count">{count}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {mostPlayed.length > 0 && (
          <Card title="Most played">
            <div className="set-top-list">
              {mostPlayed.map((g, i) => (
                <div className="set-top-row" key={g.id}>
                  <div className="set-top-rank">{i + 1}</div>
                  <div className="set-top-name">{g.name}</div>
                  <div className="set-top-time">{fmtTime(g.playtimeMinutes || 0)}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card title="System">
          <div className="set-spec-list">
            {specsLoading ? (
              <div className="set-spec-row"><span className="set-spec-lbl">⋯</span><span className="set-spec-val muted">Loading…</span></div>
            ) : specs ? (<>
              {specs.cpuModel && <div className="set-spec-row"><span className="set-spec-lbl">CPU</span><span className="set-spec-val">{specs.cpuModel}{specs.cpuCount > 1 ? ` · ${specs.cpuCount} cores` : ''}</span></div>}
              {specs.ramGb > 0 && <div className="set-spec-row"><span className="set-spec-lbl">RAM</span><span className="set-spec-val">{specs.ramGb} GB</span></div>}
              {specs.gpuName && <div className="set-spec-row"><span className="set-spec-lbl">GPU</span><span className="set-spec-val">{specs.gpuName}</span></div>}
              <div className="set-spec-row"><span className="set-spec-lbl">OS</span><span className="set-spec-val">{getOsLabel() || '—'}</span></div>
              {(() => {
                const rec = getPerformanceRecommendation(specs);
                if (!rec) return null;
                const scaleLabel: Record<string, string> = { '0.9': '90%', '1': '100%', '1.1': '110%', '1.25': '125%' };
                const isApplied = (local.starDensity || 'normal') === rec.starDensity && String(local.uiScale || '1') === rec.uiScale;
                return (
                  <div className="set-spec-row">
                    <span className="set-spec-lbl">Tier</span>
                    <span className="set-spec-val" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong>{rec.tier}</strong>
                      <span className="set-spec-rec">suggests <em>{rec.starDensity}</em> stars · <em>{scaleLabel[rec.uiScale]}</em> scale</span>
                      {!isApplied && (
                        <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => {
                          update('starDensity', rec.starDensity);
                          update('uiScale', rec.uiScale);
                          applyUiScale(rec.uiScale);
                          flash('Performance profile applied');
                        }}>Apply</button>
                      )}
                    </span>
                  </div>
                );
              })()}
            </>) : <div className="set-spec-row"><span className="set-spec-lbl muted">—</span><span className="set-spec-val muted">Unavailable</span></div>}
          </div>
        </Card>

        {dataPath && (
          <Card title="Storage">
            <div className="set-data-path">
              <div className="set-data-path-val">{dataPath}</div>
              <button className="btn-sm" onClick={() => (window.api as any)?.openPath?.(dataPath)}>Open</button>
            </div>
          </Card>
        )}

        <Card title="Keyboard shortcuts">
          <div className="wiz-shortcut-grid" style={{ marginTop: 4 }}>
            {([
              ['Ctrl+K', 'Quick search'],
              ['Ctrl+Shift+R', 'Random game (respects filters)'],
              ['Ctrl+,', 'Settings'],
              ['Esc', 'Close popover / game details'],
              ['H', 'Hide or unhide game (details view)'],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="wiz-shortcut">
                <kbd className="settings-kbd">{k}</kbd>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{v}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Credits">
          <div className="set-spec-list">
            <div className="set-spec-row"><span className="set-spec-lbl">UI</span><span className="set-spec-val muted">Inspired by Steam Deck, Playnite, and saturday-morning cereal bowls.</span></div>
            <div className="set-spec-row"><span className="set-spec-lbl">Streaming</span><span className="set-spec-val muted">chiaki-ng (streetpea) · xbox.com/play</span></div>
            <div className="set-spec-row"><span className="set-spec-lbl">Art</span><span className="set-spec-val muted">SteamGridDB · platform store CDNs</span></div>
            <div className="set-spec-row"><span className="set-spec-lbl">Metadata</span><span className="set-spec-val muted">Steam Store API · Wikipedia · Wikidata</span></div>
          </div>
          <div className="set-about-foot">Built with Electron · React · Vite · Made with cereal by Andrew</div>
        </Card>
      </>
    );
  };

  const renderDanger = () => (
    <>
      <Hero
        tone="danger"
        eyebrow="Be careful"
        title="Danger Zone"
        subtitle="These actions can't be undone. Please double-check before confirming."
      />

      <Card tone="danger" title="Reset all covers" subtitle="Remove custom artwork and revert to default covers.">
        <div className="set-danger-actions">
          {confirmClearCovers && <button className="btn-sm" onClick={() => setConfirmClearCovers(false)}>Cancel</button>}
          <button className="btn-sm danger" onClick={doClearCovers}>{confirmClearCovers ? 'Confirm reset' : 'Reset covers'}</button>
        </div>
      </Card>

      <Card tone="danger" title="Clear library" subtitle="Permanently delete every game from your library.">
        <div className="set-danger-actions">
          {confirmClear && <button className="btn-sm" onClick={() => setConfirmClear(false)}>Cancel</button>}
          <button className="btn-sm danger" onClick={doClearAll}>{confirmClear ? 'Confirm delete' : 'Clear library'}</button>
        </div>
      </Card>

      <Card tone="danger" title="Reset settings" subtitle="Restore preferences to factory defaults.">
        <div className="set-danger-actions">
          <button className="btn-sm danger" onClick={doReset}>Reset all</button>
          <button className="btn-sm" onClick={async () => {
            if (!confirm('Re-run the first-time setup wizard?')) return;
            if ((window.api as any)?.saveSettings) await (window.api as any).saveSettings({ firstRun: true });
            if (typeof onRunWizard === 'function') onRunWizard(true);
            flash('Setup wizard will run');
          }}>Re-run wizard</button>
        </div>
      </Card>
    </>
  );

  return (
    <SidePanel show={show} onClose={onClose} title="Settings" xwide bare>
      <div className="set-shell">
        {/* Sidebar rail */}
        <aside className="set-rail">
          <div className="set-rail-brand">
            <div className="set-rail-brand-logo">CEREAL</div>
            <div className="set-rail-brand-ver">v{appVersion}</div>
          </div>
          <div className="set-rail-groups">
            {NAV_GROUPS.map((grp, gi) => (
              <div key={gi} className={'set-rail-group' + (grp.danger ? ' danger' : '')}>
                {grp.label && <div className="set-rail-group-label">{grp.label}</div>}
                {grp.items.map(item => (
                  <button key={item.id}
                    role="tab"
                    aria-selected={item.id === activeSection}
                    className={'set-rail-btn' + (item.id === activeSection ? ' active' : '')}
                    onClick={() => setActiveSection(item.id)}
                  >
                    <span className="set-rail-btn-ic">{item.icon}</span>
                    <span className="set-rail-btn-lbl">{item.label}</span>
                    <span className="set-rail-btn-tick" />
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="set-rail-foot">
            <span>Made with cereal</span>
          </div>
        </aside>

        {/* Content pane */}
        <main className="set-pane" key={activeSection}>
          <div className="set-pane-inner">
            {activeSection === 'appearance' && renderAppearance()}
            {activeSection === 'behavior'   && renderBehavior()}
            {activeSection === 'library'    && renderLibrary()}
            {activeSection === 'system'     && renderSystem()}
            {activeSection === 'about'      && renderAbout()}
            {activeSection === 'danger'     && renderDanger()}
          </div>
        </main>
      </div>
    </SidePanel>
  );
}
