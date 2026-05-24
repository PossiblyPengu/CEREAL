import React, { useState, useEffect } from 'react';
import type { Game, Settings } from '../../types';
import { THEMES, PLATFORMS } from '../../constants';
import { applyTheme, applyUiScale } from '../../utils';

interface StartupWizardProps {
  show: boolean;
  onClose: () => void;
  flash: (msg: React.ReactNode) => void;
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  settings: Settings;
  onSettingsChange: (s: Partial<Settings>) => void;
}

// Step metadata drives the stepper rail at the top of the wizard. Order matters:
// the index here must match the step number in the render switch below.
const STEP_DEFS: { n: number; label: string; sub: string }[] = [
  { n: 1, label: 'Welcome',    sub: 'Get oriented'      },
  { n: 2, label: 'Appearance', sub: 'Theme & view'      },
  { n: 3, label: 'Performance',sub: 'Tune the renderer' },
  { n: 4, label: 'Accounts',   sub: 'Connect platforms' },
  { n: 5, label: 'Behavior',   sub: 'Tray & presence'   },
  { n: 6, label: 'Streaming',  sub: 'PS Remote Play'    },
  { n: 7, label: 'Finish',     sub: 'Review & launch'   },
];

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
  const [steamApiKey, setSteamApiKey] = useState('');
  const [steamApiKeySaving, setSteamApiKeySaving] = useState(false);
  const [waking, setWaking] = useState<string | null>(null);
  const [finalSgKey, setFinalSgKey] = useState('');
  const [finalSgInfo, setFinalSgInfo] = useState<{ hasSecret: boolean; fingerprint: string | null } | null>(null);
  const [finalSgSaving, setFinalSgSaving] = useState(false);

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
  }, [step, chiakiStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh persisted SGDB key info on final step so the user can see whether
  // a key is already saved and update/replace it inline.
  useEffect(() => {
    if (step !== 7) return;
    (async () => {
      try {
        const r = await (window.api as any)?.getApiKeyInfo?.('steamgriddb');
        if (r?.ok) setFinalSgInfo({ hasSecret: !!r.hasSecret, fingerprint: r.fingerprint ?? null });
        else setFinalSgInfo(null);
      } catch { /* ignore */ }
    })();
  }, [step]);

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

  const doImport = async (which: string, apiKey?: string) => {
    setImportStatus(p => ({ ...p, [which]: 'importing' }));
    try {
      if (apiKey && (window.api as any)?.saveApiKey) {
        setSteamApiKeySaving(true);
        await (window.api as any).saveApiKey(which, apiKey);
        setSteamApiKeySaving(false);
      }
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
      const lbl = (() => {
        const map: Record<string, string> = { steam: 'Steam', gog: 'GOG', epic: 'Epic Games', xbox: 'Xbox' };
        return map[which] || which;
      })();
      flash(count > 0 ? `${count} games imported from ${lbl}` : `${lbl} library is already up to date`);
      if ((window.api as any)?.getGames) {
        const g = await (window.api as any).getGames();
        if (typeof setGames === 'function') setGames(g || []);
      }
    } catch (e) {
      console.error('Import error', e);
      setImportStatus(p => ({ ...p, [which]: 'error' }));
    }
  };

  const platformLabel = (id: string) => {
    const map: Record<string, string> = { steam: 'Steam', gog: 'GOG', epic: 'Epic Games', xbox: 'Xbox' };
    return map[id] || id;
  };

  const doAuth = async (which: string) => {
    try {
      if (!window.api) return;
      const label = platformLabel(which);
      const authResult = await (window.api as any).platformAuth?.(which);

      // Always re-sync from the DB: the OAuth provider's success page may
      // close the auth window itself (login.live.com / Epic), which makes
      // platformAuth resolve as 'cancelled' even though credentials were
      // persisted. Trust the DB, not the IPC return value.
      await refreshAccounts();
      const fresh = await (window.api as any).getAccounts?.() || {};
      const nowConnected = !!fresh[which]?.connected;

      if (authResult?.error && authResult.error !== 'cancelled' && !nowConnected) {
        flash(`${label} sign-in failed: ${authResult.error}`);
        return;
      }
      if (nowConnected) {
        const who = fresh[which].displayName || fresh[which].gamertag;
        flash(`${label} connected${who ? ` as ${who}` : ''} — importing library…`);
        await doImport(which);
      }
    } catch (e) { console.error('Auth error', e); flash('Authentication error'); }
  };

  const downloadChiaki = async () => {
    setChiakiDownloading(true);
    try {
      const r = await (window.api as any)?.chiakiUpdate?.();
      if (r?.ok) { flash('chiaki-ng downloaded (v' + (r.version || '?') + ')'); await refreshChiaki(); }
      else {
        const lines = r?.output ? String(r.output).split('\n') : [];
        const errLine = lines.find(l => l.trimStart().startsWith('ERROR:')) || lines.filter(l => l.trim()).pop() || '';
        flash((r?.error || 'Download failed') + (errLine ? ': ' + errLine.replace(/^ERROR:\s*/i, '').trim() : ''));
      }
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

  // Section hero used at the top of every step for visual consistency.
  // Eyebrow tag + large title + subtitle; an optional `aside` slot renders on
  // the right (e.g. a "Recommended" hint or a connection counter).
  const Hero = ({ tag, title, subtitle, aside }: { tag: string; title: string; subtitle?: React.ReactNode; aside?: React.ReactNode }) => (
    <div className="wiz-hero">
      <div className="wiz-hero-text">
        <div className="wiz-hero-tag">{tag}</div>
        <h2 className="wiz-hero-title">{title}</h2>
        {subtitle && <div className="wiz-hero-sub">{subtitle}</div>}
      </div>
      {aside && <div className="wiz-hero-aside">{aside}</div>}
    </div>
  );

  // Section heading used inside steps to introduce a card or row group.
  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="wiz-section-label">{children}</div>
  );

  // ── Step 1: Welcome ────────────────────────────────────────────────────────
  const renderWelcome = () => {
    // Mirror the Performance step's recommendation engine so the user sees
    // a tailored hint up-front (matches the C# wizard's welcome card).
    let perfRec: { tier: string; starDensity: string; uiScale: string } | null = null;
    if (specs) {
      const ramGb = specs.ramGb || 0;
      const cpuCount = specs.cpuCount || 0;
      const tier = (ramGb >= 24 && cpuCount >= 8) ? 'High' : (ramGb <= 8 || cpuCount <= 4) ? 'Low' : 'Mid';
      const starDensity = tier === 'High' ? 'high' : tier === 'Low' ? 'low' : 'normal';
      const sw = window.screen?.width || 1920;
      const uiScale = sw >= 2560 ? '125%' : sw >= 1920 ? '110%' : sw < 1280 ? '90%' : '100%';
      perfRec = { tier, starDensity, uiScale };
    }
    const features: { icon: string; title: string; desc: string }[] = [
      { icon: '🌌', title: 'Orbit galaxy',   desc: 'Pan, zoom and fly through your library like a solar system.' },
      { icon: '🎮', title: 'All platforms',  desc: 'Steam, Epic, GOG, Xbox — and your sideloaded titles too.' },
      { icon: '📺', title: 'Remote Play',    desc: 'Stream PS4 / PS5 over the network via chiaki-ng.' },
      { icon: '🖼️', title: 'Cover artwork',  desc: 'Auto-fetched from Steam and SteamGridDB.' },
      { icon: '🎯', title: 'Smart filters',  desc: 'Slice by platform, category, recent or playtime.' },
      { icon: '🟣', title: 'Discord status', desc: "Show your friends what you're playing — privately optional." },
    ];
    return (
      <div className="wiz-welcome">
        <div className="wiz-welcome-hero">
          <div className="wiz-welcome-glyph">🥣</div>
          <div className="wiz-welcome-eyebrow">CEREAL · First-run setup</div>
          <h2 className="wiz-welcome-title">Welcome aboard</h2>
          <div className="wiz-welcome-sub">A unified launcher for everything you play. We'll have you set up in about a minute.</div>
        </div>

        <div className="wiz-feature-grid">
          {features.map(f => (
            <div key={f.title} className="wiz-feature">
              <div className="wiz-feature-icon">{f.icon}</div>
              <div className="wiz-feature-body">
                <div className="wiz-feature-title">{f.title}</div>
                <div className="wiz-feature-desc">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {perfRec && (
          <div className="wiz-tier-card">
            <div className="wiz-tier-badge">{perfRec.tier} TIER</div>
            <div className="wiz-tier-text">
              We detected your machine and will suggest{' '}
              <strong>{perfRec.starDensity}</strong> stars at <strong>{perfRec.uiScale}</strong> UI scale on the next step.
            </div>
          </div>
        )}

        <div className="wiz-welcome-cta">
          <button className="wiz-btn primary lg" onClick={() => setStep(2)}>Let's get started →</button>
          <button className="wiz-btn ghost" onClick={finish}>Skip setup</button>
        </div>
      </div>
    );
  };

  // ── Step 2: Appearance ─────────────────────────────────────────────────────
  const renderAppearance = () => (
    <div className="wiz-step">
      <Hero
        tag="STEP 2 · APPEARANCE"
        title="Make it yours"
        subtitle="Pick a theme and a default view. Everything is live-previewed and changeable later in Settings."
      />

      <div className="wiz-card">
        <SectionLabel>Theme</SectionLabel>
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

        <div className="wiz-accent-row">
          <div className="wiz-accent-info">
            <div className="wiz-accent-title">Custom accent</div>
            <div className="wiz-accent-desc">Override the theme accent with any color.</div>
          </div>
          <div className="wiz-accent-controls">
            <input type="color" value={wAccent || THEMES[wTheme]?.accent || '#d4a853'} className="settings-color sm"
              onChange={e => {
                setWAccent(e.target.value);
                document.documentElement.style.setProperty('--accent', e.target.value);
                document.documentElement.style.setProperty('--accent-soft', e.target.value + '1f');
                document.documentElement.style.setProperty('--accent-border', e.target.value + '4d');
              }} />
            {wAccent && (
              <button className="wiz-btn ghost sm" onClick={() => { setWAccent(''); applyTheme(wTheme); }}>
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="wiz-card">
        <SectionLabel>Default view</SectionLabel>
        <div className="wiz-view-grid">
          {(['orbit', 'cards'] as const).map(v => (
            <button key={v} className={'wizard-view-btn' + (wView === v ? ' active' : '')}
              onClick={() => setWView(v)}>
              <div className="wizard-view-icon">
                {v === 'orbit'
                  ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-30 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(30 12 12)"/></svg>
                  : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                }
              </div>
              <div className="wiz-view-name">{v === 'orbit' ? 'Orbit' : 'Cards'}</div>
              <div className="wiz-view-desc">
                {v === 'orbit' ? 'Interactive galaxy with zoom & pan.' : 'Classic grid — fast and familiar.'}
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
    const scaleLabel: Record<string, string> = { '0.9': '90%', '1': '100%', '1.1': '110%', '1.25': '125%' };
    return (
      <div className="wiz-step">
        <Hero
          tag="STEP 3 · PERFORMANCE"
          title="Tune the renderer"
          subtitle="Pick density and scale that match your hardware. Apply the recommendation if you're unsure."
          aside={rec && (
            <button className="wiz-rec-pill" onClick={() => { setWDensity(rec.starDensity as any); setWScale(rec.uiScale); applyUiScale(rec.uiScale); }}>
              <span className="wiz-rec-pill-tag">RECOMMENDED</span>
              <span className="wiz-rec-pill-text">
                <strong>{rec.starDensity}</strong> stars · <strong>{scaleLabel[rec.uiScale]}</strong> scale
              </span>
              <span className="wiz-rec-pill-action">Apply →</span>
            </button>
          )}
        />

        <div className="wiz-card">
          <SectionLabel>Detected hardware</SectionLabel>
          {specs ? (
            <div className="wiz-spec-grid">
              {([
                ['RAM', specs.ramGb + '\u00a0GB'],
                ['CPU', specs.cpuCount + ' cores' + (specs.cpuModel ? ' — ' + String(specs.cpuModel).slice(0, 40) : '')],
                specs.gpuName ? ['GPU', String(specs.gpuName).slice(0, 50)] : null,
                ['Display', window.screen.width + '×' + window.screen.height],
              ] as (string[] | null)[]).filter((x): x is string[] => x !== null).map(([k, v]) => (
                <div key={k} className="wiz-spec">
                  <div className="wiz-spec-key">{k}</div>
                  <div className="wiz-spec-val">{v}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="wiz-loading"><span className="spinner" />Detecting specs…</div>
          )}
        </div>

        <div className="wiz-card">
          <SectionLabel>Renderer & layout</SectionLabel>
          <div className="wizard-setting-row">
            <div>
              <div className="wizard-setting-label">Star density</div>
              <div className="wizard-setting-desc">Background star count in Orbit view.</div>
            </div>
            <div className="wizard-seg">
              {(['low', 'normal', 'high'] as const).map(v => (
                <button key={v} className={'wizard-seg-btn' + (wDensity === v ? ' active' : '')}
                  onClick={() => setWDensity(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
              ))}
            </div>
          </div>

          <div className="wizard-setting-row">
            <div>
              <div className="wizard-setting-label">UI scale</div>
              <div className="wizard-setting-desc">Text and element sizes across the launcher.</div>
            </div>
            <div className="wizard-seg">
              {([['0.9', '90%'], ['1', '100%'], ['1.1', '110%'], ['1.25', '125%']] as const).map(([v, l]) => (
                <button key={v} className={'wizard-seg-btn' + (wScale === v ? ' active' : '')}
                  onClick={() => { setWScale(v); applyUiScale(v); }}>{l}</button>
              ))}
            </div>
          </div>

          <div className="wizard-setting-row">
            <div>
              <div className="wizard-setting-label">Animations</div>
              <div className="wizard-setting-desc">Orbit drift, scaling and UI transitions.</div>
            </div>
            <Toggle value={wAnimations} onChange={setWAnimations} />
          </div>

          <div className="wizard-setting-row">
            <div>
              <div className="wizard-setting-label">Toolbar position</div>
              <div className="wizard-setting-desc">Where the navigation bar sits.</div>
            </div>
            <div className="wizard-seg">
              {(['top', 'bottom', 'left', 'right'] as const).map(v => (
                <button key={v} className={'wizard-seg-btn' + (wNavPos === v ? ' active' : '')}
                  onClick={() => setWNavPos(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Step 4: Connect Accounts ───────────────────────────────────────────────
  // Visual styling shared with PlatformsPanel via .login-card classes so the
  // wizard and the Settings → Platforms panel feel like the same screen.
  const ACCT_PLATS: { id: string; label: string; color: string; glyph: string }[] = [
    { id: 'steam', label: 'Steam',      color: '#1b2838', glyph: 'S' },
    { id: 'gog',   label: 'GOG',        color: '#3a1a50', glyph: 'G' },
    { id: 'epic',  label: 'Epic Games', color: '#2a2a2a', glyph: 'E' },
    { id: 'xbox',  label: 'Xbox',       color: '#0e6a0e', glyph: 'X' },
  ];

  const fmtSync = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'synced just now';
    if (m < 60) return `synced ${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `synced ${h}h ago`;
    return `synced ${Math.floor(h / 24)}d ago`;
  };

  const renderAccountCard = (def: { id: string; label: string; color: string; glyph: string }) => {
    const { id: platform, label, color, glyph } = def;
    const acct = accounts[platform];
    const connected = acct?.connected;
    const impSt = importStatus[platform];
    const impCt = importCounts[platform];
    const impErr = importErrors[platform];
    const showApiKeyFallback = platform === 'steam' && impSt === 'error';
    const isImporting = impSt === 'importing';

    let pillCls = 'login-pill muted';
    let pillTxt: React.ReactNode = 'Not signed in';
    if (impSt === 'done')        { pillCls = 'login-pill ok';   pillTxt = `${impCt ?? 0} imported`; }
    else if (impSt === 'error')  { pillCls = 'login-pill bad';  pillTxt = 'Failed'; }
    else if (isImporting)        { pillCls = 'login-pill warn'; pillTxt = 'Importing…'; }
    else if (connected)          { pillCls = 'login-pill ok';   pillTxt = 'Connected'; }

    return (
      <div key={platform} className={'login-card' + (connected ? ' connected' : '')}>
        <div className="login-card-head">
          <div className="login-card-glyph" style={{ background: color }}>
            {acct?.avatarUrl
              ? <img src={acct.avatarUrl} alt="" />
              : (PLATFORMS[platform]?.icon || glyph)}
          </div>
          <div className="login-card-title">
            <div className="login-card-name">{label}</div>
            <div className="login-card-sub">
              {connected
                ? <span>{acct?.displayName || acct?.gamertag || 'Signed in'}</span>
                : <span>Sign in to import your library</span>}
              {connected && acct?.gameCount > 0 && <><span className="dot" /><span>{acct.gameCount} {acct.gameCount === 1 ? 'game' : 'games'}</span></>}
              {connected && acct?.lastSync && fmtSync(acct.lastSync) && <><span className="dot" /><span>{fmtSync(acct.lastSync)}</span></>}
            </div>
          </div>
          <span className={pillCls}><span className="pip" />{pillTxt}</span>
        </div>

        {impSt === 'error' && impErr && (
          <div className="login-card-error">{impErr}</div>
        )}

        <div className="login-card-actions">
          {connected ? (
            <button
              className="login-cta"
              onClick={() => doImport(platform)}
              disabled={isImporting}
            >
              {isImporting ? <><span className="spinner" />Importing…</> : (impSt === 'done' ? 'Re-import' : 'Import library')}
            </button>
          ) : (
            <button
              className="login-cta"
              onClick={() => doAuth(platform)}
              disabled={isImporting}
            >
              Sign in with {label}
            </button>
          )}
          {connected && (
            <button className="login-cta ghost" onClick={() => doAuth(platform)} disabled={isImporting}>
              Re-auth
            </button>
          )}
        </div>

        {showApiKeyFallback && (
          <div className="login-key open">
            <div className="login-key-help">
              Profile set to private? Enter a{' '}
              <a onClick={e => { e.preventDefault(); (window.api as any)?.openExternal?.('https://steamcommunity.com/dev/apikey'); }}>
                Steam Web API key
              </a>{' '}
              to import anyway.
            </div>
            <div className="login-key-input-row">
              <input
                type="password"
                placeholder="Paste your Steam Web API key"
                value={steamApiKey}
                onChange={e => setSteamApiKey(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                onKeyDown={e => { if (e.key === 'Enter' && steamApiKey.trim().length > 10) doImport('steam', steamApiKey.trim()); }}
              />
              <button
                className="login-cta"
                disabled={steamApiKey.trim().length < 10 || steamApiKeySaving}
                onClick={() => doImport('steam', steamApiKey.trim())}
              >
                {steamApiKeySaving ? <><span className="spinner" />Saving…</> : 'Import'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderAccounts = () => (
    <div className="wiz-step">
      <Hero
        tag="STEP 4 · ACCOUNTS"
        title="Pull in your games"
        subtitle="Sign in to any platforms you use — we'll import your library. Skip the ones you don't."
        aside={
          <div className="wiz-progress-pill">
            <strong>{connectedCount}</strong>
            <span> of {ACCT_PLATS.length} connected</span>
          </div>
        }
      />

      <section className="login-section">
        <div className="login-section-head">
          <span className="login-section-title">Online sign-in</span>
          <span className="login-section-sub">Official OAuth/OpenID flows</span>
        </div>
        {ACCT_PLATS.map(p => renderAccountCard(p))}
      </section>

      <div className="wiz-card">
        <div className="wiz-sgdb-row">
          <div className="wiz-sgdb-info">
            <div className="wiz-sgdb-title">SteamGridDB</div>
            <div className="wiz-sgdb-desc">Optional API key — unlocks high-resolution cover art for older games.</div>
          </div>
          <div className="wiz-sgdb-actions">
            <button className="wiz-btn ghost" onClick={() => { if ((window.api as any)?.steamGridDbLogin) (window.api as any).steamGridDbLogin(); }}>Get key</button>
            <button className="wiz-btn ghost" onClick={async () => {
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
            }}>Paste from clipboard</button>
          </div>
        </div>
      </div>

      <div className="wiz-privacy">
        <span className="wiz-privacy-glyph">🔒</span>
        <span>Your library data stays local. Cereal never uploads your account info or game list. The remaining storefronts (EA, Battle.net, itch.io, Ubisoft) can be connected later from <em>Settings → Platforms</em>.</span>
      </div>
    </div>
  );

  // ── Step 5: Behavior ───────────────────────────────────────────────────────
  const renderBehavior = () => (
    <div className="wiz-step">
      <Hero
        tag="STEP 5 · BEHAVIOR"
        title="How Cereal lives in the background"
        subtitle="Window behavior, presence, and playtime sync. All optional and reversible later."
      />

      <div className="wiz-card">
        <div className="wizard-setting-row">
          <div>
            <div className="wizard-setting-label">Minimize on game launch</div>
            <div className="wizard-setting-desc">Hide the launcher window when you start a game.</div>
          </div>
          <Toggle value={wMinimize} onChange={setWMinimize} />
        </div>

        <div className="wizard-setting-row">
          <div>
            <div className="wizard-setting-label">Close to system tray</div>
            <div className="wizard-setting-desc">Keep running in the background when the window is closed.</div>
          </div>
          <Toggle value={wCloseTray} onChange={setWCloseTray} />
        </div>

        <div className="wizard-setting-row">
          <div>
            <div className="wizard-setting-label">Discord rich presence</div>
            <div className="wizard-setting-desc">Show what you're playing on your Discord profile.</div>
          </div>
          <Toggle value={wDiscord} onChange={setWDiscord} />
        </div>

        <div className="wizard-setting-row">
          <div>
            <div className="wizard-setting-label">Auto-sync Steam playtime</div>
            <div className="wizard-setting-desc">Refresh Steam playtime each time Cereal starts.</div>
          </div>
          <Toggle value={wAutoSync} onChange={setWAutoSync} />
        </div>
      </div>

      <div className="wiz-card wiz-shortcuts">
        <SectionLabel>Handy shortcuts</SectionLabel>
        <div className="wiz-shortcut-grid">
          {([
            ['Ctrl+K', 'Quick search'],
            ['Ctrl+Shift+R', 'Random game'],
            ['Ctrl+,', 'Open Settings'],
            ['Esc',    'Close / back'],
            ['Scroll', 'Zoom (Orbit)'],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="wiz-shortcut">
              <kbd className="settings-kbd">{k}</kbd>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Step 6: PlayStation Remote Play ────────────────────────────────────────
  const renderPlayStation = () => (
    <div className="wiz-step">
      <Hero
        tag="STEP 6 · STREAMING (OPTIONAL)"
        title="PlayStation Remote Play"
        subtitle="Set up chiaki-ng to stream PS4 / PS5 games over your local network. Skip this step if you don't have a console."
      />

      <div className="wiz-tip">
        <span className="wiz-tip-glyph">💡</span>
        <span>Your PC and PlayStation must be on the <strong>same local network</strong>. Find the pairing code on the console under <strong>Settings → System → Remote Play → Link Device</strong>.</span>
      </div>

      <div className="wiz-card">
        <div className="wiz-chk-status">
          <div className="wiz-chk-glyph">PS</div>
          <div className="wiz-chk-info">
            <div className="wiz-chk-name">chiaki-ng</div>
            <div className="wiz-chk-state">
              {chiakiDownloading
                ? <span className="wiz-chk-state-dl">Downloading…</span>
                : chiakiReady
                  ? <span className="wiz-chk-state-ok">✓ Installed{chiakiStatus.version ? ' · v' + chiakiStatus.version : ''}</span>
                  : <span className="wiz-chk-state-missing">Not installed</span>}
            </div>
          </div>
          <div className="wiz-chk-actions">
            {!chiakiReady && !chiakiDownloading && <button className="wiz-btn primary" onClick={downloadChiaki}>Download</button>}
            {chiakiReady && !chiakiDownloading && (
              <button
                className="wiz-btn ghost"
                title="Open the chiaki-ng configurator window for advanced setup"
                onClick={async () => {
                  const r = await (window.api as any)?.chiakiOpenGui?.();
                  if (r?.error) flash('Could not open configurator: ' + r.error);
                }}
              >Open configurator</button>
            )}
            {chiakiDownloading && <div className="wiz-chk-hint">This may take a minute…</div>}
          </div>
        </div>
      </div>

      {chiakiReady && (
        <div className="wiz-card">
          <div className="wiz-row-head">
            <SectionLabel>Consoles</SectionLabel>
            <button className="wiz-btn ghost sm" onClick={discoverConsoles} disabled={discovering}>
              {discovering ? <><span className="spinner" style={{ marginRight: 6 }} />Scanning…</> : 'Scan network'}
            </button>
          </div>

          {consoles.map((c, i) => (
            <div key={i} className="wizard-console">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name || c.host || 'Console'}</div>
                <div className="console-type">{c.type || 'PlayStation'} — {c.host}</div>
              </div>
              {c.registKey && c.morning && (
                <button
                  className="wiz-btn ghost sm"
                  disabled={waking === c.host}
                  title="Send a wake-up packet to a sleeping PlayStation"
                  onClick={async () => {
                    setWaking(c.host);
                    try {
                      const r = await (window.api as any)?.chiakiWakeConsole?.({
                        host: c.host,
                        credentials: { registKey: c.registKey, morning: c.morning },
                      });
                      if (r?.success || r?.ok) flash('Wake packet sent to ' + (c.name || c.host));
                      else flash(r?.error || 'Wake failed');
                    } catch (_e) { flash('Wake failed'); }
                    setWaking(null);
                  }}
                >{waking === c.host ? 'Waking…' : 'Wake'}</button>
              )}
              <button className="wiz-btn primary sm" onClick={() => setRegisterHost(c.host)}>Register</button>
            </div>
          ))}

          {registerHost && (
            <div className="wiz-register">
              <div className="wiz-register-title">Register: <code>{registerHost}</code></div>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>PSN Account ID</label>
                <input type="text" value={registerPsnId} onChange={e => setRegisterPsnId(e.target.value)} placeholder="Your PSN account ID" />
              </div>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>PIN</label>
                <input type="text" value={registerPin} onChange={e => setRegisterPin(e.target.value)} placeholder="Displayed on your console" />
              </div>
              <div className="wiz-register-actions">
                <button className="wiz-btn ghost" onClick={() => setRegisterHost('')}>Cancel</button>
                <button className="wiz-btn primary" onClick={() => registerConsole(registerHost)} disabled={registering}>
                  {registering ? <><span className="spinner" style={{ marginRight: 6 }} />Registering…</> : 'Register'}
                </button>
              </div>
            </div>
          )}

          {!registerHost && consoles.length === 0 && !discovering && (
            <div className="wiz-empty-consoles">
              <div className="wiz-empty-text">No consoles found. Try scanning again or enter the IP manually.</div>
              <div className="field">
                <label>Manual host IP</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="text" placeholder="192.168.1.42" value={manualHost} onChange={e => setManualHost(e.target.value)} style={{ flex: 1 }} />
                  <button className="wiz-btn ghost" onClick={() => { if (manualHost) setRegisterHost(manualHost); }}>Use this</button>
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
    const scaleLabel: Record<string, string> = { '0.9': '90%', '1': '100%', '1.1': '110%', '1.25': '125%' };
    const behaviorBits = [
      wMinimize && 'Minimize on launch',
      wCloseTray && 'Close to tray',
      wDiscord && 'Discord presence',
      wAutoSync && 'Auto-sync playtime',
    ].filter(Boolean) as string[];

    type Row = { ok: boolean; icon: string; title: string; sub: React.ReactNode };
    const rows: Row[] = [
      {
        ok: true,
        icon: '🎨',
        title: themeLabel + ' theme' + (wAccent ? ' + custom accent' : ''),
        sub: <>{wView === 'orbit' ? 'Orbit view' : 'Cards view'} · {wNavPos} toolbar</>,
      },
      {
        ok: true,
        icon: '⚡',
        title: wDensity[0].toUpperCase() + wDensity.slice(1) + ' stars · ' + scaleLabel[wScale] + ' scale',
        sub: <>Animations {wAnimations ? 'on' : 'off'}</>,
      },
      {
        ok: connectedCount > 0,
        icon: connectedCount > 0 ? '🎮' : '○',
        title: connectedCount + ' account' + (connectedCount !== 1 ? 's' : '') + ' connected',
        sub: connectedCount === 0
          ? 'You can connect them later from Settings.'
          : (['steam', 'gog', 'epic', 'xbox'] as const).filter(p => accounts[p]?.connected)
              .map(p => (p === 'epic' ? 'Epic' : p === 'gog' ? 'GOG' : p === 'xbox' ? 'Xbox' : 'Steam')
                + (importCounts[p] != null ? ' (' + importCounts[p] + ')' : ''))
              .join(' · '),
      },
      {
        ok: behaviorBits.length > 0,
        icon: behaviorBits.length > 0 ? '⚙' : '○',
        title: 'Behavior',
        sub: behaviorBits.length > 0 ? behaviorBits.join(' · ') : 'Using launcher defaults.',
      },
      {
        ok: chiakiReady,
        icon: chiakiReady ? '📺' : '○',
        title: chiakiReady ? 'PlayStation Remote Play ready' : 'PlayStation Remote Play skipped',
        sub: chiakiReady
          ? (chiakiStatus?.version ? 'chiaki-ng v' + chiakiStatus.version : 'chiaki-ng installed')
          : 'You can set this up later from Settings.',
      },
      {
        ok: !!finalSgInfo?.hasSecret,
        icon: finalSgInfo?.hasSecret ? '🖼️' : '○',
        title: finalSgInfo?.hasSecret ? 'High-res artwork enabled' : 'Using free-tier artwork',
        sub: finalSgInfo?.hasSecret
          ? (finalSgInfo.fingerprint ? 'SteamGridDB key ' + finalSgInfo.fingerprint : 'SteamGridDB key saved')
          : 'Add a SteamGridDB API key below for higher-resolution covers.',
      },
    ];

    return (
      <div className="wiz-step wiz-finish">
        <div className="wiz-finish-hero">
          <div className="wiz-finish-glyph">✨</div>
          <div className="wiz-finish-eyebrow">SETUP COMPLETE</div>
          <h2 className="wiz-finish-title">You're all set</h2>
          <div className="wiz-finish-sub">Here's what was configured. You can change any of this later in Settings.</div>
        </div>

        <div className="wiz-summary">
          {rows.map((r, i) => (
            <div key={i} className={'wiz-summary-row' + (r.ok ? ' ok' : ' skip')}>
              <div className="wiz-summary-icon">{r.icon}</div>
              <div className="wiz-summary-body">
                <div className="wiz-summary-title">{r.title}</div>
                <div className="wiz-summary-sub">{r.sub}</div>
              </div>
              <div className="wiz-summary-badge">{r.ok ? '✓' : 'skip'}</div>
            </div>
          ))}
        </div>

        {!finalSgInfo?.hasSecret && (
          <div className="wiz-card">
            <SectionLabel>Add SteamGridDB API key (optional)</SectionLabel>
            <div className="wiz-sgdb-input">
              <input
                type="password"
                placeholder="Paste your SteamGridDB API key"
                value={finalSgKey}
                onChange={e => setFinalSgKey(e.target.value)}
              />
              <button
                className="wiz-btn ghost"
                onClick={async () => {
                  try {
                    if (!(window.api as any)?.readClipboard) return flash('Clipboard not available');
                    const txt = await (window.api as any).readClipboard();
                    if (!txt) return flash('Clipboard empty');
                    setFinalSgKey(txt.trim());
                  } catch { flash('Could not read clipboard'); }
                }}
              >Paste</button>
              <button
                className="wiz-btn primary"
                disabled={finalSgKey.trim().length < 10 || finalSgSaving}
                onClick={async () => {
                  setFinalSgSaving(true);
                  try {
                    const vr = await (window.api as any)?.validateApiKey?.('steamgriddb', finalSgKey.trim());
                    if (!vr?.ok) { flash('Key is invalid'); return; }
                    const sr = await (window.api as any)?.saveApiKey?.('steamgriddb', finalSgKey.trim());
                    if (sr?.ok) {
                      setFinalSgInfo({ hasSecret: true, fingerprint: sr.fingerprint || null });
                      setFinalSgKey('');
                      flash('SteamGridDB key saved');
                    } else flash('Could not save key');
                  } finally { setFinalSgSaving(false); }
                }}
              >{finalSgSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        )}

        <div className="wiz-finish-cta">
          <p className="wiz-finish-tip">
            Press <kbd className="settings-kbd">Ctrl+K</kbd> anytime to search your library.
          </p>
          <button className="wiz-btn primary lg" onClick={finish}>Launch Cereal →</button>
        </div>
      </div>
    );
  };

  return (
    <div className="modal-overlay wiz-overlay">
      <div className="wiz-frame">
        {/* Header — brand, step counter, and stepper rail. */}
        <div className="wiz-frame-head">
          <div className="wiz-brand">
            <div className="wiz-brand-mark">CEREAL</div>
            <div className="wiz-brand-tag">Setup</div>
          </div>
          <div className="wiz-progress-ind">
            Step <strong>{step}</strong> of {TOTAL_STEPS}
          </div>
        </div>

        <div className="wiz-stepper" role="tablist" aria-label="Setup steps">
          {STEP_DEFS.map(sd => {
            const state = sd.n === step ? 'active' : sd.n < step ? 'done' : 'todo';
            const clickable = sd.n < step; // allow stepping back to completed steps
            return (
              <button
                key={sd.n}
                type="button"
                role="tab"
                aria-selected={sd.n === step}
                disabled={!clickable && sd.n !== step}
                onClick={() => clickable && setStep(sd.n)}
                className={'wiz-step-pip ' + state + (clickable ? ' clickable' : '')}
              >
                <div className="wiz-step-bullet">
                  {state === 'done' ? '✓' : sd.n}
                </div>
                <div className="wiz-step-meta">
                  <div className="wiz-step-label">{sd.label}</div>
                  <div className="wiz-step-sub">{sd.sub}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Body — animates per-step swap. */}
        <div className="wiz-frame-body" key={step}>
          {step === 1 && renderWelcome()}
          {step === 2 && renderAppearance()}
          {step === 3 && renderPerformance()}
          {step === 4 && renderAccounts()}
          {step === 5 && renderBehavior()}
          {step === 6 && renderPlayStation()}
          {step === 7 && renderSummary()}
        </div>

        {/* Footer nav — hidden on Welcome (its own CTA) and Finish (its own
            "Launch Cereal" button). */}
        {step > 1 && step < TOTAL_STEPS && (
          <div className="wiz-frame-foot">
            <button className="wiz-btn ghost" onClick={goBack}>← Back</button>
            <div className="wiz-foot-spacer" />
            <button className="wiz-btn ghost" onClick={goNext}>Skip</button>
            <button className="wiz-btn primary" onClick={goNext}>Continue →</button>
          </div>
        )}
      </div>
    </div>
  );
}
