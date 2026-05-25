import { useState } from 'react';
import { PLATFORMS } from '../constants';
import type { Platform } from '../types';

interface Tab {
  id: string;
  title: string;
  closable: boolean;
  platform: string | null;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  /** Optional reorder callback. Receives the next tab order. Non-closable tabs (e.g. the
   *  launcher) are guaranteed to keep their leading position. */
  onReorder?: (tabs: Tab[]) => void;
}

const GLOBE_ICON = (
  <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="7" cy="7" r="5.5" />
    <path d="M7 1.5c-1.5 2-1.5 9 0 11M7 1.5c1.5 2 1.5 9 0 11M1.5 7h11" />
  </svg>
);

const CEREAL_ICON = (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="5.5" cy="7" r="1.2" fill="currentColor" opacity="0.8" />
    <circle cx="8" cy="5.5" r="1" fill="currentColor" opacity="0.6" />
    <circle cx="10.5" cy="7.5" r="1.3" fill="currentColor" />
    <circle cx="8" cy="10" r="1" fill="currentColor" opacity="0.7" />
  </svg>
);

const CLOSE_X = (
  <svg viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M1 1l6 6M7 1l-6 6" />
  </svg>
);

const WIN_ICONS = {
  min: <svg viewBox="0 0 10 1" width="10" height="1" fill="currentColor"><rect width="10" height="1" /></svg>,
  max: <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9" /></svg>,
  close: <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><path d="M1 1l8 8M9 1l-8 8" /></svg>,
};

export function TabBar({ tabs, activeTab, onSwitch, onClose, onReorder }: TabBarProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const reorder = (fromId: string, toId: string) => {
    if (!onReorder || fromId === toId) return;
    const next = tabs.slice();
    const fromIdx = next.findIndex(t => t.id === fromId);
    const toIdx = next.findIndex(t => t.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    // Keep non-closable tabs (launcher) anchored at the start, regardless of drop site.
    next.sort((a, b) => (a.closable === b.closable ? 0 : a.closable ? 1 : -1));
    onReorder(next);
  };

  return (
    <div className="tab-bar">
      <div className="tab-list">
        {tabs.map(tab => {
          const isActive = tab.id === activeTab;
          const plat: Platform | undefined = tab.platform ? PLATFORMS[tab.platform] : undefined;
          const platColor = plat?.color || 'var(--accent)';
          const glowColor = tab.id === 'launcher' ? 'var(--accent)' : platColor;
          const platIcon = plat?.icon ?? GLOBE_ICON;
          const icon = tab.id === 'launcher' ? CEREAL_ICON : platIcon;
          const draggable = tab.closable && !!onReorder;
          return (
            <div
              key={tab.id}
              className={'tab-item' + (isActive ? ' active' : '') + (dragId === tab.id ? ' dragging' : '') + (overId === tab.id && dragId !== tab.id ? ' drag-over' : '')}
              onClick={() => onSwitch(tab.id)}
              onMouseDown={e => {
                // Middle-click closes the tab — standard browser behaviour.
                if (e.button === 1 && tab.closable) { e.preventDefault(); onClose(tab.id); }
              }}
              onAuxClick={e => {
                if (e.button === 1 && tab.closable) { e.preventDefault(); onClose(tab.id); }
              }}
              title={tab.title}
              style={isActive ? { boxShadow: 'inset 0 1.5px 0 ' + glowColor } : undefined}
              draggable={draggable}
              onDragStart={draggable ? e => {
                setDragId(tab.id);
                e.dataTransfer.effectAllowed = 'move';
                // Setting some payload keeps Firefox/Chromium happy.
                try { e.dataTransfer.setData('text/plain', tab.id); } catch (_e) { /* ignore */ }
              } : undefined}
              onDragOver={draggable ? e => {
                if (!dragId || !tab.closable) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (overId !== tab.id) setOverId(tab.id);
              } : undefined}
              onDragLeave={() => { if (overId === tab.id) setOverId(null); }}
              onDrop={draggable ? e => {
                e.preventDefault();
                if (dragId) reorder(dragId, tab.id);
                setDragId(null); setOverId(null);
              } : undefined}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
            >
              <span className="tab-icon-wrap">{icon}</span>
              <span className="tab-title">{tab.title}</span>
              {tab.closable && (
                <button
                  className="tab-close-btn"
                  onClick={e => { e.stopPropagation(); onClose(tab.id); }}
                  aria-label="Close tab"
                >
                  {CLOSE_X}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="tab-spacer" />
      <div className="tab-win-ctrls">
        {(['minimize', 'maximize'] as const).map(fn => (
          <button key={fn} onClick={() => (window.api as unknown as Record<string, () => void>)?.[fn]?.()} aria-label={fn}>
            {fn === 'minimize' ? WIN_ICONS.min : WIN_ICONS.max}
          </button>
        ))}
        <button className="tab-close-win" onClick={() => (window.api as unknown as Record<string, () => void>)?.close?.()} aria-label="Close">{WIN_ICONS.close}</button>
      </div>
    </div>
  );
}
