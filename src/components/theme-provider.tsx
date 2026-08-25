'use client';

// v8.47: Theme Provider — wraps next-themes ThemeProvider.
// v9.53: Added 'professional' to allowed themes (subtilnejše barve po vzoru Stripe/Linear).

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      themes={['dark', 'light', 'professional']}
    >
      {children}
    </NextThemesProvider>
  );
}
