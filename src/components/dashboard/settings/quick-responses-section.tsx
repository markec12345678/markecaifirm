'use client';

// v8.95: QuickResponsesSection — shranjena sporočila za kontakt prodajalcev.
// Izločeno iz settings-view.tsx (samostojna komponenta, brez props).

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RefreshCw, Plus, X, FileText, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export function QuickResponsesSection() {
  const [templates, setTemplates] = useState<Array<{ name: string; text: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newText, setNewText] = useState('');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/quick-responses');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/quick-responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates }),
      });
      if (res.ok) toast.success('Predloge shranjene');
      else toast.error('Napaka pri shranjevanju');
    } catch { toast.error('Napaka'); }
    finally { setSaving(false); }
  };

  const add = () => {
    if (!newName.trim() || !newText.trim()) {
      toast.error('Ime in besedilo sta obvezna');
      return;
    }
    setTemplates([...templates, { name: newName.trim(), text: newText.trim() }]);
    setNewName('');
    setNewText('');
    toast.success('Predloga dodana (shrani za uveljavitev)');
  };

  const remove = (idx: number) => {
    setTemplates(templates.filter((_, i) => i !== idx));
  };

  const copyText = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    toast.success('Kopirano');
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  if (loading) return <div className="h-20 animate-pulse bg-muted rounded" />;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Shranite pogosto uporabljena sporočila za prodajalce. Kliknite za kopiranje v clipboard, nato prilepite v Bolha/FB sporočilo.
      </p>

      {/* Existing templates */}
      {templates.length > 0 && (
        <div className="space-y-2">
          {templates.map((t, i) => (
            <div key={i} className="bg-background/50 border border-border rounded p-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-bold text-primary">{t.name}</span>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => copyText(t.text, i)} className="h-6 px-2 text-xs gap-1">
                    {copiedIdx === i ? <CheckCircle2 className="w-3 h-3 text-primary" /> : <FileText className="w-3 h-3" />}
                    {copiedIdx === i ? 'Kopirano' : 'Kopiraj'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(i)} className="h-6 w-6 p-0 text-destructive">
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{t.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Add new template */}
      <div className="border-t border-border pt-3 space-y-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Ime (npr. 'Zacetno povprasovanje')"
          className="text-xs"
        />
        <Textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Pozdravljen, ali je oglas še na voljo? Zanima me stanje in ali bi prišlo do dogovora o ceni. LP"
          className="text-xs min-h-[60px]"
        />
        <Button size="sm" variant="outline" onClick={add} className="gap-1.5 h-7 text-xs">
          <Plus className="w-3 h-3" /> Dodaj predlogo
        </Button>
      </div>

      <Button size="sm" onClick={save} disabled={saving} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
        {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
        Shrani predloge
      </Button>
    </div>
  );
}
