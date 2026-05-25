import { useEffect } from 'react';

interface ShortcutsHelpProps {
  show: boolean;
  onClose: () => void;
}

interface ShortcutDef {
  keys: string[];
  desc: string;
}

interface ShortcutGroup {
  title: string;
  rows: ShortcutDef[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Library',
    rows: [
      { keys: ['Ctrl', 'K'],         desc: 'Search games' },
      { keys: ['Ctrl', 'F'],         desc: 'Search games' },
      { keys: ['Ctrl', 'N'],         desc: 'Add a new game' },
      { keys: ['Ctrl', 'Shift', 'R'],desc: 'Random pick' },
      { keys: ['Ctrl', ','],         desc: 'Open Settings' },
    ],
  },
  {
    title: 'Tabs',
    rows: [
      { keys: ['Ctrl', '1'], desc: 'Switch to tab 1' },
      { keys: ['Ctrl', '2..9'], desc: 'Switch to tabs 2–9' },
      { keys: ['Ctrl', 'W'], desc: 'Close current tab' },
    ],
  },
  {
    title: 'Game details',
    rows: [
      { keys: ['Enter'],       desc: 'Play / launch' },
      { keys: ['F'],           desc: 'Favorite / unfavorite' },
      { keys: ['E'],           desc: 'Edit' },
      { keys: ['H'],           desc: 'Hide / unhide' },
      { keys: ['Del'],         desc: 'Remove from library' },
      { keys: ['Esc'],         desc: 'Close' },
    ],
  },
  {
    title: 'Anywhere',
    rows: [
      { keys: ['?'],         desc: 'Show this help' },
      { keys: ['Esc'],       desc: 'Close menus / overlays' },
    ],
  },
];

function Kbd({ k }: { k: string }) {
  return <kbd className="shortcut-kbd">{k}</kbd>;
}

export function ShortcutsHelp({ show, onClose }: ShortcutsHelpProps) {
  useEffect(() => {
    if (!show) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div className="shortcuts-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="shortcuts-panel" onClick={e => e.stopPropagation()}>
        <div className="shortcuts-head">
          <div>
            <div className="shortcuts-eyebrow">Keyboard</div>
            <h2 className="shortcuts-title">Shortcuts</h2>
          </div>
          <button className="shortcuts-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="shortcuts-grid">
          {GROUPS.map(g => (
            <section key={g.title} className="shortcuts-group">
              <div className="shortcuts-group-title">{g.title}</div>
              <ul className="shortcuts-list">
                {g.rows.map((r, i) => (
                  <li key={i} className="shortcuts-row">
                    <span className="shortcuts-desc">{r.desc}</span>
                    <span className="shortcuts-keys">
                      {r.keys.map((k, j) => (
                        <span key={j} className="shortcuts-keys-grp">
                          <Kbd k={k} />
                          {j < r.keys.length - 1 && <span className="shortcuts-plus">+</span>}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="shortcuts-foot">Press <kbd className="shortcut-kbd">Esc</kbd> or <kbd className="shortcut-kbd">?</kbd> to close.</div>
      </div>
    </div>
  );
}
