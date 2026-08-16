'use client';

// v8.36: Quick Add Trade Modal — reusable compact modal for adding trades
// from anywhere (Dashboard, AI Hub, Trades view).
//
// Unlike the full TradeFormDialog (which has 14 fields + 3 sections), this
// modal exposes only the essentials for fast entry: title, category, buyPrice,
// buyLocation, sellPrice (optional), status. Everything else defaults.
//
// Props:
//   - open: boolean (controlled)
//   - onOpenChange: (v: boolean) => void
//   - onSaved?: () => void  (callback after successful save — for refresh)
//
// POSTs to /api/trades on save. Toast: "✓ Trade dodan".

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { triggerGlobalRefresh } from '@/hooks/use-global-refresh';

const CATEGORIES = [
  'elektronika',
  'avto',
  'nepremičnina',
  'pohištvo',
  'oblačila',
  'orodje',
  'kolektorstvo',
  'drugo',
];

interface QuickAddTradeModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
}

export function QuickAddTradeModal({
  open,
  onOpenChange,
  onSaved,
}: QuickAddTradeModalProps) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('elektronika');
  const [buyPrice, setBuyPrice] = useState('');
  const [buyLocation, setBuyLocation] = useState('Bolha');
  const [sellPrice, setSellPrice] = useState('');
  const [status, setStatus] = useState('held');
  const [saving, setSaving] = useState(false);

  // Reset form when modal closes (so re-open shows blank fields)
  useEffect(() => {
    if (!open) {
      // Small delay to avoid visual flash during close animation
      const t = setTimeout(() => {
        setTitle('');
        setCategory('elektronika');
        setBuyPrice('');
        setBuyLocation('Bolha');
        setSellPrice('');
        setStatus('held');
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  const save = async () => {
    // Validation
    if (!title.trim()) {
      toast.error('Ime artikla je obvezno');
      return;
    }
    const buyPriceNum = parseFloat(buyPrice.replace(',', '.'));
    if (isNaN(buyPriceNum) || buyPriceNum < 0) {
      toast.error('Kupna cena mora biti pozitivno število');
      return;
    }
    const sellPriceNum = sellPrice.trim()
      ? parseFloat(sellPrice.replace(',', '.'))
      : null;
    if (sellPriceNum != null && (isNaN(sellPriceNum) || sellPriceNum < 0)) {
      toast.error('Prodajna cena mora biti pozitivno število');
      return;
    }

    setSaving(true);
    try {
      // Auto-set status to 'sold' if sellPrice is provided and status is still 'held'
      const finalStatus =
        sellPriceNum != null && status === 'held' ? 'sold' : status;

      const body: Record<string, unknown> = {
        title: title.trim(),
        category,
        buyPrice: buyPriceNum,
        buyLocation: buyLocation.trim() || 'Bolha',
        status: finalStatus,
        notes: '',
      };
      if (sellPriceNum != null) {
        body.sellPrice = sellPriceNum;
        body.sellDate = new Date().toISOString();
      }

      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      toast.success('✓ Trade dodan');
      onOpenChange(false);
      onSaved?.();
      triggerGlobalRefresh('trade-added'); // v8.57: all cards refetch instantly
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri shranjevanju');
    } finally {
      setSaving(false);
    }
  };

  // Computed profit preview (when both prices available)
  const buyNum = parseFloat(buyPrice.replace(',', '.'));
  const sellNum = sellPrice.trim() ? parseFloat(sellPrice.replace(',', '.')) : NaN;
  const showProfit =
    !isNaN(buyNum) && buyNum > 0 && !isNaN(sellNum) && sellNum > 0;
  const profit = showProfit ? sellNum - buyNum : 0;
  const roi =
    showProfit && buyNum > 0 ? (profit / buyNum) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" />
            Hitri dodaj trade
          </DialogTitle>
          <DialogDescription>
            Kompakten obrazec za hitro dodajanje — za podrobnosti uporabi &quot;Nov trade&quot; v Skladišču.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div>
            <Label className="text-xs uppercase">Ime artikla *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="npr. iPhone 13 Pro 256GB"
              className="mt-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !saving) save();
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase">Kategorija</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="held">V skladišču</SelectItem>
                  <SelectItem value="sold">Prodano</SelectItem>
                  <SelectItem value="cancelled">Preklicano</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase">Kupna cena (€) *</Label>
              <Input
                type="number"
                step="0.01"
                value={buyPrice}
                onChange={(e) => setBuyPrice(e.target.value)}
                placeholder="0.00"
                className="mt-1 font-mono"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !saving) save();
                }}
              />
            </div>
            <div>
              <Label className="text-xs uppercase">Lokacija nakupa</Label>
              <Input
                value={buyLocation}
                onChange={(e) => setBuyLocation(e.target.value)}
                placeholder="Bolha, FB, trgovina"
                className="mt-1 text-xs"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs uppercase">
              Prodajna cena (€) — neobvezno
            </Label>
            <Input
              type="number"
              step="0.01"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              placeholder="prazno = še ni prodano"
              className="mt-1 font-mono"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !saving) save();
              }}
            />
          </div>

          {showProfit && (
            <div className="bg-primary/5 border border-primary/30 rounded p-2 text-xs flex items-center justify-between">
              <span className="text-muted-foreground">Profit / ROI:</span>
              <span
                className={
                  profit >= 0
                    ? 'text-primary font-mono font-bold'
                    : 'text-red-500 font-mono font-bold'
                }
              >
                {profit >= 0 ? '+' : ''}
                {profit.toFixed(2)}€ · {roi >= 0 ? '+' : ''}
                {roi.toFixed(1)}%
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Prekliči
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            Dodaj trade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
