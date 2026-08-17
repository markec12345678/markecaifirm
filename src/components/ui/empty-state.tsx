'use client';

// v8.85: Reusable EmptyState component — consistent empty states across all views.
// Professional pattern: icon + title + description + CTA button + optional help link.

import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HelpCircle } from 'lucide-react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: ReactNode;
  };
  actionHref?: {
    label: string;
    href: string;
    icon?: ReactNode;
  };
  actionHref2?: {
    label: string;
    href: string;
    icon?: ReactNode;
  };
  helpLink?: string;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  actionHref,
  actionHref2,
  helpLink,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center py-12 px-4', className)}>
      {icon && (
        <div className="mb-3 opacity-40 text-muted-foreground">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-bold text-foreground mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">{description}</p>
      )}
      {(action || actionHref) && (
        <div className="mt-4 flex items-center gap-2">
          {action && (
            <Button
              size="sm"
              onClick={action.onClick}
              className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {action.icon}
              {action.label}
            </Button>
          )}
          {actionHref && (
            <Button
              size="sm"
              asChild
              className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <a href={actionHref.href}>
                {actionHref.icon}
                {actionHref.label}
              </a>
            </Button>
          )}
          {actionHref2 && (
            <Button
              size="sm"
              variant="outline"
              asChild
              className="gap-1.5"
            >
              <a href={actionHref2.href}>
                {actionHref2.icon}
                {actionHref2.label}
              </a>
            </Button>
          )}
          {helpLink && (
            <Button
              size="sm"
              variant="ghost"
              asChild
              className="gap-1 text-muted-foreground"
            >
              <a href={helpLink}>
                <HelpCircle className="w-3 h-3" />
                Pomoč
              </a>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
