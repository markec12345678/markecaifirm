'use client';

// v4.8: PWA install prompt — captures beforeinstallprompt event and shows banner

import { useEffect, useState } from 'react';
import { Download, X, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already installed (standalone mode)
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true;
    setIsStandalone(standalone);

    if (standalone) return; // Already installed, no need to prompt

    // Check if user previously dismissed
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed === 'true') return;

    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Show banner after 3 seconds delay (less intrusive)
      setTimeout(() => setShowBanner(true), 3000);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Listen for successful install
    window.addEventListener('appinstalled', () => {
      setShowBanner(false);
      setDeferredPrompt(null);
      setIsStandalone(true);
      toast.success('✓ Aplikacija nameščena! Najdeš jo na domačem zaslonu.');
    });

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      toast.success('Namestitev se je začela...');
    } else {
      // User declined — don't show again for this session
      localStorage.setItem('pwa-install-dismissed', 'true');
    }
    setDeferredPrompt(null);
    setShowBanner(false);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  if (isStandalone || !showBanner || !deferredPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-4 sm:right-auto sm:max-w-sm z-40 animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-card border border-primary/40 rounded-lg shadow-xl p-4 flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center">
            <Smartphone className="w-5 h-5 text-primary" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-primary flex items-center gap-1.5">
            Namesti aplikacijo
            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/30">PWA</span>
          </h3>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            Dodaj Markec AI na domači zaslon za hitri dostop in offline delovanje.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleInstall}
              className="h-8 text-xs gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Namesti
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              className="h-8 text-xs"
            >
              Ne, hvala
            </Button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground p-1 shrink-0"
          aria-label="Zapri"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
