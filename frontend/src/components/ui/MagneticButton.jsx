import { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function MagneticButton({
  children,
  className = '',
  strength = 0.3,
  onClick,
  disabled = false,
  type = 'button',
  to,
  href,
  ...props
}) {
  const ref = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
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
    setPosition({
      x: (e.clientX - rect.left - rect.width / 2) * strength,
      y: (e.clientY - rect.top - rect.height / 2) * strength,
    });
  };

  const handleMouseLeave = () => {
    setPosition({ x: 0, y: 0 });
    setHovered(false);
  };

  const innerClass = `relative z-10 inline-flex items-center justify-center gap-2 overflow-hidden ${className}`;
  const shine = (
    <motion.span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/25 via-white/5 to-transparent"
      animate={{ opacity: hovered ? 1 : 0 }}
      transition={{ duration: 0.25 }}
    />
  );

  let inner;
  if (to && !disabled) {
    inner = <Link to={to} onClick={onClick} className={innerClass}>{shine}{children}</Link>;
  } else if (href && !disabled) {
    inner = <a href={href} onClick={onClick} className={innerClass}>{shine}{children}</a>;
  } else {
    inner = (
      <button type={type} disabled={disabled} onClick={onClick} className={`${innerClass} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        {shine}
        {children}
      </button>
    );
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={() => setHovered(true)}
      whileTap={{ scale: disabled ? 1 : 0.96 }}
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        transition: prefersReducedMotion.current ? 'none' : 'transform 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        display: 'inline-block',
      }}
      {...props}
    >
      {inner}
    </motion.div>
  );
}
