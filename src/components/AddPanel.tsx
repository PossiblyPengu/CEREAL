import { useState, useEffect } from 'react';
import { SidePanel } from './SidePanel';
import { PLATFORMS, STREAMING_PLATFORMS, I } from '../constants';
import type { Game } from '../types';

interface ArtPickerOpts {
  gameName: string;
  platform: string;
  field: 'coverUrl' | 'headerUrl';
  autoSave?: boolean;
}

interface AddPanelProps {
  show: boolean;
  onClose: () => void;
  onSave: (f: Partial<Game>) => Promise<Game | void>;
  categories: string[];
  editGame?: Game | null;
  flash: (msg: React.ReactNode) => void;
  onOpenArtPicker: (opts: ArtPickerOpts) => Promise<string | null>;
  onUpdated?: (game: Game) => void;
}

const emptyForm = () => ({
  name: '', platform: 'custom', executablePath: '', coverUrl: '', categories: [] as string[],
  platformId: '', description: '', developer: '', publisher: '', releaseDate: '',
  headerUrl: '', metacritic: '', website: '', notes: '',
});

export function AddPanel({ show, onClose, onSave, categories, editGame, flash, onOpenArtPicker, onUpdated }: AddPanelProps) {
  const [f, setF] = useState(emptyForm());
  const [showMeta, setShowMeta] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (editGame) {
      const g = editGame as any;
      setF({ ...emptyForm(), ...g, categories: g.categories || [], metacritic: g.metacritic != null ? String(g.metacritic) : '' });
      setShowMeta(!!(g.description || g.developer));
    } else {
      setF(emptyForm());
      setShowMeta(false);
    }
  }, [editGame, show]);

  const toggle = (c: string) => setF(p => ({ ...p, categories: p.categories.includes(c) ? p.categories.filter(x => x !== c) : [...p.categories, c] }));

  const browse = async () => {
    if (window.api) {
      const p = await (window.api as any).pickExecutable();
      if (p) setF(x => {
        const filename = p.split(/[/\\]/).pop()?.replace(/\.exe$/i, '').replace(/[-_.]+/g, ' ').replace(/\s{2,}/g, ' ').trim() || '';
        return { ...x, executablePath: p, name: x.name || filename };
      });
    }
  };

  const browseImg = async (field: string) => {
    if (window.api) {
      const p = await (window.api as any).pickImage();
      if (p) setF(x => ({ ...x, [field]: p }));
    }
  };

  const doFetch = async () => {
    if (!editGame || !window.api?.applyMetadata) return;
    setFetching(true);
    try {
      const r = await (window.api as any).applyMetadata(editGame.id, false);
      if (r?.success && r.game) {
        setF(prev => ({ ...prev, ...r.game, categories: r.game.categories || prev.categories, metacritic: r.game.metacritic != null ? String(r.game.metacritic) : prev.metacritic }));
        setShowMeta(true);
        flash('Metadata fetched');
      } else if (r?.error) { flash('No metadata found'); }
    } catch (_) {}
    setFetching(false);
  };

  const doFetchForNew = async () => {
    if (!f.name.trim() || !(window.api as any)?.fetchMetadataForName) return;
    setFetching(true);
    try {
      const r = await (window.api as any).fetchMetadataForName(f.name, f.platform, (f as any).platformId || '');
      if (r?.success && r.meta) {
        const meta = r.meta;
        setF(prev => ({
          ...prev,
          coverUrl: prev.coverUrl || meta.coverUrl || meta.headerUrl || '',
          headerUrl: (prev as any).headerUrl || meta.headerUrl || meta.coverUrl || '',
          description: (prev as any).description || meta.description || '',
          developer: (prev as any).developer || meta.developer || '',
          publisher: (prev as any).publisher || meta.publisher || '',
          releaseDate: (prev as any).releaseDate || meta.releaseDate || '',
          metacritic: prev.metacritic || (meta.metacritic != null ? String(meta.metacritic) : ''),
          categories: prev.categories.length ? prev.categories : (meta.genres || []),
          website: (prev as any).website || meta.website || '',
        }));
        setShowMeta(true);
        flash('Metadata filled in');
      } else { flash('No metadata found'); }
    } catch (_) {}
    setFetching(false);
  };

  const handleSave = () => {
    if (!f.name.trim()) return;
    const out: any = { ...f, metacritic: f.metacritic ? Number(f.metacritic) : null };
    if (!out.metacritic && out.metacritic !== 0) delete out.metacritic;
    (async () => {
      try {
        const res = await onSave(out);
        if (typeof onUpdated === 'function') onUpdated((res || out) as Game);
      } catch (e: any) { flash('Save failed: ' + (e?.message || e)); }
    })();
  };

  const artSearch = async (field: 'coverUrl' | 'headerUrl') => {
    if (!f.name.trim()) return;
    try {
      const url = await onOpenArtPicker({ gameName: f.name, platform: f.platform, field, autoSave: !!editGame });
      if (url) {
        if (editGame) {
          const out: any = { ...f, [field]: url, metacritic: f.metacritic ? Number(f.metacritic) : null };
          if (!out.metacritic && out.metacritic !== 0) delete out.metacritic;
          try { const res = await onSave(out); if (typeof onUpdated === 'function') onUpdated((res || out) as Game); } catch (e: any) { flash('Save failed: ' + (e?.message || e)); }
        } else {
          setF(p => ({ ...p, [field]: url }));
        }
      }
    } catch (e: any) { flash('Art search failed: ' + (e?.message || e)); }
  };

  const chevron = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>;

  return (
    <SidePanel show={show} onClose={onClose} title={editGame ? 'Edit Game' : 'Add Game'}
      foot={<><button className="btn-flat" onClick={onClose}>Cancel</button><button className="btn-accent" onClick={handleSave}>{editGame ? 'Update' : 'Add'}</button></>}
    >
      <div className="field"><label>Name</label><input value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} placeholder="Game title" /></div>
      <div className="field"><label>Platform</label>
        <select value={f.platform} onChange={e => setF(p => ({ ...p, platform: e.target.value }))}>
          {Object.keys(PLATFORMS).filter(k => !STREAMING_PLATFORMS.includes(k)).map(k => <option key={k} value={k}>{PLATFORMS[k].label}</option>)}
        </select>
      </div>
      {['steam', 'epic', 'gog'].includes(f.platform) && <div className="field"><label>Platform ID</label><input value={(f as any).platformId || ''} onChange={e => setF(p => ({ ...p, platformId: e.target.value }))} placeholder="App ID" /></div>}
      {f.platform === 'custom' && (
        <div className="field"><label>Executable</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input value={f.executablePath || ''} onChange={e => setF(p => ({ ...p, executablePath: e.target.value }))} placeholder="Path to .exe" style={{ flex: 1 }} />
            <button className="btn-flat" onClick={browse}>Browse</button>
          </div>
        </div>
      )}
      <div className="field"><label>Cover Image</label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input value={f.coverUrl || ''} onChange={e => setF(p => ({ ...p, coverUrl: e.target.value }))} placeholder="URL or file path" style={{ flex: 1 }} />
          <button className="btn-flat" onClick={() => browseImg('coverUrl')}>File</button>
          <button className="btn-sm primary" onClick={() => artSearch('coverUrl')} disabled={!f.name.trim()}>Search</button>
        </div>
        {f.coverUrl && <img className="cover-preview" src={f.coverUrl} alt="" onError={e => (e.target as HTMLImageElement).style.display = 'none'} onLoad={e => (e.target as HTMLImageElement).style.display = 'block'} />}
      </div>
      <div className="field"><label>Categories</label>
        <div className="tag-row">{(categories || []).map(c => <button key={c} className={'tag' + (f.categories.includes(c) ? ' sel' : '')} onClick={() => toggle(c)}>{c}</button>)}</div>
      </div>
      <div className="field"><label>Notes</label><textarea value={(f as any).notes || ''} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} placeholder="Personal notes about this game..." rows={2} /></div>
      <button className={'meta-toggle' + (showMeta ? ' open' : '')} onClick={() => setShowMeta(!showMeta)}>
        {chevron} Metadata
        <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 400, color: 'var(--text-4)', textTransform: 'none', letterSpacing: 0 }}>{fetching ? 'Fetching...' : 'Auto-fill from web'}</span>
        <button className="btn-sm" style={{ padding: '3px 10px', marginLeft: 8, opacity: (f.name.trim() && !fetching) ? 1 : 0.4 }} onClick={e => { e.stopPropagation(); if (!f.name.trim() || fetching) return; editGame ? doFetch() : doFetchForNew(); }}>{I.download}</button>
      </button>
      {showMeta && (
        <div className="meta-section">
          <div className="field"><label>Description</label><textarea value={(f as any).description || ''} onChange={e => setF(p => ({ ...p, description: e.target.value }))} placeholder="Game description" rows={3} /></div>
          <div className="field-row">
            <div className="field"><label>Developer</label><input value={(f as any).developer || ''} onChange={e => setF(p => ({ ...p, developer: e.target.value }))} placeholder="Studio name" /></div>
            <div className="field"><label>Publisher</label><input value={(f as any).publisher || ''} onChange={e => setF(p => ({ ...p, publisher: e.target.value }))} placeholder="Publisher name" /></div>
          </div>
          <div className="field-row">
            <div className="field"><label>Release Date</label><input value={(f as any).releaseDate || ''} onChange={e => setF(p => ({ ...p, releaseDate: e.target.value }))} placeholder="e.g. Dec 10, 2020" /></div>
            <div className="field"><label>Metacritic</label><input type="number" min={0} max={100} value={f.metacritic || ''} onChange={e => setF(p => ({ ...p, metacritic: e.target.value }))} placeholder="0-100" /></div>
          </div>
          <div className="field"><label>Header Image</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input value={(f as any).headerUrl || ''} onChange={e => setF(p => ({ ...p, headerUrl: e.target.value }))} placeholder="Wide banner URL" style={{ flex: 1 }} />
              <button className="btn-flat" onClick={() => browseImg('headerUrl')}>File</button>
              <button className="btn-sm primary" onClick={() => artSearch('headerUrl')} disabled={!f.name.trim()}>Search</button>
            </div>
            <div className="field-hint">Used as blurred background in game detail view</div>
            {(f as any).headerUrl && <img className="cover-preview" src={(f as any).headerUrl} alt="" onError={e => (e.target as HTMLImageElement).style.display = 'none'} onLoad={e => (e.target as HTMLImageElement).style.display = 'block'} />}
          </div>
          <div className="field"><label>Website</label><input value={(f as any).website || ''} onChange={e => setF(p => ({ ...p, website: e.target.value }))} placeholder="https://..." /></div>
        </div>
      )}
    </SidePanel>
  );
}
