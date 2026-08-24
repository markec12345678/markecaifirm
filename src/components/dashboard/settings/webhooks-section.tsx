'use client';

// v8.95: WebhooksSection — integracije z zunanjimi servisi (Zapier, Make, n8n, custom API).
// Izločeno iz settings-view.tsx (samostojna komponenta, brez props).

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Zap, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function WebhooksSection() {
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<string[]>(['alert.created']);
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/webhooks');
      if (res.ok) {
        const data = await res.json();
        setEndpoints(data.endpoints || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim() || !url.trim()) {
      toast.error('Ime in URL sta obvezna');
      return;
    }
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, secret, events }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success('Webhook ustvarjen');
        setName(''); setUrl(''); setSecret(''); setEvents(['alert.created']);
        setShowForm(false);
        await load();
      } else {
        toast.error(data.error ?? 'Napaka');
      }
    } catch { toast.error('Napaka'); }
  };

  const toggle = async (id: string, isActive: boolean) => {
    await fetch('/api/webhooks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isActive: !isActive }),
    });
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm('Izbrišem ta webhook?')) return;
    await fetch(`/api/webhooks?id=${id}`, { method: 'DELETE' });
    toast.success('Webhook izbrisan');
    await load();
  };

  const test = async (id: string) => {
    setTesting(id);
    try {
      const res = await fetch(`/api/webhooks?test=${id}`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        toast.success(`✓ Test uspešen (HTTP ${data.status})`);
      } else {
        toast.error(`Test spodletel: ${data.error ?? `HTTP ${data.status}`}`);
      }
    } catch { toast.error('Napaka'); }
    finally { setTesting(null); }
  };

  const toggleEvent = (ev: string) => {
    setEvents(prev => prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]);
  };

  const eventLabels: Record<string, string> = {
    'alert.created': '🚨 Nov alert',
    'price.drop': '📉 Padec cene',
    'target.hit': '🎯 Ciljna cena dosežena',
    'listing.new': '📋 Nov oglas',
    'trade.sold': '💰 Trade prodan',
    '*': '⚡ Vsi eventi',
  };

  return (
    <Card className="bg-card/50">
      <CardHeader>
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          Webhook integracije
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v5.4</Badge>
        </CardTitle>
        <CardDescription>
          Pošiljaj alerte na zunanje servise (Zapier, Make, n8n, custom API). Podpira HMAC SHA-256 signature.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)} className="gap-2">
          {showForm ? 'Prekliči' : 'Dodaj webhook'}
        </Button>

        {showForm && (
          <div className="bg-card/30 border border-border rounded p-3 space-y-2">
            <div>
              <Label className="text-xs uppercase">Ime</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. Zapier - Slack" className="mt-1 text-xs" />
            </div>
            <div>
              <Label className="text-xs uppercase">URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/..." className="mt-1 text-xs font-mono" />
            </div>
            <div>
              <Label className="text-xs uppercase">Secret (opcionalno, za HMAC)</Label>
              <Input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="skrivnost za signature" className="mt-1 text-xs font-mono" />
            </div>
            <div>
              <Label className="text-xs uppercase">Eventi</Label>
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {Object.entries(eventLabels).map(([ev, label]) => (
                  <button
                    key={ev}
                    onClick={() => toggleEvent(ev)}
                    className={cn(
                      'px-2 py-0.5 rounded text-[10px] border transition-colors',
                      events.includes(ev)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <Button size="sm" className="w-full" onClick={create}>Ustvari webhook</Button>
          </div>
        )}

        {loading ? (
          <p className="text-xs text-muted-foreground text-center py-4">Nalagam...</p>
        ) : endpoints.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">Ni webhookov. Dodaj prvega z "Dodaj webhook".</p>
        ) : (
          <div className="space-y-2">
            {endpoints.map((ep: { id: string; name: string; url: string; isActive: boolean; events: string[]; triggerCount: number; failCount: number; lastTriggeredAt: string | null; lastResponseStatus: number | null; lastError: string | null }) => (
              <div key={ep.id} className={cn(
                'border rounded p-2 text-xs',
                ep.isActive ? 'bg-card/50 border-border' : 'bg-card/30 border-border opacity-60'
              )}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold">{ep.name}</span>
                      {ep.isActive ? (
                        <Badge variant="outline" className="text-[9px] text-primary border-primary/40">AKTIVNO</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] text-muted-foreground">IZKLOP</Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">{ep.url}</div>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {ep.events.map((ev: string) => (
                        <Badge key={ev} variant="outline" className="text-[9px]">{eventLabels[ev] || ev}</Badge>
                      ))}
                    </div>
                    {ep.lastTriggeredAt && (
                      <div className="text-[9px] text-muted-foreground mt-1">
                        Zadnjič: {new Date(ep.lastTriggeredAt).toLocaleString('sl-SI')} •
                        Trig: {ep.triggerCount} • Fail: {ep.failCount}
                        {ep.lastResponseStatus && ` • HTTP ${ep.lastResponseStatus}`}
                      </div>
                    )}
                    {ep.lastError && (
                      <div className="text-[9px] text-red-500 mt-0.5">⚠️ {ep.lastError}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-6 text-[10px]" disabled={testing === ep.id} onClick={() => test(ep.id)}>
                      {testing === ep.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Test'}
                    </Button>
                    <button onClick={() => toggle(ep.id, ep.isActive)} className="text-[10px] px-1.5 py-0.5 rounded border">
                      {ep.isActive ? 'OFF' : 'ON'}
                    </button>
                    <button onClick={() => remove(ep.id)} className="text-muted-foreground hover:text-red-500 p-1">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">📖 Dokumentacija</summary>
          <div className="mt-2 space-y-2 bg-background/30 rounded p-2">
            <p><b>Eventi:</b></p>
            <ul className="list-disc list-inside space-y-0.5 ml-2">
              <li><code>alert.created</code> — nov alert (PRILIKA/SUMNJIVO)</li>
              <li><code>price.drop</code> — cena oglasa padla</li>
              <li><code>target.hit</code> — ciljna cena dosežena</li>
              <li><code>listing.new</code> — nov oglas scraped</li>
              <li><code>trade.sold</code> — trade prodan v skladišču</li>
            </ul>
            <p className="mt-2"><b>Headers:</b></p>
            <ul className="list-disc list-inside space-y-0.5 ml-2">
              <li><code>Content-Type: application/json</code></li>
              <li><code>X-Markec-Event: &lt;event&gt;</code></li>
              <li><code>X-Markec-Signature: &lt;HMAC-SHA256&gt;</code> (če je secret nastavljen)</li>
            </ul>
            <p className="mt-2"><b>Verify signature (Node.js):</b></p>
            <pre className="bg-background p-1 rounded text-[10px] overflow-x-auto">{`const sig = crypto.createHmac('sha256', secret)
  .update(JSON.stringify(body)).digest('hex');
if (sig !== req.headers['x-markec-signature']) {
  return res.status(401).send('Invalid signature');
}`}</pre>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
