'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, BarChart3, TrendingUp, Target, AlertTriangle, Activity, ThumbsUp, ThumbsDown, Archive, Bell } from 'lucide-react';
import { toast } from 'sonner';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, PieChart, Pie, Cell,
} from 'recharts';
import { cn } from '@/lib/utils';

interface AnalyticsData {
  alertsPerDay: Array<{ date: string; total: number; PRILIKA: number; SUMNJIVO: number; NEZANIMIVO: number }>;
  listingsPerDay: Array<{ date: string; count: number }>;
  verdictDistribution: { PRILIKA: number; SUMNJIVO: number; NEZANIMIVO: number };
  monitorPerformance: Array<{
    id: string;
    name: string;
    source: string;
    isActive: boolean;
    totalListings: number;
    totalAlerts: number;
    recentAlerts: number;
    prilika: number;
    successRate: number;
    avgDurationMs: number;
    userInterested: number;
    userScam: number;
    userArchived: number;
    precision: number | null;
    conversionRate: number;
  }>;
  accuracy: {
    interested: number;
    archived: number;
    scam: number;
    ignored: number;
    total: number;
    precision: number | null;
  };
  generatedAt: string;
}

const PIE_COLORS = ['#4ade80', '#fbbf24', '#6b7280'];

export function AnalyticsView() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/analytics');
      if (!res.ok) throw new Error();
      const d = await res.json();
      setData(d);
    } catch {
      toast.error('Ne morem naložiti analitike');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-48 bg-card animate-pulse rounded" />
        ))}
      </div>
    );
  }
  if (!data) return null;

  const hasData = data.alertsPerDay.length > 0 || data.monitorPerformance.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-primary terminal-glow uppercase">
            Analitika
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Trendi, performansa monitorjev, natančnost AI (zadnjih 14 dni).
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" /> Osveži
        </Button>
      </div>

      {!hasData ? (
        <Card className="bg-card/50">
          <CardContent className="p-8 text-center">
            <BarChart3 className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">Še ni dovolj podatkov za analitiko.</p>
            <p className="text-xs text-muted-foreground mt-1">Poženi vsaj nekaj monitorjev, da zbereš podatke.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* AI Accuracy summary */}
          <Card className="bg-card/50 border-primary/30">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                Natančnost AI
              </CardTitle>
              <CardDescription>
                Kako dobro AI identificira prave priložnosti (glede na tvoje povratne informacije).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <AccuracyCard
                  icon={<ThumbsUp className="w-4 h-4" />}
                  label="Zanima me"
                  value={data.accuracy.interested}
                  color="primary"
                />
                <AccuracyCard
                  icon={<Archive className="w-4 h-4" />}
                  label="Arhivirano"
                  value={data.accuracy.archived}
                  color="muted"
                />
                <AccuracyCard
                  icon={<ThumbsDown className="w-4 h-4" />}
                  label="Prevara"
                  value={data.accuracy.scam}
                  color="amber"
                />
                <AccuracyCard
                  icon={<Activity className="w-4 h-4" />}
                  label="Brez akcije"
                  value={data.accuracy.ignored}
                  color="muted"
                />
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">Skupno povratnih informacij:</span>
                <span className="font-bold text-primary">{data.accuracy.total}</span>
                {data.accuracy.precision != null && (
                  <>
                    <span className="text-muted-foreground ml-4">Precision (interested / (interested + scam)):</span>
                    <Badge variant="outline" className={cn(
                      'text-sm',
                      data.accuracy.precision >= 0.7 ? 'border-primary/40 text-primary' :
                      data.accuracy.precision >= 0.4 ? 'border-amber-400/40 text-amber-400' :
                      'border-destructive/40 text-destructive'
                    )}>
                      {(data.accuracy.precision * 100).toFixed(1)}%
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {data.accuracy.precision >= 0.7 ? '(odlično — AI dobro ločuje priložnosti)' :
                       data.accuracy.precision >= 0.4 ? '(srednje — premakni threshold višje)' :
                       '(slabo — dvigaj minOpportunityScore ali dodaj excludeKeywords)'}
                    </span>
                  </>
                )}
                {data.accuracy.precision == null && (
                  <span className="text-xs text-muted-foreground">
                    Za izračun precision označi vsaj nekaj alertov kot "Zanima me" ali "Prevara".
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Alerts per day */}
            <Card className="bg-card/50">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <Bell className="w-4 h-4 text-primary" />
                  Alerti na dan (zadnjih 14 dni)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.alertsPerDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2a1f" />
                    <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#11140f', border: '1px solid #1f2a1f', borderRadius: '4px', fontSize: '12px' }}
                      labelStyle={{ color: '#d4d4d4' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Line type="monotone" dataKey="PRILIKA" stroke="#4ade80" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="SUMNJIVO" stroke="#fbbf24" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="NEZANIMIVO" stroke="#6b7280" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Verdict distribution pie */}
            <Card className="bg-card/50">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  Distribucija verdiktov (skupno)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'PRILIKA', value: data.verdictDistribution.PRILIKA, color: '#4ade80' },
                        { name: 'SUMNJIVO', value: data.verdictDistribution.SUMNJIVO, color: '#fbbf24' },
                        { name: 'NEZANIMIVO', value: data.verdictDistribution.NEZANIMIVO, color: '#6b7280' },
                      ].filter(d => d.value > 0)}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={(d: any) => `${d.name}: ${d.value}`}
                      labelLine={false}
                    >
                      {PIE_COLORS.map((color, i) => (
                        <Cell key={i} fill={color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#11140f', border: '1px solid #1f2a1f', borderRadius: '4px', fontSize: '12px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Listings per day bar chart */}
            <Card className="bg-card/50 lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Novi oglasi na dan (zadnjih 14 dni)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={data.listingsPerDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2a1f" />
                    <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} stroke="#1f2a1f" allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#11140f', border: '1px solid #1f2a1f', borderRadius: '4px', fontSize: '12px' }}
                      labelStyle={{ color: '#d4d4d4' }}
                    />
                    <Bar dataKey="count" fill="#4ade80" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Monitor performance table */}
          <Card className="bg-card/50">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Performansa monitorjev (zadnjih 30 dni)
              </CardTitle>
              <CardDescription>Identificiraj monitorje, ki so neučinkoviti ali proizvajajo slabe alerte.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border text-left">
                      <th className="py-2 pr-2 font-medium uppercase tracking-wider">Monitor</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">Oglasi</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">Alerti</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">🎯 Prilik</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">Uspeh</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">Avg čas</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">👍 Zanima</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">🚫 Prevara</th>
                      <th className="py-2 px-2 font-medium uppercase tracking-wider text-right">Precision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.monitorPerformance.map(m => (
                      <tr key={m.id} className="border-b border-border/50 hover:bg-background/30">
                        <td className="py-2 pr-2">
                          <div className="flex items-center gap-2">
                            <span className={cn('w-1.5 h-1.5 rounded-full', m.isActive ? 'bg-primary' : 'bg-muted-foreground')} />
                            <span className="font-medium truncate max-w-[180px]">{m.name}</span>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right font-mono">{m.totalListings}</td>
                        <td className="py-2 px-2 text-right font-mono">{m.totalAlerts}</td>
                        <td className="py-2 px-2 text-right font-mono text-primary">{m.prilika}</td>
                        <td className="py-2 px-2 text-right font-mono">
                          <span className={m.successRate >= 0.9 ? 'text-primary' : m.successRate >= 0.7 ? 'text-amber-400' : 'text-destructive'}>
                            {(m.successRate * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-muted-foreground">
                          {m.avgDurationMs > 0 ? `${(m.avgDurationMs / 1000).toFixed(1)}s` : '—'}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-primary">{m.userInterested}</td>
                        <td className="py-2 px-2 text-right font-mono text-amber-400">{m.userScam}</td>
                        <td className="py-2 px-2 text-right font-mono">
                          {m.precision != null ? (
                            <span className={m.precision >= 0.7 ? 'text-primary' : m.precision >= 0.4 ? 'text-amber-400' : 'text-destructive'}>
                              {(m.precision * 100).toFixed(0)}%
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function AccuracyCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: 'primary' | 'amber' | 'muted' }) {
  return (
    <div className="bg-background/30 rounded p-3 border border-border">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
        <span className={cn(color === 'primary' ? 'text-primary' : color === 'amber' ? 'text-amber-400' : 'text-muted-foreground')}>
          {icon}
        </span>
      </div>
      <div className={cn('text-2xl font-bold font-mono', color === 'primary' ? 'text-primary' : color === 'amber' ? 'text-amber-400' : 'text-foreground')}>
        {value}
      </div>
    </div>
  );
}
