'use client';

// v9.09: Extracted from pricing-view.tsx — AI Profit Playbook

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, BookOpen } from 'lucide-react';
import { toast } from 'sonner';

export function ProfitPlaybook() {
  const [playbook, setPlaybook] = useState<any>(null);
  const [playbookLoading, setPlaybookLoading] = useState(false);

  const runPlaybook = async () => { setPlaybookLoading(true); setPlaybook(null); try { const r = await fetch('/api/ai/profit-playbook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const d = await r.json(); if (d.ok) { setPlaybook(d); toast.success('✓ Profit playbook generiran'); } else toast.error(d.error ?? 'Napaka'); } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); } finally { setPlaybookLoading(false); } };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-primary" /> AI Profit Playbook</span>
          <Button size="sm" variant="outline" onClick={runPlaybook} disabled={playbookLoading} className="h-6 text-xs gap-1.5">
            {playbookLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <BookOpen className="w-3 h-3" />} Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {playbookLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground"><RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" /> AI pripravlja profit playbook...</div>
        ) : playbook?.playbook ? (
          <div className="space-y-2 text-xs">
            {playbook.playbook.strategies?.slice(0, 3).map((s: any, i: number) => (
              <div key={i} className="bg-primary/5 border border-primary/20 rounded p-2">
                <div className="text-[10px] font-medium text-primary">{s.strategy || s.name}</div>
                <div className="text-[9px] text-muted-foreground">{s.description || s.action}</div>
              </div>
            ))}
            {playbook.playbook.insights && <div className="text-[9px] text-muted-foreground">💡 {playbook.playbook.insights}</div>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">AI pripravi strategije za maksimiranje dobička (v6.40 MILESTONE).</p>
        )}
      </CardContent>
    </Card>
  );
}
