import React, { useEffect, useRef, useState } from 'react';

export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  /** Label shown on the button (e.g. "Undo"). */
  label: string;
  /** Click handler. The toast is auto-dismissed afterwards. */
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  msg: React.ReactNode;
  severity: ToastSeverity;
  /** Milliseconds before auto-dismiss. Defaults to 3500 (5500 for action toasts so users can react). */
  duration: number;
  action?: ToastAction;
}

interface SingleToastProps {
  item: ToastItem;
  onDismiss: (id: number) => void;
}

/**
 * Single stacked toast. Pauses its auto-dismiss timer while the cursor hovers,
 * so users always get a fair chance to read or click "Undo".
 */
function SingleToast({ item, onDismiss }: SingleToastProps) {
  const [paused, setPaused] = useState(false);
  const [closing, setClosing] = useState(false);
  const remainingRef = useRef(item.duration);
  const startedAtRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const begin = (ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => doClose(), ms);
  };

  const doClose = () => {
    setClosing(true);
    setTimeout(() => onDismiss(item.id), 240);
  };

  useEffect(() => {
    begin(item.duration);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    if (paused) {
      if (timerRef.current) clearTimeout(timerRef.current);
      remainingRef.current = Math.max(500, remainingRef.current - (Date.now() - startedAtRef.current));
    } else if (remainingRef.current > 0) {
      begin(remainingRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  return (
    <div
      className={'toast toast-' + item.severity + (closing ? ' closing' : '')}
      role={item.severity === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="toast-dot" aria-hidden />
      <span className="toast-msg">{item.msg}</span>
      {item.action && (
        <button
          className="toast-action"
          onClick={() => { item.action?.onClick(); doClose(); }}
        >
          {item.action.label}
        </button>
      )}
      <button
        className="toast-close"
        onClick={doClose}
        aria-label="Dismiss"
        title="Dismiss"
      >×</button>
    </div>
  );
}

interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

/** Stacked toast container. New toasts appear at the bottom. */
export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map(t => (
        <SingleToast key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
