import React, { useState, useEffect } from 'react';
import type { Game, Settings, FlashFn } from '../../types';
import { THEMES, PLATFORMS } from '../../constants';
import { applyTheme, applyUiScale } from '../../utils';

interface StartupWizardProps {
  show: boolean;
  onClose: () => void;
  flash: FlashFn;
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  settings: Settings;
  onSettingsChange: (s: Partial<Settings>) => void;
}

// Step metadata drives the stepper rail at the top of the wizard. Order matters:
// the index here must match the step number in the render switch below.
// Step 5 (Streaming) is conditional — only entered when the user opts in on
// the Setup step. The rail shows it but it auto-skips otherwise.
const STEP_DEFS: { n: number; label: string; sub: string; conditional?: boolean }[] = [
  { n: 1, label: 'Welcome',    sub: 'Hi there'           },
  { n: 2, label: 'Appearance', sub: 'Theme & view'       },
  { n: 3, label: 'Setup',      sub: 'Performance & feel' },
  { n: 4, label: 'Accounts',   sub: 'Sign in & import'   },
  { n: 5, label: 'Streaming',  sub: 'PS Remote Play', conditional: true },
  { n: 6, label: 'Finish',     sub: 'Review & launch'    },
];

const STEP_WELCOME    = 1;
const STEP_APPEARANCE = 2;
const STEP_SETUP      = 3;
const STEP_ACCOUNTS   = 4;
const STEP_STREAMING  = 5;
const STEP_FINISH     = 6;

