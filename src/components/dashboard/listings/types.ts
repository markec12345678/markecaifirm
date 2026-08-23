// v9.00: Shared types for listings modules.
// Extracted from listings-view.tsx to enable modular listings components.

export interface Listing {
  id: string;
  title: string;
  price: number | null;
  priceText: string;
  url: string;
  location: string;
  description: string;
  imageUrl: string | null;
  firstSeenAt: string;
  aiScore: number | null;
  aiRisk: number | null;
  aiVerdict: string | null;
  aiReason: string | null;
  aiEstimatedValue: number | null;
  aiImageVerdict: string | null;
  aiImageAnalysis: string | null;
  isBookmarked: boolean;
  contactStatus: string;
  // v6.99: dodano za ListingActionsBar (obstoječa polja v DB, prej niso bila v interfacu)
  sellerResponse?: string | null;
  userNotes?: string | null;
  // v4.4: AI Deal Score 0-100
  dealScore: number | null;
  dealScoreReason: string | null;
  dealScoreComputedAt: string | null;
  // v4.5: Target price
  targetPrice: number | null;
  targetPriceSetAt: string | null;
  targetPriceAlertSent: boolean;
  monitor: { name: string; source: string };
}

export interface Monitor {
  id: string;
  name: string;
  source: string;
}

export interface ListingsResponse {
  listings: Listing[];
  total: number;
  offset: number;
  limit: number;
}

export interface BuyScore {
  score: number;
  verdict: 'STRONG_BUY' | 'BUY' | 'CONSIDER' | 'AVOID';
  expectedROI: number | null;
  expectedProfit: number | null;
  discountPercent: number | null;
  recommendation: string;
}
