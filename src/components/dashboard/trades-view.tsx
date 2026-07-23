'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RefreshCw, Plus, Pencil, Trash2, TrendingUp, TrendingDown, Wallet, Target, ExternalLink, ShoppingCart, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Trade {
  id: string;
  listingId: string | null;
  title: string;
  category: string;
  imageUrl: string | null;
  url: string | null;
  buyPrice: number;
  buyDate: string;
  buyLocation: string;
  buyFees: number;
  sellPrice: number | null;
  sellDate: string | null;
  sellLocation: string;
  sellFees: number;
  status: string;
  notes: string;
  createdAt: string;
  listing?: { id: string; title: string; url: string; imageUrl: string | null; monitor?: { name: string } } | null;
}

interface TradeStats {
  totalTrades: number;
  heldCount: number;
  soldCount: number;
  realizedProfit: number;
  totalInvestedHeld: number;
  totalRealizedRevenue: number;
  totalRealizedCost: number;
  avgRoiPercent: number;
  byCategory: Array<{ category: string; count: number; profit: number; invested: number }>;
  byMonth: Array<{ month: string; profit: number; count: number }>;
}

const CATEGORIES = ['elektronika', 'avto', 'nepremičnina', 'pohištvo', 'oblačila', 'orodje', 'kolektorstvo', 'drugo'];

