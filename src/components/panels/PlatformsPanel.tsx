import { useState, useEffect, useMemo } from 'react';
import { SidePanel } from '../SidePanel';
import { I } from '../../constants';
import type { Game, ImportProgress, FlashFn } from '../../types';

interface PlatformsPanelProps {
  show: boolean;
  onClose: () => void;
  flash: FlashFn;
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  onOpenChiaki: () => void;
  onOpenXcloud: () => void;
}

type AuthMethod = 'oauth' | 'local' | 'streaming';

interface PlatDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  authMethod: AuthMethod;
  group: 'online' | 'local' | 'streaming';
  apiKeyLabel?: string;
  apiKeyHelp?: string;
  apiKeyUrl?: string;
  note?: string;
}

const PLATS: PlatDef[] = [
  // ── Online sign-in (official OAuth/OpenID routes) ──────────────────────
  { id: 'steam', name: 'Steam', icon: 'S', color: '#1b2838', authMethod: 'oauth', group: 'online',
    apiKeyLabel: 'Steam Web API Key (optional)',
    apiKeyHelp: 'Only required if your Steam profile is set to private. Register any domain name (e.g. "cereal-launcher") on the Steam dev page.',
    apiKeyUrl: 'https://steamcommunity.com/dev/apikey',
    note: 'Signs in via Steam OpenID — Valve\'s official sign-in route.' },
  { id: 'gog', name: 'GOG', icon: 'G', color: '#3a1a50', authMethod: 'oauth', group: 'online',
    note: 'Signs in via GOG\'s official login.gog.com OAuth flow.' },
  { id: 'epic', name: 'Epic Games', icon: 'E', color: '#2a2a2a', authMethod: 'oauth', group: 'online',
    note: 'Signs in via Epic\'s official epicgames.com/id login.' },
  { id: 'xbox', name: 'Xbox', icon: 'X', color: '#0e6a0e', authMethod: 'oauth', group: 'online',
    note: 'Signs in via Microsoft\'s official login.live.com flow with Xbox Live scope.' },

  // ── Streaming ───────────────────────────────────────────────────────────
  { id: 'psn', name: 'PlayStation', icon: 'P', color: '#003087', authMethod: 'streaming', group: 'streaming',
    note: 'Stream PS4 / PS5 over the network using chiaki-ng.' },

  // ── Local detection only (no public OAuth) ──────────────────────────────
  { id: 'ea', name: 'EA App', icon: 'EA', color: '#0f6fc6', authMethod: 'local', group: 'local',
    note: 'EA does not offer a public sign-in API. Cereal reads your installed EA App library on this PC.' },
  { id: 'battlenet', name: 'Battle.net', icon: 'BN', color: '#148eff', authMethod: 'local', group: 'local',
    note: 'Battle.net has no public sign-in API. Cereal reads your Battle.net installation on this PC.' },
  { id: 'itchio', name: 'itch.io', icon: 'io', color: '#e8395c', authMethod: 'local', group: 'local',
    apiKeyLabel: 'itch.io Personal API Key',
    apiKeyHelp: 'itch.io\'s official integration route — paste a per-user key from your account settings to import your full purchased library.',
    apiKeyUrl: 'https://itch.io/user/settings/api-keys',
    note: 'Detects locally installed itch.io games. Add an API key to also import your full library.' },
  { id: 'ubisoft', name: 'Ubisoft Connect', icon: 'U', color: '#003791', authMethod: 'local', group: 'local',
    note: 'Ubisoft Connect has no public sign-in API. Cereal reads your Ubisoft Connect installation on this PC.' },
];

interface PlatState { status: string; games?: number; chiaki?: any; cloudUrl?: string; appFound?: boolean; }
interface ApiKeyState { input: string; saved: string | null; status: string | null; }

