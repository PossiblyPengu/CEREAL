import { useRef, useEffect } from 'react';

const PARALLAX_SPEEDS = [10, 30, 60] as const;

export function useParallax(viewMode: string) {
  const pRef0 = useRef<HTMLDivElement>(null);
  const pRef1 = useRef<HTMLDivElement>(null);
  const pRef2 = useRef<HTMLDivElement>(null);
  const parallaxRefsArray = useRef([pRef0, pRef1, pRef2]);
  const parallaxRafRef = useRef<number | null>(null);
  const parallaxMouseRef = useRef({ cx: 0, cy: 0 });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (viewMode === 'cards') return;
      parallaxMouseRef.current = { cx: e.clientX / window.innerWidth - 0.5, cy: e.clientY / window.innerHeight - 0.5 };
      if (parallaxRafRef.current !== null) return;
      parallaxRafRef.current = requestAnimationFrame(() => {
        parallaxRafRef.current = null;
        const { cx, cy } = parallaxMouseRef.current;
        parallaxRefsArray.current.forEach((ref, i) => {
          if (ref.current) ref.current.style.transform = `translate(${cx * PARALLAX_SPEEDS[i]}px, ${cy * PARALLAX_SPEEDS[i]}px)`;
        });
      });
    };
    window.addEventListener('mousemove', handler, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handler);
      if (parallaxRafRef.current !== null) { cancelAnimationFrame(parallaxRafRef.current); parallaxRafRef.current = null; }
    };
  }, [viewMode]);

  return { parallaxRefsArray };
}
