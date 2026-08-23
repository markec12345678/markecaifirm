'use client';

// v8.99: CsvImportDialog — extracted from trades-view.tsx.

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


export function CsvImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported: () => void;
}) {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  // Result from server after import
  const [result, setResult] = useState<{
    ok: boolean;
    created?: number;
    errors?: Array<{ rowNumber: number; field: string; message: string; rawValue: string }>;
    totalRows?: number;
    validCount?: number;
    errorCount?: number;
    error?: string;
  } | null>(null);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setCsvText('');
        setFileName('');
        setResult(null);
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    try {
      const text = await file.text();
      setCsvText(text);
      setResult(null); // clear previous result when new file loaded
    } catch {
      toast.error('Ne morem prebrati datoteke');
    }
  };

  const handlePaste = (text: string) => {
    setCsvText(text);
    setFileName(text ? '<paste>' : '');
    setResult(null);
  };

  const doImport = async () => {
    if (!csvText.trim()) {
      toast.error('Najprej izberi CSV datoteko ali prilepi CSV text');
      return;
    }
    setImporting(true);
    setResult(null);
    try {
      const res = await fetch('/api/trades/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setResult(data);
        toast.success(`✓ Uvoženih ${data.created} trade-ov`);
        if (data.errorCount > 0) {
          toast.warning(`${data.errorCount} vrstic preskočenih (napake)`);
        }
        // Auto-close + refresh after short delay (so user sees toast)
        if (data.errorCount === 0) {
          setTimeout(() => onImported(), 1500);
        }
      } else {
        setResult(data);
        toast.error(data.error ?? 'Napaka pri uvozu');
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Napaka pri povezavi');
    } finally {
      setImporting(false);
    }
  };

  // CSV preview — split csvText into rows for display (max 8 rows shown)
  const previewRows = csvText
    ? csvText
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter((r) => r.trim())
        .slice(0, 8)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-primary" />
            Uvozi trades iz CSV
          </DialogTitle>
          <DialogDescription>
            Podpira slovenske in angleške naslove (naslov/title, kategorija/category, nakupcena/buyPrice...).
            Avtomatska detekcija , ali ; ločila. Vrstice z napakami se preskočijo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* File upload + paste textarea */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
            <div className="space-y-2">
              <Label className="text-xs uppercase">1. Izberi CSV datoteko</Label>
              <Input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
                className="text-xs file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:bg-primary file:text-primary-foreground file:cursor-pointer file:text-xs"
              />
              {/* Template download link */}
              <a
                href="/api/trades/csv-template"
                download="trade-template.csv"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <FileText className="w-3 h-3" />
                Prenesi predlogo CSV
              </a>
            </div>
            <div className="flex items-end">
              <span className="text-[10px] text-muted-foreground">
                {fileName ? `📄 ${fileName}` : 'ali prilepi CSV spodaj'}
              </span>
            </div>
          </div>

          {/* Paste textarea (alternative to file upload) */}
          <div>
            <Label className="text-xs uppercase">2. Ali prilepi CSV text</Label>
            <Textarea
              value={csvText}
              onChange={(e) => handlePaste(e.target.value)}
              placeholder={'title,category,buyPrice,buyDate,buyLocation\niPhone 13,elektronika,280,2026-07-01,Bolha'}
              className="mt-1 font-mono text-[11px] min-h-[100px] max-h-40"
            />
          </div>

          {/* CSV preview */}
          {previewRows.length > 0 && (
            <div>
              <Label className="text-xs uppercase">Predogled (max 8 vrstic)</Label>
              <div className="mt-1 border border-border rounded bg-background/50 overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-[10px] font-mono">
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className={i === 0 ? 'bg-primary/5 font-bold' : ''}>
                        <td className="px-2 py-0.5 text-muted-foreground border-r border-border w-8">
                          {i === 0 ? '#' : i}
                        </td>
                        <td className="px-2 py-0.5 whitespace-pre">{row}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter((r) => r.trim()).length > 8 && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  (+{csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter((r) => r.trim()).length - 8} več vrstic...)
                </p>
              )}
            </div>
          )}

          {/* Import result */}
          {result && (
            <div className="border border-border rounded p-3 bg-background/30">
              {result.ok ? (
                <>
                  <div className="text-sm font-medium text-primary mb-2">
                    ✓ Uvoz uspešen — {result.created} trade-ov ustvarjenih
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-background/50 rounded p-1.5 text-center">
                      <div className="text-[9px] text-muted-foreground uppercase">Skupaj</div>
                      <div className="font-mono font-bold">{result.totalRows ?? 0}</div>
                    </div>
                    <div className="bg-background/50 rounded p-1.5 text-center">
                      <div className="text-[9px] text-muted-foreground uppercase">Uvoženi</div>
                      <div className="font-mono font-bold text-primary">{result.validCount ?? 0}</div>
                    </div>
                    <div className="bg-background/50 rounded p-1.5 text-center">
                      <div className="text-[9px] text-muted-foreground uppercase">Napake</div>
                      <div className={cn('font-mono font-bold', (result.errorCount ?? 0) > 0 ? 'text-amber-400' : 'text-muted-foreground')}>
                        {result.errorCount ?? 0}
                      </div>
                    </div>
                  </div>
                  {result.errors && result.errors.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[10px] uppercase text-amber-400 mb-1">
                        Napake ({result.errors.length}):
                      </div>
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {result.errors.slice(0, 30).map((err, i) => (
                          <div key={i} className="text-[10px] bg-amber-400/5 border border-amber-400/20 rounded p-1.5">
                            <span className="text-muted-foreground">Vrstica {err.rowNumber}</span>
                            {' · '}
                            <span className="font-mono text-amber-400">{err.field}</span>
                            {': '}
                            <span>{err.message}</span>
                            {err.rawValue && (
                              <span className="text-muted-foreground ml-1">({err.rawValue})</span>
                            )}
                          </div>
                        ))}
                        {result.errors.length > 30 && (
                          <p className="text-[10px] text-muted-foreground text-center">
                            (+{result.errors.length - 30} več napak...)
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {(result.errorCount ?? 0) === 0 && (
                    <p className="text-[10px] text-muted-foreground mt-2 text-center">
                      Zapiranje in osveževanje...
                    </p>
                  )}
                </>
              ) : (
                <div className="text-sm text-red-500">
                  ❌ {result.error ?? 'Napaka pri uvozu'}
                  {result.errors && result.errors.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {result.errors.slice(0, 5).map((err, i) => (
                        <div key={i} className="text-[10px] bg-red-500/5 border border-red-500/20 rounded p-1.5">
                          <span className="text-muted-foreground">Vrstica {err.rowNumber}</span>
                          {' · '}
                          <span className="font-mono text-red-500">{err.field}</span>
                          {': '}
                          <span>{err.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button
            onClick={doImport}
            disabled={importing || !csvText.trim()}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {importing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {csvText.trim() ? `Uvozi ${csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter((r) => r.trim()).length - 1} trades` : 'Uvozi'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

