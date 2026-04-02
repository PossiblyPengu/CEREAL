import { useState, useEffect } from 'react';
import { SidePanel } from './SidePanel';
import { platformLabel } from '../utils';
import type { Game } from '../types';

interface DetectPanelProps {
  show: boolean;
  onClose: () => void;
  onImport: (games: Game[]) => void;
}

export function DetectPanel({ show, onClose, onImport }: DetectPanelProps) {
  const [results, setResults] = useState<Game[]>([]);
  const [sel, setSel] = useState(new Set<number>());
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!show) return;
    (async () => {
      if (!window.api) { setStatus('err:Detection requires Electron'); return; }
      setResults([]); setSel(new Set());
      const all: Game[] = [];
      const scan = async (label: string, fn: () => Promise<any>) => {
        setStatus('scanning:Scanning ' + label + '...');
        try { const r = await fn(); if (r?.games) all.push(...r.games); } catch (_) {}
      };
      await scan('Steam',          () => (window.api as any).detectSteam());
      await scan('Epic Games',     () => (window.api as any).detectEpic());
      await scan('GOG',            () => (window.api as any).detectGOG());
      await scan('Xbox',           () => (window.api as any).detectXbox());
      await scan('EA App',         () => (window.api as any).detectEA());
      await scan('Battle.net',     () => (window.api as any).detectBattleNet());
      await scan('itch.io',        () => (window.api as any).detectItchio());
      await scan('Ubisoft Connect',() => (window.api as any).detectUbisoft());
      setResults(all); setSel(new Set(all.map((_, i) => i)));
      setStatus(all.length ? 'done:Found ' + all.length + ' games' : 'done:No games detected');
    })();
  }, [show]);

  const toggleSel = (i: number) => setSel(p => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const [st, ...smParts] = status.split(':');
  const sm = smParts.join(':');

  return (
    <SidePanel show={show} onClose={onClose} title="Detect Games"
      foot={results.length > 0 ? <button className="btn-accent" onClick={() => onImport(results.filter((_, i) => sel.has(i)))}>Import {sel.size}</button> : undefined}
    >
      {sm && (
        <div className={'detect-status ' + st}>
          {st === 'scanning' ? <><span className="spinner" style={{ marginRight: 8 }} />{sm}</> : sm}
        </div>
      )}
      {results.map((g, i) => (
        <div key={i} className="conn-card" style={{ cursor: 'pointer' }} onClick={() => toggleSel(i)}>
          <input type="checkbox" checked={sel.has(i)} readOnly style={{ accentColor: 'var(--accent)' }} />
          <div className="conn-info">
            <div className="conn-name">{g.name}</div>
            <div className="conn-detail">{platformLabel(g.platform)}{g.platformId ? ' / ' + g.platformId : ''}</div>
          </div>
        </div>
      ))}
    </SidePanel>
  );
}
