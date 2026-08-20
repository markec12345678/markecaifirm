"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Activity, Target, Clock } from "lucide-react";

interface SettingsGeneralProps {
  settings: any;
  setSettings: (s: any) => void;
}

export function SettingsGeneral({ settings, setSettings }: SettingsGeneralProps) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Target className="w-4 h-4 text-primary" />Scoring Thresholds</CardTitle>
          <CardDescription>Nastavi minimalni score za alerte in maksimalni riziko.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-2">
            <div className="flex justify-between items-center">
              <Label>Min. Opportunity Score</Label>
              <Badge variant="outline">{settings?.minOpportunityScore || 60}/100</Badge>
            </div>
            <Slider value={[settings?.minOpportunityScore || 60]} onValueChange={(v) => setSettings({ ...settings, minOpportunityScore: v[0] })} min={0} max={100} step={5} />
            <p className="text-xs text-muted-foreground">Samo oglasi s score >= {settings?.minOpportunityScore || 60} bodo sprožili alert.</p>
          </div>
          <div className="grid gap-2">
            <div className="flex justify-between items-center">
              <Label>Max. Risk Score</Label>
              <Badge variant="outline">{settings?.maxRiskScore || 70}/100</Badge>
            </div>
            <Slider value={[settings?.maxRiskScore || 70]} onValueChange={(v) => setSettings({ ...settings, maxRiskScore: v[0] })} min={0} max={100} step={5} />
            <p className="text-xs text-muted-foreground">Oglasi z risk score > {settings?.maxRiskScore || 70} bodo označeni kot nevarni.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Activity className="w-4 h-4 text-primary" />Heartbeat</CardTitle>
          <CardDescription>Dnevni povzetek sistema in AI priporočil.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Omogoči Heartbeat</Label>
            <Switch checked={settings?.heartbeatEnabled || false} onCheckedChange={(v) => setSettings({ ...settings, heartbeatEnabled: v })} />
          </div>
          {settings?.heartbeatEnabled && (
            <div className="grid gap-2">
              <div className="flex justify-between items-center">
                <Label>Ura pošiljanja</Label>
                <Badge variant="outline">{settings?.heartbeatHour || 8}:00</Badge>
              </div>
              <Slider value={[settings?.heartbeatHour || 8]} onValueChange={(v) => setSettings({ ...settings, heartbeatHour: v[0] })} min={0} max={23} step={1} />
              <p className="text-xs text-muted-foreground">Zadnji heartbeat: {settings?.lastHeartbeatAt || "nikoli"}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clock className="w-4 h-4 text-primary" />Tihe ure</CardTitle>
          <CardDescription>Blokiraj alerte med določenimi urami.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Omogoči tihe ure</Label>
            <Switch checked={settings?.quietHoursEnabled || false} onCheckedChange={(v) => setSettings({ ...settings, quietHoursEnabled: v })} />
          </div>
          {settings?.quietHoursEnabled && (
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Od</Label>
                <Input type="number" min={0} max={23} value={settings?.quietStartHour || 22} onChange={(e) => setSettings({ ...settings, quietStartHour: parseInt(e.target.value) })} />
              </div>
              <div className="grid gap-2">
                <Label>Do</Label>
                <Input type="number" min={0} max={23} value={settings?.quietEndHour || 7} onChange={(e) => setSettings({ ...settings, quietEndHour: parseInt(e.target.value) })} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
