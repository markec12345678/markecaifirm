'use client';

/**
 * v8.45: Mobile Floating Action Button (FAB)
 *
 * A floating action button that shows ONLY on mobile (md:hidden).
 * Positioned bottom-right, above the MobileBottomNav (bottom-20 right-4).
 * Uses a purple→primary gradient with a pulsing glow to draw attention.
 * On tap: triggers haptic feedback (medium) and calls onAddTrade to open
 * the QuickAddTradeModal (from v8.36).
 *
 * The FAB gives mobile users a one-tap path to the most common action
 * ("Dodaj trade") without scrolling to find the button in the dashboard.
 */

import { Plus } from 'lucide-react';
import { useHaptic } from '@/hooks/use-haptic';
import { cn } from '@/lib/utils';

interface MobileFABProps {
  /** Called when FAB is tapped — should open QuickAddTradeModal. */
  onAddTrade: () => void;
}

export function MobileFAB({ onAddTrade }: MobileFABProps) {
  const haptic = useHaptic();

  const handleTap = () => {
    haptic.medium();
    onAddTrade();
  };

  return (
    <button
      type="button"
      onClick={handleTap}
      aria-label="Dodaj trade"
      title="Dodaj trade"
      className={cn(
        'md:hidden fixed bottom-20 right-4 z-50',
        'flex items-center justify-center',
        'w-14 h-14 min-w-[44px] min-h-[44px] rounded-full',
        'bg-gradient-to-br from-primary to-purple-600',
        'text-white shadow-lg shadow-primary/40',
        'border border-primary/30',
        'transition-transform active:scale-90 hover:scale-105',
        'fab-pulse-glow'
      )}
    >
      <Plus className="w-7 h-7" strokeWidth={2.5} />
    </button>
  );
}
