import React, { useState, useEffect } from 'react';
import type { Game, Settings } from '../types';
import { THEMES, PLATFORMS } from '../constants';
import { applyTheme, applyUiScale } from '../utils';

interface StartupWizardProps {
  show: boolean;
  onClose: () => void;
  flash: (msg: React.ReactNode) => void;
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  settings: Settings;
  onSettingsChange: (s: Partial<Settings>) => void;
}

export function StartupWizard({ show, onClose, flash, setGames, settings, onSettingsChange }: StartupWizardProps) {
  const TOTAL_STEPS = 7;
  const [step, setStep] = useState(1);
  const [accounts, setAccounts] = useState<Record<string, any>>({});
  const [importStatus, setImportStatus] = useState<Record<string, string>>({});
  const [importErrors, setImportErrors] = useState<Record<string, string>>({});
  const [importCounts, setImportCounts] = useState<Record<string, number>>({});
  const [chiakiStatus, setChiakiStatus] = useState<any>(null);
  const [chiakiDownloading, setChiakiDownloading] = useState(false);
  const [consoles, setConsoles] = useState<any[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [registerHost, setRegisterHost] = useState('');
  const [registerPsnId, setRegisterPsnId] = useState('');
  const [registerPin, setRegisterPin] = useState('');
  const [registering, setRegistering] = useState(false);
  const [manualHost, setManualHost] = useState('');
  const [specs, setSpecs] = useState<any>(null);

  // Local wizard state mirrors settings for live preview
  const [wTheme, setWTheme] = useState(settings.theme || 'midnight');
  const [wAccent, setWAccent] = useState(settings.accentColor || '');
  const [wView, setWView] = useState<'orbit' | 'cards'>(settings.defaultView || 'orbit');
  const [wDensity, setWDensity] = useState(settings.starDensity || 'normal');
  const [wScale, setWScale] = useState(settings.uiScale || '1');
  const [wAnimations, setWAnimations] = useState(settings.showAnimations !== false);
  const [wNavPos, setWNavPos] = useState<'top' | 'bottom' | 'left' | 'right'>(settings.toolbarPosition || 'top');
  const [wMinimize, setWMinimize] = useState(!!settings.minimizeOnLaunch);
  const [wCloseTray, setWCloseTray] = useState(!!settings.closeToTray);
  const [wDiscord, setWDiscord] = useState(!!settings.discordPresence);
  const [wAutoSync, setWAutoSync] = useState(!!settings.autoSyncPlaytime);

  const refreshAccounts = async () => {
    if ((window.api as any)?.getAccounts) {
      const a = await (window.api as any).getAccounts();
      setAccounts(a || {});
    }
  };

  const refreshChiaki = async () => {
    if ((window.api as any)?.getChiakiStatus) {
      const s = await (window.api as any).getChiakiStatus();
      setChiakiStatus(s);
    }
  };

  useEffect(() => {
    if (show) {
      refreshAccounts();
      refreshChiaki();
      setStep(1);
      setManualHost('');
      setWTheme(settings.theme || 'midnight');
      setWAccent(settings.accentColor || '');
      setWView(settings.defaultView || 'orbit');
      setWDensity(settings.starDensity || 'normal');
      setWScale(settings.uiScale || '1');
      setWAnimations(settings.showAnimations !== false);
      setWNavPos(settings.toolbarPosition || 'top');
      setWMinimize(!!settings.minimizeOnLaunch);
      setWCloseTray(!!settings.closeToTray);
      setWDiscord(!!settings.discordPresence);
      setWAutoSync(!!settings.autoSyncPlaytime);
      (window.api as any)?.getSystemSpecs?.().then((s: any) => setSpecs(s)).catch(() => {});
    }
  }, [show]);

  useEffect(() => {
    if (step === 6 && chiakiStatus && chiakiStatus.status !== 'missing' && consoles.length === 0 && !discovering) {
      discoverConsoles();
    }
  }, [step, chiakiStatus]);

  // Persist all wizard choices on step change or nav
  const saveWizardSettings = async (extra?: Partial<Settings>) => {
    const patch: Partial<Settings> = {
      theme: wTheme,
      accentColor: wAccent,
      defaultView: wView,
      starDensity: wDensity,
      uiScale: wScale,
      showAnimations: wAnimations,
      toolbarPosition: wNavPos,
      minimizeOnLaunch: wMinimize,
      closeToTray: wCloseTray,
      discordPresence: wDiscord,
      autoSyncPlaytime: wAutoSync,
      ...extra,
    };
    onSettingsChange(patch);
    if ((window.api as any)?.saveSettings) await (window.api as any).saveSettings(patch);
  };

  const doAuth = async (which: string) => {
    try {
      if (!window.api) return;
      const authResult = await (window.api as any).platformAuth?.(which);
      if (authResult?.error) {
        if (authResult.error !== 'cancelled') flash(which + ' sign-in failed: ' + authResult.error);
        return;
      }
      await refreshAccounts();
      const fresh = await (window.api as any).getAccounts?.();
      if (fresh && fresh[which] && fresh[which].connected) {
        flash(which + ' connected — importing library...');
        setImportStatus(p => ({ ...p, [which]: 'importing' }));
        try {
          const result = await (window.api as any).platformImport?.(which);
          if (result?.error) {
            setImportStatus(p => ({ ...p, [which]: 'error' }));
            setImportErrors(p => ({ ...p, [which]: result.error }));
            flash(result.error);
            return;
          }
          const count = Array.isArray(result?.imported) ? result.imported.length : (typeof result?.imported === 'number' ? result.imported : 0);
          setImportCounts(p => ({ ...p, [which]: count }));
          setImportStatus(p => ({ ...p, [which]: 'done' }));
          flash(count > 0 ? count + ' games imported from ' + which : which + ' library up to date');
          if ((window.api as any)?.getGames) {
            const g = await (window.api as any).getGames();
            if (typeof setGames === 'function') setGames(g || []);
          }
        } catch (e) {
          console.error('Import error', e);
          setImportStatus(p => ({ ...p, [which]: 'error' }));
        }
      }
    } catch (e) { console.error('Auth error', e); flash('Authentication error'); }
  };

  const downloadChiaki = async () => {
    setChiakiDownloading(true);
    try {
      const r = await (window.api as any)?.chiakiUpdate?.();
      if (r?.ok) { flash('chiaki-ng downloaded (v' + (r.version || '?') + ')'); await refreshChiaki(); }
      else flash(r?.error || 'Download failed');
    } catch (_) { flash('Download failed'); }
    setChiakiDownloading(false);
  };

  const discoverConsoles = async () => {
    setDiscovering(true);
    try {
      const r = await (window.api as any)?.chiakiDiscoverConsoles?.();
      const found = r?.consoles || [];
      if (found.length) setConsoles(found);
      else flash('No consoles found on network');
    } catch (_) { flash('Discovery failed'); }
    setDiscovering(false);
  };

  const registerConsole = async (host: string) => {
    if (!registerPsnId || !registerPin) { flash('PSN Account ID and PIN required'); return; }
    setRegistering(true);
    try {
      const r = await (window.api as any)?.chiakiRegisterConsole?.({ host, psnAccountId: registerPsnId, pin: registerPin });
      if (r?.success) { flash('Console registered'); setRegisterPsnId(''); setRegisterPin(''); }
      else flash(r?.error || 'Registration failed');
    } catch (_) { flash('Registration failed'); }
    setRegistering(false);
  };

  const goNext = () => { saveWizardSettings(); setStep(s => Math.min(s + 1, TOTAL_STEPS)); };
  const goBack = () => setStep(s => Math.max(s - 1, 1));

  const finish = async () => {
    await saveWizardSettings({ firstRun: false });
    onClose();
  };

  if (!show) return null;

  const connectedCount = ['steam', 'gog', 'epic', 'xbox'].filter(p => accounts[p]?.connected).length;
  const chiakiReady = chiakiStatus && chiakiStatus.status !== 'missing';

  const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <button className={'settings-toggle' + (value ? ' on' : '')} onClick={() => onChange(!value)} />
  );

  // ── Step 1: Welcome ────────────────────────────────────────────────────────
  const renderWelcome = () => (
    <div style={{ textAlign: 'center', padding: '14px 0' }}>
      <div style={{ fontSize: 48, marginBottom: 10 }}>🥣</div>
      <h2 style={{ margin: '0 0 6px', fontSize: 22 }}>Welcome to Cereal</h2>
      <p style={{ color: 'var(--text-2)', margin: '0 0 20px', fontSize: 13 }}>Your unified game launcher. Let's get you set up.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20, textAlign: 'left' }}>
        {([
          ['🌌', 'Orbit View', 'Fly through your games like a solar system'],
          ['🎮', 'All Platforms', 'Steam, Epic, GOG & Xbox in one place'],
          ['📺', 'Remote Play', 'Stream PS4/PS5 via chiaki-ng'],
          ['🖼️', 'Cover Art', 'Auto-fetch artwork from SteamGridDB'],
          ['🎯', 'Smart Filters', 'Filter by platform, category or playtime'],
          ['🟣', 'Discord Status', "Show what you're playing to friends"],
        ] as [string, string, string][]).map(([icon, title, desc]) => (
          <div key={title} style={{ background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 3 }}>{title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4 }}>{desc}</div>
          </div>
        ))}
      </div>
      <button className="btn-accent btn-accent-lg" onClick={() => setStep(2)}>Get Started</button>
    </div>
  );

  // ── Step 2: Appearance ─────────────────────────────────────────────────────
  const renderAppearance = () => (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Appearance</h2>
      <p style={{ color: 'var(--text-2)', margin: '0 0 14px', fontSize: 12 }}>Pick a theme and view mode. You can always change these later in Settings.</p>

      {/* Theme picker */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-2)' }}>Theme</div>
        <div className="wizard-theme-grid">
          {Object.entries(THEMES).map(([key, t]) => (
            <button key={key} className={'wizard-theme-swatch' + (wTheme === key ? ' active' : '')}
              onClick={() => { setWTheme(key); setWAccent(''); applyTheme(key); }}>
              <div className="wizard-theme-preview">
                {t.preview.map((c, i) => <div key={i} style={{ background: c, flex: 1 }} />)}
              </div>
              <div className="wizard-theme-accent" style={{ background: t.accent }} />
              <div className="wizard-theme-label">{t.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Accent color override */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Custom Accent Color</div>
          <input type="color" value={wAccent || THEMES[wTheme]?.accent || '#d4a853'} className="settings-color sm"
            onChange={e => {
              setWAccent(e.target.value);
              document.documentElement.style.setProperty('--accent', e.target.value);
              document.documentElement.style.setProperty('--accent-soft', e.target.value + '1f');
              document.documentElement.style.setProperty('--accent-border', e.target.value + '4d');
            }} />
          {wAccent && <button className="btn-flat" style={{ padding: '4px 10px', fontSize: 10 }}
            onClick={() => { setWAccent(''); applyTheme(wTheme); }}>Reset</button>}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 4 }}>Optional — override the theme accent with any color.</div>
      </div>

      {/* Default view */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-2)' }}>Default View</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {(['orbit', 'cards'] as const).map(v => (
            <button key={v} className={'wizard-view-btn' + (wView === v ? ' active' : '')}
              onClick={() => setWView(v)}>
              <div className="wizard-view-icon">
                {v === 'orbit'
                  ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-30 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(30 12 12)"/></svg>
                  : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                }
              </div>
              <div style={{ fontWeight: 600, fontSize: 12 }}>{v === 'orbit' ? 'Orbit' : 'Cards'}</div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.3 }}>
                {v === 'orbit' ? 'Interactive galaxy with zoom & pan' : 'Classic grid for quick browsing'}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Step 3: Performance & Layout ───────────────────────────────────────────
  const renderPerformance = () => {
    const getRecommendation = (sp: any) => {
      const ramGb = sp.ramGb || 0;
      const cpuCount = sp.cpuCount || 0;
      const starDensity = (ramGb >= 24 && cpuCount >= 8) ? 'high' : (ramGb <= 8 || cpuCount <= 4) ? 'low' : 'normal';
      const sw = window.screen?.width || 1920;
      const uiScale = sw >= 2560 ? '1.25' : sw >= 1920 ? '1.1' : sw < 1280 ? '0.9' : '1';
      return { starDensity, uiScale };
    };
    const rec = specs ? getRecommendation(specs) : null;
    return (
      <div>
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Performance & Layout</h2>
        <p style={{ color: 'var(--text-2)', margin: '0 0 14px', fontSize: 12 }}>Tune rendering quality and UI layout.</p>

        {/* Specs card */}
        {specs && (
          <div style={{ background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 10, padding: '10px 16px', marginBottom: 14, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 14px', alignItems: 'baseline' }}>
            {([['RAM', specs.ramGb + '\u00a0GB'], ['CPU', specs.cpuCount + ' cores' + (specs.cpuModel ? ' — ' + specs.cpuModel.slice(0, 32) : '')], specs.gpuName ? ['GPU', specs.gpuName.slice(0, 40)] : null, ['Display', window.screen.width + '×' + window.screen.height]] as (string[] | null)[]).filter((x): x is string[] => x !== null).map(([k, v]) => [
              <div key={k + 'k'} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-4)' }}>{k}</div>,
              <div key={k + 'v'} style={{ fontSize: 12, color: 'var(--text-2)' }}>{v}</div>
            ])}
          </div>
        )}
        {!specs && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 12, marginBottom: 14 }}>
            <span className="spinner" />
            Detecting specs...
          </div>
        )}

        {rec && (
          <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, fontSize: 11, color: 'var(--text-4)', background: 'var(--glass)', border: '1px solid var(--glass-border)', lineHeight: 1.5 }}>
            💡 Recommended: <strong style={{ color: 'var(--text-3)' }}>{rec.starDensity}</strong> stars, <strong style={{ color: 'var(--text-3)' }}>{{  '0.9': '90%', '1': '100%', '1.1': '110%', '1.25': '125%' }[rec.uiScale]}</strong> scale
            <button className="btn-flat" style={{ marginLeft: 8, padding: '2px 8px', fontSize: 10, verticalAlign: 'middle' }}
              onClick={() => { setWDensity(rec.starDensity as any); setWScale(rec.uiScale); applyUiScale(rec.uiScale); }}>Apply</button>
          </div>
        )}

        {/* Star Density */}
        <div className="wizard-setting-row">
          <div>
            <div className="wizard-setting-label">Star Density</div>
            <div className="wizard-setting-desc">Background star count in Orbit view</div>
          </div>
          <div className="wizard-seg">
            {(['low', 'normal', 'high'] as const).map(v => (
              <button key={v} className={'wizard-seg-btn' + (wDensity === v ? ' active' : '')}
                onClick={() => setWDensity(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
            ))}
          </div>
        </div>

        {/* UI Scale */}
        <div className="wizard-setting-row">
          <div>
            <div className="wizard-setting-label">UI Scale</div>
            <div className="wizard-setting-desc">Text and element sizes</div>
          </div>
          <div className="wizard-seg">
            {([['0.9', '90%'], ['1', '100%'], ['1.1', '110%'], ['1.25', '125%']] as const).map(([v, l]) => (
              <button key={v} className={'wizard-seg-btn' + (wScale === v ? ' active' : '')}
                onClick={() => { setWScale(v); applyUiScale(v); }}>{l}</button>
            ))}
          </div>
        </div>

        {/* Animations */}
        <div className="wizard-setting-row">
          <div>
            <div className="wizard-setting-label">Animations</div>
            <div className="wizard-setting-desc">Orbit drift and UI transitions</div>
          </div>
          <Toggle value={wAnimations} onChange={setWAnimations} />
        </div>

        {/* Nav Position */}
        <div className="wizard-setting-row">
          <div>
            <div className="wizard-setting-label">Toolbar Position</div>
            <div className="wizard-setting-desc">Where the navigation bar sits</div>
          </div>
          <div className="wizard-seg">
            {(['top', 'bottom', 'left', 'right'] as const).map(v => (
              <button key={v} className={'wizard-seg-btn' + (wNavPos === v ? ' active' : '')}
                onClick={() => setWNavPos(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ── Step 4: Connect Accounts ───────────────────────────────────────────────
  const renderAccountCard = (platform: string, label: string) => {
    const acct = accounts[platform];
    const connected = acct?.connected;
    const impSt = importStatus[platform];
    const impCt = importCounts[platform];
    const impErr = importErrors[platform];
    return (
      <div className={'acct-card' + (connected ? ' connected' : '')} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="acct-avatar" style={!acct?.avatarUrl && PLATFORMS[platform] ? { color: PLATFORMS[platform].color } : undefined}>
          {acct?.avatarUrl
            ? <img src={acct.avatarUrl} alt="" />
            : PLATFORMS[platform]?.icon || <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="4" stroke="rgba(255,255,255,0.06)" strokeWidth="1.2" /></svg>
          }
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="acct-title">{label}</div>
          <div className="acct-status">
            {impSt === 'importing' ? <span style={{ color: 'var(--accent)' }}>Importing games...</span>
              : impSt === 'done' ? <span className="acct-connected-badge">✓ {impCt} games imported</span>
              : impSt === 'error' ? <span style={{ color: 'var(--red)', fontSize: 10, lineHeight: 1.4, display: 'block', wordBreak: 'break-word' }}>{impErr || 'Import failed'}</span>
              : connected ? <span className="acct-connected-badge">✓ {acct.displayName || acct.gamertag || 'Connected'}</span>
              : 'Not connected'}
          </div>
        </div>
        <button className="btn-flat" onClick={() => doAuth(platform)} disabled={impSt === 'importing'}>
          {connected ? 'Re-auth' : 'Sign in'}
        </button>
      </div>
    );
  };

  const renderAccounts = () => (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Connect Accounts</h2>
      <p style={{ color: 'var(--text-2)', margin: '0 0 14px', fontSize: 12 }}>Sign in to import your game libraries. You can skip any you don't use.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {renderAccountCard('steam', 'Steam')}
        {renderAccountCard('gog', 'GOG')}
        {renderAccountCard('epic', 'Epic Games')}
        {renderAccountCard('xbox', 'Xbox')}
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="acct-card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div className="acct-title">SteamGridDB</div>
            <div className="acct-status" style={{ fontSize: 11 }}>API key for game cover art lookup</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-flat" onClick={() => { if ((window.api as any)?.steamGridDbLogin) (window.api as any).steamGridDbLogin(); }}>Get Key</button>
            <button className="btn-flat" onClick={async () => {
              try {
                if (!(window.api as any)?.readClipboard) return flash('Clipboard not available');
                const txt = await (window.api as any).readClipboard();
                if (!txt || txt.trim().length < 10) { flash('No API key on clipboard'); return; }
                if ((window.api as any)?.saveApiKey) {
                  const r = await (window.api as any).saveApiKey('steamgriddb', txt.trim());
                  if (r?.ok) flash('SteamGridDB API key saved');
                  else flash('Could not save key');
                }
              } catch (_) { flash('Could not paste API key'); }
            }}>Paste Key</button>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 11, color: 'var(--text-4)', display: 'flex', gap: 8, alignItems: 'center', background: 'var(--glass)', border: '1px solid var(--glass-border)' }}>
        <span>🔒</span>
        <span>Your library data stays local — Cereal never uploads your account info or game list to any server.</span>
      </div>
    </div>
  );

  // ── Step 5: Behavior ───────────────────────────────────────────────────────
  const renderBehavior = () => (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Behavior</h2>
      <p style={{ color: 'var(--text-2)', margin: '0 0 14px', fontSize: 12 }}>Configure how Cereal behaves in the background and while gaming.</p>

      <div className="wizard-setting-row">
        <div>
          <div className="wizard-setting-label">Minimize on Game Launch</div>
          <div className="wizard-setting-desc">Hide Cereal's window when you start a game</div>
        </div>
        <Toggle value={wMinimize} onChange={setWMinimize} />
      </div>

      <div className="wizard-setting-row">
        <div>
          <div className="wizard-setting-label">Close to System Tray</div>
          <div className="wizard-setting-desc">Keep running in the background when you close the window</div>
        </div>
        <Toggle value={wCloseTray} onChange={setWCloseTray} />
      </div>

      <div className="wizard-setting-row">
        <div>
          <div className="wizard-setting-label">Discord Rich Presence</div>
          <div className="wizard-setting-desc">Show what you're playing on your Discord profile</div>
        </div>
        <Toggle value={wDiscord} onChange={setWDiscord} />
      </div>

      <div className="wizard-setting-row">
        <div>
          <div className="wizard-setting-label">Auto-Sync Playtime</div>
          <div className="wizard-setting-desc">Sync Steam playtime data when Cereal starts</div>
        </div>
        <Toggle value={wAutoSync} onChange={setWAutoSync} />
      </div>

      <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'var(--glass)', border: '1px solid var(--glass-border)' }}>
        <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, color: 'var(--text-2)' }}>Quick Reference</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px' }}>
          {([
            ['Ctrl+K', 'Quick search'],
            ['Ctrl+,', 'Settings'],
            ['Esc', 'Close / Back'],
            ['Scroll', 'Zoom (Orbit)'],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 6, fontSize: 11, padding: '2px 0' }}>
              <kbd className="settings-kbd">{k}</kbd>
              <span style={{ color: 'var(--text-3)' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Step 6: PlayStation Remote Play ────────────────────────────────────────
  const renderPlayStation = () => (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>PlayStation Remote Play</h2>
      <p style={{ color: 'var(--text-2)', margin: '0 0 10px', fontSize: 12 }}>Optional: Set up chiaki-ng for streaming PS4/PS5 games to your PC.</p>
      <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 11, color: 'var(--text-4)', marginBottom: 12, background: 'var(--glass)', border: '1px solid var(--glass-border)', lineHeight: 1.5 }}>
        💡 Your PC and PlayStation must be on the <strong style={{ color: 'var(--text-3)' }}>same local network</strong>. Find the pairing PIN on your console under <strong style={{ color: 'var(--text-3)' }}>Settings → System → Remote Play → Link Device</strong>.
      </div>

      <div className="acct-card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div className="acct-title">chiaki-ng</div>
            <div className="acct-status">
              {chiakiDownloading ? <span style={{ color: 'var(--accent)' }}>Downloading...</span>
                : chiakiReady ? <span className="acct-connected-badge">✓ Installed{chiakiStatus.version ? ' (v' + chiakiStatus.version + ')' : ''}</span>
                : 'Not installed'}
            </div>
          </div>
          {!chiakiReady && !chiakiDownloading && <button className="btn-accent" onClick={downloadChiaki}>Download</button>}
          {chiakiDownloading && <div style={{ color: 'var(--text-3)', fontSize: 11 }}>This may take a minute...</div>}
        </div>
      </div>

      {chiakiReady && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Consoles</span>
            <button className="btn-flat" onClick={discoverConsoles} disabled={discovering}>
              {discovering ? 'Scanning...' : 'Discover'}
            </button>
          </div>

          {consoles.map((c, i) => (
            <div key={i} className="wizard-console">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name || c.host || 'Console'}</div>
                <div className="console-type">{c.type || 'PlayStation'} — {c.host}</div>
              </div>
              <button className="btn-flat" onClick={() => setRegisterHost(c.host)}>Register</button>
            </div>
          ))}

          {registerHost && (
            <div style={{ padding: 12, borderRadius: 8, border: '1px solid var(--glass-border)', background: 'var(--glass)', marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Register: {registerHost}</div>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>PSN Account ID</label>
                <input type="text" value={registerPsnId} onChange={e => setRegisterPsnId(e.target.value)} placeholder="Your PSN account ID" />
              </div>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>PIN</label>
                <input type="text" value={registerPin} onChange={e => setRegisterPin(e.target.value)} placeholder="Displayed on your console" />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-accent" onClick={() => registerConsole(registerHost)} disabled={registering}>{registering ? 'Registering...' : 'Register'}</button>
                <button className="btn-flat" onClick={() => setRegisterHost('')}>Cancel</button>
              </div>
            </div>
          )}

          {!registerHost && consoles.length === 0 && (
            <div style={{ marginTop: 6 }}>
              <div className="field">
                <label>Manual Host IP</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="text" placeholder="192.168.1.x" value={manualHost} onChange={e => setManualHost(e.target.value)} style={{ flex: 1 }} />
                  <button className="btn-flat" onClick={() => { if (manualHost) setRegisterHost(manualHost); }}>Set</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── Step 7: Summary ────────────────────────────────────────────────────────
  const renderSummary = () => {
    const themeLabel = THEMES[wTheme]?.label || wTheme;
    return (
      <div style={{ textAlign: 'center', padding: '10px 0' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>✨</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>You're All Set</h2>
        <p style={{ color: 'var(--text-2)', margin: '0 0 16px', fontSize: 12 }}>Here's what was configured:</p>
        <div style={{ textAlign: 'left', maxWidth: 400, margin: '0 auto' }}>
          <div className="wizard-summary-item">
            <div className="wizard-summary-icon ok">🎨</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{themeLabel} theme{wAccent ? ' + custom accent' : ''}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{wView === 'orbit' ? 'Orbit' : 'Cards'} view · {wNavPos} toolbar</div>
            </div>
          </div>
          <div className="wizard-summary-item">
            <div className="wizard-summary-icon ok">⚡</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{wDensity[0].toUpperCase() + wDensity.slice(1)} stars · {{ '0.9': '90%', '1': '100%', '1.1': '110%', '1.25': '125%' }[wScale]} scale</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Animations {wAnimations ? 'on' : 'off'}</div>
            </div>
          </div>
          <div className="wizard-summary-item">
            <div className={'wizard-summary-icon ' + (connectedCount > 0 ? 'ok' : 'skip')}>{connectedCount > 0 ? '✓' : '—'}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{connectedCount} account{connectedCount !== 1 ? 's' : ''} connected</div>
              {(['steam', 'gog', 'epic', 'xbox'] as const).filter(p => accounts[p]?.connected).map(p => (
                <div key={p} style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {p === 'epic' ? 'Epic' : p === 'gog' ? 'GOG' : p === 'xbox' ? 'Xbox' : 'Steam'} — {importCounts[p] != null ? importCounts[p] + '\u00a0games' : 'connected'}
                </div>
              ))}
            </div>
          </div>
          <div className="wizard-summary-item">
            <div className={'wizard-summary-icon ' + ((wMinimize || wCloseTray || wDiscord || wAutoSync) ? 'ok' : 'skip')}>
              {(wMinimize || wCloseTray || wDiscord || wAutoSync) ? '✓' : '—'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Behavior</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {[wMinimize && 'Minimize on launch', wCloseTray && 'Close to tray', wDiscord && 'Discord presence', wAutoSync && 'Auto-sync'].filter(Boolean).join(' · ') || 'Defaults'}
              </div>
            </div>
          </div>
          <div className="wizard-summary-item">
            <div className={'wizard-summary-icon ' + (chiakiReady ? 'ok' : 'skip')}>{chiakiReady ? '✓' : '—'}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{chiakiReady ? 'PlayStation Remote Play ready' : 'PlayStation skipped'}</div>
            </div>
          </div>
        </div>
        <p style={{ color: 'var(--text-4)', fontSize: 11, margin: '14px 0 0' }}>
          Press <kbd className="settings-kbd">Ctrl+K</kbd> anytime to search your library.
        </p>
        <button className="btn-accent btn-accent-lg" onClick={finish}>Launch Cereal</button>
      </div>
    );
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card" style={{ width: 640 }}>
        <div className="wizard-steps">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(s => (
            <div key={s} className={'wizard-dot' + (s === step ? ' active' : s < step ? ' done' : '')} />
          ))}
        </div>
        <div key={step} style={{ animation: 'stepIn 0.2s cubic-bezier(0.16,1,0.3,1)' }}>
          {step === 1 && renderWelcome()}
          {step === 2 && renderAppearance()}
          {step === 3 && renderPerformance()}
          {step === 4 && renderAccounts()}
          {step === 5 && renderBehavior()}
          {step === 6 && renderPlayStation()}
          {step === 7 && renderSummary()}
        </div>
        {step > 1 && step < TOTAL_STEPS && (
          <div className="wizard-nav">
            <button className="btn-flat" onClick={goBack}>Back</button>
            <div className="wizard-nav-right">
              <button className="btn-flat" onClick={goNext}>Skip</button>
              <button className="btn-accent" onClick={goNext}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
