import React, { useEffect } from 'react';

interface ToastProps {
  msg: React.ReactNode;
  onDone: () => void;
}

export function Toast({ msg, onDone }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);
  return <div className="toast">{msg}</div>;
}
