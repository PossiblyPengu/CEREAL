import { useState, useEffect } from 'react';
import type { Game, ChiakiSession } from '../types';
import { SidePanel } from './SidePanel';
import { I } from '../constants';

interface ChiakiPanelProps {
  show: boolean;
  onClose: () => void;
  flash: (msg: React.ReactNode) => void;
  games: Game[];
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  chiakiSessions: Record<string, ChiakiSession>;
}

interface ChiakiConsole {
  nickname: string;
  host: string;
  profile: string;
  registKey?: string;
  morning?: string;
}

interface ChiakiConfig {
  executablePath: string;
  consoles: ChiakiConsole[];
}

interface ChiakiStatus {
  status?: string;
  version?: string;
  installed?: boolean;
}

interface DiscoveredConsole {
  name?: string;
  host: string;
  type?: string;
  state?: string;
  firmwareVersion?: string;
  runningTitle?: string;
}

export function ChiakiPanel({ show, onClose, flash, games: _games, setGames: _setGames, chiakiSessions }: ChiakiPanelProps) {
  const [chiakiStatus, setChiakiStatus] = useState<ChiakiStatus | null>(null);
  const [chiakiConfig, setChiakiConfig] = useState<ChiakiConfig>({ executablePath: '', consoles: [] });
  const [newConsole, setNewConsole] = useState<ChiakiConsole>({ nickname: '', host: '', profile: '' });
  const [showAddConsole, setShowAddConsole] = useState(false);
  const [activeTab, setActiveTab] = useState('consoles');
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredConsole[]>([]);
  const [registering, setRegistering] = useState<string | null>(null);
  const [regForm, setRegForm] = useState({ host: '', psnAccountId: '', pin: '' });
  const [regResult, setRegResult] = useState<any>(null);

  useEffect(() => {
    if (!show) return;
    (async () => {
      if (window.api) {
        const st = await (window.api as any).getChiakiStatus?.();
        const cfg = await (window.api as any).getChiakiConfig?.();
        setChiakiStatus(st);
        setChiakiConfig(cfg || { executablePath: '', consoles: [] });
      }
    })();
  }, [show]);

  const addConsole = async () => {
    if (!newConsole.nickname?.trim() || !newConsole.host?.trim()) return;
    const updated: ChiakiConfig = { ...chiakiConfig, consoles: [...(chiakiConfig.consoles || []), newConsole] };
    if (window.api) await (window.api as any).saveChiakiConfig?.(updated);
    setChiakiConfig(updated);
    setNewConsole({ nickname: '', host: '', profile: '' });
    setShowAddConsole(false);
    flash('Console added');
  };

  const removeConsole = async (idx: number) => {
    const updated: ChiakiConfig = { ...chiakiConfig, consoles: chiakiConfig.consoles.filter((_, i) => i !== idx) };
    if (window.api) await (window.api as any).saveChiakiConfig?.(updated);
    setChiakiConfig(updated);
    flash('Console removed');
  };

  const doDiscover = async () => {
    setDiscovering(true);
    setDiscovered([]);
    if (window.api) {
      const r = await (window.api as any).chiakiDiscoverConsoles?.();
      setDiscovered(r?.consoles || []);
    }
    setDiscovering(false);
  };

  const doRegister = async () => {
    if (!regForm.host || !regForm.pin) return;
    setRegistering('working');
    if (window.api) {
      const r = await (window.api as any).chiakiRegisterConsole?.(regForm);
      setRegResult(r);
      setRegistering(r?.success ? 'success' : 'failed');
      if (r?.success) {
        const existingConsoles = chiakiConfig.consoles || [];
        const alreadyInList = existingConsoles.some(c => c.host === regForm.host);
        const updatedConsoles = alreadyInList
          ? existingConsoles.map(c =>
              c.host === regForm.host ? { ...c, registKey: r.registKey || '', morning: r.morning || '' } : c
            )
          : [...existingConsoles, { nickname: regForm.host, host: regForm.host, profile: '', registKey: r.registKey || '', morning: r.morning || '' }];
        const upd: ChiakiConfig = { ...chiakiConfig, consoles: updatedConsoles };
        await (window.api as any).saveChiakiConfig?.(upd);
        setChiakiConfig(upd);
        flash('Console registered!');
      }
    }
  };

  const addDiscoveredAsConsole = (c: DiscoveredConsole) => {
    setNewConsole({ nickname: c.name || 'PlayStation', host: c.host, profile: '' });
    setShowAddConsole(true);
    setActiveTab('consoles');
  };

  const stopStream = async (sessionKey: string) => {
    if (window.api) await (window.api as any).chiakiStopStream?.(sessionKey);
    flash('Stream stopped');
  };

  const openChiakiGui = async () => {
    if (window.api) {
      const r = await (window.api as any).chiakiOpenGui?.();
      flash(r?.success ? 'chiaki-ng GUI opened' : 'Error: ' + r?.error);
    }
  };

  const statusClass = chiakiStatus?.status || 'missing';
  const chiakiMissing = statusClass === 'missing';

  const getSessionForConsole = (c: ChiakiConsole) => {
    const sessionKey = 'console:' + c.host;
    const sess = chiakiSessions[sessionKey];
    const isLive = !!(sess && sess.state && sess.state !== 'disconnected');
    return { sessionKey, session: sess, isLive };
  };

  const connectConsole = async (c: ChiakiConsole) => {
    if (!window.api) return;
    const r = await (window.api as any).chiakiStartStreamDirect?.({
      host: c.host, nickname: c.nickname || '', profile: c.profile || '',
      registKey: c.registKey || '', morning: c.morning || '',
    });
    flash(r?.success ? 'Connecting to ' + (c.nickname || c.host) + '...' : 'Error: ' + r?.error);
  };

  const renderConsoleCard = (c: ChiakiConsole, i: number) => {
    const hasKeys = !!c.registKey && !!c.morning;
    const { sessionKey, session: connSess, isLive } = getSessionForConsole(c);
    const isStreaming = (connSess as any)?.state === 'streaming';
    const quality = (connSess as any)?.quality;
    const streamInfo = (connSess as any)?.streamInfo;

    return (
      <div key={i} className="conn-card">
        <div className="conn-icon" style={{ background: '#003087' }}>PS</div>
        <div className="conn-info">
          <div className="conn-name">
            {c.nickname}
            {isLive && <span className="chiaki-live-badge">LIVE</span>}
            {!isLive && !hasKeys && <span className="chiaki-unreg-badge">Not registered</span>}
          </div>
          <div className="conn-detail">
            {c.host}{c.profile ? ' / ' + c.profile : ''}
            {isStreaming && streamInfo?.resolution && (
              <span> — {streamInfo.resolution}{streamInfo.fps ? ' / ' + streamInfo.fps + 'fps' : ''}</span>
            )}
          </div>
          {isStreaming && quality?.bitrate && (
            <div className="chiaki-session-stats">
              <div className="chiaki-stat">
                <div className="chiaki-stat-val">{quality.bitrate.toFixed(1)}</div>
                <div className="chiaki-stat-lbl">Mbps</div>
              </div>
              {quality.fpsActual && (
                <div className="chiaki-stat">
                  <div className="chiaki-stat-val">{Math.round(quality.fpsActual)}</div>
                  <div className="chiaki-stat-lbl">FPS</div>
                </div>
              )}
              {quality.latencyMs != null && (
                <div className="chiaki-stat">
                  <div className="chiaki-stat-val">{Math.round(quality.latencyMs)}</div>
                  <div className="chiaki-stat-lbl">Latency</div>
                </div>
              )}
              {quality.packetLoss != null && (
                <div className="chiaki-stat">
                  <div className="chiaki-stat-val">{quality.packetLoss.toFixed(1)}%</div>
                  <div className="chiaki-stat-lbl">Loss</div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="conn-actions">
          {isLive ? (
            <button className="btn-sm danger" onClick={() => stopStream(sessionKey)}>Stop</button>
          ) : (
            <>
              <button className="btn-sm primary" onClick={() => connectConsole(c)} disabled={chiakiMissing}>Connect</button>
              {hasKeys ? (
                <button className="btn-sm" title="Wake console from rest mode" onClick={async () => {
                  flash('Sending wake signal...');
                  const r = await (window.api as any)?.chiakiWakeConsole?.({ host: c.host, credentials: { registKey: c.registKey } });
                  flash(r?.success ? 'Wake signal sent to ' + c.nickname : 'Wake failed: ' + (r?.error || 'unknown'));
                }} disabled={chiakiMissing}>Wake</button>
              ) : (
                <button className="btn-sm" onClick={() => { setRegForm(p => ({ ...p, host: c.host })); setActiveTab('register'); }}>Register</button>
              )}
            </>
          )}
          <button className="btn-sm danger" onClick={() => removeConsole(i)}>
            <span style={{ display: 'flex', width: 12, height: 12 }}>{I.trash}</span>
          </button>
        </div>
      </div>
    );
  };

  const renderDiscoverCard = (c: DiscoveredConsole, i: number) => {
    const consoleType = (c.type || '').toUpperCase();
    const isPS5 = consoleType.includes('PS5') || consoleType.includes('5');
    const isPS4 = consoleType.includes('PS4') || consoleType.includes('4');
    const alreadyAdded = (chiakiConfig.consoles || []).some(x => x.host === c.host);

    return (
      <div key={i} className="chiaki-disc-card">
        <div className="chiaki-disc-icon">{isPS5 ? 'PS5' : isPS4 ? 'PS4' : 'PS'}</div>
        <div className="chiaki-disc-info">
          <div className="chiaki-disc-name">{c.name || 'PlayStation'}</div>
          <div className="chiaki-disc-detail">
            {c.host}
            {(isPS5 || isPS4) && <span className={'chiaki-disc-tag ' + (isPS5 ? 'ps5' : 'ps4')}>{isPS5 ? 'PS5' : 'PS4'}</span>}
            {c.state === 'standby' && <span style={{ color: 'var(--text-4)', fontSize: 9, fontWeight: 600 }}>Standby</span>}
            {c.state === 'ready' && <span style={{ color: 'var(--green)', fontSize: 9, fontWeight: 600 }}>Awake</span>}
            {c.firmwareVersion && <span>{c.firmwareVersion}</span>}
            {c.runningTitle && <span className="chiaki-disc-tag live">{c.runningTitle}</span>}
            {alreadyAdded && <span style={{ color: 'var(--green)', fontSize: 9, fontWeight: 700 }}>Added</span>}
          </div>
        </div>
        <div className="chiaki-disc-actions">
          {!alreadyAdded && <button className="btn-sm primary" onClick={() => addDiscoveredAsConsole(c)}>Add</button>}
          <button className="btn-sm" onClick={() => { setRegForm(p => ({ ...p, host: c.host })); setActiveTab('register'); }}>Register</button>
        </div>
      </div>
    );
  };

  return (
    <SidePanel show={show} onClose={onClose} title="PlayStation Remote Play" wide
      headActions={
        <button className="btn-sm" onClick={openChiakiGui} title="Open chiaki-ng GUI">
          <span style={{ display: 'flex', width: 14, height: 14 }}>{I.globe}</span>
        </button>
      }
    >
      <div className={'chiaki-bar ' + statusClass}>
        <div className="chiaki-bar-dot" />
        <div className="chiaki-bar-text">
          {statusClass === 'bundled' ? 'chiaki-ng bundled' : statusClass === 'system' ? 'chiaki-ng (system)' : 'chiaki-ng not found'}
        </div>
        {chiakiStatus?.version && <div className="chiaki-bar-ver">v{chiakiStatus.version}</div>}
      </div>

      {chiakiMissing && (
        <div className="chiaki-missing-hint">
          chiaki-ng is required for Remote Play. Run <strong>scripts/setup-chiaki.ps1</strong> to download it automatically.
        </div>
      )}

      <div className="sub-tabs">
        {['consoles', 'discover', 'register'].map(t => (
          <button key={t} className={'sub-tab' + (activeTab === t ? ' active' : '')} onClick={() => setActiveTab(t)}>{t}</button>
        ))}
      </div>

      {activeTab === 'consoles' && (
        <>
          <div className="chiaki-section-head">
            <div className="conn-section">Registered Consoles</div>
            <button className="btn-sm" onClick={() => setShowAddConsole(!showAddConsole)}>+ Add</button>
          </div>

          {showAddConsole && (
            <div className="chiaki-add-form">
              <div className="field-row">
                <div className="field">
                  <label>Nickname</label>
                  <input value={newConsole.nickname} onChange={e => setNewConsole(p => ({ ...p, nickname: e.target.value }))} placeholder="PS5-Living-Room" />
                </div>
                <div className="field">
                  <label>Host IP</label>
                  <input value={newConsole.host} onChange={e => setNewConsole(p => ({ ...p, host: e.target.value }))} placeholder="192.168.1.x" />
                </div>
              </div>
              <div className="field">
                <label>Profile</label>
                <input value={newConsole.profile} onChange={e => setNewConsole(p => ({ ...p, profile: e.target.value }))} placeholder="default" />
              </div>
              <div className="chiaki-add-actions">
                <button className="btn-flat" onClick={() => setShowAddConsole(false)}>Cancel</button>
                <button className="btn-accent" onClick={addConsole}>Add Console</button>
              </div>
            </div>
          )}

          {(chiakiConfig.consoles || []).length === 0 && !showAddConsole && (
            <div className="chiaki-console-empty">
              No consoles registered. Use the <strong>Discover</strong> tab to find consoles on your network,<br />
              or click <strong>+ Add</strong> to add one manually.
            </div>
          )}

          {(chiakiConfig.consoles || []).map((c, i) => renderConsoleCard(c, i))}
        </>
      )}

      {activeTab === 'discover' && (
        <>
          <div className="chiaki-discover-head">
            <span>Scan your network for PlayStation consoles</span>
            <button className="btn-sm primary" onClick={doDiscover} disabled={discovering || chiakiMissing}>
              {discovering ? <><span className="spinner" style={{ marginRight: 6 }} />Scanning</> : 'Scan Network'}
            </button>
          </div>

          {discovered.map((c, i) => renderDiscoverCard(c, i))}

          {!discovering && discovered.length === 0 && (
            <div className="chiaki-console-empty">
              Click <strong>Scan Network</strong> to find PlayStation consoles.<br />
              <span style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 4, display: 'block' }}>Make sure your console is on and connected to the same network.</span>
            </div>
          )}
        </>
      )}

      {activeTab === 'register' && (
        <>
          <div className="chiaki-reg-intro">
            Register your PlayStation console for Remote Play. This is a one-time setup per console.
          </div>

          <div className="chiaki-reg-steps">
            <div className="reg-step-title">Setup Steps</div>
            <div className="reg-step">
              <div className="reg-step-num">1</div>
              <div className="reg-step-text">On your console, go to <span>Settings &gt; System &gt; Remote Play</span> and enable it.</div>
            </div>
            <div className="reg-step">
              <div className="reg-step-num">2</div>
              <div className="reg-step-text">Go to <span>Settings &gt; System &gt; Remote Play &gt; Link Device</span> to get the 8-digit link code.</div>
            </div>
            <div className="reg-step">
              <div className="reg-step-num">3</div>
              <div className="reg-step-text">Get your PSN Account ID — visit{' '}
                <a href="#" onClick={e => { e.preventDefault(); (window.api as any)?.openExternal?.('https://psn.flipscreen.games/'); }} style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                  psn.flipscreen.games
                </a>{' '}and sign in. Copy the Base64 Account ID.
              </div>
            </div>
            <div className="reg-step">
              <div className="reg-step-num">4</div>
              <div className="reg-step-text">Enter console IP, Account ID, and link code below.</div>
            </div>
          </div>

          <div className="field">
            <label>Console IP</label>
            <input value={regForm.host} onChange={e => setRegForm(p => ({ ...p, host: e.target.value }))} placeholder="192.168.1.x" />
          </div>
          <div className="field">
            <label>PSN Account ID (Base64)</label>
            <input value={regForm.psnAccountId} onChange={e => setRegForm(p => ({ ...p, psnAccountId: e.target.value }))} placeholder="e.g. ab12CDef3ghIjk..." />
          </div>
          <div className="field">
            <label>Link Code</label>
            <input value={regForm.pin} onChange={e => setRegForm(p => ({ ...p, pin: e.target.value }))} placeholder="8-digit code from console" maxLength={8} />
          </div>

          {registering === 'working' && (
            <div className="detect-status scanning" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
              <span className="spinner" />Registering...
            </div>
          )}
          {registering === 'success' && regResult && (
            <div className="detect-status done">Registered successfully! Keys saved to console config.</div>
          )}
          {registering === 'failed' && (
            <div className="detect-status err">Registration failed{regResult?.error ? ': ' + regResult.error : ''}</div>
          )}

          <div className="chiaki-reg-actions">
            <button className="btn-accent" onClick={doRegister} disabled={registering === 'working' || chiakiMissing || !regForm.host || !regForm.pin}>
              Register Console
            </button>
            <button className="btn-flat" onClick={() => { setRegistering(null); setRegResult(null); }}>Reset</button>
          </div>
        </>
      )}
    </SidePanel>
  );
}
