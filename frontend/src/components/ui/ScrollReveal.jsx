import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

export function ScrollReveal({
  children,
  className = '',
  delay = 0,
  duration = 0.6,
  distance = 40,
  direction = 'up',
  once = true,
  threshold = 0.1,
  rootMargin = '0px 0px -50px 0px',
  ...props
}) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion.current = mediaQuery.matches;
    const handler = () => { prefersReducedMotion.current = mediaQuery.matches; };
    mediaQuery.addEventListener('change', handler);

    if (prefersReducedMotion.current) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) observer.unobserve(entry.target);
        } else if (!once) {
          setIsVisible(false);
        }
      },
      { threshold, rootMargin }
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [once, threshold, rootMargin]);

  const getInitial = () => {
    if (isVisible || prefersReducedMotion.current) return { opacity: 1, y: 0, x: 0 };
    switch (direction) {
      case 'up': return { opacity: 0, y: distance };
      case 'down': return { opacity: 0, y: -distance };
      case 'left': return { opacity: 0, x: distance };
      case 'right': return { opacity: 0, x: -distance };
      default: return { opacity: 0, y: distance };
    }
  };

  return (
    <motion.div
      ref={ref}
      initial={getInitial()}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{ duration, delay, ease: 'easeOut' }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function StaggeredReveal({
  children,
  className = '',
  staggerDelay = 0.08,
  direction = 'up',
  ...props
}) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <div className={className} {...props}>
      {items.map((child, index) =>
        React.cloneElement(child, {
          initial: direction === 'up' ? { opacity: 0, y: 30 } : { opacity: 0, x: -20 },
          animate: { opacity: 1, y: 0, x: 0 },
          transition: { delay: index * staggerDelay, duration: 0.5, ease: 'easeOut' },
        })
      )}
    </div>
  );
}

export function RevealOnScroll({
  children,
  className = '',
  delay = 0,
  once = true,
  ...props
}) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion.current = mediaQuery.matches;
    const handler = () => { prefersReducedMotion.current = mediaQuery.matches; };
    mediaQuery.addEventListener('change', handler);

    if (prefersReducedMotion.current) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) observer.unobserve(entry.target);
        } else if (!once) {
          setIsVisible(false);
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [once]);

  return (
    <div ref={ref} className={className} {...props}>
      {React.Children.map(children, (child, index) =>
        React.isValidElement(child)
          ? React.cloneElement(child, {
              initial: { opacity: 0, y: 20 },
              animate: isVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 },
              transition: {
                delay: delay + index * 0.06,
                duration: 0.5,
                ease: 'easeOut',
              },
            })
          : child
      )}
    </div>
  );
}

import React from 'react';