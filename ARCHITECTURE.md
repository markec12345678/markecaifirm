# 🏗️ Architektura — Markec AI Firm

> **v9.28.0** — Modularna arhitektura z 193 moduli v 17 direktorijeh

## 📊 Pregled

```
src/components/dashboard/
├── *-view.tsx              # 18 tanhih orchestratorjev (glavne view datoteke)
├── settings/              # 14 modulov (AI, notifications, automation, push, advanced, scoring, backup)
├── ai-hub/                # 25 modulov (brain sections, cards, types, utils)
├── trades/                 # 25 modulov (AI features, form, row, types, utils)
├── listings/               # 6 modulov (detail modal, compare, row, types, utils)
├── statistics/             # 26 modulov (25 AI sections + types)
├── monitors/               # 6 modulov (form, template, sparkline, types, utils)
├── dashboard/              # 7 modulov (stat-card, activity-feed, skladisce, widget-wrapper, types, utils)
├── analytics/              # 7 modulov (6 AI sections + types)
├── iskalnik/               # 4 modulov (compare-content, result-card, types, utils)
├── watchlist/              # 3 modulov (item-card, smart-rules-modal, types)
├── inventory/              # 11 modulov (10 AI sections + types)
├── buyers/                 # 11 modulov (10 AI sections + types)
├── pricing/                # 11 modulov (10 AI sections + types)
├── risk/                   # 11 modulov (10 AI sections + types)
├── alerts/                 # 4 modulov (ai-prioritized, alert-card, types, utils)
├── listing-optimization/   # 11 modulov (10 AI sections + types)
└── listing-detail/         # 11 modulov (AI panels — sentiment, fraud, image, negotiation, etc.)
```

## 🎯 Načela

### 1. Tanek Orchestrator Pattern
Vsaka `*-view.tsx` datoteka je tanek orchestrator ki:
- **Drži skupni state** (useState deklaracije)
- **Definira fetch handlerje** (useCallback, useEffect)
- **Import-a in renderira module** (samostojne komponente)

```typescript
// Primer: trades-view.tsx
import { TradeRow } from './trades/trade-row';
import { TradeFormDialog } from './trades/trade-form-dialog';
import { CsvImportDialog } from './trades/csv-import-dialog';
import { AIPortfolioAnalysis } from './trades/ai-portfolio-analysis';
// ... 21 več modulov

export function TradesView() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  // ... state + handlers
  return (
    <div>
      <TradeRow trade={...} onEdit={...} />
      <AIPortfolioAnalysis />
      {/* ... */}
    </div>
  );
}
```

### 2. Samostojni Moduli
Večina modulov je **samostojnih** — imajo lasten state + fetch:
```typescript
// ai-portfolio-analysis.tsx
export function AIPortfolioAnalysis() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { /* fetch /api/ai/portfolio */ }, []);

  return <Card>...</Card>;
}
```

### 3. Shared Types + Utils
Vsak direktorij ima `types.ts` in `utils.ts` za skupne tipe/helperje:
```
trades/types.ts    → Trade, TradeStats, SavedView, SavedViewFilters
trades/utils.ts    → CATEGORIES, parseTagsLocal
ai-hub/types.ts    → 48 tipov (BrainResult, SystemHealthReport, ...)
ai-hub/utils.ts    → 26 helperjev (categorize, gradeColor, DOMAIN_LABELS, ...)
```

### 4. React.memo za Performance
Ključne list komponente so memoizirane:
```typescript
export const TradeRow = memo(function TradeRow({ trade, onEdit, ... }) {
  // Re-render samo ko se props spremenijo
});
```

## 📈 Statistika

| Metrika | Vrednost |
|---|---|
| View datotek | 18 |
| Direktorijev | 17 |
| Modulskih datotek | 193 |
| Original vrstic (v8.94) | 28885 |
| Trenutnih vrstic | 9524 |
| Zmanjšanje | −67% |
| Lint napak | 0 |
| Typecheck napak | 0 |
| Testov | 158 (100% pass) |
| ARIA labelov | 44 |
| CI/CD workflow-i | 3 |

## 🔄 Ekstrakcijski Vzorec

Ekstrakcija modula sledi temu vzorcu:

1. **Identificiraj** sekcijo z lastnim state + fetch
2. **Ustvari** novo datoteko v direktoriju `<view-name>/`
3. **Premakni** state + fetch + JSX v novo datoteko
4. **Dodaj** `'use client'` + import-e
5. **Posodobi** view datoteko z import-om
6. **Preveri** typecheck + lint

```bash
# Ekstrakcija enega modula
mkdir -p src/components/dashboard/<view>/
# Ustvari <view>/<module-name>.tsx
# Dodaj import v <view>-view.tsx
# Zbriši inline definicijo
bun run typecheck  # 0 errors
bun run lint       # 0 errors
```

## 🧪 Testiranje

```
tests/
├── utils/
│   └── helpers.test.ts    # 29 testov (trades, ai-hub, iskalnik, listings utils)
├── api/
│   └── deal-flow.test.ts  # 4 testi (API endpoint)
├── brain/
│   ├── auto-pilot.test.ts        # 16 testov
│   └── adaptive-weights.test.ts  # 11 testov
└── lib/
    ├── logger.test.ts    # 5 testov
    └── app-url.test.ts   # 5 testov

Skupaj: 158 testov (100% pass rate)
```

## 🚀 CI/CD

```
.github/workflows/
├── ci.yml              # Lint + TypeCheck + Build + Security Audit
├── ai-endpoints.yml    # Auto-update AI_ENDPOINTS.md
└── module-check.yml    # Module count verification (min 190)
```

## 📦 Seed Data

```bash
bun run seed-all
# 1. Seed 15 demo listings
# 2. Seed 25 demo trades
# 3. Seed tags
# 4. Set monthly goal (500€)
# 5. Enable Web Push + VAPID keys
# 6. Activate monitor + cron simulation
```

## ♿ Accessibility

44 ARIA labelov v 8 view-jih:
- Dashboard: 6 (filter chips)
- Alerts: 6 (bulk actions)
- Monitors: 5 (batch run, tag filters)
- Listings: 7 (close buttons, bulk actions)
- Iskalnik: 9 (search, compare, save)
- Trades: 9 (filter buttons, saved views, bulk actions)
- Statistics: 1 (refresh)
- Settings: 1 (save)
