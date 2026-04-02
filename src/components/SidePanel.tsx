import React, { useState, useEffect, useRef } from 'react';

interface SidePanelProps {
  show: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  headActions?: React.ReactNode;
  children?: React.ReactNode;
  foot?: React.ReactNode;
}

export function SidePanel({ show, onClose, title, wide, headActions, children, foot }: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(show);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (show) { setVisible(true); setClosing(false); }
    else if (visible) setClosing(true);
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button,input,select,textarea,[tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [show]);

  if (!visible) return null;

  return (
    <>
      <div className={'panel-backdrop' + (closing ? ' closing' : '')} onClick={onClose} />
      <div
        className={'side-panel' + (wide ? ' wide' : '') + (closing ? ' closing' : '')}
        ref={panelRef}
        role="dialog"
        aria-label={title}
        onAnimationEnd={() => { if (closing) setVisible(false); }}
      >
        <div className="panel-head">
          <h3>{title}</h3>
          <div className="panel-head-actions">
            {headActions}
            <button className="panel-close" onClick={onClose} aria-label="Close panel">&times;</button>
          </div>
        </div>
        <div className="panel-body">{children}</div>
        {foot && <div className="panel-foot">{foot}</div>}
      </div>
    </>
  );
}
