'use client';

/**
 * v6.92: LoginModal — preprost modal za vnos APP_API_KEY.
 *
 * Klic:
 *   const { needsAuth, LoginModal } = useAuth();
 *   // ... v JSX:
 *   {needsAuth && <LoginModal onSuccess={() => location.reload()} />}
 *
 * Po uspehu: POST /api/auth/set-key nastavi cookie, nato refresh.
 * Cookie se samodejno pošlje z vsakim nadaljnjim fetch() — ni treba
 * spreminjati obstoječih 204 fetch klicev v dashboard komponentah.
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Lock, ShieldCheck } from 'lucide-react';

export function useAuth() {
  const [authState, setAuthState] = useState<{ authEnabled: boolean; authenticated: boolean } | null>(null);

  useEffect(() => {
    fetch('/api/auth/check')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setAuthState({ authEnabled: data.authEnabled, authenticated: data.authenticated });
      })
      .catch(() => {/* ignore — auth morda izklopljen */});
  }, []);

  return {
    authState,
    needsAuth: authState?.authEnabled === true && authState?.authenticated === false,
  };
}

export function LoginModal({ onSuccess }: { onSuccess?: () => void }) {
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!key.trim()) {
      toast.error('Vnesi API ključ');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/set-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Napačen ključ');
        return;
      }
      toast.success('Avtentikacija uspešna');
      onSuccess?.();
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri prijavi');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={true}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Avtentikacija zahtevana
          </DialogTitle>
          <DialogDescription>
            Vnesi API ključ aplikacije (APP_API_KEY v .env). Ključ se shrani
            v cookie in samodejno pošlje z vsakim nadaljnjim zahtevkom.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="api-key">API ključ</Label>
          <div className="flex gap-2">
            <Lock className="w-4 h-4 mt-2 text-muted-foreground" />
            <Input
              id="api-key"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="64-znakoven hex niz..."
              autoFocus
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Ključ generiraš z: <code className="px-1 py-0.5 bg-card rounded">openssl rand -hex 32</code>
            <br />
            Shrani ga v <code className="px-1 py-0.5 bg-card rounded">.env</code> kot <code className="px-1 py-0.5 bg-card rounded">APP_API_KEY</code>.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={loading || !key.trim()}>
            {loading ? 'Prijava...' : 'Prijava'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
