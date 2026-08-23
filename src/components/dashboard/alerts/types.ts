// v9.09: Shared types for alerts modules.
// Extracted from alerts-view.tsx to enable modular alert components.

export interface Alert {
  id: string;
  title: string;
  body: string;
  url: string;
  aiScore: number | null;
  aiRisk: number | null;
  aiVerdict: string | null;
  isRead: boolean;
  isArchived: boolean;
  userAction: string | null;
  sentTelegram: boolean;
  telegramError: string | null;
  sentDiscord: boolean;
  discordError: string | null;
  sentSlack: boolean;
  slackError: string | null;
  sentEmail: boolean;
  emailError: string | null;
  sentPush: boolean;
  pushError: string | null;
  createdAt: string;
  monitor: { name: string; source: string };
}
