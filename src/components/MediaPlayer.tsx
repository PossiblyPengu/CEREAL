import ReactDOM from 'react-dom';
import { useState, useEffect, useRef } from 'react';

interface MediaInfo {
  title?: string;
  artist?: string;
  album?: string;
  thumbnail?: string;
  playing?: boolean;
  position?: number;
  duration?: number;
}

interface MediaPlayerProps {
  tbPos: string;
  viewMode: string;
}

export function MediaPlayer({ tbPos, viewMode: _viewMode }: MediaPlayerProps) {
  const [media, setMedia] = useState<MediaInfo>({});
  const [collapsed, setCollapsed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMedia = async () => {
    if (!window.api?.getMediaInfo) return;
    try { const info = await (window.api as any).getMediaInfo(); setMedia(info || {}); } catch (_) {}
  };

  useEffect(() => {
    fetchMedia();
    pollRef.current = setInterval(fetchMedia, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const ctrl = async (action: string) => { await (window.api as any)?.mediaControl?.(action); fetchMedia(); };

  const pos = tbPos || 'top';
  const bottom = pos === 'bottom' ? 6 : (pos === 'left' || pos === 'right' ? 8 : 18);
  const hPos = pos === 'right' ? { right: 6, left: 'auto' as const } : { left: pos === 'left' ? 6 : 18 };
  const cornerStyle = pos === 'left' ? { borderRadius: '0 22px 22px 0', transformOrigin: 'bottom left' as const }
    : pos === 'right' ? { borderRadius: '22px 0 0 22px', transformOrigin: 'bottom right' as const }
    : {};

  const hasMedia = !!(media.title || media.artist);
  const progress = (media.duration && media.duration > 0) ? Math.min(100, (media.position || 0) / media.duration * 100) : 0;

  const iMusic  = <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 3v11.5a3.5 3.5 0 1 0 2 3.14V7h6V3H9z" /></svg>;
  const iPrev   = <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>;
  const iNext   = <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z" /></svg>;
  const iPause  = <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>;
  const iPlay   = <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
  const iRefresh= <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.76L13 11h7V4l-2.35 2.35z" /></svg>;

  const content = collapsed ? (
    <div className="media-player collapsed" style={{ bottom, ...hPos, ...cornerStyle }}>
      <button className="media-collapsed-btn" onClick={() => setCollapsed(false)} title="Media controls">{iMusic}</button>
    </div>
  ) : (
    <div className={'media-player' + (hasMedia ? '' : ' no-media')} style={{ bottom, ...hPos, ...cornerStyle }}>
      <div className="media-player-art" onClick={() => setCollapsed(true)} title="Collapse">
        {media.thumbnail ? <img src={media.thumbnail} alt="" /> : iMusic}
      </div>
      <div className="media-player-info">
        <div className="media-player-title">{hasMedia ? (media.title || '—') : <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>Nothing playing</span>}</div>
        {hasMedia && <div className="media-player-artist">{media.artist || media.album || ''}</div>}
      </div>
      <div className="media-player-controls">
        <button onClick={() => ctrl('prev')} title="Previous">{iPrev}</button>
        <button className="play-btn" onClick={() => ctrl('playpause')} title={media.playing ? 'Pause' : 'Play'}>{media.playing ? iPause : iPlay}</button>
        <button onClick={() => ctrl('next')} title="Next">{iNext}</button>
        <button onClick={fetchMedia} title="Refresh">{iRefresh}</button>
      </div>
      {progress > 0 && <div className="media-player-progress" style={{ width: progress + '%' }} />}
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
