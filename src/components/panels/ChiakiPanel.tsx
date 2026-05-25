import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { Game, ChiakiSession, FlashFn } from '../../types';
import { SidePanel } from '../SidePanel';
import { I, PLATFORMS } from '../../constants';

/** PlayStation logo, sized to fit any chk-*-glyph. */
const PS_LOGO = PLATFORMS.psn?.icon ?? null;

interface ChiakiPanelProps {
  show: boolean;
  onClose: () => void;
  flash: FlashFn;
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

interface ChiakiUpdateResult {
  ok?: boolean;
  version?: string;
  error?: string;
  output?: string;
}

/** A few common Base64 alphabets — PSN IDs are usually 12 chars of std/URL-safe Base64. */
const PSN_ID_RE = /^[A-Za-z0-9+/_-]{8,32}={0,2}$/;

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

  // ─── Install state (Bucket A) ───────────────────────────────────────────
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  // ─── Live-state cache (Bucket B) ────────────────────────────────────────
  /** Discovered consoles keyed by host — used to enrich the saved-consoles list. */
  const [discoveredByHost, setDiscoveredByHost] = useState<Record<string, DiscoveredConsole>>({});
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);

  // ─── Smart Connect state (Bucket C) ─────────────────────────────────────
  /** Per-host transient state shown on the Connect button. */
  const [connectStates, setConnectStates] = useState<Record<string, 'waking' | 'connecting'>>({});
  /** Cancellation flag so wake-polls don't keep running after the panel closes. */
  const cancelRef = useRef(false);

  // ─── Register polish (Bucket D) ─────────────────────────────────────────
  /** True once we've populated psnAccountId from settings (so users only re-enter on demand). */
  const [psnIdPrefilled, setPsnIdPrefilled] = useState(false);

  // ─── Top-level load ─────────────────────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    if (!window.api) return null;
    const st = (await window.api.getChiakiStatus?.()) as ChiakiStatus | null;
    setChiakiStatus(st);
    return st;
  }, []);

  const runDiscover = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!window.api) return [] as DiscoveredConsole[];
    if (!opts.silent) setDiscovering(true);
    try {
      const r = (await window.api.chiakiDiscoverConsoles?.()) as { consoles?: DiscoveredConsole[] } | undefined;
      const found = r?.consoles || [];
      setDiscovered(found);
      const byHost: Record<string, DiscoveredConsole> = {};
      for (const c of found) if (c.host) byHost[c.host] = c;
      setDiscoveredByHost(byHost);
      setLastScanAt(Date.now());
      return found;
    } finally {
      if (!opts.silent) setDiscovering(false);
    }
  }, []);

  useEffect(() => {
    if (!show) return;
    cancelRef.current = false;
    (async () => {
      if (!window.api) return;
      const st = (await window.api.getChiakiStatus?.()) as ChiakiStatus | null;
      const cfg = (await window.api.getChiakiConfig?.()) as ChiakiConfig | null;
      setChiakiStatus(st);
      setChiakiConfig(cfg || { executablePath: '', consoles: [] });

      // Pre-fill PSN Account ID from settings if we have one saved.
      try {
        const settings = (await window.api.getSettings?.()) as { psnAccountId?: string } | undefined;
        if (settings?.psnAccountId && !psnIdPrefilled) {
          setRegForm(p => ({ ...p, psnAccountId: settings.psnAccountId || '' }));
          setPsnIdPrefilled(true);
        }
      } catch (_e) { /* settings IPC is optional */ }

      // Background-scan in the background so console cards get enriched on first paint.
      if (st && st.status !== 'missing') {
        void runDiscover({ silent: true });
      }
    })();
    return () => { cancelRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // Auto-scan when the user opens the Discover tab — that's why they're there.
  useEffect(() => {
    if (!show) return;
    if (activeTab !== 'discover') return;
    if (chiakiStatus?.status === 'missing') return;
    // If we have a fresh result (<15s old) skip — avoids hammering the network.
    if (lastScanAt && Date.now() - lastScanAt < 15_000 && discovered.length > 0) return;
    void runDiscover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, show, chiakiStatus?.status]);

  // ─── Install chiaki-ng (Bucket A) ───────────────────────────────────────
  const installChiaki = async () => {
    if (!window.api?.chiakiUpdate) {
      flash('Install IPC unavailable — please restart Cereal');
      return;
    }
    setInstalling(true);
    setInstallError(null);
    try {
      const r = (await window.api.chiakiUpdate()) as ChiakiUpdateResult;
      if (r?.ok) {
        flash('chiaki-ng installed (v' + (r.version || '?') + ')');
        await refreshStatus();
        // Kick off a discover now that we can actually talk to consoles.
        void runDiscover({ silent: true });
      } else {
        const lines = r?.output ? String(r.output).split('\n') : [];
        const errLine =
          lines.find(l => l.trimStart().startsWith('ERROR:')) ||
          lines.filter(l => l.trim()).pop() ||
          '';
        const msg = (r?.error || 'Install failed') + (errLine ? ': ' + errLine.replace(/^ERROR:\s*/i, '').trim() : '');
        setInstallError(msg);
        flash(msg);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Install failed';
      setInstallError(msg);
      flash(msg);
    } finally {
      setInstalling(false);
    }
  };

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

  const doDiscover = () => runDiscover();

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

        // Save the PSN Account ID so the user never has to type it again.
        if (regForm.psnAccountId) {
          try { await window.api.saveSettings?.({ psnAccountId: regForm.psnAccountId }); } catch (_e) { /* best-effort */ }
        }

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

  /** Poll discover every `intervalMs` until the target host reports `ready`, or until we time out. */
  const pollUntilReady = async (host: string, timeoutMs = 30_000, intervalMs = 2_500): Promise<boolean> => {
    const startedAt = Date.now();
    while (!cancelRef.current && Date.now() - startedAt < timeoutMs) {
      await new Promise(r => setTimeout(r, intervalMs));
      if (cancelRef.current) return false;
      try {
        const found = await runDiscover({ silent: true });
        const hit = found.find(d => d.host === host);
        if (hit && (hit.state === 'ready' || hit.state === 'on')) return true;
      } catch (_e) { /* keep polling */ }
    }
    return false;
  };

  /**
   * Smart connect:
   *  - If the console is already known to be ready → start the stream immediately.
   *  - If it's in standby (or we don't know) and we have wake credentials → send wake, poll until ready, then stream.
   *  - Otherwise try direct connect (chiaki-ng can sometimes handle it).
   */
  const connectConsole = async (c: ChiakiConsole) => {
    if (!window.api) return;
    const host = c.host;
    const disc = discoveredByHost[host];
    const isStandby = disc?.state === 'standby';
    const hasWakeCreds = !!c.registKey;

    const startStream = async () => {
      setConnectStates(prev => ({ ...prev, [host]: 'connecting' }));
      const r = (await window.api?.chiakiStartStreamDirect?.({
        host, nickname: c.nickname || '', profile: c.profile || '',
        registKey: c.registKey || '', morning: c.morning || '',
      })) as { success?: boolean; error?: string } | undefined;
      flash(r?.success ? 'Connecting to ' + (c.nickname || host) + '…' : 'Error: ' + r?.error);
    };

    try {
      if (isStandby && hasWakeCreds) {
        setConnectStates(prev => ({ ...prev, [host]: 'waking' }));
        flash('Waking ' + (c.nickname || host) + '…');
        const wake = (await window.api.chiakiWakeConsole?.({
          host, credentials: { registKey: c.registKey },
        })) as { success?: boolean; error?: string } | undefined;
        if (!wake?.success) {
          flash('Wake failed: ' + (wake?.error || 'unknown'));
          return;
        }
        const ready = await pollUntilReady(host);
        if (!ready) {
          flash('Console didn’t respond after waking. Try again, or wake it manually.');
          return;
        }
        await startStream();
      } else {
        await startStream();
      }
    } finally {
      setConnectStates(prev => {
        const next = { ...prev };
        delete next[host];
        return next;
      });
    }
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

    // Cross-reference live network state (Bucket B)
    const disc = discoveredByHost[c.host];
    const consoleType = (disc?.type || '').toUpperCase();
    const isPS5 = consoleType.includes('PS5') || consoleType.includes('5');
    const isPS4 = consoleType.includes('PS4') || consoleType.includes('4');
    const glyphClass = isPS5 ? 'ps5' : isPS4 ? 'ps4' : '';
    const typePip = isPS5 ? 'PS5' : isPS4 ? 'PS4' : null;
    const isOnline = !!disc && disc.state !== 'unknown' && disc.state !== undefined;
    const isStandby = disc?.state === 'standby';
    const isReady = disc?.state === 'ready' || disc?.state === 'on';
    const isReachable = !!disc;
    // Once we have a fresh scan and the console isn't in it, treat it as offline.
    const scanFresh = lastScanAt && Date.now() - lastScanAt < 60_000;
    const isOfflineConfident = !isReachable && !!scanFresh;

    // Smart-connect transient feedback
    const connState = connectStates[c.host];
    const connLabel =
      connState === 'waking' ? 'Waking…' :
      connState === 'connecting' ? 'Connecting…' :
      'Connect';

    return (
      <div key={i} className={'chk-console' + (isLive ? ' live' : '') + (!hasKeys ? ' unreg' : '')}>
        <div className="chk-console-head">
          <div className={'chk-ps-glyph' + (glyphClass ? ' ' + glyphClass : '')} aria-label={typePip || 'PlayStation'}>
            {PS_LOGO}
            {typePip && <span className="chk-ps-glyph-type">{typePip}</span>}
          </div>
          <div className="chk-console-meta">
            <div className="chk-console-name">{c.nickname || 'PlayStation'}</div>
            <div className="chk-console-host">
              {c.host}
              {c.profile ? ' • ' + c.profile : ''}
              {disc?.runningTitle && <span className="chk-console-running"> • {disc.runningTitle}</span>}
            </div>
          </div>
          <div className="chk-console-tags">
            {isLive && <span className="chk-tag live"><span className="chk-tag-dot" />LIVE</span>}
            {!isLive && isReady && hasKeys && <span className="chk-tag ok">Online</span>}
            {!isLive && isStandby && hasKeys && <span className="chk-tag idle">Standby</span>}
            {!isLive && isOnline && !isReady && !isStandby && hasKeys && <span className="chk-tag ok">Reachable</span>}
            {!isLive && isOfflineConfident && hasKeys && <span className="chk-tag idle">Offline</span>}
            {!isLive && !isReachable && !isOfflineConfident && hasKeys && <span className="chk-tag ok">Paired</span>}
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
                disabled={chiakiMissing || !hasKeys || !!connState}
                title={
                  !hasKeys ? 'Register the console before connecting' :
                  isStandby ? 'Wake the console and start streaming' :
                  'Start Remote Play session'
                }
              >
                {connState ? <><span className="spinner" style={{ marginRight: 6 }} />{connLabel}</> : connLabel}
              </button>
              {hasKeys ? (
                <button
                  className="chk-btn"
                  title="Send a wake signal without starting a stream"
                  onClick={async () => {
                    flash('Sending wake signal…');
                    const r = await window.api?.chiakiWakeConsole?.({ host: c.host, credentials: { registKey: c.registKey } }) as { success?: boolean; error?: string } | undefined;
                    flash(r?.success ? 'Wake signal sent to ' + (c.nickname || c.host) : 'Wake failed: ' + (r?.error || 'unknown'));
                    // Refresh discover shortly after so the card reflects the new state.
                    setTimeout(() => { void runDiscover({ silent: true }); }, 4_000);
                  }}
                  disabled={chiakiMissing || !!connState}
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
            disabled={!!connState || isLive}
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
        <div className={'chk-disc-glyph ' + (isPS5 ? 'ps5' : isPS4 ? 'ps4' : 'ps')} aria-label={isPS5 ? 'PS5' : isPS4 ? 'PS4' : 'PlayStation'}>
          {PS_LOGO}
          {(isPS5 || isPS4) && <span className="chk-disc-glyph-type">{isPS5 ? 'PS5' : 'PS4'}</span>}
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

  const renderConsoles = () => {
    const reachableCount = consoles.filter(c => !!discoveredByHost[c.host]).length;
    const sub =
      consoles.length === 0
        ? 'No consoles yet — discover or add manually.'
        : lastScanAt
          ? `${registeredCount} of ${consoles.length} paired • ${reachableCount} reachable on network`
          : `${registeredCount} of ${consoles.length} paired.`;
    return (
    <>
      <div className="chk-section-head">
        <div>
          <div className="chk-section-title">My Consoles</div>
          <div className="chk-section-sub">{sub}</div>
        </div>
        <div className="chk-section-actions">
          <button
            className="chk-btn"
            onClick={() => runDiscover()}
            disabled={discovering || chiakiMissing}
            title="Re-scan the network to refresh console state"
          >
            {discovering ? <><span className="spinner" style={{ marginRight: 6 }} />Refreshing…</> : 'Refresh'}
          </button>
          <button className="chk-btn" onClick={() => setActiveTab('discover')} disabled={chiakiMissing}>Scan</button>
          <button className="chk-btn primary" onClick={() => setShowAddConsole(v => !v)} disabled={chiakiMissing}>
            {showAddConsole ? 'Cancel' : '+ Add manually'}
          </button>
        </div>
      </div>

      {showAddConsole && (
        <form className="chk-add" onSubmit={e => { e.preventDefault(); void addConsole(); }}>
          <div className="chk-add-title">Add a console manually</div>
          <div className="chk-add-grid">
            <div className="chk-field">
              <label>Nickname</label>
              <input
                value={newConsole.nickname}
                onChange={e => setNewConsole(p => ({ ...p, nickname: e.target.value }))}
                placeholder="PS5 — Living Room"
                autoFocus
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
              <label title="chiaki-ng controller mapping profile — leave blank to use the default">
                Profile (optional)
              </label>
              <input
                value={newConsole.profile}
                onChange={e => setNewConsole(p => ({ ...p, profile: e.target.value }))}
                placeholder="default"
                title="chiaki-ng controller mapping profile — leave blank to use the default"
              />
            </div>
          </div>
          <div className="chk-add-actions">
            <button type="button" className="chk-btn" onClick={() => setShowAddConsole(false)}>Cancel</button>
            <button
              type="submit"
              className="chk-btn accent"
              disabled={!newConsole.nickname.trim() || !newConsole.host.trim()}
            >
              Add console
            </button>
          </div>
        </form>
      )}

      {consoles.length === 0 && !showAddConsole ? (
        <div className="chk-empty">
          <div className="chk-empty-glyph">{PS_LOGO}</div>
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
  };

  const renderDiscover = () => {
    const scanAgo = lastScanAt ? Math.floor((Date.now() - lastScanAt) / 1000) : null;
    const scanLabel = scanAgo == null
      ? 'Send a UDP probe to your local subnet. Make sure your console is on or in standby.'
      : scanAgo < 5
        ? 'Scanned just now.'
        : scanAgo < 60
          ? `Last scan: ${scanAgo}s ago.`
          : `Last scan: ${Math.floor(scanAgo / 60)}m ago.`;
    return (
    <>
      <div className="chk-section-head">
        <div>
          <div className="chk-section-title">Discover consoles</div>
          <div className="chk-section-sub">{scanLabel}</div>
        </div>
        <div className="chk-section-actions">
          <button
            className="chk-btn primary"
            onClick={doDiscover}
            disabled={discovering || chiakiMissing}
          >
            {discovering ? <><span className="spinner" style={{ marginRight: 6 }} />Scanning…</> : (lastScanAt ? 'Scan again' : 'Scan network')}
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
          <div className="chk-empty-glyph scan">{I.scan}</div>
          <div className="chk-empty-title">No consoles found yet</div>
          <div className="chk-empty-sub">
            Click <strong>Scan again</strong> to look for PlayStation consoles. They must be on the same Wi-Fi or LAN. If a console is off (not standby), it won't reply.
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
  };

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

      <form
        className="chk-form"
        onSubmit={e => {
          e.preventDefault();
          if (registering === 'working' || chiakiMissing || !regForm.host || !regForm.pin) return;
          void doRegister();
        }}
      >
        <div className="chk-form-grid">
          <div className="chk-field">
            <label>Console IP</label>
            <input
              value={regForm.host}
              onChange={e => setRegForm(p => ({ ...p, host: e.target.value }))}
              placeholder="192.168.1.42"
              inputMode="numeric"
            />
          </div>
          <div className="chk-field">
            <label>
              PSN Account ID (Base64)
              {psnIdPrefilled && regForm.psnAccountId && (
                <span className="chk-field-hint"> · remembered</span>
              )}
            </label>
            <input
              value={regForm.psnAccountId}
              onChange={e => setRegForm(p => ({ ...p, psnAccountId: e.target.value }))}
              placeholder="ab12CDef3ghIjk…"
              autoComplete="off"
              spellCheck={false}
            />
            {regForm.psnAccountId && !PSN_ID_RE.test(regForm.psnAccountId.trim()) && (
              <div className="chk-field-warn">Doesn't look like a Base64 PSN ID — double-check before submitting.</div>
            )}
          </div>
          <div className="chk-field">
            <label>Link code (8 digits)</label>
            <input
              value={regForm.pin}
              onChange={e => setRegForm(p => ({ ...p, pin: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
              placeholder="00000000"
              maxLength={8}
              inputMode="numeric"
              pattern="[0-9]{8}"
            />
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
          <button
            type="button"
            className="chk-btn"
            onClick={() => { setRegistering(null); setRegResult(null); }}
          >
            Reset
          </button>
          <button
            type="submit"
            className="chk-btn accent"
            disabled={registering === 'working' || chiakiMissing || !regForm.host || !regForm.pin}
          >
            Register console
          </button>
        </div>
      </form>
    </>
  );

  // ─── Top-level ────────────────────────────────────────────────────────────

  return (
    <SidePanel show={show} onClose={onClose} title="PlayStation Remote Play" wide mode={mode} bare>
      <div className="chk-shell">
        {/* HERO */}
        <div className={'chk-hero ' + statusClass}>
          <div className="chk-hero-left">
            <div className="chk-hero-glyph" aria-hidden>{PS_LOGO}</div>
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
          <div className="chk-install">
            <div className="chk-install-icon" aria-hidden>
              <span style={{ display: 'flex', width: 22, height: 22 }}>{I.download}</span>
            </div>
            <div className="chk-install-text">
              <div className="chk-install-title">Install chiaki-ng to get started</div>
              <div className="chk-install-sub">
                chiaki-ng is the open-source PlayStation Remote Play client Cereal uses to stream. We'll download it
                from the official GitHub release and install it locally.
              </div>
              {installError && <div className="chk-install-err">{installError}</div>}
            </div>
            <div className="chk-install-actions">
              <button
                className="chk-btn primary"
                onClick={installChiaki}
                disabled={installing}
                title="Downloads the latest chiaki-ng release into Cereal's app data (~30 MB). Usually finishes in under a minute."
              >
                {installing
                  ? <><span className="spinner" style={{ marginRight: 6 }} />Installing…</>
                  : 'Download chiaki-ng'}
              </button>
              <button
                className="chk-btn link"
                onClick={() => window.api?.openExternal?.('https://github.com/streetpea/chiaki-ng')}
                title="Open the chiaki-ng project on GitHub"
              >
                What is chiaki-ng?
              </button>
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
