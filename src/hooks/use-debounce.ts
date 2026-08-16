'use client';

// v8.58: useDebounce — debounced value for search inputs.
// Prevents excessive re-renders/API calls on every keystroke.
// Best practice: debounce search/filter inputs by 300ms.

import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delayMs: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debouncedValue;
}
