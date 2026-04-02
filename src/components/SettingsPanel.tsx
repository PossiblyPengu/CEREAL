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
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  setCats: React.Dispatch<React.SetStateAction<string[]>>;
  onOpenPlatforms: () => void;
  onOpenDetect: () => void;
  onSync: () => void;
  onFetchMetadata: () => void;
  onRunWizard: (run: boolean) => void;
  onRescanAll: () => Promise<void>;
}

export function SettingsPanel({
  show, onClose, flash, settings, onSettingsChange, setGames, setCats,
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
      else if (type === 'update-available') setUpdateStatus('downloading');
      else if (type === 'download-progress') { setUpdateStatus('downloading'); setUpdateProgress(Math.round(data?.percent || 0)); }
      else if (type === 'update-downloaded') setUpdateStatus('ready');
      else if (type === 'update-not-available') setUpdateStatus('up-to-date');
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
    const prevGames: Game[] = Array.isArray((window as any)._games) ? [...(window as any)._games] : [];
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
    { id: 'behavior', label: 'Behavior', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
    { id: 'system', label: 'System', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> },
    { id: 'library', label: 'Library', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg> },
    { id: 'danger', label: 'Danger Zone', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> },
  ];



  const renderHeader = () => {
    const gameCount = Array.isArray((window as any)._games) ? (window as any)._games.length : 0;
    const totalMinutes = Array.isArray((window as any)._games) ? (window as any)._games.reduce((s: number, g: Game) => s + (g.playtimeMinutes || 0), 0) : 0;
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
                    {discordStatus && <span title={discordStatus.connected ? (discordStatus.ready ? 'Discord connected' : 'Discord connecting…') : 'Discord not connected'} style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: discordStatus.ready ? 'var(--green)' : discordStatus.connected ? 'var(--yellow, #f5a623)' : 'var(--text-4)', flexShrink: 0 }} />}
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
            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Software Update</div>
                  <div className="settings-row-desc">
                    {updateStatus === 'checking' && 'Checking for updates...'}
                    {updateStatus === 'downloading' && `Downloading... ${updateProgress}%`}
                    {updateStatus === 'ready' && 'Update ready to install'}
                    {updateStatus === 'up-to-date' && 'You are on the latest version'}
                    {updateStatus === 'error' && (updateError || 'Update check failed')}
                    {!updateStatus && 'Check for app updates'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-sm" onClick={async () => { setUpdateStatus('checking'); await (window.api as any)?.checkForUpdates?.(); }}>Check</button>
                  {updateStatus === 'ready' && <button className="btn-sm primary" onClick={() => (window.api as any)?.installUpdates?.()}>Install</button>}
                </div>
              </div>
              <div className="settings-row" style={{ borderBottom: 'none' }}>
                <div className="settings-row-info">
                  <div className="settings-row-label">chiaki-ng (Remote Play)</div>
                  <div className="settings-row-desc">
                    {!chiakiUpd && 'PlayStation Remote Play engine'}
                    {chiakiUpd?.checking && 'Checking for updates...'}
                    {chiakiUpd?.hasUpdate && `Update available: v${chiakiUpd.latest} (current: v${chiakiUpd.current})`}
                    {chiakiUpd?.hasUpdate === false && `Up to date (v${chiakiUpd.current})`}
                    {chiakiUpd?.updating && 'Updating...'}
                    {chiakiUpd?.done && `Updated to v${chiakiUpd.version}`}
                    {chiakiUpd?.error && `Error: ${chiakiUpd.error}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-sm" disabled={chiakiUpd?.checking || chiakiUpd?.updating} onClick={async () => {
                    setChiakiUpd({ checking: true });
                    try {
                      const s = await (window.api as any)?.getChiakiStatus?.();
                      if (!s?.installed) { setChiakiUpd({ error: 'Not installed' }); return; }
                      const r = await (window.api as any)?.chiakiCheckUpdate?.();
                      if (r?.hasUpdate) setChiakiUpd({ current: r.current, latest: r.latest, hasUpdate: true });
                      else setChiakiUpd({ current: r?.current || s.version, hasUpdate: false });
                    } catch (e: any) { setChiakiUpd({ error: e.message }); }
                  }}>Check</button>
                  {chiakiUpd?.hasUpdate && (
                    <button className="btn-sm primary" disabled={chiakiUpd?.updating} onClick={async () => {
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
            <div className="settings-section-label">Library &amp; Art</div>
            <div className="settings-group">
              <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', height: 'auto', padding: '12px 14px', borderBottom: 'none' }}>
                <div className="settings-row-info" style={{ marginBottom: 8 }}>
                  <div className="settings-row-label">SteamGridDB API Key</div>
                  <div className="settings-row-desc">Custom game art search.{' '}
                    <a href="#" onClick={e => { e.preventDefault(); (window.api as any)?.openExternal?.('https://www.steamgriddb.com/profile/preferences/api'); }} style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Get a key</a>
                  </div>
                </div>
                <div className="sgdb-key-row">
                  <input type="password" value={sgKey} onChange={e => { setSgKey(e.target.value); setSgStatus(null); }} placeholder={sgSavedKey?.hasSecret ? '••••••••' + (sgSavedKey.fingerprint || '') : 'Paste API key'} />
                  <button className="btn-sm" onClick={async () => {
                    if (!(window.api as any)?.readClipboard) return flash('Clipboard not available');
                    const txt = await (window.api as any).readClipboard();
                    if (!txt) return flash('Clipboard empty');
                    const k = txt.trim(); setSgKey(k); setSgStatus('checking');
                    const vr = await (window.api as any).validateApiKey('steamgriddb', k);
                    if (vr?.ok) { const sr = await (window.api as any).saveApiKey('steamgriddb', k); if (sr?.ok) { setSgSavedKey({ hasSecret: true, fingerprint: sr.fingerprint || null }); flash('SteamGridDB key saved'); } }
                    else { setSgStatus('invalid'); flash('Key is invalid'); }
                  }}>Paste</button>
                </div>
                <div className="sgdb-key-actions">
                  <button className="btn-sm" onClick={async () => {
                    if (!sgKey && !sgSavedKey?.hasSecret) { flash('No key to validate'); return; }
                    setSgStatus('checking');
                    const r = sgKey
                      ? await (window.api as any).validateApiKey('steamgriddb', sgKey)
                      : await (window.api as any).validateStoredApiKey?.('steamgriddb');
                    setSgStatus(r?.ok ? 'valid' : ('invalid: ' + (r?.error || 'unknown')));
                  }}>Validate</button>
                  <button className="btn-sm primary" onClick={async () => {
                    if (!sgKey) { flash('Enter a key first'); return; }
                    const r = await (window.api as any).saveApiKey('steamgriddb', sgKey);
                    if (r?.ok) { setSgSavedKey({ hasSecret: true, fingerprint: r.fingerprint || null }); flash('Key saved securely'); } else flash('Save failed: ' + r?.error);
                  }}>Save</button>
                  {sgSavedKey?.hasSecret && (
                    <button className="btn-sm danger" onClick={async () => {
                      const r = await (window.api as any).deleteApiKey('steamgriddb');
                      if (r?.ok) { setSgSavedKey(null); setSgKey(''); flash('Key deleted'); } else flash('Delete failed');
                    }}>Delete</button>
                  )}
                  {sgStatus && <span className="sgdb-key-status" style={{ color: sgStatus === 'valid' ? 'var(--green)' : sgStatus === 'checking' ? 'var(--text-3)' : 'var(--red)' }}>{sgStatus}</span>}
                </div>
                {sgSavedKey?.hasSecret && <div className="sgdb-key-saved">Key saved {sgSavedKey.fingerprint ? `(id: ${sgSavedKey.fingerprint})` : ''}</div>}
              </div>
            </div>
          <div className="settings-action-grid" style={{ margin: '10px 0' }}>
              <button className="settings-action-card" onClick={async () => { if (onRescanAll) await onRescanAll(); }}>
                <div className="settings-action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
                <div className="settings-action-body"><div className="settings-action-label">Re-scan Platforms</div><div className="settings-action-desc">Detect new installed games</div></div>
              </button>
              <button className="settings-action-card" onClick={onSync}>
                <div className="settings-action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg></div>
                <div className="settings-action-body"><div className="settings-action-label">Sync Playtime</div><div className="settings-action-desc">Pull hours from Steam</div></div>
              </button>
              <button className="settings-action-card" onClick={onFetchMetadata}>
                <div className="settings-action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>
                <div className="settings-action-body"><div className="settings-action-label">Fetch Metadata</div><div className="settings-action-desc">Covers, scores, descriptions</div></div>
              </button>
              <button className="settings-action-card" onClick={onOpenPlatforms}>
                <div className="settings-action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div>
                <div className="settings-action-body"><div className="settings-action-label">Platforms</div><div className="settings-action-desc">Manage connected accounts</div></div>
              </button>
              <button className="settings-action-card" onClick={doExport}>
                <div className="settings-action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
                <div className="settings-action-body"><div className="settings-action-label">Export Library</div><div className="settings-action-desc">Save to JSON file</div></div>
              </button>
              <button className="settings-action-card" onClick={doFileImport}>
                <div className="settings-action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div>
                <div className="settings-action-body"><div className="settings-action-label">Import Library</div><div className="settings-action-desc">Load from JSON file</div></div>
              </button>
              <button className="settings-action-card" onClick={() => { if (dataPath) (window.api as any)?.openExternal?.('file:///' + dataPath.replace(/\\/g, '/')); }} disabled={!dataPath}>
                <div className="settings-action-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></div>
                <div className="settings-action-body"><div className="settings-action-label">Open Folder</div><div className="settings-action-desc">Browse data location</div></div>
              </button>
            </div>
            {dataPath && (
              <div className="settings-group" style={{ marginTop: 10 }}>
                <div className="settings-row" style={{ borderBottom: 'none' }}>
                  <div className="settings-row-info">
                    <div className="settings-row-label">Data Location</div>
                    <div className="settings-row-desc" style={{ wordBreak: 'break-all', fontFamily: 'Consolas, monospace', fontSize: 9, letterSpacing: '0.3px' }}>{dataPath}</div>
                  </div>
                </div>
              </div>
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
