"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MessageSquare, Bell, Mail } from "lucide-react";

interface SettingsNotificationsProps {
  settings: any;
  setSettings: (s: any) => void;
}

export function SettingsNotifications({ settings, setSettings }: SettingsNotificationsProps) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MessageSquare className="w-4 h-4 text-primary" />Telegram Bot</CardTitle>
          <CardDescription>Pošlji alerte in Brain insights direktno v Telegram.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Omogoči Telegram</Label>
            <Switch checked={settings?.telegramEnabled || false} onCheckedChange={(v) => setSettings({ ...settings, telegramEnabled: v })} />
          </div>
          {settings?.telegramEnabled && (
            <>
              <div className="grid gap-2">
                <Label>Bot Token</Label>
                <Input type="password" value={settings?.telegramBotToken || ""} onChange={(e) => setSettings({ ...settings, telegramBotToken: e.target.value })} placeholder={settings?.telegramBotTokenSet ? "•••••••• (nastavljeno)" : "123456:ABC-DEF..."} />
              </div>
              <div className="grid gap-2">
                <Label>Chat ID</Label>
                <Input value={settings?.telegramChatId || ""} onChange={(e) => setSettings({ ...settings, telegramChatId: e.target.value })} placeholder="-1001234567890" />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bell className="w-4 h-4 text-primary" />Discord Webhook</CardTitle>
          <CardDescription>Pošlji alerte v Discord kanal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Omogoči Discord</Label>
            <Switch checked={settings?.discordEnabled || false} onCheckedChange={(v) => setSettings({ ...settings, discordEnabled: v })} />
          </div>
          {settings?.discordEnabled && (
            <div className="grid gap-2">
              <Label>Webhook URL</Label>
              <Input type="password" value={settings?.discordWebhookUrl || ""} onChange={(e) => setSettings({ ...settings, discordWebhookUrl: e.target.value })} placeholder={settings?.discordWebhookUrlSet ? "•••••••• (nastavljeno)" : "https://discord.com/api/webhooks/..."} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="w-4 h-4 text-primary" />Email (SMTP)</CardTitle>
          <CardDescription>Pošlji alerte in tedenski povzetek na email.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Omogoči Email</Label>
            <Switch checked={settings?.emailEnabled || false} onCheckedChange={(v) => setSettings({ ...settings, emailEnabled: v })} />
          </div>
          {settings?.emailEnabled && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>SMTP Host</Label>
                  <Input value={settings?.emailSmtpHost || ""} onChange={(e) => setSettings({ ...settings, emailSmtpHost: e.target.value })} placeholder="smtp.gmail.com" />
                </div>
                <div className="grid gap-2">
                  <Label>SMTP Port</Label>
                  <Input type="number" value={settings?.emailSmtpPort || 587} onChange={(e) => setSettings({ ...settings, emailSmtpPort: parseInt(e.target.value) })} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>SMTP User</Label>
                <Input value={settings?.emailSmtpUser || ""} onChange={(e) => setSettings({ ...settings, emailSmtpUser: e.target.value })} placeholder="your@email.com" />
              </div>
              <div className="grid gap-2">
                <Label>SMTP Password</Label>
                <Input type="password" value={settings?.emailSmtpPassword || ""} onChange={(e) => setSettings({ ...settings, emailSmtpPassword: e.target.value })} placeholder={settings?.emailSmtpPasswordSet ? "•••••••• (nastavljeno)" : "Gmail app password"} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
