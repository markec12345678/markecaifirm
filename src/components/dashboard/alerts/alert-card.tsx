'use client';

// v9.09: Extracted from alerts-view.tsx — AlertCard presentational component

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Target, AlertTriangle, ExternalLink, ThumbsUp, ThumbsDown, RotateCcw, Archive, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Alert } from './types';
import { formatTimeAgo } from './utils';

interface AlertCardProps {
  alert: Alert;
  selected: boolean;
  onToggleSelect: () => void;
  onMarkRead: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onUserAction: (action: 'interested' | 'scam') => void;
  onRetry: () => void;
}

export function AlertCard({
  alert,
  selected,
  onToggleSelect,
  onMarkRead,
  onArchive,
  onDelete,
  onUserAction,
  onRetry,
}: AlertCardProps) {
  const verdictColor =
    alert.aiVerdict === 'PRILIKA' ? 'text-primary terminal-glow' :
    alert.aiVerdict === 'SUMNJIVO' ? 'text-amber-400 amber-glow' :
    'text-muted-foreground';
  const verdictIcon =
    alert.aiVerdict === 'PRILIKA' ? <Target className="w-3.5 h-3.5" /> :
    alert.aiVerdict === 'SUMNJIVO' ? <AlertTriangle className="w-3.5 h-3.5" /> :
    null;
  const userActionBadge =
    alert.userAction === 'interested' ? { text: '👍 Zanima me', cls: 'border-primary/40 text-primary' } :
    alert.userAction === 'scam' ? { text: '🚫 Prevara', cls: 'border-amber-400/40 text-amber-400' } :
    alert.userAction === 'archived' ? { text: '✅ Arhivirano', cls: 'border-muted text-muted-foreground' } :
    null;

  return (
    <Card
      className={cn(
        'bg-card/50 hover:bg-card transition-colors flex-row items-start gap-2',
        !alert.isRead && 'border-primary/40 bg-primary/5',
        selected && 'border-primary ring-1 ring-primary/30'
      )}
      onClick={onMarkRead}
    >
      <CardContent className="p-4 flex items-start gap-3 w-full">
        {/* v1.3: selection checkbox */}
        <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            className="border-muted-foreground/50"
          />
        </div>
        <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              {verdictIcon && <span className={verdictColor}>{verdictIcon}</span>}
              {alert.aiVerdict && (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] uppercase tracking-wider',
                    alert.aiVerdict === 'PRILIKA' && 'border-primary/40 text-primary',
                    alert.aiVerdict === 'SUMNJIVO' && 'border-amber-400/40 text-amber-400',
                    alert.aiVerdict === 'NEZANIMIVO' && 'border-muted text-muted-foreground'
                  )}
                >
                  {alert.aiVerdict}
                </Badge>
              )}
              {alert.aiScore != null && (
                <span className="text-[11px] text-primary">⭐ {alert.aiScore}/10</span>
              )}
              {alert.aiRisk != null && (
                <span className="text-[11px] text-amber-400">🛡 {alert.aiRisk}/10</span>
              )}
              <span className="text-[11px] text-muted-foreground">•</span>
              <span className="text-[11px] text-muted-foreground">{alert.monitor.name}</span>
              {userActionBadge && (
                <Badge variant="outline" className={cn('text-[10px]', userActionBadge.cls)}>
                  {userActionBadge.text}
                </Badge>
              )}
              {!alert.isRead && !userActionBadge && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary pulse-dot ml-auto" />
              )}
            </div>
            <h3 className="font-bold text-sm mb-1 truncate">{alert.title}</h3>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed line-clamp-6">
              {alert.body}
            </pre>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
              <a
                href={alert.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 text-primary/70 hover:text-primary"
              >
                <ExternalLink className="w-3 h-3" /> Odpri oglas
              </a>
              <span>•</span>
              <span>{formatTimeAgo(alert.createdAt)}</span>
              {alert.sentTelegram && (
                <>
                  <span>•</span>
                  <span className="text-primary">TG ✓</span>
                </>
              )}
              {alert.sentDiscord && (
                <>
                  <span>•</span>
                  <span className="text-primary">DC ✓</span>
                </>
              )}
              {alert.sentSlack && (
                <>
                  <span>•</span>
                  <span className="text-primary">SL ✓</span>
                </>
              )}
              {alert.sentPush && (
                <>
                  <span>•</span>
                  <span className="text-primary">Push ✓</span>
                </>
              )}
              {alert.sentEmail && (
                <>
                  <span>•</span>
                  <span className="text-primary">Email ✓</span>
                </>
              )}
              {(alert.telegramError || alert.discordError || alert.slackError || alert.emailError) && (
                <>
                  <span>•</span>
                  <span className="text-destructive" title={alert.telegramError || alert.discordError || alert.slackError || alert.emailError || ''}>
                    ⚠ Napaka
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
            {!userActionBadge && (
              <>
                <Button size="sm" variant="ghost" onClick={() => onUserAction('interested')} className="h-7 w-7 p-0 text-primary hover:text-primary" title="Zanima me">
                  <ThumbsUp className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onUserAction('scam')} className="h-7 w-7 p-0 text-amber-400 hover:text-amber-400" title="Prevara">
                  <ThumbsDown className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
            {/* v3.3: Retry button */}
            <Button size="sm" variant="ghost" onClick={onRetry} className="h-7 w-7 p-0" title="Ponovno pošlji na vse kanale">
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onArchive} className="h-7 w-7 p-0" title="Arhiviraj">
              <Archive className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Izbriši">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
      </CardContent>
    </Card>
  );
}
