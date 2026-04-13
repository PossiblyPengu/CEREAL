import { useState, useRef, useEffect, useCallback } from 'react';
import { GALAXY_W, GALAXY_H } from '../constants';

export function useGalaxyCamera(viewMode: string) {
  const [cam, setCam] = useState({ zoom: 0.4, x: 0, y: 0 });
  const [animating, setAnimating] = useState(false);
  const [galaxyEntering, setGalaxyEntering] = useState(false);
  const camRef = useRef({ zoom: 0.4, x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragInfo = useRef({ active: false, sx: 0, sy: 0, cx: 0, cy: 0, moved: false });

  useEffect(() => { camRef.current = cam; }, [cam]);

  const fitAll = useCallback(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const z = Math.min(vw / GALAXY_W, vh / GALAXY_H) * 0.9;
    const nx = (vw - GALAXY_W * z) / 2, ny = (vh - GALAXY_H * z) / 2;
    setAnimating(true); setCam({ zoom: z, x: nx, y: ny }); setTimeout(() => setAnimating(false), 650);
  }, []);

  const flyTo = useCallback((cx: number, cy: number, tz?: number) => {
    const z = tz || 1.6;
    const vw = window.innerWidth, vh = window.innerHeight;
    setAnimating(true); setCam({ zoom: z, x: vw / 2 - cx * z, y: vh / 2 - cy * z }); setTimeout(() => setAnimating(false), 650);
  }, []);

  const zoomIn = useCallback(() => {
    const hw = window.innerWidth / 2, hh = window.innerHeight / 2;
    setAnimating(true);
    setCam(c => { const nz = Math.min(5, c.zoom * 1.4); const r = nz / c.zoom; return { zoom: nz, x: hw - r * (hw - c.x), y: hh - r * (hh - c.y) }; });
    setTimeout(() => setAnimating(false), 350);
  }, []);

  const zoomOut = useCallback(() => {
    const hw = window.innerWidth / 2, hh = window.innerHeight / 2;
    setAnimating(true);
    setCam(c => { const nz = Math.max(0.15, c.zoom / 1.4); const r = nz / c.zoom; return { zoom: nz, x: hw - r * (hw - c.x), y: hh - r * (hh - c.y) }; });
    setTimeout(() => setAnimating(false), 350);
  }, []);

  // Fit on view mode change
  useEffect(() => {
    if (viewMode === 'orbit') {
      const vw = window.innerWidth, vh = window.innerHeight;
      const z = Math.min(vw / GALAXY_W, vh / GALAXY_H) * 0.9;
      setCam({ zoom: z, x: (vw - GALAXY_W * z) / 2, y: (vh - GALAXY_H * z) / 2 });
    }
  }, [viewMode]);

  // Orbit wheel + drag
  useEffect(() => {
    if (viewMode !== 'orbit') return;
    const vp = viewportRef.current; if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); setAnimating(false);
      const rect = vp.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      setCam(c => { const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; const nz = Math.min(5, Math.max(0.15, c.zoom * f)); const r = nz / c.zoom; return { zoom: nz, x: mx - r * (mx - c.x), y: my - r * (my - c.y) }; });
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return; setAnimating(false);
      const c = camRef.current;
      dragInfo.current = { active: true, sx: e.clientX, sy: e.clientY, cx: c.x, cy: c.y, moved: false };
    };
    let rafId: number | null = null;
    const onMove = (e: MouseEvent) => {
      const d = dragInfo.current; if (!d.active) return;
      if (Math.abs(e.clientX - d.sx) > 3 || Math.abs(e.clientY - d.sy) > 3) d.moved = true;
      const ex = e.clientX, ey = e.clientY;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        setCam(c => ({ ...c, x: d.cx + (ex - d.sx), y: d.cy + (ey - d.sy) }));
      });
    };
    const onUp = () => { dragInfo.current.active = false; };
    vp.addEventListener('wheel', onWheel, { passive: false });
    vp.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      vp.removeEventListener('wheel', onWheel);
      vp.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [viewMode]);

  return {
    cam, setCam, animating, setAnimating, galaxyEntering, setGalaxyEntering,
    camRef, viewportRef, canvasRef, dragInfo,
    fitAll, flyTo, zoomIn, zoomOut,
  };
}
