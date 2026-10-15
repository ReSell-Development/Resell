import { useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function TiltCard({
  children,
  className = '',
  maxTilt = 10,
  strength = 0.15,
  hoverLift = -12,
  hoverScale = 1.02,
  glowColor = 'rgba(102, 113, 248, 0.15)',
  onClick,
  disabled = false,
  ...props
}) {
  const ref = useRef(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion.current = mediaQuery.matches;
    const handler = () => { prefersReducedMotion.current = mediaQuery.matches; };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const handleMouseMove = (e) => {
    if (disabled || prefersReducedMotion.current) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;

    setTilt({
      x: x * maxTilt * strength,
      y: -y * maxTilt * strength,
    });
  };

  const handleMouseLeave = () => {
    if (prefersReducedMotion.current) return;
    setTilt({ x: 0, y: 0 });
    setHovered(false);
  };

  const rotateX = tilt.y;
  const rotateY = tilt.x;

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={() => !disabled && setHovered(true)}
      onClick={onClick}
      className={`relative ${className}`}
      style={{
        transform: prefersReducedMotion.current
          ? (hovered ? `translateY(${hoverLift}px) scale(${hoverScale})` : 'none')
          : `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(0) ${hovered ? `translateY(${hoverLift}px) scale(${hoverScale})` : ''}`,
        transformStyle: 'preserve-3d',
        transition: prefersReducedMotion.current
          ? 'transform 0.3s ease, box-shadow 0.3s ease'
          : 'transform 0.1s ease-out, box-shadow 0.3s ease',
        willChange: 'transform, box-shadow',
        cursor: onClick && !disabled ? 'pointer' : 'default',
      }}
      whileTap={{ scale: 0.98 }}
      {...props}
    >
      <motion.div
        className="absolute inset-0 bg-gradient-to-br from-brand-500/10 to-accent-500/10 opacity-0 pointer-events-none rounded-inherit"
        animate={{ opacity: hovered ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      />
      <motion.div
        className="absolute inset-0 pointer-events-none rounded-inherit"
        style={{
          boxShadow: hovered
            ? `0 32px 64px -12px rgba(15, 23, 42, 0.15), 0 0 0 1px ${glowColor}, 0 0 60px -10px ${glowColor}`
            : '0 4px 6px -1px rgba(0, 0, 0, 0.03), 0 2px 4px -1px rgba(0, 0, 0, 0.02)',
        }}
        animate={{ boxShadow: hovered
          ? `0 32px 64px -12px rgba(15, 23, 42, 0.15), 0 0 0 1px ${glowColor}, 0 0 60px -10px ${glowColor}`
          : '0 4px 6px -1px rgba(0, 0, 0, 0.03), 0 2px 4px -1px rgba(0, 0, 0, 0.02)'
        }}
        transition={{ duration: 0.3 }}
      />
      <div className="relative z-10" style={{ transformStyle: 'preserve-3d' }}>
        {children}
      </div>
    </motion.div>
  );
}

export function FloatingCard({
  children,
  className = '',
  floatDistance = 15,
  floatDuration = 6,
  delay = 0,
  rotateAmount = 3,
  onClick,
  ...props
}) {
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion.current = mediaQuery.matches;
    const handler = () => { prefersReducedMotion.current = mediaQuery.matches; };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return (
    <motion.div
      className={`relative ${className}`}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      animate={{
        y: prefersReducedMotion.current ? 0 : [-floatDistance, floatDistance, -floatDistance],
        rotate: prefersReducedMotion.current ? 0 : [-rotateAmount, rotateAmount, -rotateAmount],
      }}
      transition={{
        duration: floatDuration,
        delay,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      whileHover={{
        y: -floatDistance * 1.5,
        scale: 1.03,
        boxShadow: '0 40px 80px -12px rgba(15, 23, 42, 0.2), 0 0 0 1px rgba(102, 113, 248, 0.15)',
        transition: { duration: 0.4 },
      }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function MagneticCard({
  children,
  className = '',
  strength = 0.12,
  maxTilt = 8,
  hoverLift = -8,
  ...props
}) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion.current = mediaQuery.matches;
    const handler = () => { prefersReducedMotion.current = mediaQuery.matches; };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const handleMouseMove = (e) => {
    if (prefersReducedMotion.current) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;

    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;

    setPosition({
      x: x * strength * 100,
      y: y * strength * 100,
    });
  };

  const handleMouseLeave = () => {
    if (prefersReducedMotion.current) return;
    setPosition({ x: 0, y: 0 });
    setHovered(false);
  };

  const rotateX = -position.y * maxTilt / 50;
  const rotateY = position.x * maxTilt / 50;

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={() => setHovered(true)}
      className={`relative ${className}`}
      style={{
        transform: prefersReducedMotion.current
          ? (hovered ? `translateY(${hoverLift}px)` : 'none')
          : `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translate(${position.x}px, ${position.y}px) ${hovered ? `translateY(${hoverLift}px)` : ''}`,
        transformStyle: 'preserve-3d',
        transition: prefersReducedMotion.current
          ? 'transform 0.3s ease, box-shadow 0.3s ease'
          : 'transform 0.1s ease-out, box-shadow 0.3s ease',
        willChange: 'transform, box-shadow',
      }}
      whileHover={{
        y: hoverLift,
        boxShadow: '0 32px 64px -12px rgba(15, 23, 42, 0.15), 0 0 0 1px rgba(102, 113, 248, 0.1)',
        transition: { duration: 0.3 },
      }}
      {...props}
    >
      <motion.div
        className="absolute inset-0 bg-gradient-to-br from-brand-500/5 to-accent-500/5 opacity-0 pointer-events-none rounded-inherit"
        animate={{ opacity: hovered ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      />
      <div className="relative z-10" style={{ transformStyle: 'preserve-3d' }}>
        {children}
      </div>
    </motion.div>
  );
}