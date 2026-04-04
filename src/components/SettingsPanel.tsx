import { useState, useEffect } from 'react';
import type { Game, Settings } from '../types';
import { SidePanel } from './SidePanel';
import { THEMES } from '../constants';
import { applyTheme, applyUiScale, fmtTime } from '../utils';

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
  const [activeSection, setActiveSection] = useState('appearance');

  useEffect(() => {
    if (!show) { setConfirmClear(false); setConfirmClearCovers(false); return; }
    setLocal({ ...settings });
    (async () => {
      if ((window.api as any)?.getDataPath) { const p = await (window.api as any).getDataPath(); setDataPath(p); }
      if ((window.api as any)?.getAppVersion) { const v = await (window.api as any).getAppVersion(); setAppVersion(v); }
      if ((window.api as any)?.getApiKeyInfo) {
        try { const r = await (window.api as any).getApiKeyInfo('steamgriddb'); setSgSavedKey(r?.ok ? { hasSecret: r.hasSecret, fingerprint: r.fingerprint } : null); } catch (_) {}
      }
      if ((window.api as any)?.getDiscordStatus) {
        try { const ds = await (window.api as any).getDiscordStatus(); setDiscordStatus(ds || null); } catch (_) {}
      }
    })();
    setChiakiUpd(null);
  }, [show, settings]);

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

  const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <button className={'settings-toggle' + (value ? ' on' : '')} onClick={() => onChange(!value)} />
  );

  const sections = [
    { id: 'appearance', label: 'Appearance', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg> },
    { id: 'library', label: 'Library', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg> },
    { id: 'behavior', label: 'Behavior', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
    { id: 'system', label: 'System', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> },
    { id: 'danger', label: 'Danger Zone', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> },
  ];



  const renderHeader = () => {
    const gameCount = Array.isArray(games) ? games.length : 0;
    const totalMinutes = Array.isArray(games) ? games.reduce((s: number, g: Game) => s + (g.playtimeMinutes || 0), 0) : 0;
    return (
      <div className="settings-header">
        <span className="settings-header-logo">Cereal</span>
        <span className="settings-header-ver">v{appVersion}</span>
        <div className="settings-header-stats">
          <div className="settings-header-stat">
            <div className="settings-header-stat-val">{gameCount}</div>
            <div className="settings-header-stat-lbl">Games</div>
          </div>
          <div className="settings-header-stat">
            <div className="settings-header-stat-val">{totalMinutes ? fmtTime(totalMinutes) : '—'}</div>
            <div className="settings-header-stat-lbl">Playtime</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <SidePanel show={show} onClose={onClose} title="Settings" wide>
      <div className="settings-layout">
        <div className="settings-nav" role="tablist">
          {sections.filter(s => s.id !== 'danger').map(sec => (
            <button key={sec.id} role="tab" aria-selected={sec.id === activeSection} className={sec.id === activeSection ? 'active' : ''} onClick={() => setActiveSection(sec.id)}>
              {sec.icon}{sec.label}
            </button>
          ))}
          <div className="settings-nav-sep" />
          <div className="settings-nav-danger">
            {sections.filter(s => s.id === 'danger').map(sec => (
              <button key={sec.id} role="tab" aria-selected={sec.id === activeSection} className={sec.id === activeSection ? 'active' : ''} onClick={() => setActiveSection(sec.id)}>
                {sec.icon}{sec.label}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-content">
          {renderHeader()}

          {/* Appearance */}
          {activeSection === 'appearance' && <div className="settings-section">
            <div className="settings-section-label">Appearance</div>
            <div className="settings-group">
              <div className="theme-grid" style={{ padding: '4px 8px 10px' }}>
                {Object.entries(THEMES).map(([key, t]) => (
                  <button key={key} className={'theme-swatch' + ((local.theme || 'midnight') === key ? ' active' : '')}
                    onClick={() => { update('theme', key); update('accentColor' as any, ''); applyTheme(key); }} title={t.label}>
                    <div className="theme-swatch-preview">
                      <div style={{ background: t.preview[0], flex: 1 }} />
                      <div style={{ background: t.preview[2], flex: 1 }} />
                    </div>
                    <div className="theme-swatch-accent" style={{ background: t.accent }} />
                    <div className="theme-swatch-label">{t.label}</div>
                  </button>
                ))}
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><div className="settings-row-label">Accent Colour</div><div className="settings-row-desc">Override the theme accent colour</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="color"
                    className="settings-color"
                    value={(local as any).accentColor || (THEMES[local.theme || 'midnight']?.accent ?? '#d4a853')}
                    onChange={e => {
                      const c = e.target.value;
                      (local as any).accentColor = c;
                      document.documentElement.style.setProperty('--accent', c);
                      document.documentElement.style.setProperty('--accent-soft', c + '1f');
                      document.documentElement.style.setProperty('--accent-border', c + '4d');
                    }}
                    onBlur={e => { update('accentColor' as any, e.target.value); }}
                  />
                  {(local as any).accentColor && (
                    <button className="btn-flat" style={{ fontSize: 11 }} onClick={() => {
                      update('accentColor' as any, '');
                      applyTheme(local.theme || 'midnight');
                    }}>Reset</button>
                  )}
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><div className="settings-row-label">Default View</div><div className="settings-row-desc">View shown on startup</div></div>
                <select className="settings-select" value={local.defaultView || 'orbit'} onChange={e => update('defaultView', e.target.value as any)}>
                  <option value="orbit">Galaxy Orbit</option>
                  <option value="cards">Card Grid</option>
                </select>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><div className="settings-row-label">Star Density</div><div className="settings-row-desc">Background star count</div></div>
                <select className="settings-select" value={(local as any).starDensity || 'normal'} onChange={e => update('starDensity' as any, e.target.value)}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><div className="settings-row-label">UI Scale</div><div className="settings-row-desc">Font size and zoom level</div></div>
                <select className="settings-select" value={String(local.uiScale || '1')} onChange={e => { update('uiScale', e.target.value); applyUiScale(e.target.value); }}>
                  <option value="0.9">Small</option>
                  <option value="1">Normal</option>
                  <option value="1.1">Large</option>
                  <option value="1.25">X-Large</option>
                </select>
              </div>
              <div className="settings-row" style={{ borderBottom: 'none' }}>
                <div className="settings-row-info"><div className="settings-row-label">Animations</div><div className="settings-row-desc">Orbit drift and transitions</div></div>
                <Toggle value={local.showAnimations !== false} onChange={v => update('showAnimations', v)} />
              </div>
            </div>
          </div>}

          {/* Behavior */}
          {activeSection === 'behavior' && <div className="settings-section">
            <div className="settings-section-label">Behavior</div>
            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-info"><div className="settings-row-label">Auto-Sync Playtime</div><div className="settings-row-desc">Sync Steam playtime on launch</div></div>
                <Toggle value={!!(local as any).autoSyncPlaytime} onChange={v => update('autoSyncPlaytime' as any, v)} />
              </div>
              <div className="settings-row">
                <div className="settings-row-info"><div className="settings-row-label">Minimize on Game Launch</div><div className="settings-row-desc">Hide window when starting a game</div></div>
                <Toggle value={!!(local as any).minimizeOnLaunch} onChange={v => update('minimizeOnLaunch' as any, v)} />
              </div>
              <div className="settings-row" style={{ borderBottom: 'none' }}>
                <div className="settings-row-info">
                  <div className="settings-row-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    Discord Rich Presence
                    {discordStatus && <span title={discordStatus.connected ? (discordStatus.ready ? 'Discord connected' : 'Discord connecting…') : 'Discord not connected'} style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: discordStatus.ready ? 'var(--green)' : discordStatus.connected ? 'var(--yellow)' : 'var(--text-4)', flexShrink: 0 }} />}
                  </div>
                  <div className="settings-row-desc">Show currently playing game on Discord</div>
                </div>
                <Toggle value={!!(local as any).discordPresence} onChange={v => update('discordPresence' as any, v)} />
              </div>
            </div>
          </div>}

          {/* System */}
          {activeSection === 'system' && <div className="settings-section">
            <div className="settings-section-label">System</div>
            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-info"><div className="settings-row-label">Launch on Startup</div><div className="settings-row-desc">Start Cereal when Windows boots</div></div>
                <Toggle value={!!(local as any).launchOnStartup} onChange={v => update('launchOnStartup' as any, v)} />
              </div>
              <div className="settings-row" style={{ borderBottom: 'none' }}>
                <div className="settings-row-info"><div className="settings-row-label">Close to System Tray</div><div className="settings-row-desc">Keep running in background when closed</div></div>
                <Toggle value={!!(local as any).closeToTray} onChange={v => update('closeToTray' as any, v)} />
              </div>
            </div>

            <div className="settings-section-label" style={{ marginTop: 16 }}>Updates</div>
            <div className="sys-update-list">
              {/* Cereal */}
              <div className="sys-update-card">
                <div className="sys-update-card-top">
                  <div className="sys-update-card-name">Cereal</div>
                  <div className="sys-update-card-ver">v{appVersion}</div>
                  {updateStatus === 'ready' && <span className="sys-update-badge new">{availableVersion ? `v${availableVersion} ready` : 'Update ready'}</span>}
                  {updateStatus === 'downloading' && <span className="sys-update-badge busy">{availableVersion ? `v${availableVersion} — ${updateProgress}%` : `Downloading ${updateProgress}%`}</span>}
                  {updateStatus === 'checking' && <span className="sys-update-badge busy">Checking…</span>}
                  {updateStatus === 'up-to-date' && <span className="sys-update-badge ok">Up to date</span>}
                  {updateStatus === 'error' && <span className="sys-update-badge err" title={updateError || ''}>Error</span>}
                </div>
                <div className="sys-update-card-actions">
                  <button className="btn-sm" disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                    onClick={async () => {
                      setUpdateStatus('checking');
                      const r = await (window.api as any)?.checkForUpdate?.();
                      if (r?.error) { setUpdateStatus('error'); setUpdateError(r.error); }
                    }}>
                    Check
                  </button>
                  {updateStatus === 'ready' && (
                    <button className="btn-sm primary" onClick={() => (window.api as any)?.installUpdate?.()}>
                      Install &amp; Restart
                    </button>
                  )}
                </div>
              </div>

              {/* chiaki-ng */}
              <div className="sys-update-card">
                <div className="sys-update-card-top">
                  <div className="sys-update-card-name">chiaki-ng</div>
                  {(chiakiUpd?.current || chiakiUpd?.hasUpdate === false) && (
                    <div className="sys-update-card-ver">v{chiakiUpd.current}</div>
                  )}
                  {chiakiUpd?.hasUpdate && <span className="sys-update-badge new">v{chiakiUpd.latest} available</span>}
                  {chiakiUpd?.hasUpdate === false && <span className="sys-update-badge ok">Up to date</span>}
                  {chiakiUpd?.checking && <span className="sys-update-badge busy">Checking…</span>}
                  {chiakiUpd?.updating && <span className="sys-update-badge busy">Updating…</span>}
                  {chiakiUpd?.done && <span className="sys-update-badge ok">Updated to v{chiakiUpd.version}</span>}
                  {chiakiUpd?.error && <span className="sys-update-badge err" title={chiakiUpd.error}>Error</span>}
                </div>
                <div className="sys-update-card-desc">PlayStation Remote Play engine</div>
                <div className="sys-update-card-actions">
                  <button className="btn-sm" disabled={chiakiUpd?.checking || chiakiUpd?.updating}
                    onClick={async () => {
                      setChiakiUpd({ checking: true });
                      try {
                        const s = await (window.api as any)?.getChiakiStatus?.();
                        const r = await (window.api as any)?.chiakiCheckUpdate?.();
                        if (r?.error) { setChiakiUpd({ error: r.error }); return; }
                        const current = r?.current || s?.version || null;
                        if (r?.hasUpdate) setChiakiUpd({ current, latest: r.latest, hasUpdate: true });
                        else setChiakiUpd({ current, latest: r?.latest || null, hasUpdate: false });
                      } catch (e: any) { setChiakiUpd({ error: e.message }); }
                    }}>Check</button>
                  {chiakiUpd?.hasUpdate && (
                    <button className="btn-sm primary" disabled={chiakiUpd?.updating}
                      onClick={async () => {
                        setChiakiUpd((prev: any) => ({ ...prev, updating: true }));
                        try {
                          const r = await (window.api as any)?.chiakiUpdate?.();
                          if (r?.ok) setChiakiUpd({ done: true, version: r.version });
                          else setChiakiUpd({ error: r?.error || 'Update failed' });
                        } catch (e: any) { setChiakiUpd({ error: e.message }); }
                      }}>Update</button>
                  )}
                </div>
              </div>
            </div>
          </div>}

          {/* Library */}
          {activeSection === 'library' && <div className="settings-section">

            {/* Quick actions */}
            <div className="lib-section-title">Actions</div>
            <div className="settings-action-grid">
              <button className="settings-action-card" onClick={async () => { if (onRescanAll) await onRescanAll(); }}>
                <div className="settings-action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
                <div className="settings-action-body"><div className="settings-action-label">Re-scan Platforms</div><div className="settings-action-desc">Detect newly installed games</div></div>
              </button>
              <button className="settings-action-card" onClick={onFetchMetadata}>
                <div className="settings-action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>
                <div className="settings-action-body"><div className="settings-action-label">Fetch Metadata</div><div className="settings-action-desc">Covers, scores &amp; descriptions</div></div>
              </button>
              <button className="settings-action-card" onClick={onSync}>
                <div className="settings-action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg></div>
                <div className="settings-action-body"><div className="settings-action-label">Sync Playtime</div><div className="settings-action-desc">Pull hours from Steam</div></div>
              </button>
              <button className="settings-action-card" onClick={onOpenPlatforms}>
                <div className="settings-action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div>
                <div className="settings-action-body"><div className="settings-action-label">Platforms</div><div className="settings-action-desc">Manage connected accounts</div></div>
              </button>
            </div>

            {/* Backup */}
            <div className="lib-section-title">Backup</div>
            <div className="settings-action-grid">
              <button className="settings-action-card" onClick={doExport}>
                <div className="settings-action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
                <div className="settings-action-body"><div className="settings-action-label">Export Library</div><div className="settings-action-desc">Save to JSON file</div></div>
              </button>
              <button className="settings-action-card" onClick={doFileImport}>
                <div className="settings-action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>
                <div className="settings-action-body"><div className="settings-action-label">Import Library</div><div className="settings-action-desc">Restore from JSON file</div></div>
              </button>
            </div>

            {/* SteamGridDB */}
            <div className="lib-section-title">Integrations</div>
            <div className="lib-key-card">
              <div className="lib-key-card-top">
                <div className="lib-key-card-name">SteamGridDB</div>
                {sgStatus === 'checking' && <span className="lib-key-card-status busy">Checking…</span>}
                {sgStatus === 'valid' && <span className="lib-key-card-status ok">Valid</span>}
                {sgStatus && sgStatus !== 'valid' && sgStatus !== 'checking' && <span className="lib-key-card-status err">Invalid</span>}
                {!sgStatus && sgSavedKey?.hasSecret && <span className="lib-key-card-status ok">Key saved</span>}
                {!sgStatus && !sgSavedKey?.hasSecret && <span className="lib-key-card-status missing">No key</span>}
                {sgSavedKey?.fingerprint && <span className="lib-key-card-fp">{sgSavedKey.fingerprint}</span>}
              </div>
              <div className="settings-row-desc">Custom game art search. <a href="#" className="settings-link" onClick={e => { e.preventDefault(); (window.api as any)?.openExternal?.('https://www.steamgriddb.com/profile/preferences/api'); }}>Get a key</a></div>
              <div className="lib-key-input-row">
                <input type="password" value={sgKey} onChange={e => { setSgKey(e.target.value); setSgStatus(null); }} placeholder={sgSavedKey?.hasSecret ? 'Saved — paste to replace' : 'Paste API key here'} />
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
            </div>

            {/* Data */}
            {dataPath && (
              <>
                <div className="lib-section-title">Data</div>
                <div className="lib-data-path">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="lib-data-path-label">Storage location</div>
                    <div className="lib-data-path-val">{dataPath}</div>
                  </div>
                  <button className="btn-sm" style={{ flexShrink: 0 }} onClick={() => (window.api as any)?.openExternal?.('file:///' + dataPath.replace(/\\/g, '/'))}>Open</button>
                </div>
              </>
            )}

          </div>}

          {/* Danger Zone */}
          {activeSection === 'danger' && <div className="settings-section">
            <div className="settings-section-label" style={{ color: 'var(--red)' }}>Danger Zone</div>
            <div className="settings-danger-section">
              <div className="settings-danger-row">
                <div>
                  <div className="settings-danger-row-label">Reset All Covers</div>
                  <div className="settings-danger-row-desc">Remove custom artwork and revert to default covers</div>
                </div>
                <button className="btn-sm danger" onClick={doClearCovers}>{confirmClearCovers ? 'Are you sure?' : 'Reset Covers'}</button>
              </div>
              <div className="settings-danger-row">
                <div>
                  <div className="settings-danger-row-label">Clear All Games</div>
                  <div className="settings-danger-row-desc">Permanently delete every game from your library</div>
                </div>
                <button className="btn-sm danger" onClick={doClearAll}>{confirmClear ? 'Are you sure?' : 'Clear Library'}</button>
              </div>
              <div className="settings-danger-row">
                <div>
                  <div className="settings-danger-row-label">Reset Settings</div>
                  <div className="settings-danger-row-desc">Restore all preferences to factory defaults</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-sm danger" onClick={doReset}>Reset All</button>
                  <button className="btn-sm" onClick={async () => {
                    if (!confirm('Re-run the first-time setup wizard?')) return;
                    if ((window.api as any)?.saveSettings) await (window.api as any).saveSettings({ firstRun: true });
                    if (typeof onRunWizard === 'function') onRunWizard(true);
                    flash('Setup wizard will run');
                  }}>Re-run Wizard</button>
                </div>
              </div>
            </div>
          </div>}

          <div className="settings-about">
            <span className="settings-about-logo">Cereal</span>
            <span className="settings-about-ver">v{appVersion}</span>
            <span className="settings-about-author">Made with cereal by Andrew</span>
          </div>
        </div>
      </div>
    </SidePanel>
  );
}
