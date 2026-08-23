'use client';

// v8.99: TradeFormDialog — extracted from trades-view.tsx.

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Plus, Pencil, Trash2, TrendingUp, TrendingDown, Wallet, Target, ExternalLink, ShoppingCart, Tag, Download, Sparkles, Check, Copy, AlertTriangle, Boxes, Flame, FileText, Receipt, Network, Clock, Type, Users, Globe, Activity, Upload, ChevronDown, ChevronUp, DollarSign } from 'lucide-react';
import { FlipChecklist } from '@/components/dashboard/flip-checklist';
import { TagsInput } from '@/components/ui/tags-input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Trade } from './types';
import { CATEGORIES, parseTagsLocal } from './utils';
import { triggerGlobalRefresh } from '@/hooks/use-global-refresh';


export function TradeFormDialog({ open, onOpenChange, editing, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; editing: Trade | null; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('elektronika');
  const [buyPrice, setBuyPrice] = useState('');
  const [buyDate, setBuyDate] = useState('');
  const [buyLocation, setBuyLocation] = useState('Bolha');
  const [buyFees, setBuyFees] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [sellDate, setSellDate] = useState('');
  const [sellLocation, setSellLocation] = useState('');
  const [sellFees, setSellFees] = useState('');
  const [status, setStatus] = useState('held');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]); // v8.63
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]); // v8.63
  const [saving, setSaving] = useState(false);

  // v8.63: Fetch existing tags for autocomplete suggestions (cached for the session)
  useEffect(() => {
    if (tagSuggestions.length > 0) return;
    fetch('/api/trades/tags').then(r => r.json()).then(d => {
      if (d?.ok && Array.isArray(d.tags)) setTagSuggestions(d.tags);
    }).catch(() => {});
  }, [tagSuggestions.length]);

  useEffect(() => {
    if (editing) {
      setTitle(editing.title);
      setCategory(editing.category || 'elektronika');
      setBuyPrice(String(editing.buyPrice));
      setBuyDate(editing.buyDate ? new Date(editing.buyDate).toISOString().slice(0, 10) : '');
      setBuyLocation(editing.buyLocation || 'Bolha');
      setBuyFees(String(editing.buyFees || ''));
      setSellPrice(editing.sellPrice != null ? String(editing.sellPrice) : '');
      setSellDate(editing.sellDate ? new Date(editing.sellDate).toISOString().slice(0, 10) : '');
      setSellLocation(editing.sellLocation || '');
      setSellFees(String(editing.sellFees || ''));
      setStatus(editing.status);
      setNotes(editing.notes);
      // v8.63: parse existing tags
      setTags(editing.tagsArray ?? parseTagsLocal(editing.tags));
    } else {
      setTitle(''); setCategory('elektronika'); setBuyPrice('');
      setBuyDate(new Date().toISOString().slice(0, 10));
      setBuyLocation('Bolha'); setBuyFees('');
      setSellPrice(''); setSellDate(''); setSellLocation(''); setSellFees('');
      setStatus('held'); setNotes('');
      setTags([]);
    }
  }, [editing, open]);

  const save = async () => {
    if (!title.trim() || !buyPrice) {
      toast.error('Ime in kupna cena sta obvezna');
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        category,
        buyPrice: parseFloat(buyPrice),
        buyDate: buyDate ? new Date(buyDate).toISOString() : undefined,
        buyLocation: buyLocation.trim(),
        buyFees: buyFees ? parseFloat(buyFees) : 0,
        sellPrice: sellPrice ? parseFloat(sellPrice) : null,
        sellDate: sellDate ? new Date(sellDate).toISOString() : null,
        sellLocation: sellLocation.trim(),
        sellFees: sellFees ? parseFloat(sellFees) : 0,
        status,
        notes: notes.trim(),
        tags, // v8.63
      };
      const res = await fetch(
        editing ? `/api/trades/${editing.id}` : '/api/trades',
        { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!res.ok) throw new Error();
      toast.success(editing ? 'Trade posodobljen' : 'Trade dodan');
      triggerGlobalRefresh(editing ? 'trade-updated' : 'trade-created'); // v8.57
      onSaved();
    } catch {
      toast.error('Napaka pri shranjevanju');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Uredi trade' : 'Nov trade'}</DialogTitle>
          <DialogDescription>Sledi nakup, morebitno prodajo in profit.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs uppercase">Ime artikla *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="npr. iPhone 13 Pro 256GB" className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase">Kategorija</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="held">V skladišču</SelectItem>
                  <SelectItem value="sold">Prodano</SelectItem>
                  <SelectItem value="cancelled">Preklicano</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="border-t border-border pt-3">
            <h4 className="text-xs uppercase tracking-wider text-amber-400 mb-2">Kupna stran</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase">Kupna cena (€) *</Label>
                <Input type="number" step="0.01" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs uppercase">Datum nakupa</Label>
                <Input type="date" value={buyDate} onChange={e => setBuyDate(e.target.value)} className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs uppercase">Lokacija nakupa</Label>
                <Input value={buyLocation} onChange={e => setBuyLocation(e.target.value)} placeholder="Bolha, FB, trgovina" className="mt-1 text-xs" />
              </div>
              <div>
                <Label className="text-xs uppercase">Pristojbine nakupa (€)</Label>
                <Input type="number" step="0.01" value={buyFees} onChange={e => setBuyFees(e.target.value)} placeholder="0.00" className="mt-1 font-mono" />
              </div>
            </div>
          </div>
          <div className="border-t border-border pt-3">
            <h4 className="text-xs uppercase tracking-wider text-primary mb-2">Prodajna stran (izpolni ob prodaji)</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase">Prodajna cena (€)</Label>
                <Input type="number" step="0.01" value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder="prazno = ni še prodano" className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs uppercase">Datum prodaje</Label>
                <Input type="date" value={sellDate} onChange={e => setSellDate(e.target.value)} className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs uppercase">Lokacija prodaje</Label>
                <Input value={sellLocation} onChange={e => setSellLocation(e.target.value)} placeholder="Bolha, FB..." className="mt-1 text-xs" />
              </div>
              <div>
                <Label className="text-xs uppercase">Pristojbine prodaje (€)</Label>
                <Input type="number" step="0.01" value={sellFees} onChange={e => setSellFees(e.target.value)} placeholder="0.00" className="mt-1 font-mono" />
              </div>
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase">Opombe</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Stanje, dodatna oprema, kontakt prodajalca..." className="mt-1 text-xs min-h-[60px]" />
          </div>
          {/* v8.63: Tags */}
          <div>
            <Label className="text-xs uppercase flex items-center gap-1.5"><Tag className="h-3 w-3" /> Tagi</Label>
            <TagsInput
              value={tags}
              onChange={setTags}
              suggestions={tagSuggestions}
              placeholder="flip, premium, restock, eksperiment…"
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">Oznake za fleksibilno kategorizacijo (uporabljajo se za filtriranje in analitiko).</p>
          </div>
          {buyPrice && sellPrice && (
            <div className="bg-primary/5 border border-primary/30 rounded p-3 text-sm">
              <span className="text-muted-foreground">Profit: </span>
              <span className="text-primary font-bold">
                +{(parseFloat(sellPrice) - parseFloat(buyPrice) - (parseFloat(sellFees) || 0) - (parseFloat(buyFees) || 0)).toFixed(2)} €
              </span>
              <span className="text-muted-foreground ml-2">ROI: </span>
              <span className="text-primary font-bold">
                {(((parseFloat(sellPrice) - parseFloat(buyPrice) - (parseFloat(sellFees) || 0) - (parseFloat(buyFees) || 0)) / parseFloat(buyPrice)) * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button onClick={save} disabled={saving} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            {editing ? 'Shrani' : 'Dodaj trade'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// v8.36: CSV Import Dialog — file upload + preview + bulk create
// POST /api/trades/import-csv with CSV text (JSON {csv: string} or multipart file)
// Supports Slovenian + English headers, auto-detect ,/; delimiter, quoted fields.
// GET /api/trades/csv-template for template download link.

