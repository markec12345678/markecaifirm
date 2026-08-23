'use client';

// v8.96: SettingsScoring — Thresholds + Backup konfiguracije sekciji.
// Izločeno iz settings-view.tsx. Sprejema state + handlerje kot props (deljen save flow).

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Download, Upload, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export interface SettingsScoringProps {
  minOpportunityScore: number;
  setMinOpportunityScore: (n: number) => void;
  maxRiskScore: number;
  setMaxRiskScore: (n: number) => void;
}

export function SettingsScoring({
  minOpportunityScore,
  setMinOpportunityScore,
  maxRiskScore,
  setMaxRiskScore,
}: SettingsScoringProps) {
  return (
    <>
      {/* v2.8: Settings export/import */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Download className="w-4 h-4 text-primary" />
            Backup konfiguracije <Badge variant="outline" className="text-[10px] text-primary border-primary/40">v2.8</Badge>
          </CardTitle>
          <CardDescription>
            Izvozi/Uvozi nastavitve in monitorje kot JSON. API ključi in gesla niso vključeni.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => window.open('/api/settings/export', '_blank')} className="gap-2">
              <Download className="w-3.5 h-3.5" /> Izvozi JSON
            </Button>
            <Button size="sm" variant="outline" onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.json';
              input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  const data = JSON.parse(text);
                  const res = await fetch('/api/settings/export', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                  });
                  const result = await res.json();
                  if (result.ok) toast.success(`Importirano: ${result.imported.settings} nastavitev, ${result.imported.monitors} monitorjev`);
                  else toast.error('Napaka pri importu');
                } catch { toast.error('Napaka pri branju datoteke'); }
              };
              input.click();
            }} className="gap-2">
              <Upload className="w-3.5 h-3.5" /> Uvozi JSON
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Po importu moraš ročno vnesti API ključe in gesla (varnostni razlog).
          </p>
        </CardContent>
      </Card>

      {/* Thresholds card */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            Thresholdi za alerte
          </CardTitle>
          <CardDescription>
            Samo oglasi, ki zadenejo oba pogoja, sprožijo alert.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs uppercase tracking-wider">Min ocena prilike</Label>
              <Badge variant="outline" className="text-primary text-xs">{minOpportunityScore}/10</Badge>
            </div>
            <Slider
              value={[minOpportunityScore]}
              onValueChange={(v) => setMinOpportunityScore(v[0])}
              min={1}
              max={10}
              step={1}
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              AI ocena priložnosti mora biti vsaj toliko. Višje = manj alertov, bolj selektivno.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs uppercase tracking-wider">Max ocena tveganja</Label>
              <Badge variant="outline" className="text-amber-400 text-xs">{maxRiskScore}/10</Badge>
            </div>
            <Slider
              value={[maxRiskScore]}
              onValueChange={(v) => setMaxRiskScore(v[0])}
              min={1}
              max={10}
              step={1}
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              AI ocena tveganja (1=varno, 10=prevara) mora biti največ toliko.
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
