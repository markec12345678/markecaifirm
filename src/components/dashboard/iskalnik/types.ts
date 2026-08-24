// v9.06: Shared types for iskalnik modules.
// Extracted from iskalnik-view.tsx to enable modular iskalnik components.

export interface SearchResult {
  id: string;
  title: string;
  price: number | null;
  priceText: string;
  url: string;
  location: string;
  description: string;
  detailDescription?: string;
  fullDescription: string;
  imageUrl: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  aiScore: number | null;
  aiRisk: number | null;
  aiVerdict: string | null;
  aiReason: string | null;
  aiEstimatedValue: number | null;
  aiImageVerdict: string | null;
  previousPrice: number | null;
  priceDroppedAt: string | null;
  sellerName: string | null;
  buyScore: number | null;
  expectedROI?: number | null;
  year?: number | null;
  discountPercent?: number | null;
  expectedProfit?: number | null;
  recommendation?: string;
  confidenceLabel?: string;
  buyVerdict?: string;
  monitor?: { name: string; source: string; tags: string } | null;
}

export interface SearchResponse {
  ok: boolean;
  total: number;
  totalBeforeLimit: number;
  results: SearchResult[];
  sortBy: string;
}

export interface SavedRequest {
  id: string;
  searchFor: string;
  title: string;
  keywords: string;
  category: string;
  priceMin: number | null;
  priceMax: number | null;
  location: string;
  yearMin: number | null;
  yearMax: number | null;
  condition: string;
  sortBy: string;
  notes: string;
  isActive: boolean;
  lastRunAt: string | null; // v8.75
  newMatchesCount: number;  // v8.75
  createdAt: string;
}
