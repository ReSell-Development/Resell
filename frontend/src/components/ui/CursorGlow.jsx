import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

export function CursorGlow({
  enabled = true,
  size = 300,
  color = 'rgba(102, 113, 248, 0.15)',
  className = '',
}) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [visible, setVisible] = useState(false);
  const prefersReducedMotion = useRef(false);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion.current = mediaQuery.matches;
    
    if (prefersReducedMotion.current) return;
    
    const handler = () => { prefersReducedMotion.current = mediaQuery.matches; };
    mediaQuery.addEventListener('change', handler);
    
    const handleMove = (e) => {
      setPosition({ x: e.clientX, y: e.clientY });
      setVisible(true);
    };

    const handleLeave = () => setVisible(false);
    
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseleave', handleLeave);
    
    return () => {
      mediaQuery.removeEventListener('change', handler);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseleave', handleLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled]);

  if (!visible || prefersReducedMotion.current) return null;

  return (
    <motion.div
      className={`fixed pointer-events-none ${className}`}
      style={{
        left: position.x - size / 2,
        top: position.y - size / 2,
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle at center, ${color} 0%, transparent 70%)`,
        zIndex: 9999,
        willChange: 'transform',
      }}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    />
  );
}

export function MagneticCursor({
  enabled = true,
  className = '',
}) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const prefersReducedMotion = useRef(false);
  const targetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!enabled) return;
    
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion.current = mediaQuery.matches;
    
    if (prefersReducedMotion.current) return;
    
    const handler = () => { prefersReducedMotion.current = mediaQuery.matches; };
    mediaQuery.addEventListener('change', handler);

    const handleMove = (e) => {
      targetRef.current = { x: e.clientX, y: e.clientY };
    };

    window.addEventListener('mousemove', handleMove);

    const animate = () => {
      if (prefersReducedMotion.current) return;
      
      setPosition((prev) => ({
        x: prev.x + (targetRef.current.x - prev.x) * 0.15,
        y: prev.y + (targetRef.current.y - prev.y) * 0.15,
      }));
      
      rafRef.current = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      mediaQuery.removeEventListener('change', handler);
      window.removeEventListener('mousemove', handleMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled]);

  if (prefersReducedMotion.current) return null;

  return (
    <motion.div
      className={`fixed pointer-events-none ${className}`}
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -50%)',
        zIndex: 9999,
        willChange: 'transform',
      }}
      animate={{
        x: 0,
        y: 0,
      }}
    >
      <div className="w-6 h-6 rounded-full border border-brand-500/50 bg-brand-500/10" />
    </motion.div>
  );
}

const prefersReducedMotion = { current: false };
let rafRef = { current: null };