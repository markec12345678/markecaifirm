'use client';

// v8.56: CardError — consistent error state for dashboard cards.
// Shows error message + retry button. Best practice: every card should
// gracefully handle API failures.

import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CardErrorProps {
  error?: string | null;
  onRetry?: () => void;
  message?: string;
}

export function CardError({ error, onRetry, message }: CardErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <AlertCircle className="w-6 h-6 text-red-500 mb-2" />
      <p className="text-xs text-muted-foreground mb-3">
        {message || 'Napaka pri nalaganju podatkov'}
      </p>
      {error && (
        <p className="text-[10px] text-muted-foreground/60 mb-3 font-mono max-w-[200px] truncate">
          {error}
        </p>
      )}
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={onRetry}
        >
          <RefreshCw className="w-3 h-3 mr-1" />
          Poskusi znova
        </Button>
      )}
    </div>
  );
}
