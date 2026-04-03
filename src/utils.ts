import { useEffect, useRef } from 'react';
import { THEMES } from './constants';
import type { Game } from './types';

// ─── UI scale & theme ────────────────────────────────────────────────────────

export function applyUiScale(scale: string | undefined): void {
  document.documentElement.style.zoom = scale || '1';
  let px = '13px';
  if (scale === '0.9') px = '11px';
  else if (scale === '1') px = '13px';
  else if (scale === '1.1') px = '15px';
  else if (scale === '1.25') px = '17px';
  document.documentElement.style.setProperty('--font-size', px);
}

export function applyTheme(themeKey: string): void {
  const t = THEMES[themeKey] ?? THEMES.midnight;
  const r = document.documentElement;
  r.style.setProperty('--void',         t.void);
  r.style.setProperty('--surface',      t.surface);
  r.style.setProperty('--card',         t.card);
  r.style.setProperty('--card-up',      t.cardUp);
  r.style.setProperty('--glass',        t.glass);
  r.style.setProperty('--glass-border', t.glassBorder);
  r.style.setProperty('--glow',         t.glow);
  r.style.setProperty('--accent',       t.accent);
  r.style.setProperty('--accent-soft',  t.accent + '1f');
  r.style.setProperty('--accent-border',t.accent + '4d');
  r.style.setProperty('--text',         t.text);
  r.style.setProperty('--text-2',       t.text2);
  r.style.setProperty('--text-3',       t.text3);
  r.style.setProperty('--text-4',       t.text4);
  document.body.style.background = t.bodyBg;
  document.body.style.color = t.text;
  try {
    localStorage.setItem('cereal-boot-accent', t.accent);
    localStorage.setItem('cereal-boot-bg', t.bodyBg);
  } catch (_) { /* ignore */ }
}

// ─── Formatters ──────────────────────────────────────────────────────────────

export function platformLabel(p: string): string {
  const PLATFORMS_LABELS: Record<string, string> = {
    steam: 'Steam', epic: 'Epic Games', gog: 'GOG',
    psn: 'PlayStation', xbox: 'Xbox', custom: 'Custom',
  };
  return PLATFORMS_LABELS[p] ?? p;
}

export function fmtTime(m: number | undefined): string {
  if (!m) return 'No playtime';
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? h + 'h ' + r + 'm' : h + 'h';
}

export function fmtDate(d: string | number | undefined): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (_) { return ''; }
}

// ─── Image resolution (prefers local cached paths) ───────────────────────────

export function resolveGameImage(game: Game | null | undefined, field: 'coverUrl' | 'headerUrl'): string {
  if (!game) return '';
  try {
    const localField = field === 'coverUrl' ? game.localCoverPath : game.localHeaderPath;
    if (localField) {
      let p = String(localField);
      if (!p) return '';
      try {
        if (p.startsWith('file:')) p = p.replace(/^file:\/+/i, '');
        p = p.replace(/^\/+/, '').replace(/\\/g, '/');
        // Use custom protocol so images load from any renderer origin (http/file)
        const imgUrl = 'local-image:///' + encodeURI(p);
        const stamp = game._imgStamp
          ? (imgUrl.includes('?') ? '&cb=' + game._imgStamp : '?cb=' + game._imgStamp)
          : '';
        return imgUrl + stamp;
      } catch (_) { /* fallthrough */ }
    }
    const url = game[field] ?? '';
    if (!url) return '';
    const stamp = game._imgStamp
      ? (url.includes('?') ? '&cb=' + game._imgStamp : '?cb=' + game._imgStamp)
      : '';
    return url + stamp;
  } catch (_) { return game[field] ?? ''; }
}

// ─── Gamepad hook ────────────────────────────────────────────────────────────

type GamepadCallback = (actions: string[]) => void;

const BUTTON_MAP: Record<number, string> = {
  0: 'confirm', 1: 'back',  2: 'x',    3: 'y',
  9: 'start',   8: 'select', 4: 'lb',  5: 'rb',
  12: 'up',    13: 'down', 14: 'left', 15: 'right',
};

const DEADZONE      = 0.4;
const INITIAL_DELAY = 300;
const REPEAT_DELAY  = 120;

export function useGamepad(cb: GamepadCallback): void {
  const cbRef = useRef<GamepadCallback>(cb);
  cbRef.current = cb;

  useEffect(() => {
    const prev: Record<string, boolean | undefined> = {};
    const held: Record<string, number> = {};

    let raf: number;

    const poll = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gp: Gamepad | null = null;
      for (let i = 0; i < pads.length; i++) { if (pads[i]) { gp = pads[i]; break; } }

      if (gp) {
        const actions: string[] = [];

        // Buttons
        for (const bi in BUTTON_MAP) {
          const name = BUTTON_MAP[Number(bi)];
          const pressed = !!(gp.buttons[Number(bi)]?.pressed);
          if (pressed && !prev[name]) {
            actions.push(name);
            held[name] = Date.now();
          } else if (pressed && prev[name]) {
            const elapsed = Date.now() - held[name];
            if (name === 'up' || name === 'down' || name === 'left' || name === 'right') {
              if (elapsed > INITIAL_DELAY) { actions.push(name); held[name] = Date.now() - (INITIAL_DELAY - REPEAT_DELAY); }
            }
          } else if (!pressed) {
            delete held[name];
          }
          prev[name] = pressed;
        }

        // Left stick as d-pad
        const lx = gp.axes[0] ?? 0;
        const ly = gp.axes[1] ?? 0;
        const stickDirs: string[] = [];
        if (lx < -DEADZONE) stickDirs.push('left');
        else if (lx > DEADZONE) stickDirs.push('right');
        if (ly < -DEADZONE) stickDirs.push('up');
        else if (ly > DEADZONE) stickDirs.push('down');

        for (const s of stickDirs) {
          const sk = 'stick_' + s;
          if (!prev[sk]) { actions.push(s); held[sk] = Date.now(); }
          else {
            const se = Date.now() - held[sk];
            if (se > INITIAL_DELAY) { actions.push(s); held[sk] = Date.now() - (INITIAL_DELAY - REPEAT_DELAY); }
          }
          prev[sk] = true;
        }
        ['stick_left','stick_right','stick_up','stick_down'].forEach(sk => {
          if (!stickDirs.includes(sk.replace('stick_',''))) { prev[sk] = false; delete held[sk]; }
        });

        // Right stick
        const rx = gp.axes[2] ?? 0;
        const ry = gp.axes[3] ?? 0;
        const rDirs: string[] = [];
        if (rx < -DEADZONE) rDirs.push('r_left');
        else if (rx > DEADZONE) rDirs.push('r_right');
        if (ry < -DEADZONE) rDirs.push('r_up');
        else if (ry > DEADZONE) rDirs.push('r_down');

        for (const rs of rDirs) {
          if (!prev[rs]) { actions.push(rs); held[rs] = Date.now(); }
          else {
            const re = Date.now() - held[rs];
            if (re > INITIAL_DELAY) { actions.push(rs); held[rs] = Date.now() - (INITIAL_DELAY - REPEAT_DELAY); }
          }
          prev[rs] = true;
        }
        ['r_left','r_right','r_up','r_down'].forEach(rk => {
          if (!rDirs.includes(rk)) { prev[rk] = false; delete held[rk]; }
        });

        if (actions.length) cbRef.current(actions);
      }

      raf = requestAnimationFrame(poll);
    };

    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);
}
