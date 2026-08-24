'use client';

// v9.09: Extracted from buyers-view.tsx — AI Buyer Review Generator

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Star } from 'lucide-react';
import { toast } from 'sonner';

interface BuyerReviewProps {
  selectedBuyer: string;
}

export function BuyerReview({ selectedBuyer }: BuyerReviewProps) {
  const [review, setReview] = useState<any>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const runReview = async () => {
    if (!selectedBuyer) { toast.error('Izberi kupca'); return; }
    setReviewLoading(true);
    setReview(null);
    try {
      const res = await fetch('/api/ai/buyer-review-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: selectedBuyer }),
      });
      const data = await res.json();
      if (data.ok) { setReview(data); toast.success('✓ Review generiran'); }
      else toast.error(data.error ?? 'Napaka');
    } catch (e: unknown) { toast.error((e as Error)?.message ?? 'Napaka'); }
    finally { setReviewLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-400" />
            AI Review Generator
          </span>
          <Button size="sm" variant="outline" onClick={runReview} disabled={reviewLoading} className="h-6 text-xs gap-1.5">
            {reviewLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Star className="w-3 h-3" />}
            Generiraj
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {reviewLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 mx-auto mb-1 animate-spin opacity-50" />
            AI generira review-e...
          </div>
        ) : review?.generator ? (
          <div className="space-y-2 text-xs">
            {review.generator.reviews?.slice(0, 3).map((r: any, i: number) => (
              <div key={i} className="bg-card/30 border rounded p-2">
                <Badge variant="outline" className="text-[9px] mb-1">{r.type || r.style || `Review ${i + 1}`}</Badge>
                <div className="text-[10px] italic">"{r.text || r.content || r.message}"</div>
              </div>
            ))}
            {review.generator.reviews?.length === 0 && (
              <p className="text-[10px] text-muted-foreground text-center">Ni review-ov.</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            AI generira review-e (testimonial, referral, social proof...).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