export function TradesView() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Trade | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<string>('all');

  const load = useCallback(async () => {
    try {
      const [tradesRes, statsRes] = await Promise.all([
        fetch('/api/trades'),
        fetch('/api/trades/stats'),
      ]);
      if (tradesRes.ok) setTrades(await tradesRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } catch {
      toast.error('Ne morem naložiti tradov');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const deleteTrade = async (t: Trade) => {
    if (!confirm(`Izbrišem trade "${t.title}"?`)) return;
    try {
      await fetch(`/api/trades/${t.id}`, { method: 'DELETE' });
      toast.success('Trade izbrisan');
      await load();
    } catch {
      toast.error('Napaka');
    }
  };

  const filtered = filter === 'all' ? trades : trades.filter(t => t.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Skladišče
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Sledi kupljene in prodane oglase — izračunaj profit in ROI.
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="w-3.5 h-3.5" /> Nov trade
        </Button>
      </div>

      {/* Stats overview */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox
            icon={<Wallet className="w-4 h-4" />}
            label="Realiziran profit"
            value={`${stats.realizedProfit >= 0 ? '+' : ''}${stats.realizedProfit.toFixed(2)} €`}
            color={stats.realizedProfit >= 0 ? 'text-primary' : 'text-destructive'}
          />
          <StatBox
            icon={<Target className="w-4 h-4" />}
            label="Povprečni ROI"
            value={`${stats.avgRoiPercent >= 0 ? '+' : ''}${stats.avgRoiPercent}%`}
            color={stats.avgRoiPercent >= 0 ? 'text-primary' : 'text-destructive'}
          />
          <StatBox
            icon={<ShoppingCart className="w-4 h-4" />}
            label="V skladišču"
            value={`${stats.heldCount} (${stats.totalInvestedHeld.toFixed(0)} €)`}
            color="text-amber-400"
          />
          <StatBox
            icon={<TrendingUp className="w-4 h-4" />}
            label="Prodani"
            value={`${stats.soldCount} (${stats.totalRealizedRevenue.toFixed(0)} €)`}
            color="text-primary"
          />
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {['all', 'held', 'sold', 'cancelled'].map(f => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'default' : 'outline'}
            onClick={() => setFilter(f)}
            className={cn('h-7 text-xs uppercase', filter === f && 'bg-primary text-primary-foreground')}
          >
            {f === 'all' ? 'Vsi' : f === 'held' ? 'V skladišču' : f === 'sold' ? 'Prodani' : 'Preklicani'}
          </Button>
        ))}
      </div>

      {/* Trades list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-card animate-pulse rounded" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="bg-card/50">
          <CardContent className="p-8 text-center">
            <TrendingUp className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">Še ni tradov. Dodaj prvi trade z gumbom "Nov trade".</p>
            <p className="text-xs text-muted-foreground mt-1">Ko v Listings klikneš "Kupi", se bo samodejno dodal sem.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(t => <TradeRow key={t.id} trade={t} onEdit={() => { setEditing(t); setShowForm(true); }} onDelete={() => deleteTrade(t)} />)}
        </div>
      )}

      <TradeFormDialog open={showForm} onOpenChange={setShowForm} editing={editing} onSaved={() => { setShowForm(false); load(); }} />
    </div>
  );
}

function StatBox({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <Card className="bg-card/50">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
          <span className={color}>{icon}</span>
        </div>
        <div className={cn('text-lg font-bold font-mono', color)}>{value}</div>
      </CardContent>
    </Card>
  );
}

function TradeRow({ trade, onEdit, onDelete }: { trade: Trade; onEdit: () => void; onDelete: () => void }) {
  const totalCost = trade.buyPrice + (trade.buyFees || 0);
  const revenue = trade.sellPrice != null ? trade.sellPrice - (trade.sellFees || 0) : null;
  const profit = revenue != null ? revenue - totalCost : null;
  const roi = (profit != null && totalCost > 0) ? (profit / totalCost) * 100 : null;

  const statusBadge =
    trade.status === 'held' ? { text: 'V SKLADIŠČU', cls: 'border-amber-400/40 text-amber-400' } :
    trade.status === 'sold' ? { text: 'PRODANO', cls: 'border-primary/40 text-primary' } :
    { text: 'PREKlicano', cls: 'border-muted text-muted-foreground' };

  return (
    <Card className="bg-card/50 hover:bg-card transition-colors">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          {trade.imageUrl ? (
            <img src={trade.imageUrl} alt="" className="w-16 h-16 rounded object-cover bg-muted shrink-0" loading="lazy" />
          ) : (
            <div className="w-16 h-16 rounded bg-muted/50 flex items-center justify-center shrink-0">
              <Tag className="w-4 h-4 text-muted-foreground opacity-50" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant="outline" className={cn('text-[10px] uppercase', statusBadge.cls)}>{statusBadge.text}</Badge>
              {trade.category && <Badge variant="outline" className="text-[10px]">{trade.category}</Badge>}
              {trade.listing && (
                <a href={trade.listing.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary/70 hover:text-primary flex items-center gap-0.5">
                  <ExternalLink className="w-3 h-3" /> izvirni oglas
                </a>
              )}
            </div>
            <h3 className="font-bold text-sm truncate">{trade.title}</h3>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1 flex-wrap">
              <span className="text-amber-400">Kupljeno: {trade.buyPrice} €</span>
              <span>• {new Date(trade.buyDate).toLocaleDateString('sl-SI')}</span>
              {trade.sellPrice != null && (
                <>
                  <span className="text-primary">Prodano: {trade.sellPrice} €</span>
                  {profit != null && (
                    <span className={profit >= 0 ? 'text-primary font-bold' : 'text-destructive font-bold'}>
                      {profit >= 0 ? '+' : ''}{profit.toFixed(2)} € ({roi?.toFixed(0)}% ROI)
                    </span>
                  )}
                </>
              )}
            </div>
            {trade.notes && <p className="text-[11px] text-muted-foreground mt-1 italic">{trade.notes}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <Button size="sm" variant="ghost" onClick={onEdit} className="h-7 w-7 p-0"><Pencil className="w-3.5 h-3.5" /></Button>
            <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 w-7 p-0 text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TradeFormDialog({ open, onOpenChange, editing, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; editing: Trade | null; onSaved: () => void }) {
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
  const [saving, setSaving] = useState(false);

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
    } else {
      setTitle(''); setCategory('elektronika'); setBuyPrice('');
      setBuyDate(new Date().toISOString().slice(0, 10));
      setBuyLocation('Bolha'); setBuyFees('');
      setSellPrice(''); setSellDate(''); setSellLocation(''); setSellFees('');
      setStatus('held'); setNotes('');
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
      };
      const res = await fetch(
        editing ? `/api/trades/${editing.id}` : '/api/trades',
        { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!res.ok) throw new Error();
      toast.success(editing ? 'Trade posodobljen' : 'Trade dodan');
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
