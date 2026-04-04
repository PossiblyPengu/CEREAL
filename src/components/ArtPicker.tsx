import { useState, useEffect, useRef } from 'react';

interface ArtImage {
  url: string;
  type?: string;
  source?: string;
  label?: string;
}

interface ArtPickerProps {
  gameName: string;
  platform: string;
  field: 'coverUrl' | 'headerUrl';
  onPick: (url: string) => void;
  onClose: () => void;
}

export function ArtPicker({ gameName, platform, field, onPick, onClose }: ArtPickerProps) {
  const [images, setImages] = useState<ArtImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(new Set<string>());
  const [query, setQuery] = useState(gameName || '');
  const filterType = field === 'coverUrl' ? 'cover' : 'header';
  const searchToken = useRef(0);

  useEffect(() => { setQuery(gameName || ''); }, [gameName]);

  const doSearch = async (q?: string) => {
    const term = (typeof q === 'string' ? q : query) || '';
    if (!term) { setImages([]); setLoading(false); return; }
    setLoading(true); setImages([]); setFailed(new Set());
    const token = ++searchToken.current;
    try {
      if (window.api?.searchArt) {
        const r = await (window.api as any).searchArt(term, platform);
        if (searchToken.current === token) setImages(r?.images || []);
      }
    } catch (_) {}
    if (searchToken.current === token) setLoading(false);
  };

  useEffect(() => { if (gameName) doSearch(gameName); }, [gameName, platform]);

  const sourcePrio: Record<string, number> = { SteamGridDB: 0 };
  const sorted = [...images].filter(img => !failed.has(img.url)).sort((a, b) => {
    const aMatch = a.type === filterType ? 0 : a.type === 'screenshot' ? 1 : 2;
    const bMatch = b.type === filterType ? 0 : b.type === 'screenshot' ? 1 : 2;
    if (aMatch !== bMatch) return aMatch - bMatch;
    return (sourcePrio[a.source!] ?? 9) - (sourcePrio[b.source!] ?? 9);
  });
  const gridClass = field === 'coverUrl' ? 'covers' : 'headers';

  return (
    <div className="art-picker">
      <div className="art-picker-head">
        <span className="art-picker-title" style={{ flex: '0 0 auto' }}>Select from online sources</span>
        <div style={{ flex: 1, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doSearch(); }} placeholder={gameName || 'Search term'} style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--glass-border)', background: 'var(--glass)', color: 'var(--text-2)', outline: 'none', transition: 'border-color var(--speed-normal)' }} />
          <button className="btn-flat" onClick={() => doSearch()} style={{ whiteSpace: 'nowrap' }}>Search</button>
        </div>
        <button className="art-picker-close" onClick={onClose}>&times;</button>
      </div>
      {loading && <div className="art-picker-loading"><span className="spinner" />Searching...</div>}
      {!loading && sorted.length === 0 && <div className="art-picker-empty">No images found. Try changing the game name.</div>}
      {!loading && sorted.length > 0 && (
        <div className={'art-picker-grid ' + gridClass}>
          {sorted.map(img => (
            <div key={img.url} className="art-pick" onClick={() => { onPick(img.url); onClose(); }} title={img.label}>
              <img src={img.url} alt="" loading="lazy" onError={() => setFailed(prev => new Set([...prev, img.url]))} />
              <div className="art-pick-source">{img.source}</div>
              <div className="art-pick-label">{img.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
