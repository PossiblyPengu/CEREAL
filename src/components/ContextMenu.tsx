import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

export interface ContextMenuItem {
  /** Display label. */
  label: string;
  /** Optional left-side icon. */
  icon?: React.ReactNode;
  /** Optional right-side hint (e.g. keyboard shortcut). */
  hint?: string;
  /** Renders the item with a danger color. */
  danger?: boolean;
  /** Disables clicks (e.g. for unavailable actions). */
  disabled?: boolean;
  /** Click handler. The menu auto-closes after invocation. */
  onClick?: () => void;
  /** Inserts a horizontal divider above this item (use { divider: true } shorthand). */
  divider?: boolean;
}

interface ContextMenuProps {
  /** Anchor position in viewport coordinates (typically clientX/clientY of the contextmenu event). */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * Lightweight portal-rendered context menu. Auto-flips so it stays on-screen,
 * closes on outside-click, Esc, blur, or scroll.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 6;
    const maxX = window.innerWidth - rect.width - pad;
    const maxY = window.innerHeight - rect.height - pad;
    setPos({ left: Math.max(pad, Math.min(x, maxX)), top: Math.max(pad, Math.min(y, maxY)) });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const handle = (item: ContextMenuItem) => {
    if (item.disabled || item.divider) return;
    item.onClick?.();
    onClose();
  };

  return ReactDOM.createPortal(
    <div ref={ref} className="ctx-menu" style={{ left: pos.left, top: pos.top }} role="menu">
      {items.map((it, i) => {
        if (it.divider) return <div key={'d-' + i} className="ctx-menu-divider" />;
        return (
          <button
            key={i}
            className={'ctx-menu-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '')}
            onClick={() => handle(it)}
            role="menuitem"
            disabled={it.disabled}
          >
            {it.icon && <span className="ctx-menu-icon">{it.icon}</span>}
            <span className="ctx-menu-label">{it.label}</span>
            {it.hint && <span className="ctx-menu-hint">{it.hint}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
