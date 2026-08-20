"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Save, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { SettingsAI } from "./settings/settings-ai";
import { SettingsNotifications } from "./settings/settings-notifications";
import { SettingsGeneral } from "./settings/settings-general";

const AI_PROVIDERS = [
  { id: "ollama", label: "Ollama (lokalno)", baseUrl: "http://localhost:11434", model: "qwen2.5:7b", help: "Poženi Ollama CLI lokalno. Priporočam qwen2.5:7b ali 14b za slovenščino." },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com", model: "gpt-4o-mini", help: "Zahteva API ključ. Hitri in zanesljivi modeli." },
  { id: "anthropic", label: "Anthropic (Claude)", baseUrl: "https://api.anthropic.com", model: "claude-3-5-sonnet-20241022", help: "Zahteva API ključ. Odlični za kompleksne analize." },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api", model: "openai/gpt-4o-mini", help: "Agregat različnih modelov. Zahteva API ključ." },
  { id: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-1.5-flash", help: "Zahteva API ključ. Hitri in poceni modeli." },
  { id: "openai-compatible", label: "OpenAI-compatible (custom)", baseUrl: "", model: "", help: "Za lokalne modele z OpenAI API kompatibilnostjo." },
];

export function SettingsView() {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingAI, setTestingAI] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<any>(null);

  useEffect(() => { fetchSettings(); }, []);

  async function fetchSettings() {
    try {
      setLoading(true);
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSettings(data);
    } catch (error) {
      toast.error("Napaka pri nalaganju nastavitev");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    try {
      setSaving(true);
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        toast.success("Nastavitve shranjene");
        fetchSettings();
      } else {
        throw new Error("Napaka pri shranjevanju");
      }
    } catch (error) {
      toast.error("Napaka pri shranjevanju nastavitev");
      console.error(error);
    } finally {
      setSaving(false);
    }
  }

  async function testAI() {
    try {
      setTestingAI(true);
      setAiTestResult(null);
      const res = await fetch("/api/settings/test-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: settings?.aiProvider,
          baseUrl: settings?.aiBaseUrl,
          apiKey: settings?.aiApiKey,
          model: settings?.aiModel,
        }),
      });
      const data = await res.json();
      setAiTestResult(data);
      if (data.ok) {
        toast.success("AI test uspešen!");
      } else {
        toast.error("AI test neuspešen");
      }
    } catch (error) {
      toast.error("Napaka pri testiranju AI");
      console.error(error);
    } finally {
      setTestingAI(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Nalagam nastavitve...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Nastavitve</h2>
          <p className="text-sm text-muted-foreground">Konfiguriraj AI provider, notifikacije in splošne nastavitve.</p>
        </div>
        <Button onClick={saveSettings} disabled={saving} size="lg">
          <Save className="w-4 h-4 mr-2" />
          {saving ? "Shranjujem..." : "Shrani vse"}
        </Button>
      </div>

      <SettingsAI
        settings={settings}
        setSettings={setSettings}
        aiProviders={AI_PROVIDERS}
        testingAI={testingAI}
        aiTestResult={aiTestResult}
        onTestAI={testAI}
        onSave={saveSettings}
        saving={saving}
      />

      <SettingsNotifications settings={settings} setSettings={setSettings} />
      <SettingsGeneral settings={settings} setSettings={setSettings} />

      <Card>
        <CardHeader>
          <CardTitle>Hitre akcije</CardTitle>
          <CardDescription>Pogoste operacije za vzdrževanje sistema.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => {
            if (confirm("Ali res želiš ponastaviti vse nastavitve na privzete?")) {
              fetchSettings();
              toast.info("Nastavitve osvežene");
            }
          }}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Osveži nastavitve
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
