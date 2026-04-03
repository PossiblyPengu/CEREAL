import React, { useState, useEffect } from 'react';
import type { Game } from '../types';
import { applyUiScale } from '../utils';

interface StartupWizardProps {
  show: boolean;
  onClose: () => void;
  flash: (msg: React.ReactNode) => void;
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
}

export function StartupWizard({ show, onClose, flash, setGames }: StartupWizardProps) {
  const [step, setStep] = useState(1);
  const [accounts, setAccounts] = useState<Record<string, any>>({});
  const [importStatus, setImportStatus] = useState<Record<string, string>>({});
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
  const [specApplied, setSpecApplied] = useState(false);

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
      setSpecs(null);
      setSpecApplied(false);
      setManualHost('');
      (window.api as any)?.getSystemSpecs?.().then((s: any) => setSpecs(s)).catch(() => {});
    }
  }, [show]);

  useEffect(() => {
    if (step === 5 && chiakiStatus && chiakiStatus.status !== 'missing' && consoles.length === 0 && !discovering) {
      discoverConsoles();
    }
  }, [step, chiakiStatus]);

  const getRecommendation = (sp: any) => {
    const ramGb = sp.ramGb || 0;
    const cpuCount = sp.cpuCount || 0;
    const starDensity = (ramGb >= 24 && cpuCount >= 8) ? 'high' : (ramGb <= 8 || cpuCount <= 4) ? 'low' : 'normal';
    const sw = window.screen?.width || 1920;
    const uiScale = sw >= 2560 ? '1.25' : sw >= 1920 ? '1.1' : sw < 1280 ? '0.9' : '1';
    return { starDensity, uiScale };
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
          if (result?.error) { setImportStatus(p => ({ ...p, [which]: 'error' })); flash(result.error); return; }
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

  const finish = async () => {
    if ((window.api as any)?.saveSettings) await (window.api as any).saveSettings({ firstRun: false });
    onClose();
  };

  if (!show) return null;

  const connectedCount = ['steam', 'gog', 'epic', 'xbox'].filter(p => accounts[p]?.connected).length;
  const chiakiReady = chiakiStatus && chiakiStatus.status !== 'missing';

  const stepDots = (
    <div className="wizard-steps">
      {[1, 2, 3, 4, 5, 6, 7].map(s => (
        <div key={s} className={'wizard-dot' + (s === step ? ' active' : s < step ? ' done' : '')} />
      ))}
    </div>
  );

  const renderStep1 = () => (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🥣</div>
      <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>Welcome to Cereal</h2>
      <p style={{ color: 'var(--text-2)', margin: '0 0 20px', fontSize: 13 }}>Your unified game launcher. Let's get you set up in a few quick steps.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 24, textAlign: 'left' }}>
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
      <button className="btn-accent" style={{ padding: '10px 32px', fontSize: 14 }} onClick={() => setStep(2)}>Get Started</button>
    </div>
  );

  const renderStepFeatures = () => (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>What's Included</h2>
      <p style={{ color: 'var(--text-2)', margin: '0 0 14px', fontSize: 12 }}>A quick tour of everything Cereal can do.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {([
          ['🌌', 'Three views', 'Orbit: an interactive solar system. Cards: a classic grid. Galaxy: a cosmic scatter of your whole library.'],
          ['🔗', 'Unified library', 'Steam, Epic Games, GOG and Xbox libraries sync automatically into one launcher.'],
          ['📺', 'PlayStation Remote Play', 'Built-in chiaki-ng integration — register your PS4/PS5 and stream over your local network.'],
          ['🎮', 'Controller support', 'Browse, filter and launch games with a gamepad — navigates menus and the Orbit view too.'],
          ['➕', 'Custom & detected games', 'Add any executable manually, or auto-scan to find games outside managed platforms.'],
          ['🖼️', 'Automatic cover art', 'SteamGridDB integration fetches game artwork, heroes and icons in the background.'],
        ] as [string, string, string][]).map(([icon, label, desc]) => (
          <div key={label} style={{ display: 'flex', gap: 12, background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 10, padding: '10px 14px', alignItems: 'flex-start' }}>
            <div style={{ fontSize: 22, flexShrink: 0, lineHeight: 1.2 }}>{icon}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.45 }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderStepPerf = () => {
    const rec = specs ? getRecommendation(specs) : null;
    const densityLabel: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High' };
    const scaleLabel: Record<string, string> = { '0.9': 'Compact (90%)', '1': 'Standard (100%)', '1.1': 'Large (110%)', '1.25': 'XL (125%)' };
    return (
      <div>
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Performance</h2>
        <p style={{ color: 'var(--text-2)', margin: '0 0 14px', fontSize: 12 }}>We detected your system and can tune Cereal for best performance.</p>
        {!specs && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 12 }}>
            <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            Detecting specs...
          </div>
        )}
        {specs && (
          <div>
            <div style={{ background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 10, padding: '10px 16px', marginBottom: 14, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 14px', alignItems: 'baseline' }}>
              {([['RAM', specs.ramGb + '\u00a0GB'], ['CPU', specs.cpuCount + ' cores' + (specs.cpuModel ? ' — ' + specs.cpuModel.slice(0, 32) : '')], specs.gpuName ? ['GPU', specs.gpuName.slice(0, 40)] : null, ['Display', window.screen.width + '×' + window.screen.height]] as (string[] | null)[]).filter((x): x is string[] => x !== null).map(([k, v]) => [
                <div key={k + 'k'} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-4)' }}>{k}</div>,
                <div key={k + 'v'} style={{ fontSize: 12, color: 'var(--text-2)' }}>{v}</div>
              ])}
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Recommended settings</div>
              <div className="acct-card" style={{ display: 'flex', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-4)', marginBottom: 3 }}>Star Density</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{densityLabel[rec!.starDensity]}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-4)', marginBottom: 3 }}>UI Scale</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{scaleLabel[rec!.uiScale]}</div>
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 8, marginBottom: 14, lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--text-3)' }}>Star Density</strong> controls how many animated stars float in the background. <strong style={{ color: 'var(--text-3)' }}>UI Scale</strong> adjusts text and element sizes across the whole app. Both can be changed later in <strong style={{ color: 'var(--text-3)' }}>Settings → Appearance</strong>.
            </div>
            {!specApplied
              ? <button className="btn-accent" onClick={async () => {
                  if ((window.api as any)?.saveSettings) await (window.api as any).saveSettings({ starDensity: rec!.starDensity, uiScale: rec!.uiScale });
                  applyUiScale(rec!.uiScale);
                  setSpecApplied(true);
                }}>Apply Recommendations</button>
              : <div style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 600 }}>✓ Settings applied</div>
            }
          </div>
        )}
      </div>
    );
  };

  const renderAccountCard = (platform: string, label: string) => {
    const acct = accounts[platform];
    const connected = acct?.connected;
    const impSt = importStatus[platform];
    const impCt = importCounts[platform];
    return (
      <div className={'acct-card' + (connected ? ' connected' : '')} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="acct-avatar">
          {acct?.avatarUrl
            ? <img src={acct.avatarUrl} alt="" />
            : <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="4" stroke="rgba(255,255,255,0.06)" strokeWidth="1.2" /></svg>
          }
        </div>
        <div style={{ flex: 1 }}>
          <div className="acct-title">{label}</div>
          <div className="acct-status">
            {impSt === 'importing' ? <span style={{ color: 'var(--accent)' }}>Importing games...</span>
              : impSt === 'done' ? <span className="acct-connected-badge">✓ {impCt} games imported</span>
              : impSt === 'error' ? <span style={{ color: 'var(--red)' }}>Import failed</span>
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

  const renderStep2 = () => (
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
      <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 11, color: 'var(--text-4)', display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <span>🔒</span>
        <span>Your library data stays local — Cereal never uploads your account info or game list to any server.</span>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>PlayStation Remote Play</h2>
      <p style={{ color: 'var(--text-2)', margin: '0 0 10px', fontSize: 12 }}>Optional: Set up chiaki-ng for streaming PS4/PS5 games to your PC.</p>
      <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 11, color: 'var(--text-4)', marginBottom: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', lineHeight: 1.5 }}>
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

  const renderStepTips = () => (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Tips & Shortcuts</h2>
      <p style={{ color: 'var(--text-2)', margin: '0 0 14px', fontSize: 12 }}>A few things worth knowing before you dive in.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
        {([
          [['Ctrl', 'K'], 'Quick Search', 'Jump to any game instantly'],
          [['Ctrl', ','], 'Settings', 'Open app preferences'],
          [['Esc'], 'Close / Back', 'Dismiss any panel or overlay'],
          [['Scroll'], 'Zoom', 'Zoom in or out in Orbit view'],
          [['Drag'], 'Pan', 'Click and drag to pan Orbit view'],
          [['Dbl-click'], 'Game details', 'Open the focus view for a game'],
        ] as [string[], string, string][]).map(([keys, action, desc]) => (
          <div key={action} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, minWidth: 110 }}>
              {keys.map(k => (
                <kbd key={k} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)', borderBottom: '2px solid rgba(255,255,255,0.22)', borderRadius: 5, padding: '2px 7px', fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-2)' }}>{k}</kbd>
              ))}
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 12 }}>{action}</span>
              <span style={{ color: 'var(--text-3)', fontSize: 11 }}> — {desc}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 10, padding: '10px 14px' }}>
        <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>🎮 Gamepad controls</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px' }}>
          {([
            ['Left stick / D-pad', 'Navigate cards'],
            ['Right stick', 'Pan Orbit view'],
            ['A / Cross', 'Select / Launch'],
            ['B / Circle', 'Back / Close'],
            ['LB / RB', 'Switch tabs'],
            ['Start', 'Open Settings'],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 6, fontSize: 11, padding: '2px 0' }}>
              <span style={{ color: 'var(--text-2)', fontWeight: 600, flexShrink: 0 }}>{k}</span>
              <span style={{ color: 'var(--text-3)' }}>— {v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div style={{ textAlign: 'center', padding: '10px 0' }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>✨</div>
      <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>You're All Set</h2>
      <p style={{ color: 'var(--text-2)', margin: '0 0 18px', fontSize: 12 }}>Here's what was configured:</p>
      <div style={{ textAlign: 'left', maxWidth: 360, margin: '0 auto' }}>
        <div className="wizard-summary-item">
          <div className={'wizard-summary-icon ' + (specApplied ? 'ok' : 'skip')}>{specApplied ? '✓' : '—'}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{specApplied ? 'Performance tuned' : 'Default performance settings'}</div>
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
          <div className={'wizard-summary-icon ' + (chiakiReady ? 'ok' : 'skip')}>{chiakiReady ? '✓' : '—'}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{chiakiReady ? 'PlayStation Remote Play ready' : 'PlayStation skipped'}</div>
          </div>
        </div>
      </div>
      <p style={{ color: 'var(--text-4)', fontSize: 11, margin: '14px 0 0' }}>
        Press <kbd style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 4, padding: '1px 5px', fontSize: 10, fontFamily: 'monospace', color: 'var(--text-2)' }}>Ctrl+K</kbd> anytime to search your library.
      </p>
      <button className="btn-accent" style={{ marginTop: 12, padding: '10px 32px', fontSize: 14 }} onClick={finish}>Launch Cereal</button>
    </div>
  );

  return (
    <div className="modal-overlay">
      <div className="modal-card" style={{ width: 640 }}>
        {stepDots}
        <div key={step} style={{ animation: 'stepIn 0.2s cubic-bezier(0.16,1,0.3,1)' }}>
          {step === 1 && renderStep1()}
          {step === 2 && renderStepFeatures()}
          {step === 3 && renderStepPerf()}
          {step === 4 && renderStep2()}
          {step === 5 && renderStep3()}
          {step === 6 && renderStepTips()}
          {step === 7 && renderStep4()}
        </div>
        {step > 1 && step < 7 && (
          <div className="wizard-nav">
            <button className="btn-flat" onClick={() => setStep(s => s - 1)}>Back</button>
            <div className="wizard-nav-right">
              <button className="btn-flat" onClick={() => setStep(s => s + 1)}>Skip</button>
              <button className="btn-accent" onClick={() => setStep(s => s + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
