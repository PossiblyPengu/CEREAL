import { useState } from 'react';
import type { Game } from '../types';
import { I } from '../constants';

interface ContinueBannerProps {
  game: Game;
  onPlay: () => void;
  onDismiss: () => void;
}

export function ContinueBanner({ game, onPlay, onDismiss }: ContinueBannerProps) {
  const [closing, setClosing] = useState(false);
  return (
    <div className={'continue-banner' + (closing ? ' closing' : '')} onAnimationEnd={() => { if (closing) onDismiss(); }}>
      <div className="continue-banner-info">
        <div className="continue-banner-label">Continue</div>
        <div className="continue-banner-name">{game.name}</div>
      </div>
      <button className="continue-play-btn" onClick={() => { setClosing(true); onPlay(); }}>
        <span style={{ display: 'flex', width: 10, height: 10 }}>{I.play}</span> Play
      </button>
      <button className="continue-dismiss" onClick={() => setClosing(true)} title="Dismiss">&times;</button>
    </div>
  );
}
