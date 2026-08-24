'use client';

// v1.3: Backup section component
// Izločeno iz settings-view.tsx (samostojna komponenta, brez props).
// Vključuje tudi JsonBackupControls (v4.7) kot lokalni helper.

import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Download, Upload, Trash2, FileJson } from 'lucide-react';
import { toast } from 'sonner';

export function BackupSection() {
  const [info, setInfo] = useState<{ sizeMb: string; lastModified: string } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadInfo = async () => {
    try {
      const res = await fetch('/api/backup');
      if (res.ok) {
        const data = await res.json();
        setInfo({ sizeMb: data.sizeMb, lastModified: data.lastModified });
      }
    } catch { /* ignore */ }
  };

  useEffect(() => { loadInfo(); }, []);

  const download = () => {
    window.open('/api/backup?download=1', '_blank');
    toast.success('Prenos baze se začne');
  };

  const restore = async (file: File) => {
    if (!confirm(`Obnovim bazo iz "${file.name}"? TRENUTNI PODATKI BODO ZAMENJANI. Pred obnovitvijo se bo naredila varnostna kopija.`)) return;
    setRestoring(true);
    try {
      const formData = new FormData();
      formData.append('db', file);
      const res = await fetch('/api/backup', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(data.message);
        await loadInfo();
      } else {
        toast.error(data.error ?? 'Napaka pri obnovi');
      }
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka pri obnovi');
    } finally {
      setRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const clearAll = async () => {
    if (!confirm('Izbrišem VSE oglase, alerte, run loge in heartbeate? MONITORJI in NASTAVITVE bodo ohranjene. Tega ni mogoče razveljaviti.')) return;
    if (!confirm('ZADNJI POTRDITEV: resnično izbrišem vse podatke?')) return;
    try {
      const res = await fetch('/api/backup', { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) toast.success(data.message);
      else toast.error(data.error ?? 'Napaka');
      await loadInfo();
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka');
    }
  };

  return (
    <div className="space-y-3">
      {info && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-background/50 border border-border rounded p-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Velikost</div>
            <div className="font-mono text-primary">{info.sizeMb} MB</div>
          </div>
          <div className="bg-background/50 border border-border rounded p-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Zadnja sprememba</div>
            <div className="font-mono text-primary text-[11px]">{new Date(info.lastModified).toLocaleString('sl-SI')}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Button size="sm" variant="outline" onClick={download} className="gap-2 h-8">
          <Download className="w-3.5 h-3.5" /> Prenesi .db
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={restoring}
          onClick={() => fileInputRef.current?.click()}
          className="gap-2 h-8"
        >
          {restoring ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Obnovi iz .db
        </Button>
        <Button size="sm" variant="outline" onClick={clearAll} className="gap-2 h-8 text-destructive hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" /> Počisti podatke
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".db,.sqlite,.sqlite3,application/octet-stream"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) restore(file);
        }}
      />

      <div className="text-[11px] text-muted-foreground space-y-1">
        <p>
          <b>Prenesi .db</b>: varnostna kopija celotne baze (vključno z API ključi in Telegram tokenom — hranite varno!).
        </p>
        <p>
          <b>Obnovi iz .db</b>: naloži prejšnjo varnostno kopijo. Pred obnovitvijo se samodejno naredi backup trenutne baze. Po obnovitvi <b>priporočamo ponovni zagon aplikacije</b> (Prisma client cache).
        </p>
        <p>
          <b>Počisti podatke</b>: izbriše vse oglase, alerte, run loge in heartbeate. Monitorji in nastavitve (vključno z API ključi) ostanejo. Uporabno za "fresh start" pri testiranju.
        </p>
      </div>

      {/* v4.7: JSON backup / restore — portable, human-readable */}
      <div className="border-t border-border pt-3 mt-3">
        <h4 className="text-xs uppercase tracking-wider text-primary flex items-center gap-1.5 mb-2">
          <FileJson className="w-3.5 h-3.5" />
          JSON Backup / Restore <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v4.7</Badge>
        </h4>
        <JsonBackupControls />
      </div>
    </div>
  );
}

// v4.7: JSON backup/restore — portable, human-readable, sensitive fields redacted
function JsonBackupControls() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportJson = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/backup/json');
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `markec-ai-firm-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('JSON backup prenešen');
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka pri exportu');
    } finally {
      setExporting(false);
    }
  };

  const importJson = async (file: File) => {
    if (!confirm(`Importiram JSON backup iz "${file.name}"?\n\nTo bo USTVARILO ali POSODOBILO podatke v bazi (upsert). Obstoječi podatki ostanejo, razen če jih prepiše JSON.\n\nObčutljiva polja (API ključi, tokeni) ne bodo uvožena — ostanejo trenutne vrednosti.`)) return;
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      const res = await fetch('/api/backup/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup }),
      });
      const data = await res.json();
      if (data.ok) {
        setImportResult(data);
        toast.success(`Importirano: ${data.restored.monitors} monitorjev, ${data.restored.listings} oglasov, ${data.restored.trades} tradeov`);
      } else {
        toast.error(data.error ?? 'Napaka pri importu');
      }
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? 'Napaka pri branju JSON datoteke');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={exportJson}
          disabled={exporting}
          className="gap-2 h-8"
        >
          {exporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Izvozi JSON
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="gap-2 h-8"
        >
          {importing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Uvozi JSON
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importJson(file);
        }}
      />
      {importResult && (
        <div className="bg-primary/5 border border-primary/20 rounded p-3 text-xs">
          <div className="text-[10px] uppercase tracking-wider text-primary mb-2">Import uspešen</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div>
              <div className="text-muted-foreground">Monitorji:</div>
              <div className="font-mono font-bold text-primary">{importResult.restored.monitors}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Oglasi:</div>
              <div className="font-mono font-bold text-primary">{importResult.restored.listings}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Alerti:</div>
              <div className="font-mono font-bold text-primary">{importResult.restored.alerts}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Tradei:</div>
              <div className="font-mono font-bold text-primary">{importResult.restored.trades}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Run logi:</div>
              <div className="font-mono font-bold text-primary">{importResult.restored.runLogs}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Cenovna zgodovina:</div>
              <div className="font-mono font-bold text-primary">{importResult.restored.priceHistory}</div>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground mt-2">
            Backup ustvarjen: {new Date(importResult.meta?.exportedAt).toLocaleString('sl-SI')}
          </div>
        </div>
      )}
      <div className="text-[11px] text-muted-foreground space-y-1">
        <p>
          <b>Izvozi JSON</b>: prenosljiv, človeku berljiv backup. <b>Občutljiva polja (API ključi, tokeni) so redactana</b> — varno za deljenje ali arhiviranje.
        </p>
        <p>
          <b>Uvozi JSON</b>: upsert (ustvari ali posodobi) vse zapise. Občutljiva polja ne bodo prepisana.
        </p>
      </div>
    </div>
  );
}