// ─── Helpers ─────────────────────────────────────────────────────────────
function relTime(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function isExpired(acct: any): boolean {
  if (!acct?.connected) return false;
  const expiry = acct.msExpiresAt ?? acct.expiresAt;
  if (typeof expiry !== 'number') return false;
  return Date.now() > expiry - 60_000;
}

export function PlatformsPanel({ show, onClose, flash, setGames, onOpenChiaki, onOpenXcloud }: PlatformsPanelProps) {
  const [accounts, setAccounts] = useState<Record<string, any>>({});
  const [platforms, setPlatforms] = useState<Record<string, PlatState>>({
    steam: { status: 'checking', games: 0 }, epic: { status: 'checking', games: 0 },
    gog: { status: 'checking', games: 0 }, psn: { status: 'checking', chiaki: null },
    xbox: { status: 'checking', cloudUrl: '', appFound: false, games: 0 },
    ea: { status: 'checking', games: 0 }, battlenet: { status: 'checking', games: 0 },
    itchio: { status: 'checking', games: 0 }, ubisoft: { status: 'checking', games: 0 },
  });
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState('');
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, ApiKeyState>>({});
  const [keyOpen, setKeyOpen] = useState<Record<string, boolean>>({});
  const [platFilter, setPlatFilter] = useState('');
  const [xcloudRefreshing, setXcloudRefreshing] = useState(false);

  useEffect(() => {
    if (!show) return;
    (async () => {
      if ((window.api as any)?.getAccounts) { const a = await (window.api as any).getAccounts(); setAccounts(a || {}); }
      const next: Record<string, PlatState> = { ...platforms };
      const api = window.api as any;
      if (api) {
        const probe = async (id: string, fn: string, build: (r: any) => PlatState) => {
          try { const r = await api[fn](); next[id] = build(r || {}); } catch { next[id] = { status: 'not-found', games: 0 }; }
        };
        await Promise.all([
          probe('steam',     'detectSteam',     r => ({ status: r.games?.length ? 'connected' : 'not-found', games: r.games?.length || 0 })),
          probe('epic',      'detectEpic',      r => ({ status: r.games?.length ? 'connected' : 'not-found', games: r.games?.length || 0 })),
          probe('gog',       'detectGOG',       r => ({ status: r.games?.length ? 'connected' : 'not-found', games: r.games?.length || 0 })),
          probe('psn',       'getChiakiStatus', r => ({ status: r.status === 'missing' ? 'not-found' : 'connected', chiaki: r })),
          probe('xbox',      'detectXbox',      r => ({ status: (r.games?.length || r.xboxAppFound) ? 'connected' : 'available', cloudUrl: r.cloudGamingUrl || 'https://www.xbox.com/play', appFound: r.xboxAppFound, games: r.games?.length || 0 })),
          probe('ea',        'detectEA',        r => ({ status: r.games?.length ? 'connected' : 'not-found', games: r.games?.length || 0 })),
          probe('battlenet', 'detectBattleNet', r => ({ status: r.games?.length ? 'connected' : 'not-found', games: r.games?.length || 0 })),
          probe('itchio',    'detectItchio',    r => ({ status: r.games?.length ? 'connected' : 'not-found', games: r.games?.length || 0 })),
          probe('ubisoft',   'detectUbisoft',   r => ({ status: r.games?.length ? 'connected' : 'not-found', games: r.games?.length || 0 })),
        ]);
      }
      setPlatforms(next);
      if ((window.api as any)?.getApiKeyInfo) {
        const keys: Record<string, ApiKeyState> = {};
        for (const pid of ['steam', 'itchio']) {
          try { const r = await (window.api as any).getApiKeyInfo(pid); keys[pid] = { input: '', saved: r?.ok && r.hasSecret ? r.fingerprint : null, status: null }; }
          catch { keys[pid] = { input: '', saved: null, status: null }; }
        }
        setApiKeys(keys);
      }
    })();
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!show) return;
    const unsub = window.api?.onImportProgress?.((data) => {
      setImportProgress(data);
      if (data.status === 'done' || data.status === 'error') {
        setTimeout(() => setImportProgress(null), 2500);
      }
    });
    return () => { unsub?.(); };
  }, [show]);

  const refreshAccounts = async () => {
    if ((window.api as any)?.getAccounts) { const a = await (window.api as any).getAccounts(); setAccounts(a || {}); }
  };
  const setKeyField = (id: string, field: keyof ApiKeyState, val: any) =>
    setApiKeys(prev => ({ ...prev, [id]: { ...(prev[id] || { input: '', saved: null, status: null }), [field]: val } }));

  const doAuth = async (id: string, name: string, method: AuthMethod) => {
    const verb = method === 'local' ? 'connect' : 'sign-in';
    setLoading(l => ({ ...l, [id]: true }));
    let r: any;
    try { r = await (window.api as any).platformAuth(id); }
    finally { setLoading(l => ({ ...l, [id]: false })); }

    // Always re-pull account state from main: provider success pages can call
    // window.close() before our async onRedirect resolves, and a hard error
    // partway through still might have persisted partial credentials. The DB
    // is the source of truth — sync the panel to it before deciding what flash
    // message to show.
    await refreshAccounts();
    const fresh = (window.api as any)?.getAccounts ? await (window.api as any).getAccounts() : {};
    const nowConnected = !!fresh?.[id]?.connected;

    if (r?.error === 'cancelled') {
      if (nowConnected) {
        const who = fresh[id].displayName || fresh[id].gamertag;
        flash(`${name} connected${who ? ': ' + who : ''} — importing library...`);
        await doImport(id);
      }
      return;
    }
    if (r?.error) {
      flash(`${name} ${verb} failed: ${r.error}`);
      return;
    }
    const who = r?.displayName || r?.gamertag || fresh?.[id]?.displayName || fresh?.[id]?.gamertag;
    flash(name + ' connected' + (who ? ': ' + who : '') + ' — importing library...');
    await doImport(id);
  };

  const doImport = async (id: string) => {
    setImporting(id);
    const r = await (window.api as any).platformImport(id);
    setImporting('');
    if (r.error) { flash(r.error); return; }
    if (r.games) setGames(prev => {
      const prevMap = new Map((prev || []).map((x: any) => [x.id, x]));
      return r.games.map((ng: any) => {
        const prevStamp = prevMap.get(ng.id)?._imgStamp || 0;
        const stamp = Math.max(prevStamp, ng._imgStamp || 0);
        return stamp ? { ...ng, _imgStamp: stamp } : ng;
      });
    });
    const added = r.imported?.length || 0;
    const updated = r.updated?.length || 0;
    const localNote = r.source === 'local' ? ' (installed games only — add an API key for full library)' : '';
    flash(added + updated > 0
      ? `Imported ${added} new, ${updated} updated${localNote}`
      : 'Library already up to date');
    refreshAccounts();
  };

  const doDisconnect = async (id: string, name: string) => {
    await (window.api as any).removeAccount(id);
    refreshAccounts();
    flash(name + ' disconnected');
  };

  const doValidateKey = async (id: string) => {
    const k = apiKeys[id] || {} as ApiKeyState;
    if (!k.input && !k.saved) { flash('No key to validate'); return; }
    setKeyField(id, 'status', 'checking');
    const r = k.input
      ? await (window.api as any).validateApiKey(id, k.input)
      : await (window.api as any).validateStoredApiKey?.(id);
    setKeyField(id, 'status', r?.ok ? 'valid' : ('invalid: ' + (r?.error || 'unknown')));
  };
  const doSaveKey = async (id: string) => {
    const key = (apiKeys[id] || {} as ApiKeyState).input;
    if (!key) { flash('Enter a key to save'); return; }
    const r = await (window.api as any).saveApiKey(id, key);
    if (r?.ok) { setKeyField(id, 'input', ''); setKeyField(id, 'saved', r.fingerprint || '✓'); flash('Key saved securely'); }
    else flash('Save failed: ' + r?.error);
  };
  const doDeleteKey = async (id: string) => {
    const r = await (window.api as any).deleteApiKey(id);
    if (r?.ok) { setKeyField(id, 'saved', null); setKeyField(id, 'input', ''); setKeyField(id, 'status', null); flash('Key deleted'); }
    else flash('Delete failed');
  };
  const doPasteKey = async (id: string) => {
    if (!(window.api as any)?.readClipboard) return flash('Clipboard not available');
    const txt = await (window.api as any).readClipboard();
    if (!txt) return flash('Clipboard empty');
    const candidate = txt.trim();
    setKeyField(id, 'input', candidate); setKeyField(id, 'status', 'checking');
    const vr = await (window.api as any).validateApiKey(id, candidate);
    if (vr?.ok) {
      const sr = await (window.api as any).saveApiKey(id, candidate);
      if (sr?.ok) {
        setKeyField(id, 'input', '');
        setKeyField(id, 'saved', sr.fingerprint || '✓');
        setKeyField(id, 'status', 'valid');
        flash('Pasted key validated and saved');
      } else flash('Pasted key validated but save failed');
    } else { setKeyField(id, 'status', 'invalid'); flash('Pasted key invalid'); }
  };

  // ─── Filtering & summary ──────────────────────────────────────────────
  const matchesFilter = (p: PlatDef) => {
    const q = (platFilter || '').trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || p.id.includes(q);
  };

  const summary = useMemo(() => {
    const oauthIds = PLATS.filter(p => p.authMethod === 'oauth').map(p => p.id);
    const onlineConnected = oauthIds.filter(id => accounts[id]?.connected).length;
    const expired = oauthIds.filter(id => isExpired(accounts[id])).length;
    return { onlineConnected, onlineTotal: oauthIds.length, expired };
  }, [accounts]);

  // ─── Building blocks (defined as render functions, not subcomponents — see
  // react-hooks/static-components rule) ──────────────────────────────────
  const renderStatusPill = (acct: any, plat: PlatDef, pdata?: PlatState) => {
    if (plat.authMethod === 'streaming') {
      const ok = pdata?.status === 'connected';
      return <span className={'login-pill ' + (ok ? 'ok' : 'muted')}><span className="pip" />{ok ? 'Ready' : 'Not configured'}</span>;
    }
    if (acct?.connected) {
      if (isExpired(acct)) return <span className="login-pill warn"><span className="pip" />Re-auth needed</span>;
      return <span className="login-pill ok"><span className="pip" />Connected</span>;
    }
    if (plat.authMethod === 'local') return <span className="login-pill local"><span className="pip" />Local detection</span>;
    return <span className="login-pill muted"><span className="pip" />Not signed in</span>;
  };

  const renderApiKeyPanel = ({ id, label, help, url }: { id: string; label: string; help?: string; url?: string }) => {
    const k = apiKeys[id] || ({} as ApiKeyState);
    const open = !!keyOpen[id] || !!k.saved;
    const status = k.status;
    const statusCls = !status ? '' : status === 'valid' ? 'ok' : status === 'checking' ? 'checking' : 'bad';
    const statusLabel = status === 'valid' ? 'Valid key' : status === 'checking' ? 'Checking…' : status?.startsWith('invalid') ? 'Invalid key' : status;
    return (
      <div className={'login-key' + (open ? ' open' : '')}>
        <button type="button" className="login-key-toggle" onClick={() => setKeyOpen(s => ({ ...s, [id]: !open }))}>
          <span>{label}</span>
          {k.saved && <span className="login-pill ok" style={{ marginLeft: 6 }}><span className="pip" />Saved</span>}
          <span className="chev">›</span>
        </button>
        {open && (
          <>
            {help && (
              <div className="login-key-help">
                {help}
                {url && (
                  <> <a onClick={e => { e.preventDefault(); window.api?.openExternal?.(url); }}>Get a key</a></>
                )}
              </div>
            )}
            <div className="login-key-input-row">
              <input
                type="password"
                value={k.input || ''}
                onChange={e => setKeyField(id, 'input', e.target.value)}
                placeholder={k.saved ? `Saved key ····${k.saved}` : 'Paste key here'}
                spellCheck={false}
                autoComplete="off"
              />
              <button className="login-cta ghost" type="button" onClick={() => doPasteKey(id)}>Paste</button>
            </div>
            <div className="login-key-actions">
              <button className="login-cta ghost" type="button" onClick={() => doValidateKey(id)} disabled={!k.input && !k.saved}>Validate</button>
              <button className="login-cta" type="button" onClick={() => doSaveKey(id)} disabled={!k.input}>Save</button>
              {k.saved && <button className="login-cta danger" type="button" onClick={() => doDeleteKey(id)}>Delete</button>}
              {status && <span className={'login-key-status ' + statusCls}>{statusLabel}</span>}
            </div>
            {k.saved && <div className="login-key-saved">····{k.saved}</div>}
          </>
        )}
      </div>
    );
  };

  const renderImportProgress = (id: string) => {
    if (importing !== id || !importProgress || importProgress.provider !== id) return null;
    const pct = importProgress.total
      ? Math.round(((importProgress.processed ?? 0) / importProgress.total) * 100)
      : null;
    return (
      <div className="login-progress">
        <div className="login-progress-head">
          <span className="login-progress-msg">{importProgress.message || 'Processing…'}</span>
          {importProgress.total ? <span className="login-progress-fraction">{importProgress.processed} / {importProgress.total}</span> : null}
        </div>
        <div className="login-progress-bar">
          <div className={'login-progress-fill' + (pct == null ? ' indeterminate' : '')} style={pct != null ? { width: pct + '%' } : undefined} />
        </div>
        <div className="login-progress-stats">
          <span className="new">+{importProgress.imported ?? 0} new</span>
          <span className="upd">{importProgress.updated ?? 0} updated</span>
        </div>
      </div>
    );
  };

  // Xbox-specific row: replaces the old "Xbox Cloud Gaming · requires Game
  // Pass" link with two real actions — open the embedded xCloud session and
  // refresh which library titles are currently streamable. The latter hits
  // the public Game Pass catalog and re-tags `xcloudPlayable` on Xbox games
  // without re-importing from Xbox Live.
  const renderXcloudActions = () => {
    const api = window.api as any;
    return (
      <div className="login-xcloud-actions">
        <button
          className="login-cta"
          onClick={() => { onClose(); onOpenXcloud(); }}
          title="Open the embedded Xbox Cloud Gaming session (sign in with the Microsoft account that has Game Pass Ultimate)"
        >
          <span style={{ display: 'flex', width: 13, height: 13 }}>{I.globe}</span>
          <span>Stream via Xbox Cloud</span>
        </button>
        {api?.xcloudRefreshCatalog && (
          <button
            className="login-cta ghost"
            disabled={xcloudRefreshing}
            onClick={async () => {
              setXcloudRefreshing(true);
              try {
                const r = await api.xcloudRefreshCatalog();
                if (r?.error) {
                  flash?.('Couldn’t refresh xCloud catalog: ' + r.error);
                } else {
                  flash?.(`xCloud catalog: ${r?.cloudPlayable ?? 0} of your titles are streamable.`);
                  // Refresh account stats so the new counts show up.
                  if (api.getAccounts) { const a = await api.getAccounts(); setAccounts(a || {}); }
                  if (setGames && api.getGames) { const g = await api.getGames(); setGames(g || []); }
                }
              } catch (e: any) {
                flash?.('xCloud catalog refresh failed: ' + (e?.message || e));
              } finally { setXcloudRefreshing(false); }
            }}
            title="Cross-reference your Xbox library against the public Xbox Cloud Gaming catalog. Doesn't re-import or touch your Xbox Live tokens."
          >
            {xcloudRefreshing ? <><span className="spinner" />Refreshing catalog…</> : 'Refresh cloud catalog'}
          </button>
        )}
        <div className="login-card-note" style={{ width: '100%', marginTop: 4 }}>Streaming via Xbox Cloud requires Game Pass Ultimate.</div>
      </div>
    );
  };

  const renderPlatformCard = (plat: PlatDef) => {
    const acct = accounts[plat.id] || {};
    const connected = !!acct.connected;
    const expired = isExpired(acct);
    const pdata = platforms[plat.id];
    const isLoading = loading[plat.id];
    const isImporting = importing === plat.id;
    const cardCls = 'login-card'
      + (connected ? ' connected' : '')
      + (expired ? ' expired' : '')
      + (!connected && plat.authMethod === 'local' ? ' local' : '');

    // ── PSN / Streaming ──────────────────────────────────────────────────
    if (plat.authMethod === 'streaming') {
      return (
        <div className={cardCls}>
          <div className="login-card-head">
            <div className="login-card-glyph" style={{ background: plat.color }}>{plat.icon}</div>
            <div className="login-card-title">
              <div className="login-card-name">{plat.name}</div>
              <div className="login-card-sub">
                {pdata?.chiaki?.version ? `chiaki-ng v${pdata.chiaki.version}` : pdata?.chiaki ? 'chiaki-ng installed' : 'Not configured'}
              </div>
            </div>
            {renderStatusPill(acct, plat, pdata)}
          </div>
          <button className="login-cta ghost" onClick={() => { onClose(); onOpenChiaki(); }}>
            <span style={{ display: 'flex', width: 14, height: 14 }}>{I.gear}</span>
            <span>Configure Remote Play</span>
          </button>
          {plat.note && <div className="login-card-note">{plat.note}</div>}
        </div>
      );
    }

    // ── Connected (OAuth or local detection) ─────────────────────────────
    if (connected) {
      const identity = acct.displayName || acct.gamertag || plat.name;
      const stats: string[] = [];
      if (acct.gameCount) stats.push(`${acct.gameCount} ${acct.gameCount === 1 ? 'game' : 'games'}`);
      if (pdata?.games) stats.push(`${pdata.games} installed`);
      // Xbox-specific: surface how many library titles are streamable right now
      // and how many are currently included in Game Pass. These come from the
      // last import (provider stores them on the account record).
      if (plat.id === 'xbox' && typeof acct.cloudPlayableCount === 'number' && acct.cloudPlayableCount > 0) {
        stats.push(`${acct.cloudPlayableCount} cloud-playable`);
      }
      if (plat.id === 'xbox' && typeof acct.gamePassCount === 'number' && acct.gamePassCount > 0) {
        stats.push(`${acct.gamePassCount} on Game Pass`);
      }
      const synced = relTime(acct.lastSync);
      if (synced) stats.push(`synced ${synced}`);

      return (
        <div className={cardCls}>
          <div className="login-card-head">
            <div className="login-card-glyph" style={{ background: plat.color }}>{plat.icon}</div>
            <div className="login-card-title">
              <div className="login-card-name">{plat.name}</div>
              <div className="login-card-sub">{plat.authMethod === 'local' ? 'Local launcher' : 'Online sign-in'}</div>
            </div>
            {renderStatusPill(acct, plat, pdata)}
          </div>

          <div className="login-card-meta">
            {acct.avatarUrl
              ? <div className="login-card-avatar"><img src={acct.avatarUrl} alt="" /></div>
              : <div className="login-card-glyph" style={{ background: plat.color, width: 44, height: 44, fontSize: 14 }}>{plat.icon}</div>}
            <div className="login-card-identity">
              <div className="login-card-identity-name" title={identity}>{identity}</div>
              <div className="login-card-identity-meta">
                {stats.length
                  ? stats.map((s, i) => <span key={i}>{s}</span>)
                  : <span>Connected</span>}
              </div>
            </div>
          </div>

          {expired && (
            <div className="login-card-error" role="status">
              Your {plat.name} session has expired. Re-authenticate to refresh tokens before importing.
            </div>
          )}

          <div className="login-card-actions">
            {expired ? (
              <button className="login-cta warn" disabled={isLoading} onClick={() => doAuth(plat.id, plat.name, plat.authMethod)}>
                {isLoading ? <><span className="spinner" />Re-authenticating…</> : 'Re-authenticate'}
              </button>
            ) : (
              <button className="login-cta" disabled={isImporting} onClick={() => doImport(plat.id)}>
                {isImporting ? <><span className="spinner" />Importing…</> : 'Import library'}
              </button>
            )}
            {plat.authMethod === 'oauth' && !expired && (
              <button className="login-cta ghost" onClick={() => doAuth(plat.id, plat.name, plat.authMethod)} disabled={isLoading}>
                {isLoading ? <><span className="spinner" />…</> : 'Re-auth'}
              </button>
            )}
            <button className="login-cta danger" onClick={() => doDisconnect(plat.id, plat.name)}>Disconnect</button>
          </div>

          {renderImportProgress(plat.id)}

          {plat.id === 'xbox' && renderXcloudActions()}

          {plat.apiKeyLabel && renderApiKeyPanel({ id: plat.id, label: plat.apiKeyLabel, help: plat.apiKeyHelp, url: plat.apiKeyUrl })}
          {plat.note && <div className="login-card-note">{plat.note}</div>}
        </div>
      );
    }

    // ── Disconnected (sign-in / connect) ────────────────────────────────
    const detectedHint = pdata?.games
      ? `${pdata.games} ${pdata.games === 1 ? 'game' : 'games'} detected on this PC`
      : (plat.authMethod === 'local' ? 'No local installation found' : 'Not signed in');

    return (
      <div className={cardCls}>
        <div className="login-card-head">
          <div className="login-card-glyph" style={{ background: plat.color }}>{plat.icon}</div>
          <div className="login-card-title">
            <div className="login-card-name">{plat.name}</div>
            <div className="login-card-sub">{detectedHint}</div>
          </div>
          {renderStatusPill(acct, plat, pdata)}
        </div>

        <button
          className="login-cta"
          onClick={() => doAuth(plat.id, plat.name, plat.authMethod)}
          disabled={isLoading}
        >
          {isLoading
            ? <><span className="spinner" />{plat.authMethod === 'local' ? 'Connecting…' : 'Signing in…'}</>
            : (plat.authMethod === 'local' ? `Connect ${plat.name}` : `Sign in with ${plat.name}`)}
        </button>

        {plat.id === 'xbox' && renderXcloudActions()}

        {plat.apiKeyLabel && renderApiKeyPanel({ id: plat.id, label: plat.apiKeyLabel, help: plat.apiKeyHelp, url: plat.apiKeyUrl })}
        {plat.note && <div className="login-card-note">{plat.note}</div>}
      </div>
    );
  };

  const renderSection = (title: string, sub: string, plats: PlatDef[]) => {
    const visible = plats.filter(matchesFilter);
    if (visible.length === 0) return null;
    return (
      <section key={title} className="login-section">
        <header className="login-section-head">
          <span className="login-section-title">{title}</span>
          <span className="login-section-sub">{sub}</span>
          <span className="login-section-count">{visible.length}</span>
        </header>
        {visible.map(p => <div key={p.id}>{renderPlatformCard(p)}</div>)}
      </section>
    );
  };

  const onlinePlats   = PLATS.filter(p => p.group === 'online');
  const localPlats    = PLATS.filter(p => p.group === 'local');
  const streamingPlats = PLATS.filter(p => p.group === 'streaming');
  const anyVisible = [onlinePlats, localPlats, streamingPlats].some(g => g.some(matchesFilter));

  return (
    <SidePanel show={show} onClose={onClose} title="Platforms" wide>
      {summary.onlineConnected > 0 && (
        <div className="login-summary">
          <span style={{ display: 'flex', width: 14, height: 14 }}>{I.account}</span>
          <span>
            <strong>{summary.onlineConnected}</strong> of {summary.onlineTotal} online accounts connected
            {summary.expired > 0 ? <> · <strong style={{ color: 'var(--accent)' }}>{summary.expired}</strong> need re-auth</> : null}
          </span>
        </div>
      )}

      <div className="field login-search">
        <label>Search platforms</label>
        <input value={platFilter} onChange={e => setPlatFilter(e.target.value)} placeholder="Steam, Xbox, GOG…" />
      </div>

      {renderSection('Online sign-in', 'Official OAuth/OpenID flows', onlinePlats)}
      {renderSection('Local detection', 'No public sign-in API — reads your local launcher', localPlats)}
      {renderSection('Streaming', 'Remote Play & cloud', streamingPlats)}

      {!anyVisible && (
        <div className="login-empty">No platforms match "{platFilter}".</div>
      )}
    </SidePanel>
  );
}
