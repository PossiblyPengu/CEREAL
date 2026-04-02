import { useState, useEffect } from 'react';
import { SidePanel } from './SidePanel';

interface XcloudPanelProps {
  show: boolean;
  onClose: () => void;
  flash: (msg: React.ReactNode) => void;
}

export function XcloudPanel({ show, onClose, flash }: XcloudPanelProps) {
  const [xboxInfo, setXboxInfo] = useState<{ xboxAppFound: boolean; cloudGamingUrl: string; games?: any[]; error?: string }>({ xboxAppFound: false, cloudGamingUrl: 'https://www.xbox.com/play' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!show) return;
    setLoading(true);
    (async () => {
      if (window.api) {
        try {
          const xb = await (window.api as any).detectXbox?.();
          if (xb) setXboxInfo(xb);
        } catch (_) {}
      }
      setLoading(false);
    })();
  }, [show]);

  const cloudUrl = xboxInfo.cloudGamingUrl || 'https://www.xbox.com/play';
  const gameCount = xboxInfo.games?.length ?? 0;

  const launchXcloud = (url?: string) => {
    const target = url || cloudUrl;
    if ((window.api as any)?.xcloudStartDirect) {
      (window.api as any).xcloudStartDirect(target);
      onClose();
      flash('Launching Xbox Cloud Gaming...');
    } else {
      window.open(target, '_blank');
      flash('Opening in browser...');
    }
  };

  return (
    <SidePanel show={show} onClose={onClose} title="Xbox Cloud Gaming">
      {/* Xbox App status */}
      <div className="chiaki-disc-card" style={{ marginBottom: 14 }}>
        <div className="conn-icon" style={{ background: xboxInfo.xboxAppFound ? '#107c10' : 'var(--glass2)', width: 36, height: 36, fontSize: 14 }}>X</div>
        <div className="chiaki-disc-info">
          <div className="chiaki-disc-name">Xbox App</div>
          <div className="chiaki-disc-detail">
            {loading ? 'Scanning…' : xboxInfo.xboxAppFound ? 'Installed' : 'Not detected'}
            {!loading && gameCount > 0 && ` · ${gameCount} game${gameCount === 1 ? '' : 's'} found`}
          </div>
        </div>
        <div className="conn-dot" style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: xboxInfo.xboxAppFound ? 'var(--green)' : 'var(--text-4)' }} />
      </div>

      {/* Cloud Gaming launch */}
      <div className="chiaki-disc-card" style={{ marginBottom: 14 }}>
        <div className="conn-icon" style={{ background: '#107c10', width: 36, height: 36, fontSize: 16 }}>☁</div>
        <div className="chiaki-disc-info">
          <div className="chiaki-disc-name">Xbox Cloud Gaming</div>
          <div className="chiaki-disc-detail">Stream via xbox.com/play</div>
        </div>
        <div className="chiaki-disc-actions">
          <button className="btn-sm primary" onClick={() => launchXcloud(cloudUrl)}>Launch</button>
          <button className="btn-sm" onClick={() => { window.open(cloudUrl, '_blank'); flash('Opening in browser...'); }}>Browser</button>
        </div>
      </div>

      {!xboxInfo.xboxAppFound && !loading && (
        <div style={{ padding: '10px 12px', background: 'var(--glass)', borderRadius: 8, border: '1px solid var(--glass-border)', fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
          Install the <a href="#" onClick={e => { e.preventDefault(); (window.api as any)?.openExternal?.('https://www.xbox.com/en-US/apps/xbox-app-for-pc'); }} style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Xbox app for PC</a> to access Game Pass titles and Xbox Cloud Gaming with your Microsoft account.
        </div>
      )}
    </SidePanel>
  );
}
