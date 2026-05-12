import { useState, useEffect, useMemo } from 'react';
import type { Game, ChiakiSession } from '../../types';
import { SidePanel } from '../SidePanel';
import { I } from '../../constants';

interface ChiakiPanelProps {
  show: boolean;
  onClose: () => void;
  flash: (msg: React.ReactNode) => void;
  games: Game[];
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  chiakiSessions: Record<string, ChiakiSession>;
  /** 'overlay' (sidebar) or 'tab' (rendered inside a tab page). Default 'overlay'. */
  mode?: 'overlay' | 'tab';
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

interface ChiakiRegisterResult {
  success?: boolean;
  registKey?: string;
  morning?: string;
  error?: string;
}

type ChiakiQuality = {
  bitrate?: number;
  fpsActual?: number;
  latencyMs?: number;
  packetLoss?: number;
  fps?: number;
};

type ChiakiStreamInfo = {
  resolution?: string;
  fps?: number;
};

type SubTab = 'consoles' | 'discover' | 'register';

const TAB_DEFS: { id: SubTab; label: string; hint: string }[] = [
  { id: 'consoles', label: 'My Consoles', hint: 'Connect & manage' },
  { id: 'discover', label: 'Discover',    hint: 'Scan network'    },
  { id: 'register', label: 'Register',    hint: 'Pair a new one'  },
];

export function ChiakiPanel({ show, onClose, flash, chiakiSessions, mode = 'overlay' }: ChiakiPanelProps) {
  const [chiakiStatus, setChiakiStatus] = useState<ChiakiStatus | null>(null);
  const [chiakiConfig, setChiakiConfig] = useState<ChiakiConfig>({ executablePath: '', consoles: [] });
  const [newConsole, setNewConsole] = useState<ChiakiConsole>({ nickname: '', host: '', profile: '' });
  const [showAddConsole, setShowAddConsole] = useState(false);
  const [activeTab, setActiveTab] = useState<SubTab>('consoles');
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredConsole[]>([]);
  const [registering, setRegistering] = useState<string | null>(null);
  const [regForm, setRegForm] = useState({ host: '', psnAccountId: '', pin: '' });
  const [regResult, setRegResult] = useState<ChiakiRegisterResult | null>(null);

  useEffect(() => {
    if (!show) return;
    (async () => {
      if (window.api) {
        const st = await window.api.getChiakiStatus?.() as ChiakiStatus | null;
        const cfg = await window.api.getChiakiConfig?.() as ChiakiConfig | null;
        setChiakiStatus(st);
        setChiakiConfig(cfg || { executablePath: '', consoles: [] });
      }
    })();
  }, [show]);

  const addConsole = async () => {
    if (!newConsole.nickname?.trim() || !newConsole.host?.trim()) return;
    const updated: ChiakiConfig = { ...chiakiConfig, consoles: [...(chiakiConfig.consoles || []), newConsole] };
    if (window.api) await window.api.saveChiakiConfig?.(updated);
    setChiakiConfig(updated);
    setNewConsole({ nickname: '', host: '', profile: '' });
    setShowAddConsole(false);
    flash('Console added');
  };

  const removeConsole = async (idx: number) => {
    const updated: ChiakiConfig = { ...chiakiConfig, consoles: chiakiConfig.consoles.filter((_, i) => i !== idx) };
    if (window.api) await window.api.saveChiakiConfig?.(updated);
    setChiakiConfig(updated);
    flash('Console removed');
  };

  const doDiscover = async () => {
    setDiscovering(true);
    setDiscovered([]);
    if (window.api) {
      const r = await window.api.chiakiDiscoverConsoles?.() as { consoles?: DiscoveredConsole[] } | undefined;
      setDiscovered(r?.consoles || []);
    }
    setDiscovering(false);
  };

  const doRegister = async () => {
    if (!regForm.host || !regForm.pin) return;
    setRegistering('working');
    if (window.api) {
      const r = await window.api.chiakiRegisterConsole?.(regForm) as ChiakiRegisterResult | null;
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
        await window.api.saveChiakiConfig?.(upd);
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
    if (window.api) await window.api.chiakiStopStream?.(sessionKey);
    flash('Stream stopped');
  };

  const openChiakiGui = async () => {
    if (window.api) {
      const r = await window.api.chiakiOpenGui?.() as { success?: boolean; error?: string } | undefined;
      flash(r?.success ? 'chiaki-ng GUI opened' : 'Error: ' + r?.error);
    }
  };

  const statusClass = chiakiStatus?.status || 'missing';
  const chiakiMissing = statusClass === 'missing';
  const statusLabel =
    statusClass === 'bundled' ? 'chiaki-ng bundled' :
    statusClass === 'system'  ? 'chiaki-ng (system)' :
                                'chiaki-ng not installed';

  const getSessionForConsole = (c: ChiakiConsole) => {
    const sessionKey = 'console:' + c.host;
    const sess = chiakiSessions[sessionKey];
    const isLive = !!(sess && sess.state && sess.state !== 'disconnected');
    return { sessionKey, session: sess, isLive };
  };

  const connectConsole = async (c: ChiakiConsole) => {
    if (!window.api) return;
    const r = await window.api.chiakiStartStreamDirect?.({
      host: c.host, nickname: c.nickname || '', profile: c.profile || '',
      registKey: c.registKey || '', morning: c.morning || '',
    }) as { success?: boolean; error?: string } | undefined;
    flash(r?.success ? 'Connecting to ' + (c.nickname || c.host) + '...' : 'Error: ' + r?.error);
  };

  // ─── Derived state ────────────────────────────────────────────────────────
  const consoles = chiakiConfig.consoles || [];
  const liveSessions = useMemo(() => {
    return consoles
      .map(c => ({ console: c, ...getSessionForConsole(c) }))
      .filter(x => x.isLive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consoles, chiakiSessions]);
  const registeredCount = consoles.filter(c => c.registKey && c.morning).length;

  // ─── Render helpers ───────────────────────────────────────────────────────

  const renderConsoleCard = (c: ChiakiConsole, i: number) => {
    const hasKeys = !!c.registKey && !!c.morning;
    const { sessionKey, session: connSess, isLive } = getSessionForConsole(c);
    const cs = connSess as unknown as { state?: string; quality?: ChiakiQuality; streamInfo?: ChiakiStreamInfo } | undefined;
    const isStreaming = cs?.state === 'streaming';
    const quality = cs?.quality;
    const streamInfo = cs?.streamInfo;

    return (
      <div key={i} className={'chk-console' + (isLive ? ' live' : '') + (!hasKeys ? ' unreg' : '')}>
        <div className="chk-console-head">
          <div className="chk-ps-glyph">PS</div>
          <div className="chk-console-meta">
            <div className="chk-console-name">{c.nickname || 'PlayStation'}</div>
            <div className="chk-console-host">{c.host}{c.profile ? ' • ' + c.profile : ''}</div>
          </div>
          <div className="chk-console-tags">
            {isLive && <span className="chk-tag live"><span className="chk-tag-dot" />LIVE</span>}
            {!isLive && hasKeys && <span className="chk-tag ok">Paired</span>}
            {!isLive && !hasKeys && <span className="chk-tag warn">Not paired</span>}
          </div>
        </div>

        {isStreaming && quality?.bitrate != null && (
          <div className="chk-stream-stats">
            <div className="chk-stat">
              <div className="chk-stat-val">{quality.bitrate.toFixed(1)}</div>
              <div className="chk-stat-lbl">Mbps</div>
            </div>
            {quality.fpsActual != null && (
              <div className="chk-stat">
                <div className="chk-stat-val">{Math.round(quality.fpsActual)}</div>
                <div className="chk-stat-lbl">FPS</div>
              </div>
            )}
            {quality.latencyMs != null && (
              <div className="chk-stat">
                <div className="chk-stat-val">{Math.round(quality.latencyMs)}<span className="chk-stat-unit">ms</span></div>
                <div className="chk-stat-lbl">Latency</div>
              </div>
            )}
            {quality.packetLoss != null && (
              <div className="chk-stat">
                <div className="chk-stat-val">{quality.packetLoss.toFixed(1)}<span className="chk-stat-unit">%</span></div>
                <div className="chk-stat-lbl">Loss</div>
              </div>
            )}
            {streamInfo?.resolution && (
              <div className="chk-stat wide">
                <div className="chk-stat-val">{streamInfo.resolution}{streamInfo.fps ? ' / ' + streamInfo.fps : ''}</div>
                <div className="chk-stat-lbl">Stream</div>
              </div>
            )}
          </div>
        )}

        <div className="chk-console-actions">
          {isLive ? (
            <button className="chk-btn primary danger" onClick={() => stopStream(sessionKey)}>
              Stop stream
            </button>
          ) : (
            <>
              <button
                className="chk-btn primary"
                onClick={() => connectConsole(c)}
                disabled={chiakiMissing || !hasKeys}
                title={!hasKeys ? 'Register the console before connecting' : 'Start Remote Play session'}
              >
                Connect
              </button>
              {hasKeys ? (
                <button
                  className="chk-btn"
                  title="Wake console from rest mode"
                  onClick={async () => {
                    flash('Sending wake signal...');
                    const r = await window.api?.chiakiWakeConsole?.({ host: c.host, credentials: { registKey: c.registKey } }) as { success?: boolean; error?: string } | undefined;
                    flash(r?.success ? 'Wake signal sent to ' + c.nickname : 'Wake failed: ' + (r?.error || 'unknown'));
                  }}
                  disabled={chiakiMissing}
                >
                  Wake
                </button>
              ) : (
                <button
                  className="chk-btn accent"
                  onClick={() => { setRegForm(p => ({ ...p, host: c.host })); setActiveTab('register'); }}
                >
                  Register
                </button>
              )}
            </>
          )}
          <button
            className="chk-btn icon danger"
            onClick={() => removeConsole(i)}
            title="Remove this console"
            aria-label="Remove console"
          >
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
    const alreadyAdded = consoles.some(x => x.host === c.host);

    return (
      <div key={i} className="chk-disc">
        <div className={'chk-disc-glyph ' + (isPS5 ? 'ps5' : isPS4 ? 'ps4' : 'ps')}>
          {isPS5 ? 'PS5' : isPS4 ? 'PS4' : 'PS'}
        </div>
        <div className="chk-disc-meta">
          <div className="chk-disc-name">{c.name || 'PlayStation'}</div>
          <div className="chk-disc-detail">
            <span>{c.host}</span>
            {c.state === 'standby' && <span className="chk-tag mini idle">Standby</span>}
            {c.state === 'ready'   && <span className="chk-tag mini ok">Awake</span>}
            {c.firmwareVersion     && <span className="chk-tag mini">FW {c.firmwareVersion}</span>}
            {c.runningTitle        && <span className="chk-tag mini live">{c.runningTitle}</span>}
            {alreadyAdded          && <span className="chk-tag mini ok">Added</span>}
          </div>
        </div>
        <div className="chk-disc-actions">
          {!alreadyAdded && (
            <button className="chk-btn primary" onClick={() => addDiscoveredAsConsole(c)}>Add</button>
          )}
          <button
            className="chk-btn"
            onClick={() => { setRegForm(p => ({ ...p, host: c.host })); setActiveTab('register'); }}
          >
            Register
          </button>
        </div>
      </div>
    );
  };

  // ─── Sections ─────────────────────────────────────────────────────────────

  const renderConsoles = () => (
    <>
      <div className="chk-section-head">
        <div>
          <div className="chk-section-title">My Consoles</div>
          <div className="chk-section-sub">{consoles.length === 0 ? 'No consoles yet — discover or add manually.' : `${registeredCount} of ${consoles.length} paired and ready.`}</div>
        </div>
        <div className="chk-section-actions">
          <button className="chk-btn" onClick={() => setActiveTab('discover')}>Scan</button>
          <button className="chk-btn primary" onClick={() => setShowAddConsole(v => !v)}>
            {showAddConsole ? 'Cancel' : '+ Add manually'}
          </button>
        </div>
      </div>

      {showAddConsole && (
        <div className="chk-add">
          <div className="chk-add-title">Add a console manually</div>
          <div className="chk-add-grid">
            <div className="chk-field">
              <label>Nickname</label>
              <input
                value={newConsole.nickname}
                onChange={e => setNewConsole(p => ({ ...p, nickname: e.target.value }))}
                placeholder="PS5 — Living Room"
              />
            </div>
            <div className="chk-field">
              <label>Host IP</label>
              <input
                value={newConsole.host}
                onChange={e => setNewConsole(p => ({ ...p, host: e.target.value }))}
                placeholder="192.168.1.42"
              />
            </div>
            <div className="chk-field">
              <label>Profile (optional)</label>
              <input
                value={newConsole.profile}
                onChange={e => setNewConsole(p => ({ ...p, profile: e.target.value }))}
                placeholder="default"
              />
            </div>
          </div>
          <div className="chk-add-actions">
            <button className="chk-btn" onClick={() => setShowAddConsole(false)}>Cancel</button>
            <button className="chk-btn accent" onClick={addConsole}>Add console</button>
          </div>
        </div>
      )}

      {consoles.length === 0 && !showAddConsole ? (
        <div className="chk-empty">
          <div className="chk-empty-glyph">PS</div>
          <div className="chk-empty-title">No consoles registered yet</div>
          <div className="chk-empty-sub">
            Use <strong>Discover</strong> to find consoles on your network, or <strong>Add manually</strong> if you know the IP.
          </div>
          <div className="chk-empty-actions">
            <button className="chk-btn primary" onClick={() => setActiveTab('discover')}>Scan network</button>
            <button className="chk-btn" onClick={() => setShowAddConsole(true)}>Add manually</button>
          </div>
        </div>
      ) : (
        <div className="chk-grid">
          {consoles.map((c, i) => renderConsoleCard(c, i))}
        </div>
      )}
    </>
  );

  const renderDiscover = () => (
    <>
      <div className="chk-section-head">
        <div>
          <div className="chk-section-title">Discover consoles</div>
          <div className="chk-section-sub">Send a UDP probe to your local subnet. Make sure your console is on or in standby.</div>
        </div>
        <div className="chk-section-actions">
          <button
            className="chk-btn primary"
            onClick={doDiscover}
            disabled={discovering || chiakiMissing}
          >
            {discovering ? <><span className="spinner" style={{ marginRight: 6 }} />Scanning…</> : 'Scan network'}
          </button>
        </div>
      </div>

      {discovering && (
        <div className="chk-radar">
          <div className="chk-radar-pulse" />
          <div className="chk-radar-pulse delay" />
          <div className="chk-radar-text">Searching local network…</div>
        </div>
      )}

      {!discovering && discovered.length === 0 && (
        <div className="chk-empty">
          <div className="chk-empty-glyph">⌖</div>
          <div className="chk-empty-title">No consoles found yet</div>
          <div className="chk-empty-sub">
            Click <strong>Scan network</strong> to look for PlayStation consoles. They must be on the same network.
          </div>
        </div>
      )}

      {discovered.length > 0 && (
        <div className="chk-grid one-col">
          {discovered.map((c, i) => renderDiscoverCard(c, i))}
        </div>
      )}
    </>
  );

  const renderRegister = () => (
    <>
      <div className="chk-section-head">
        <div>
          <div className="chk-section-title">Pair a new console</div>
          <div className="chk-section-sub">A one-time setup. You'll need physical access to the console.</div>
        </div>
      </div>

      <div className="chk-steps">
        {[
          { n: 1, t: 'Enable Remote Play',   d: <>On the console: <span>Settings → System → Remote Play</span> and turn it on.</> },
          { n: 2, t: 'Get the link code',     d: <>Open <span>Link Device</span> in the same menu to reveal the 8-digit code.</> },
          { n: 3, t: 'PSN Account ID',        d: <>Look it up at <a href="#" onClick={e => { e.preventDefault(); window.api?.openExternal?.('https://psn.flipscreen.games/'); }}>psn.flipscreen.games</a> and copy the Base64 value.</> },
          { n: 4, t: 'Pair below',            d: <>Enter the IP, Account ID, and link code, then hit <span>Register</span>.</> },
        ].map(s => (
          <div key={s.n} className="chk-step">
            <div className="chk-step-num">{s.n}</div>
            <div className="chk-step-body">
              <div className="chk-step-title">{s.t}</div>
              <div className="chk-step-text">{s.d}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="chk-form">
        <div className="chk-form-grid">
          <div className="chk-field">
            <label>Console IP</label>
            <input value={regForm.host} onChange={e => setRegForm(p => ({ ...p, host: e.target.value }))} placeholder="192.168.1.42" />
          </div>
          <div className="chk-field">
            <label>PSN Account ID (Base64)</label>
            <input value={regForm.psnAccountId} onChange={e => setRegForm(p => ({ ...p, psnAccountId: e.target.value }))} placeholder="ab12CDef3ghIjk…" />
          </div>
          <div className="chk-field">
            <label>Link code (8 digits)</label>
            <input value={regForm.pin} onChange={e => setRegForm(p => ({ ...p, pin: e.target.value }))} placeholder="00000000" maxLength={8} />
          </div>
        </div>

        {registering === 'working' && (
          <div className="chk-status-line working"><span className="spinner" />Registering — talking to console…</div>
        )}
        {registering === 'success' && regResult && (
          <div className="chk-status-line ok">Registered! Keys saved to console config.</div>
        )}
        {registering === 'failed' && (
          <div className="chk-status-line err">Registration failed{regResult?.error ? ': ' + regResult.error : ''}</div>
        )}

        <div className="chk-form-actions">
          <button className="chk-btn" onClick={() => { setRegistering(null); setRegResult(null); }}>Reset</button>
          <button
            className="chk-btn accent"
            onClick={doRegister}
            disabled={registering === 'working' || chiakiMissing || !regForm.host || !regForm.pin}
          >
            Register console
          </button>
        </div>
      </div>
    </>
  );

  // ─── Top-level ────────────────────────────────────────────────────────────

  return (
    <SidePanel show={show} onClose={onClose} title="PlayStation Remote Play" wide mode={mode} bare>
      <div className="chk-shell">
        {/* HERO */}
        <div className={'chk-hero ' + statusClass}>
          <div className="chk-hero-left">
            <div className="chk-hero-glyph" aria-hidden>PS</div>
            <div className="chk-hero-text">
              <div className="chk-hero-tag">Remote Play</div>
              <h2 className="chk-hero-title">PlayStation</h2>
              <div className="chk-hero-sub">Stream PS5 / PS4 games to this PC over your local network with chiaki-ng.</div>
            </div>
          </div>
          <div className="chk-hero-right">
            <div className={'chk-status-pill ' + statusClass}>
              <span className="chk-status-dot" />
              <span className="chk-status-text">{statusLabel}</span>
              {chiakiStatus?.version && <span className="chk-status-ver">v{chiakiStatus.version}</span>}
            </div>
            <button
              className="chk-btn"
              onClick={openChiakiGui}
              disabled={chiakiMissing}
              title="Open chiaki-ng GUI"
            >
              <span style={{ display: 'flex', width: 12, height: 12, marginRight: 6 }}>{I.globe}</span>
              Open chiaki-ng
            </button>
          </div>
        </div>

        {chiakiMissing && (
          <div className="chk-alert">
            <div className="chk-alert-title">chiaki-ng is required</div>
            <div className="chk-alert-text">
              Run <strong>scripts/setup-chiaki.ps1</strong> to download and install it automatically, or set the path in
              {' '}<strong>Settings → Integrations → Chiaki path</strong>.
            </div>
          </div>
        )}

        {/* LIVE BANNER */}
        {liveSessions.length > 0 && (
          <div className="chk-live-bar">
            <span className="chk-live-dot" />
            <div className="chk-live-text">
              {liveSessions.length === 1
                ? <>Streaming from <strong>{liveSessions[0].console.nickname || liveSessions[0].console.host}</strong></>
                : <><strong>{liveSessions.length}</strong> active sessions</>}
            </div>
            {liveSessions.length === 1 && (() => {
              const cs = liveSessions[0].session as unknown as { quality?: ChiakiQuality } | undefined;
              const q = cs?.quality;
              if (!q) return null;
              return (
                <div className="chk-live-meta">
                  {q.bitrate != null && <span>{q.bitrate.toFixed(1)} Mbps</span>}
                  {q.fpsActual != null && <span>{Math.round(q.fpsActual)} FPS</span>}
                  {q.latencyMs != null && <span>{Math.round(q.latencyMs)} ms</span>}
                </div>
              );
            })()}
          </div>
        )}

        {/* TABS */}
        <div className="chk-tabs" role="tablist">
          {TAB_DEFS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              className={'chk-tab' + (activeTab === t.id ? ' active' : '')}
              onClick={() => setActiveTab(t.id)}
            >
              <div className="chk-tab-label">
                {t.label}
                {t.id === 'consoles' && consoles.length > 0 && (
                  <span className="chk-tab-count">{consoles.length}</span>
                )}
              </div>
              <div className="chk-tab-hint">{t.hint}</div>
            </button>
          ))}
        </div>

        {/* CONTENT */}
        <div className="chk-content">
          {activeTab === 'consoles' && renderConsoles()}
          {activeTab === 'discover' && renderDiscover()}
          {activeTab === 'register' && renderRegister()}
        </div>
      </div>
    </SidePanel>
  );
}
