import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const COLORS = [
  'rgba(102, 113, 248, 0.6)',
  'rgba(246, 73, 107, 0.6)',
  'rgba(139, 92, 246, 0.6)',
  'rgba(16, 185, 129, 0.6)',
  'rgba(249, 115, 22, 0.6)',
  'rgba(6, 182, 212, 0.6)',
];

function getRandomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

export default function Particles({
  count = 30,
  sizeRange = [4, 24],
  speedRange = [15, 40],
  interactive = true,
  className = '',
}) {
  const [particles, setParticles] = useState([]);
  const [mouse, setMouse] = useState({ x: 0.5, y: 0.5 });
  const containerRef = useRef(null);
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion.current = mediaQuery.matches;
    
    const handler = () => {
      prefersReducedMotion.current = mediaQuery.matches;
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion.current) return;
    
    const newParticles = Array.from({ length: count }, (_, i) => ({
      id: i,
      x: Math.random(),
      y: Math.random(),
      size: sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]),
      speed: speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]),
      direction: Math.random() * Math.PI * 2,
      color: getRandomColor(),
      opacity: 0.15 + Math.random() * 0.35,
    }));
    setParticles(newParticles);
  }, [count, sizeRange, speedRange]);

  useEffect(() => {
    if (prefersReducedMotion.current || !interactive) return;
    
    const handleMouseMove = (e) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setMouse({
          x: (e.clientX - rect.left) / rect.width,
          y: (e.clientY - rect.top) / rect.height,
        });
      }
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [interactive]);

  if (prefersReducedMotion.current) {
    return null;
  }

  return (
    <motion.div
      ref={containerRef}
      className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: { staggerChildren: 0.05, delayChildren: 0.3 },
        },
      }}
      style={{ zIndex: 0 }}
    >
      {particles.map((p) => (
        <Particle
          key={p.id}
          particle={p}
          mouse={mouse}
          interactive={interactive}
          prefersReducedMotion={prefersReducedMotion.current}
        />
      ))}
    </motion.div>
  );
}

function Particle({ particle, mouse, interactive, prefersReducedMotion }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: particle.x, y: particle.y });

  useEffect(() => {
    if (prefersReducedMotion) return;
    
    let frame;
    const animate = () => {
      let { x, y } = pos;
      const speed = particle.speed / 10000;
      
      x += Math.cos(particle.direction) * speed;
      y += Math.sin(particle.direction) * speed;

      if (x <= 0 || x >= 1) particle.direction = Math.PI - particle.direction;
      if (y <= 0 || y >= 1) particle.direction = -particle.direction;

      x = Math.max(0, Math.min(1, x));
      y = Math.max(0, Math.min(1, y));

      if (interactive) {
        const dx = mouse.x - x;
        const dy = mouse.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const influence = 0.0003;
        
        if (dist < 0.3) {
          x -= dx * influence;
          y -= dy * influence;
        }
      }

      setPos({ x, y });
      frame = requestAnimationFrame(animate);
    };
    
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [pos, particle, mouse, interactive, prefersReducedMotion]);

  return (
    <motion.div
      style={{
        left: `${pos.x * 100}%`,
        top: `${pos.y * 100}%`,
        width: particle.size,
        height: particle.size,
        backgroundColor: particle.color,
        opacity: particle.opacity,
      }}
      className="absolute rounded-full blur-sm"
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay: Math.random() * 0.5 }}
    />
  );
}

export function FloatingShapes({ count = 8, className = '' }) {
  const [shapes, setShapes] = useState([]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) return;

    const newShapes = Array.from({ length: count }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 80 + Math.random() * 200,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      duration: 15 + Math.random() * 20,
      delay: Math.random() * 5,
      blur: 60 + Math.random() * 80,
    }));
    setShapes(newShapes);
  }, [count]);

  if (shapes.length === 0) return null;

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`} style={{ zIndex: 0 }}>
      {shapes.map((s) => (
        <motion.div
          key={s.id}
          className="absolute rounded-full"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            backgroundColor: s.color,
            filter: `blur(${s.blur}px)`,
            opacity: 0.15,
          }}
          animate={{
            x: [-100, 100, -100],
            y: [-50, 50, -50],
          }}
          transition={{
            duration: s.duration,
            delay: s.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}