export function StartupWizard({ show, onClose, flash, setGames, settings, onSettingsChange }: StartupWizardProps) {
  const TOTAL_STEPS = STEP_FINISH;
  const [step, setStep] = useState(1);
  // Highest step the user has reached — enables forward-clickable stepper.
  const [maxStep, setMaxStep] = useState(1);
  // Whether the user wants to set up PlayStation Remote Play. Initialized
  // from chiaki-ng presence once it's known; user can override on Setup step.
  const [streamingEnabled, setStreamingEnabled] = useState(false);
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
  const [finalSgInfo, setFinalSgInfo] = useState<{ hasSecret: boolean; fingerprint: string | null } | null>(null);

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
      setMaxStep(1);
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

  // If chiaki-ng turns up already installed, default the streaming opt-in to
  // on — the user has clearly used it before and would expect it to stay set up.
  useEffect(() => {
    if (show && chiakiStatus && chiakiStatus.status !== 'missing') {
      setStreamingEnabled(true);
    }
  }, [show, chiakiStatus]);

  // Refresh persisted SGDB key info on the Finish step so the user sees the
  // status of their key. Editing happens on the Accounts step.
  useEffect(() => {
    if (step !== STEP_FINISH) return;
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

  // Returns the next step the user should land on — auto-skips the
  // Streaming step when the user hasn't opted in.
  const nextStepFrom = (s: number) => {
    let n = Math.min(s + 1, TOTAL_STEPS);
    if (n === STEP_STREAMING && !streamingEnabled) n = STEP_FINISH;
    return n;
  };
  const prevStepFrom = (s: number) => {
    let n = Math.max(s - 1, 1);
    if (n === STEP_STREAMING && !streamingEnabled) n = STEP_ACCOUNTS;
    return n;
  };

  const goNext = () => {
    saveWizardSettings();
    setStep(s => {
      const n = nextStepFrom(s);
      setMaxStep(m => Math.max(m, n));
      return n;
    });
  };
  const goBack = () => setStep(s => prevStepFrom(s));

  const finish = async () => {
    await saveWizardSettings({ firstRun: false });
    onClose();
  };

  // Keyboard navigation. Enter / → advance, ← / Backspace go back, Esc closes,
  // 1–6 jump to any visited step. Ignored while the user is typing in a form
  // control (otherwise typing a PIN or API key would close the wizard).
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (inField) return;
      // Don't hijack with modifiers — leaves Ctrl+K etc. for global shortcuts.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') { e.preventDefault(); finish(); return; }
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (step < TOTAL_STEPS) { e.preventDefault(); goNext(); }
        else { e.preventDefault(); finish(); }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
        if (step > 1) { e.preventDefault(); goBack(); }
        return;
      }
      if (/^[1-6]$/.test(e.key)) {
        const n = parseInt(e.key, 10);
        if (n <= maxStep && n <= TOTAL_STEPS) {
          // Don't allow jumping to the conditional Streaming step unless opted in.
          if (n === STEP_STREAMING && !streamingEnabled) return;
          e.preventDefault();
          setStep(n);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, step, maxStep, streamingEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const bullets: { icon: string; text: React.ReactNode }[] = [
      { icon: '🎮', text: <>Sign in once — your <strong>Steam, Epic, GOG, Xbox</strong> libraries in one place.</> },
      { icon: '🌌', text: <>An <strong>orbit galaxy</strong> view of your library, or a classic grid if you prefer.</> },
      { icon: '🖼️', text: <>Cover art and metadata are <strong>fetched automatically</strong> — no manual tagging.</> },
    ];
    return (
      <div className="wiz-welcome">
        <div className="wiz-welcome-hero">
          <div className="wiz-welcome-glyph">🥣</div>
          <div className="wiz-welcome-eyebrow">CEREAL · First-run setup</div>
          <h2 className="wiz-welcome-title">Welcome aboard</h2>
          <div className="wiz-welcome-sub">Five quick steps and you're done. Everything is reversible from Settings.</div>
        </div>

        <ul className="wiz-welcome-bullets">
          {bullets.map((b, i) => (
            <li key={i} className="wiz-welcome-bullet">
              <span className="wiz-welcome-bullet-icon" aria-hidden>{b.icon}</span>
              <span>{b.text}</span>
            </li>
          ))}
        </ul>

        <div className="wiz-welcome-cta">
          <button className="wiz-btn primary lg" onClick={goNext}>Let's get started →</button>
          <button className="wiz-btn ghost" onClick={finish}>Skip setup</button>
        </div>
        <div className="wiz-welcome-tip">
          Tip: press <kbd className="settings-kbd">Enter</kbd> to advance, <kbd className="settings-kbd">Esc</kbd> to skip.
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

  // ── Step 3: Setup (merged Performance + Behavior + Streaming opt-in) ──────
  const renderSetup = () => {
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
    // Detected-hardware summary line — keep it visible (one-liner) so the
    // recommendation feels earned, but don't make a whole card out of it.
    const specsLine = specs
      ? [
          (specs.ramGb || 0) + ' GB RAM',
          (specs.cpuCount || 0) + ' cores',
          window.screen.width + '×' + window.screen.height,
        ].join(' · ')
      : null;

    return (
      <div className="wiz-step">
        <Hero
          tag="STEP 3 · SETUP"
          title="Tune the experience"
          subtitle="Performance, layout, and how Cereal behaves. Tap Recommended or customize."
          aside={rec && (
            <button
              className="wiz-rec-pill"
              onClick={() => { setWDensity(rec.starDensity as any); setWScale(rec.uiScale); applyUiScale(rec.uiScale); }}
              title="Use the suggested settings for this machine"
            >
              <span className="wiz-rec-pill-tag">RECOMMENDED</span>
              <span className="wiz-rec-pill-text">
                <strong>{rec.starDensity}</strong> stars · <strong>{scaleLabel[rec.uiScale]}</strong> scale
              </span>
              <span className="wiz-rec-pill-action">Apply →</span>
            </button>
          )}
        />

        {specsLine && (
          <div className="wiz-specs-line">
            <span className="wiz-specs-line-label">Detected</span>
            <span className="wiz-specs-line-val">{specsLine}</span>
          </div>
        )}

        <div className="wiz-card">
          <SectionLabel>Performance</SectionLabel>
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
            <div className="wiz-nav-picker" role="radiogroup" aria-label="Toolbar position">
              {(['top', 'bottom', 'left', 'right'] as const).map(v => (
                <button
                  key={v}
                  role="radio"
                  aria-checked={wNavPos === v}
                  className={'wiz-nav-picker-cell ' + v + (wNavPos === v ? ' active' : '')}
                  onClick={() => setWNavPos(v)}
                  title={v[0].toUpperCase() + v.slice(1)}
                >
                  <span className="wiz-nav-picker-bar" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="wiz-card">
          <SectionLabel>Behavior</SectionLabel>
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

          <div className="wizard-setting-row">
            <div>
              <div className="wizard-setting-label">PlayStation Remote Play</div>
              <div className="wizard-setting-desc">Set up chiaki-ng to stream from PS4 / PS5. Adds a setup step.</div>
            </div>
            <Toggle value={streamingEnabled} onChange={setStreamingEnabled} />
          </div>
        </div>

        <div className="wiz-shortcut-strip">
          {([
            ['Ctrl+K', 'Quick search'],
            ['Ctrl+,', 'Settings'],
            ['Esc',    'Close / back'],
          ] as [string, string][]).map(([k, v]) => (
            <span key={k} className="wiz-shortcut">
              <kbd className="settings-kbd">{k}</kbd>
              <span>{v}</span>
            </span>
          ))}
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
              Reconnect
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
          <span className="login-section-title">Sign in</span>
          <span className="login-section-sub">Official OAuth flows — sign in once, libraries import automatically</span>
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
        <span>Your library stays local — Cereal never uploads your account info or game list. EA, Battle.net, itch.io, and Ubisoft can be connected later from <em>Settings → Platforms</em>.</span>
      </div>
    </div>
  );

  // ── Step 5: PlayStation Remote Play (conditional) ──────────────────────────
  const renderPlayStation = () => (
    <div className="wiz-step">
      <Hero
        tag="STEP 5 · STREAMING"
        title="PlayStation Remote Play"
        subtitle="Stream PS4 / PS5 games over your local network via chiaki-ng. You can finish this later from Settings."
      />

      <div className="wiz-tip">
        <span className="wiz-tip-glyph">💡</span>
        <span>Your PC and PlayStation must be on the <strong>same local network</strong>. The pairing code lives on the console under <strong>Settings → System → Remote Play → Link Device</strong>.</span>
      </div>

      <div className="wiz-card">
        <div className="wiz-chk-status">
          <div className="wiz-chk-glyph" aria-hidden>{PLATFORMS.psn?.icon}</div>
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

    type Row = { ok: boolean; icon: string; title: string; sub: React.ReactNode; jumpTo?: number };
    const rows: Row[] = [
      {
        ok: true,
        icon: '🎨',
        title: themeLabel + ' theme' + (wAccent ? ' + custom accent' : ''),
        sub: <>{wView === 'orbit' ? 'Orbit view' : 'Cards view'} · {wNavPos} toolbar</>,
        jumpTo: STEP_APPEARANCE,
      },
      {
        ok: true,
        icon: '⚡',
        title: wDensity[0].toUpperCase() + wDensity.slice(1) + ' stars · ' + scaleLabel[wScale] + ' scale',
        sub: (
          <>
            Animations {wAnimations ? 'on' : 'off'}
            {behaviorBits.length > 0 ? ' · ' + behaviorBits.join(' · ') : ''}
          </>
        ),
        jumpTo: STEP_SETUP,
      },
      {
        ok: connectedCount > 0,
        icon: connectedCount > 0 ? '🎮' : '○',
        title: connectedCount + ' account' + (connectedCount !== 1 ? 's' : '') + ' connected',
        sub: connectedCount === 0
          ? 'Sign in any time from Settings → Platforms.'
          : (['steam', 'gog', 'epic', 'xbox'] as const).filter(p => accounts[p]?.connected)
              .map(p => (p === 'epic' ? 'Epic' : p === 'gog' ? 'GOG' : p === 'xbox' ? 'Xbox' : 'Steam')
                + (importCounts[p] != null ? ' (' + importCounts[p] + ')' : ''))
              .join(' · '),
        jumpTo: STEP_ACCOUNTS,
      },
      {
        ok: !!finalSgInfo?.hasSecret,
        icon: finalSgInfo?.hasSecret ? '🖼️' : '○',
        title: finalSgInfo?.hasSecret ? 'High-res artwork enabled' : 'Standard artwork',
        sub: finalSgInfo?.hasSecret
          ? (finalSgInfo.fingerprint ? 'SteamGridDB key ' + finalSgInfo.fingerprint : 'SteamGridDB key saved')
          : 'Add a SteamGridDB key from Settings → Platforms for higher-res covers.',
        jumpTo: STEP_ACCOUNTS,
      },
      {
        ok: streamingEnabled && chiakiReady,
        icon: chiakiReady ? '📺' : '○',
        title: streamingEnabled && chiakiReady
          ? 'PlayStation Remote Play ready'
          : streamingEnabled
            ? 'PlayStation streaming pending'
            : 'PlayStation streaming skipped',
        sub: chiakiReady
          ? (chiakiStatus?.version ? 'chiaki-ng v' + chiakiStatus.version : 'chiaki-ng installed')
          : streamingEnabled
            ? 'Finish chiaki-ng setup from Settings.'
            : 'Enable later from Settings → Platforms.',
        jumpTo: streamingEnabled ? STEP_STREAMING : STEP_SETUP,
      },
    ];

    return (
      <div className="wiz-step wiz-finish">
        <div className="wiz-finish-hero">
          <div className="wiz-finish-glyph">✨</div>
          <div className="wiz-finish-eyebrow">SETUP COMPLETE</div>
          <h2 className="wiz-finish-title">You're all set</h2>
          <div className="wiz-finish-sub">Tap any row to jump back and tweak it. Everything is also editable from Settings later.</div>
        </div>

        <div className="wiz-summary">
          {rows.map((r, i) => (
            <button
              key={i}
              type="button"
              className={'wiz-summary-row' + (r.ok ? ' ok' : ' skip')}
              onClick={() => r.jumpTo && setStep(r.jumpTo)}
              title={r.jumpTo ? 'Click to revisit' : undefined}
            >
              <div className="wiz-summary-icon">{r.icon}</div>
              <div className="wiz-summary-body">
                <div className="wiz-summary-title">{r.title}</div>
                <div className="wiz-summary-sub">{r.sub}</div>
              </div>
              <div className="wiz-summary-badge">{r.ok ? '✓' : 'skip'}</div>
            </button>
          ))}
        </div>

        <div className="wiz-finish-cta">
          <p className="wiz-finish-tip">
            Press <kbd className="settings-kbd">Ctrl+K</kbd> anytime to search your library.
          </p>
          <button className="wiz-btn primary lg" onClick={finish}>Launch Cereal →</button>
        </div>
      </div>
    );
  };

  // Linear progress: counts only the steps the user will actually visit
  // (excludes the conditional Streaming step when not opted in).
  const visibleStepCount = TOTAL_STEPS - (streamingEnabled ? 0 : 1);
  const visibleStepIndex = step <= STEP_STREAMING
    ? step
    : (streamingEnabled ? step : step - 1);
  const progressPct = Math.round((visibleStepIndex / visibleStepCount) * 100);

  return (
    <div className="modal-overlay wiz-overlay">
      <div className="wiz-frame">
        {/* Header — brand and step counter. */}
        <div className="wiz-frame-head">
          <div className="wiz-brand">
            <div className="wiz-brand-mark">CEREAL</div>
            <div className="wiz-brand-tag">Setup</div>
          </div>
          <div className="wiz-progress-ind">
            <strong>{visibleStepIndex}</strong> · {visibleStepCount}
          </div>
        </div>

        {/* Progress bar — sits flush against the stepper rail. */}
        <div className="wiz-progress-bar" aria-hidden>
          <div className="wiz-progress-bar-fill" style={{ width: progressPct + '%' }} />
        </div>

        <div className="wiz-stepper" role="tablist" aria-label="Setup steps">
          {STEP_DEFS.map(sd => {
            const conditional = !!sd.conditional && !streamingEnabled;
            const state = sd.n === step
              ? 'active'
              : sd.n < step ? 'done' : 'todo';
            // Forward-clickable for any previously-visited step. Conditional
            // (Streaming) step is never clickable when the user hasn't opted in.
            const clickable = sd.n !== step && sd.n <= maxStep && !conditional;
            const cls =
              'wiz-step-pip ' + state +
              (clickable ? ' clickable' : '') +
              (conditional ? ' skipped' : '');
            return (
              <button
                key={sd.n}
                type="button"
                role="tab"
                aria-selected={sd.n === step}
                disabled={!clickable && sd.n !== step}
                onClick={() => clickable && setStep(sd.n)}
                className={cls}
                title={conditional ? 'Optional — enable on Setup step' : undefined}
              >
                <div className="wiz-step-bullet">
                  {state === 'done' ? '✓' : conditional ? '–' : sd.n}
                </div>
                <div className="wiz-step-meta">
                  <div className="wiz-step-label">{sd.label}</div>
                  <div className="wiz-step-sub">{conditional ? 'Skipped' : sd.sub}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Body — animates per-step swap. */}
        <div className="wiz-frame-body" key={step}>
          {step === STEP_WELCOME    && renderWelcome()}
          {step === STEP_APPEARANCE && renderAppearance()}
          {step === STEP_SETUP      && renderSetup()}
          {step === STEP_ACCOUNTS   && renderAccounts()}
          {step === STEP_STREAMING  && renderPlayStation()}
          {step === STEP_FINISH     && renderSummary()}
        </div>

        {/* Footer nav — hidden on Welcome (its own CTA) and Finish (its own
            "Launch Cereal" button). */}
        {step > STEP_WELCOME && step < STEP_FINISH && (
          <div className="wiz-frame-foot">
            <button className="wiz-btn ghost" onClick={goBack} title="← (or Backspace)">← Back</button>
            <div className="wiz-foot-spacer" />
            <button className="wiz-btn link" onClick={goNext} title="Skip this step">Skip</button>
            <button className="wiz-btn primary" onClick={goNext} title="Continue (Enter)">Continue →</button>
          </div>
        )}
      </div>
    </div>
  );
}
