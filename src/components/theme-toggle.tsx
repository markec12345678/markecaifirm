'use client';

// v8.47: Theme Toggle — dark/light/system toggle button.
// v9.53: Extended with Professional theme (4 cycles: dark → light → system → professional).
// Professional theme uses subtilnejše barve (emerald/slate), no glow, no scanline.

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun, Monitor, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHaptic } from '@/hooks/use-haptic';

type AppTheme = 'dark' | 'light' | 'system' | 'professional';

const THEME_CYCLE: AppTheme[] = ['dark', 'light', 'system', 'professional'];
const THEME_LABELS: Record<AppTheme, string> = {
  dark: 'Dark (Terminal)',
  light: 'Light',
  system: 'Sistem',
  professional: 'Professional',
};

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [appTheme, setAppTheme] = useState<AppTheme>('dark');
  const [mounted, setMounted] = useState(false);
  const haptic = useHaptic();

  useEffect(() => setMounted(true), []);

  // Sync appTheme z next-themes state
  useEffect(() => {
    if (!mounted) return;
    const t = (theme as AppTheme) || 'dark';
    if (THEME_CYCLE.includes(t)) {
      setAppTheme(t);
    }
  }, [theme, mounted]);

  // Apply/remove data-theme="professional" na <html> elementu
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (appTheme === 'professional') {
      root.setAttribute('data-theme', 'professional');
      // Next-themes setTheme('professional') bo dodalo class="professional", ampak
      // naš CSS uporablja data-theme selector. Prav tako ohranimo dark class
      // za osnovno strukturo (border, bg, etc. iz .dark).
      if (!root.classList.contains('dark')) {
        root.classList.add('dark');
      }
    } else {
      root.removeAttribute('data-theme');
    }
  }, [appTheme]);

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
    const currentIdx = THEME_CYCLE.indexOf(appTheme);
    const nextIdx = (currentIdx + 1) % THEME_CYCLE.length;
    const next = THEME_CYCLE[nextIdx];
    setAppTheme(next);
    setTheme(next);
  };

  const icon =
    appTheme === 'professional' ? <Briefcase className="h-4 w-4" /> :
    appTheme === 'system' ? <Monitor className="h-4 w-4" /> :
    resolvedTheme === 'dark' ? <Moon className="h-4 w-4" /> :
    <Sun className="h-4 w-4" />;

  const label = THEME_LABELS[appTheme];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      className="h-9 w-9 relative"
      title={`Tema: ${label} (klikni za switch)`}
      aria-label={`Tema: ${label}. Klikni za preklop na naslednjo temo.`}
    >
      {icon}
      {compact && <span className="sr-only">{label}</span>}
    </Button>
  );
}
