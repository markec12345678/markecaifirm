/**
 * Scenario Brain sub-component types + moved ScenarioComparisonResponse.
 *
 * Extracted from the original `scenario-brain-card.tsx` (397 lines) as part
 * of v8.95.0-split-scenario. Holds the module-local `ScenarioComparisonResponse`
 * interface (moved here from ../types.ts — it is only consumed by this single
 * client card; server-side uses its own `ScenarioComparison` type from
 * `src/lib/brain/scenario.ts`) plus per-sub-component Props interfaces and
 * derived type aliases over the ScenarioComparisonResponse inline shapes
 * (avoids re-declaring the inline `comparisonTable` / `recommendation` /
 * `scenarios` shapes — keeps us in sync with the parent type automatically).
 *
 *   Sub-components (presentational):
 *     - RecommendationBanner   (🏆 Priporočeni scenarij banner with reasoning)
 *     - ComparisonTable        (8 metrics × 3-4 columns side-by-side table)
 *     - CustomScenarioForm     (capital / trades / risk inputs + submit button)
 *
 *   Derived aliases:
 *     - ScenarioType, RiskLevel — literal unions used by the response
 *     - ComparisonRow, Recommendation, CustomScenario — sliced from
 *       ScenarioComparisonResponse so sub-components don't re-declare shapes
 */

// --- Scenario comparison response (moved from ../types.ts) -----------------
// v8.27: client-side mirror of ScenarioComparison (src/lib/brain/scenario.ts).
// The server-side type includes the full MasterBrainResult per scenario; here
// we only keep the derived comparison metrics (profit projections, health,
// risk, top action, capital, conflicts/bottlenecks counts) so the client
// bundle stays small.

export type ScenarioType = 'conservative' | 'balanced' | 'aggressive' | 'custom';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ScenarioComparisonResponse {
  ok: true;
  scenarios: Array<{
    type: ScenarioType;
    label: string;
    description: string;
    comparison: {
      projectedProfit30d: number;
      projectedProfit90d: number;
      projectedProfit12m: number;
      overallHealth: number;
      healthGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
      riskLevel: string;
      topAction: string;
      topActionUpliftEUR: number;
      capitalRequired: number;
      conflictsCount: number;
      bottlenecksCount: number;
    };
  }>;
  baseCapital: number;
  custom?: ScenarioComparisonResponse['scenarios'][number];
  comparisonTable: Array<{
    metric: string;
    conservative: string | number;
    balanced: string | number;
    aggressive: string | number;
    custom?: string | number;
  }>;
  recommendation: {
    bestScenario: ScenarioType;
    reasoning: string;
  };
  source: string;
  cachedAt?: number;
}

// --- Derived aliases over ScenarioComparisonResponse inline shapes ----------
// Avoids re-declaring the inline `comparisonTable` / `recommendation` /
// `scenarios` shapes — keeps us in sync with the parent type automatically.

export type ComparisonRow = ScenarioComparisonResponse['comparisonTable'][number];
export type Recommendation = ScenarioComparisonResponse['recommendation'];
export type CustomScenario = NonNullable<ScenarioComparisonResponse['custom']>;

// Column descriptor used by ComparisonTable to render its 3-4 column headers
// + highlight the BEST scenario column. Computed inside ComparisonTable from
// `custom` (whether the 4th Custom column appears) and `bestScenario` (which
// column gets the 🏆 BEST highlight).
export interface ScenarioColumn {
  key: ScenarioType;
  label: string;
  isBest: boolean;
  isCustom?: boolean;
}

// --- Sub-component Props ---------------------------------------------------

export interface RecommendationBannerProps {
  recommendation?: Recommendation;
}

export interface ComparisonTableProps {
  comparisonTable: ComparisonRow[];
  custom?: CustomScenario;
  bestScenario?: ScenarioType;
}

export interface CustomScenarioFormProps {
  customCapital: string;
  customTrades: string;
  customRisk: RiskLevel;
  submitting: boolean;
  loading: boolean;
  onCapitalChange: (value: string) => void;
  onTradesChange: (value: string) => void;
  onRiskChange: (risk: RiskLevel) => void;
  onSubmit: () => void;
}
