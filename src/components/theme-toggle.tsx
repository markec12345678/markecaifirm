'use client';

// v8.47: Theme Toggle — dark/light/system toggle button.
// Uses next-themes useTheme hook. Renders Sun/Moon icon.

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHaptic } from '@/hooks/use-haptic';

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const haptic = useHaptic();

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    // Avoid hydration mismatch — render placeholder until mounted
    return (
      <Button variant="ghost" size="icon" className="h-9 w-9" disabled>
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  const cycle = () => {
    haptic.light();
    if (theme === 'dark') setTheme('light');
    else if (theme === 'light') setTheme('system');
    else setTheme('dark');
  };

  const icon = theme === 'system' ? <Monitor className="h-4 w-4" /> : resolvedTheme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />;
  const label = theme === 'system' ? 'Sistem' : resolvedTheme === 'dark' ? 'Dark' : 'Light';

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      className="h-9 w-9 relative"
      title={`Tema: ${label} (klikni za switch)`}
    >
      {icon}
      {compact && <span className="sr-only">{label}</span>}
    </Button>
  );
}
