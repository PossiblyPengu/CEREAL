import { useState, useEffect } from 'react';
import { SidePanel } from './SidePanel';
import { I } from '../constants';
import { fmtDate } from '../utils';
import type { Game } from '../types';

interface PlatformsPanelProps {
  show: boolean;
  onClose: () => void;
  flash: (msg: React.ReactNode) => void;
  setGames: React.Dispatch<React.SetStateAction<Game[]>>;
  onOpenChiaki: () => void;
  onOpenXcloud: () => void;
}

const PLATS = [
  { id: 'steam',  name: 'Steam',      icon: 'S', color: '#1b2838', apiKeyLabel: 'API Key (optional — for private profiles)', apiKeyHelp: 'Only needed if your Steam profile is set to private. Get your key at steamcommunity.com/dev/apikey — register any domain name (e.g. "cereal-launcher").', apiKeyUrl: 'https://steamcommunity.com/dev/apikey', note: 'Sign in to import your library. An API key is only needed for private profiles.' },
  { id: 'gog',   name: 'GOG',        icon: 'G', color: '#3a1a50' },
  { id: 'epic',  name: 'Epic Games', icon: 'E', color: '#2a2a2a', note: "Epic's developer APIs require special registration and may limit library imports." },
  { id: 'xbox',  name: 'Xbox',       icon: 'X', color: '#0e6a0e' },
  { id: 'psn',   name: 'PlayStation',icon: 'P', color: '#003087', noLogin: true },
  { id: 'ea',       name: 'EA App',          icon: 'EA', color: '#0f6fc6', note: 'Scans your local EA App installation for installed games.' },
  { id: 'battlenet', name: 'Battle.net',     icon: 'BN', color: '#148eff', note: 'Scans your local Battle.net installation for installed games.' },
  { id: 'itchio',   name: 'itch.io',         icon: 'io', color: '#e8395c', apiKeyLabel: 'API Key (optional)', apiKeyHelp: 'An itch.io API key enables importing your full purchased games library.', apiKeyUrl: 'https://itch.io/user/settings/api-keys', note: 'Scans locally installed itch.io games.' },
  { id: 'ubisoft',  name: 'Ubisoft Connect', icon: 'U',  color: '#003791', note: 'Scans your local Ubisoft Connect installation for installed games.' },
] as const;

