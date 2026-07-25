'use client';

// v5.0: useSwipe — React hook za swipe gesturi na listing karticah
// Swipe left = dismiss (hide), swipe right = bookmark

import { useEffect, useRef, useState, useCallback } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';

interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

interface SwipeState {
  deltaX: number;
  deltaY: number;
  isSwiping: boolean;
  direction: 'left' | 'right' | 'up' | 'down' | null;
}

const SWIPE_THRESHOLD = 50; // min pixels for swipe
const SWIPE_VELOCITY = 0.3; // min velocity

export function useSwipe(handlers: SwipeHandlers, enabled: boolean = true) {
  const [state, setState] = useState<SwipeState>({
    deltaX: 0,
    deltaY: 0,
    isSwiping: false,
    direction: null,
  });

  const startX = useRef(0);
  const startY = useRef(0);
  const startTime = useRef(0);
  const swiping = useRef(false);
  const handlersRef = useRef(handlers);
  const lastDeltaX = useRef(0);
  const lastDeltaY = useRef(0);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const handleTouchStart = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    if (!enabled) return;
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    startX.current = touch.clientX;
    startY.current = touch.clientY;
    startTime.current = Date.now();
    swiping.current = true;
    lastDeltaX.current = 0;
    lastDeltaY.current = 0;
    setState({ deltaX: 0, deltaY: 0, isSwiping: true, direction: null });
  }, [enabled]);

  const handleTouchMove = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    if (!enabled || !swiping.current) return;
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - startX.current;
    const deltaY = touch.clientY - startY.current;
    lastDeltaX.current = deltaX;
    lastDeltaY.current = deltaY;

    let direction: SwipeState['direction'] = null;
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      direction = deltaX > 0 ? 'right' : 'left';
    } else {
      direction = deltaY > 0 ? 'down' : 'up';
    }

    setState({ deltaX, deltaY, isSwiping: true, direction });
  }, [enabled]);

  const handleTouchEnd = useCallback(() => {
    if (!enabled || !swiping.current) return;
    swiping.current = false;

    const elapsed = Date.now() - startTime.current;
    const deltaX = lastDeltaX.current;
    const deltaY = lastDeltaY.current;
    const velocityX = elapsed > 0 ? Math.abs(deltaX) / elapsed : 0;
    const velocityY = elapsed > 0 ? Math.abs(deltaY) / elapsed : 0;

    if (Math.abs(deltaX) > SWIPE_THRESHOLD && velocityX > SWIPE_VELOCITY) {
      if (deltaX > 0) {
        handlersRef.current.onSwipeRight?.();
      } else {
        handlersRef.current.onSwipeLeft?.();
      }
    } else if (Math.abs(deltaY) > SWIPE_THRESHOLD && velocityY > SWIPE_VELOCITY) {
      if (deltaY > 0) {
        handlersRef.current.onSwipeDown?.();
      } else {
        handlersRef.current.onSwipeUp?.();
      }
    }

    setState({ deltaX: 0, deltaY: 0, isSwiping: false, direction: null });
  }, [enabled]);

  return {
    swipeState: state,
    touchHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
}
