import React, { useState, useEffect, useRef } from 'react';

interface SidePanelProps {
  show: boolean;
  onClose: () => void;
  title: string;
  /** Width preset: default 480px, `wide` 560px, `xwide` 720px (clamped to 92vw). */
  wide?: boolean;
  xwide?: boolean;
  headActions?: React.ReactNode;
  children?: React.ReactNode;
  foot?: React.ReactNode;
  /** Hide the default "panel-body" padding (caller controls spacing). */
  bare?: boolean;
  /**
   * 'overlay' (default) — slides in from the right, dims the rest of the app.
   * 'tab'              — renders inline as the active tab's content. No
   *                      backdrop, no slide animation, no close-X button (the
   *                      enclosing TabBar owns closing).
   */
  mode?: 'overlay' | 'tab';
}

export function SidePanel({ show, onClose, title, wide, xwide, headActions, children, foot, bare, mode = 'overlay' }: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(show);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (mode === 'tab') {
      setVisible(show);
      setClosing(false);
      return;
    }
    if (show) { setVisible(true); setClosing(false); }
    else if (visible) setClosing(true);
    // visible isn't a dep on purpose — see overlay close logic
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, mode]);

  useEffect(() => {
    if (!show || mode === 'tab') return;
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
  }, [show, mode, onClose]);

  if (!visible) return null;

  const sizeCls = xwide ? ' xwide' : wide ? ' wide' : '';
  const bodyCls = 'panel-body' + (bare ? ' bare' : '');

  if (mode === 'tab') {
    return (
      <div
        className={'side-panel tab-mode' + sizeCls}
        ref={panelRef}
        role="region"
        aria-label={title}
      >
        <div className="panel-head">
          <h3>{title}</h3>
          <div className="panel-head-actions">{headActions}</div>
        </div>
        <div className={bodyCls}>{children}</div>
        {foot && <div className="panel-foot">{foot}</div>}
      </div>
    );
  }

  return (
    <>
      <div className={'panel-backdrop' + (closing ? ' closing' : '')} onClick={onClose} />
      <div
        className={'side-panel' + sizeCls + (closing ? ' closing' : '')}
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
        <div className={bodyCls}>{children}</div>
        {foot && <div className="panel-foot">{foot}</div>}
      </div>
    </>
  );
}