interface PlatState { status: string; games?: number; chiaki?: any; cloudUrl?: string; appFound?: boolean; }
interface ApiKeyState { input: string; saved: string | null; status: string | null; }

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
  const [importProgress, setImportProgress] = useState<{ provider: string; status: string; processed: number; imported: number; updated: number; message?: string; total?: number } | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, ApiKeyState>>({});
  const [platFilter, setPlatFilter] = useState('');

  useEffect(() => {
    if (!show) return;
    (async () => {
      if (window.api?.getAccounts) { const a = await (window.api as any).getAccounts(); setAccounts(a || {}); }
      const p: Record<string, PlatState> = { ...platforms };
      if (window.api) {
        try { const s = await (window.api as any).detectSteam(); p.steam = { status: s.games?.length ? 'connected' : 'not-found', games: s.games?.length || 0 }; } catch (_) { p.steam = { status: 'not-found', games: 0 }; }
        try { const ep = await (window.api as any).detectEpic(); p.epic = { status: ep.games?.length ? 'connected' : 'not-found', games: ep.games?.length || 0 }; } catch (_) { p.epic = { status: 'not-found', games: 0 }; }
        try { const g = await (window.api as any).detectGOG(); p.gog = { status: g.games?.length ? 'connected' : 'not-found', games: g.games?.length || 0 }; } catch (_) { p.gog = { status: 'not-found', games: 0 }; }
        try { const ch = await (window.api as any).getChiakiStatus(); p.psn = { status: ch.status === 'missing' ? 'not-found' : 'connected', chiaki: ch }; } catch (_) { p.psn = { status: 'not-found', chiaki: null }; }
        try { const xb = await (window.api as any).detectXbox(); p.xbox = { status: (xb.games?.length || xb.xboxAppFound) ? 'connected' : 'available', cloudUrl: xb.cloudGamingUrl || 'https://www.xbox.com/play', appFound: xb.xboxAppFound, games: xb.games?.length || 0 }; } catch (_) { p.xbox = { status: 'available', cloudUrl: 'https://www.xbox.com/play', appFound: false, games: 0 }; }
        try { const ea = await (window.api as any).detectEA(); p.ea = { status: ea.games?.length ? 'connected' : 'not-found', games: ea.games?.length || 0 }; } catch (_) { p.ea = { status: 'not-found', games: 0 }; }
        try { const bn = await (window.api as any).detectBattleNet(); p.battlenet = { status: bn.games?.length ? 'connected' : 'not-found', games: bn.games?.length || 0 }; } catch (_) { p.battlenet = { status: 'not-found', games: 0 }; }
        try { const io = await (window.api as any).detectItchio(); p.itchio = { status: io.games?.length ? 'connected' : 'not-found', games: io.games?.length || 0 }; } catch (_) { p.itchio = { status: 'not-found', games: 0 }; }
        try { const ub = await (window.api as any).detectUbisoft(); p.ubisoft = { status: ub.games?.length ? 'connected' : 'not-found', games: ub.games?.length || 0 }; } catch (_) { p.ubisoft = { status: 'not-found', games: 0 }; }
      }
      setPlatforms(p);
      if ((window.api as any)?.getApiKeyInfo) {
        const keys: Record<string, ApiKeyState> = {};
        for (const pid of ['steam', 'itchio']) {
          try { const r = await (window.api as any).getApiKeyInfo(pid); keys[pid] = { input: '', saved: r?.ok && r.hasSecret ? r.fingerprint : null, status: null }; } catch (_) { keys[pid] = { input: '', saved: null, status: null }; }
        }
        setApiKeys(keys);
      }
    })();
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const unsub = (window.api as any)?.onImportProgress?.((data: any) => {
      setImportProgress(data);
      if (data.status === 'done' || data.status === 'error') {
        setTimeout(() => setImportProgress(null), 2500);
      }
    });
    return () => { unsub?.(); };
  }, [show]);

  const refreshAccounts = async () => { if (window.api?.getAccounts) { const a = await (window.api as any).getAccounts(); setAccounts(a || {}); } };
  const setKeyField = (id: string, field: keyof ApiKeyState, val: any) => setApiKeys(prev => ({ ...prev, [id]: { ...(prev[id] || { input: '', saved: null, status: null }), [field]: val } }));

  const doAuth = async (id: string, name: string) => {
    setLoading(l => ({ ...l, [id]: true }));
    const r = await (window.api as any).platformAuth(id);
    setLoading(l => ({ ...l, [id]: false }));
    if (r.error === 'cancelled') return;
    if (r.error) { flash(name + ' sign-in failed: ' + r.error); return; }
    flash(name + ' connected' + (r.displayName || r.gamertag ? ': ' + (r.displayName || r.gamertag) : '') + ' — importing library...');
    await refreshAccounts(); // show connected UI before import starts
    await doImport(id);     // auto-import after connecting
  };

  const doImport = async (id: string) => {
    setImporting(id);
    const r = await (window.api as any).platformImport(id);
    setImporting('');
    if (r.error) { flash(r.error); return; }
    if (r.games) setGames(r.games);
    const added = r.imported?.length || 0;
    const updated = r.updated?.length || 0;
    flash(added + updated > 0
      ? 'Imported ' + added + ' new, ' + updated + ' updated'
      : 'Library already up to date');
    refreshAccounts();
  };

  const doDisconnect = async (id: string, name: string) => { await (window.api as any).removeAccount(id); refreshAccounts(); flash(name + ' disconnected'); };

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
    if (r?.ok) { setKeyField(id, 'input', ''); setKeyField(id, 'saved', r.fingerprint || '✓'); flash('Key saved securely'); } else flash('Save failed: ' + r?.error);
  };
  const doDeleteKey = async (id: string) => {
    const r = await (window.api as any).deleteApiKey(id);
    if (r?.ok) { setKeyField(id, 'saved', null); setKeyField(id, 'input', ''); flash('Key deleted'); } else flash('Delete failed');
  };
  const doPasteKey = async (id: string) => {
    if (!window.api?.readClipboard) return flash('Clipboard not available');
    const txt = await (window.api as any).readClipboard();
    if (!txt) return flash('Clipboard empty');
    const candidate = txt.trim();
    setKeyField(id, 'input', candidate); setKeyField(id, 'status', 'checking');
    const vr = await (window.api as any).validateApiKey(id, candidate);
    if (vr?.ok) { const sr = await (window.api as any).saveApiKey(id, candidate); if (sr?.ok) { setKeyField(id, 'input', ''); setKeyField(id, 'saved', sr.fingerprint || '✓'); setKeyField(id, 'status', 'valid'); flash('Pasted key validated and saved'); } else flash('Pasted key validated but save failed'); }
    else { setKeyField(id, 'status', 'invalid'); flash('Pasted key invalid'); }
  };

  const showPlat = (name: string) => { const q = (platFilter || '').trim().toLowerCase(); return !q || name.toLowerCase().includes(q); };
  const connDot = (connected: boolean, pdata: PlatState | undefined, id: string) => connected ? 'ok' : (pdata?.games || id === 'xbox') ? 'warn' : 'off';

  const ApiKeyRow = ({ id, label, help, url }: { id: string; label: string; help?: string; url?: string }) => {
    const k = apiKeys[id] || {} as ApiKeyState;
    const statusColor = k.status === 'valid' ? 'var(--green)' : k.status && k.status !== 'checking' ? 'var(--red)' : 'var(--text-3)';
    return (
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--glass-border)' }}>
        <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
        {help && <div style={{ fontSize: 10, color: 'var(--text-4)', lineHeight: 1.6, marginBottom: 8 }}>{help}{url && <> <a href="#" onClick={e => { e.preventDefault(); (window.api as any)?.openExternal?.(url); }} style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}>Get your key here</a></>}</div>}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="password" value={k.input || ''} onChange={e => setKeyField(id, 'input', e.target.value)} placeholder={k.saved ? `••••••••${k.saved}` : 'Paste key'} style={{ flex: 1, fontSize: 11 }} />
          <button className="btn-flat" onClick={() => doPasteKey(id)}>Paste</button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
          <button className="btn-sm" onClick={() => doValidateKey(id)}>Validate</button>
          <button className="btn-sm primary" onClick={() => doSaveKey(id)}>Save</button>
          {k.saved && <button className="btn-sm danger" onClick={() => doDeleteKey(id)}>Delete</button>}
          {k.status && <span style={{ fontSize: 10, color: statusColor, marginLeft: 4 }}>{k.status}</span>}
        </div>
        {k.saved && <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-4)' }}>Saved: ••••••••{k.saved}</div>}
      </div>
    );
  };

  const PlatformSection = ({ plat }: { plat: typeof PLATS[number] }) => {
    const { id, name, icon, color } = plat;
    const p = plat as any;
    const acct = accounts[id] || {};
    const connected = acct.connected;
    const pdata = platforms[id];
    const isLoading = loading[id];
    const isImporting = importing === id;
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div className="conn-icon" style={{ background: color, width: 28, height: 28, fontSize: 11, flexShrink: 0 }}>{icon}</div>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{name}</div>
          {!p.apiKeyOnly && <div className={'conn-dot ' + connDot(connected, pdata, id)} />}
        </div>
        <div style={{ padding: '12px 14px', borderRadius: '10px', background: 'var(--glass)', border: '1px solid var(--glass-border)' }}>
          {id === 'psn' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: 'var(--text)' }}>PlayStation Remote Play</div>
                  <div style={{ fontSize: 10, color: 'var(--text-4)' }}>{pdata?.chiaki ? 'chiaki-ng v' + (pdata.chiaki.version || '') : 'Not configured'}</div>
                </div>
                <div className={'conn-dot ' + (pdata?.status === 'connected' ? 'ok' : pdata?.status === 'checking' ? 'warn' : 'off')} />
              </div>
              <button className="btn-sm" onClick={() => { onClose(); onOpenChiaki(); }} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <span style={{ display: 'flex', width: 14, height: 14 }}>{I.gear}</span><span>Configure chiaki-ng</span>
              </button>
            </div>
          )}
          {!p.apiKeyOnly && !p.noLogin && (connected ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                {acct.avatarUrl ? <img src={acct.avatarUrl} style={{ width: 36, height: 36, borderRadius: '50%', border: '2px solid ' + color }} /> : <div className="conn-icon" style={{ background: color, width: 36, height: 36, fontSize: 13 }}>{icon}</div>}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{acct.displayName || acct.gamertag || name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{acct.gameCount ? acct.gameCount + ' games' : 'Connected'}{pdata?.games ? ' · ' + pdata.games + ' installed' : ''}</div>
                  {acct.lastSync && <div style={{ fontSize: 9, color: 'var(--text-4)' }}>Synced {fmtDate(acct.lastSync)}</div>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-accent" onClick={() => doImport(id)} disabled={isImporting} style={{ flex: 1 }}>{isImporting ? <><span className="spinner" style={{ marginRight: 6 }} />Importing...</> : 'Import Library'}</button>
                <button className="btn-flat danger" onClick={() => doDisconnect(id, name)}>Disconnect</button>
              </div>
              {isImporting && importProgress && importProgress.provider === id && (
                <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-2, rgba(255,255,255,0.04))', border: '1px solid var(--glass-border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{importProgress.message || 'Processing…'}</span>
                    {importProgress.total ? <span style={{ fontSize: 10, color: 'var(--text-4)' }}>{importProgress.processed} / {importProgress.total}</span> : null}
                  </div>
                  <div style={{ height: 3, borderRadius: 2, background: 'var(--glass-border)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 2, background: 'var(--accent)', width: importProgress.total ? `${Math.round((importProgress.processed / importProgress.total) * 100)}%` : '100%', transition: 'width 0.3s ease', animation: importProgress.total ? 'none' : 'progress-pulse 1.5s ease-in-out infinite' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 5 }}>
                    <span style={{ fontSize: 10, color: 'var(--green, #4ade80)' }}>+{importProgress.imported} new</span>
                    <span style={{ fontSize: 10, color: 'var(--accent)' }}>{importProgress.updated} updated</span>
                  </div>
                </div>
              )}
              {id === 'xbox' && <div style={{ marginTop: 10 }}><div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 6 }}>Cloud gaming requires an active Xbox Game Pass Ultimate subscription.</div><button className="btn-sm" onClick={() => { onClose(); onOpenXcloud(); }} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><span style={{ display: 'flex', width: 14, height: 14 }}>{I.globe}</span><span>Xbox Cloud Gaming</span></button></div>}
              {p.note && <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-4)', lineHeight: 1.5 }}>{p.note}</div>}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10 }}>{pdata?.games ? pdata.games + ' games detected locally' : 'Not connected'}</div>
              <button className="btn-accent" onClick={() => doAuth(id, name)} disabled={isLoading} style={{ width: '100%' }}>{isLoading ? <><span className="spinner" style={{ marginRight: 6 }} />Signing in...</> : 'Sign in with ' + name}</button>
              {id === 'xbox' && <div style={{ marginTop: 8 }}><button className="btn-sm" onClick={() => { onClose(); onOpenXcloud(); }} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><span style={{ display: 'flex', width: 14, height: 14 }}>{I.globe}</span><span>Xbox Cloud Gaming</span></button></div>}
              {p.note && <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5 }}>{p.note}</div>}
            </div>
          ))}
          {p.apiKeyLabel && <ApiKeyRow id={id} label={p.apiKeyLabel} help={p.apiKeyHelp} url={p.apiKeyUrl} />}
        </div>
      </div>
    );
  };

  return (
    <SidePanel show={show} onClose={onClose} title="Platforms" wide>
      <div className="field" style={{ marginBottom: 12 }}><label>Filter platforms</label><input value={platFilter} onChange={e => setPlatFilter(e.target.value)} placeholder="Filter platforms..." /></div>
      {PLATS.filter(p => showPlat(p.name)).map(p => <PlatformSection key={p.id} plat={p} />)}
    </SidePanel>
  );
}
