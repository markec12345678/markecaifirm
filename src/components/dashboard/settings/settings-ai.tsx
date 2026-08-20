"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, AlertCircle, Cpu } from "lucide-react";

interface SettingsAIProps {
  settings: any;
  setSettings: (s: any) => void;
  aiProviders: any[];
  testingAI: boolean;
  aiTestResult: any;
  onTestAI: () => void;
  onSave: () => void;
  saving: boolean;
}

export function SettingsAI({ settings, setSettings, aiProviders, testingAI, aiTestResult, onTestAI, onSave, saving }: SettingsAIProps) {
  const provider = settings?.aiProvider || "ollama";
  const preset = aiProviders.find((p: any) => p.id === provider);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          AI Provider
        </CardTitle>
        <CardDescription>Nastavi AI model za analizo oglasov in Brain intelligence.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label>Provider</Label>
          <Select value={provider} onValueChange={(v) => {
            const p = aiProviders.find((x: any) => x.id === v);
            setSettings({ ...settings, aiProvider: v, aiBaseUrl: p?.baseUrl || "", aiModel: p?.model || "" });
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {aiProviders.map((p: any) => (<SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>))}
            </SelectContent>
          </Select>
          {preset?.help && <p className="text-xs text-muted-foreground">{preset.help}</p>}
        </div>

        <div className="grid gap-2">
          <Label>Base URL</Label>
          <Input value={settings?.aiBaseUrl || ""} onChange={(e) => setSettings({ ...settings, aiBaseUrl: e.target.value })} placeholder="http://localhost:11434" />
        </div>

        <div className="grid gap-2">
          <Label>API Key</Label>
          <Input type="password" value={settings?.aiApiKey || ""} onChange={(e) => setSettings({ ...settings, aiApiKey: e.target.value })} placeholder={settings?.aiApiKeySet ? "•••••••• (nastavljeno)" : "Pusti prazno za lokalno"} />
          {settings?.aiApiKeySet && <p className="text-xs text-muted-foreground">✓ Ključ je nastavljen.</p>}
        </div>

        <div className="grid gap-2">
          <Label>Model</Label>
          <Input value={settings?.aiModel || ""} onChange={(e) => setSettings({ ...settings, aiModel: e.target.value })} placeholder="qwen2.5:7b" />
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onTestAI} disabled={testingAI}>{testingAI ? "Testiram..." : "Test AI"}</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? "Shranjujem..." : "Shrani"}</Button>
        </div>

        {aiTestResult && (
          <div className={`p-3 rounded-lg text-sm ${aiTestResult.ok ? "bg-green-500/10 text-green-500 border border-green-500/20" : "bg-red-500/10 text-red-500 border border-red-500/20"}`}>
            <div className="flex items-start gap-2">
              {aiTestResult.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertCircle className="w-4 h-4 mt-0.5" />}
              <div>
                <p className="font-medium">{aiTestResult.message}</p>
                {aiTestResult.latency && <p className="text-xs mt-1">Latency: {aiTestResult.latency}ms</p>}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
