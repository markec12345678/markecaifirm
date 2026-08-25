'use client';

/**
 * v9.64: TimeToggle — klik na čas preklopi med relativnim in absolutnim formatom.
 *
 * Navdih: Reddit r/homeassistant — "a simple click should switch the value
 * to a precise timestamp".
 *
 * Default: relativni čas ("pred 14 h")
 * Po klik: exact datum ("24. avg 2026, 10:30")
 * Po 3 sekundah: samodejno nazaj na relativni
 */

import { useState, useEffect, useRef } from 'react';
import { formatRelativeTime, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface TimeToggleProps {
  date: Date | string | null | undefined;
  /** Short format za exact datum (default false = full). */
  short?: boolean;
  /** Ali naj bo klikljiv (default true). */
  clickable?: boolean;
  className?: string;
  title?: string;
}

export function TimeToggle({ date, short = false, clickable = true, className, title }: TimeToggleProps) {
  const [showAbsolute, setShowAbsolute] = useState(false);
  const resetTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  if (!date) return <span className={className}>—</span>;

  const handleClick = () => {
    if (!clickable) return;
    setShowAbsolute((prev) => !prev);
    // Samodejno resetiraj na relativni po 3 sekundah
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setShowAbsolute(false), 3000);
  };

  const display = showAbsolute
    ? formatDateTime(date, { short })
    : formatRelativeTime(date);

  const defaultTitle = clickable
    ? 'Klikni za exact datum'
    : title;

  return (
    <span
      onClick={clickable ? handleClick : undefined}
      className={cn(
        className,
        clickable && 'cursor-pointer hover:text-primary transition-colors'
      )}
      title={defaultTitle}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter') handleClick(); } : undefined}
    >
      {display}
    </span>
  );
}
