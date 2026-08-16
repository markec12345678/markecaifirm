'use client';

// v8.56: CardSkeleton — consistent loading skeleton for dashboard cards.
// Animated pulse placeholders matching card layout.

interface CardSkeletonProps {
  lines?: number;    // number of skeleton lines
  variant?: 'default' | 'chart' | 'stats';
}

export function CardSkeleton({ lines = 3, variant = 'default' }: CardSkeletonProps) {
  if (variant === 'chart') {
    return (
      <div className="space-y-2 p-2">
        <div className="h-4 w-32 bg-muted animate-pulse rounded" />
        <div className="h-32 w-full bg-muted/50 animate-pulse rounded" />
        <div className="flex gap-2">
          <div className="h-3 w-16 bg-muted animate-pulse rounded" />
          <div className="h-3 w-16 bg-muted animate-pulse rounded" />
        </div>
      </div>
    );
  }

  if (variant === 'stats') {
    return (
      <div className="grid grid-cols-2 gap-2 p-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-muted/30 rounded-lg p-2">
            <div className="h-3 w-20 bg-muted animate-pulse rounded mb-1.5" />
            <div className="h-6 w-16 bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      <div className="h-4 w-32 bg-muted animate-pulse rounded" />
      {[...Array(lines)].map((_, i) => (
        <div
          key={i}
          className="h-3 bg-muted animate-pulse rounded"
          style={{ width: `${60 + Math.random() * 40}%` }}
        />
      ))}
    </div>
  );
}
