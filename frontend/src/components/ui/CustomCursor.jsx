import { useEffect, useRef, useState } from 'react';

export default function CustomCursor() {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)').matches;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || reduced) return undefined;

    setEnabled(true);

    let raf = 0;
    const pos = { x: -100, y: -100 };
    const ring = { x: -100, y: -100 };
    let hovering = false;

    const onMove = (e) => {
      pos.x = e.clientX;
      pos.y = e.clientY;
      if (!visible) setVisible(true);
    };

    const onOver = (e) => {
      const target = e.target;
      hovering = !!(
        target.closest &&
        target.closest('a, button, input, select, textarea, [role="button"], [data-cursor]')
      );
      ringRef.current?.classList.toggle('is-hover', hovering);
    };

    const onLeave = () => setVisible(false);
    const onEnter = () => setVisible(true);

    const loop = () => {
      ring.x += (pos.x - ring.x) * 0.16;
      ring.y += (pos.y - ring.y) * 0.16;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)`;
      }
      if (ringRef.current) {
        ringRef.current.style.transform = `translate(${ring.x}px, ${ring.y}px) translate(-50%, -50%)`;
      }
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseover', onOver, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    document.documentElement.addEventListener('mouseenter', onEnter);
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseover', onOver);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      document.documentElement.removeEventListener('mouseenter', onEnter);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!enabled) return null;

  return (
    <>
      <div
        ref={dotRef}
        className="cursor-dot"
        style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.3s' }}
      />
      <div
        ref={ringRef}
        className="cursor-ring"
        style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.3s, width 0.25s ease, height 0.25s ease, border-color 0.25s ease' }}
      />
    </>
  );
}
