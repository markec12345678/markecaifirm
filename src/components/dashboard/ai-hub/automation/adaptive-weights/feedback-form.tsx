/**
 * FeedbackForm — demo feedback form for the adaptive weights card.
 *
 * Extracted from the original `adaptive-weights-card.tsx` (441 lines) as part
 * of v8.95.0-split-adaptive. Renders the demo form at the bottom of the card:
 *
 *   - Header:  ✨ "Demo: zabeleži akcijski feedback" (Sparkles icon).
 *   - Body:     Description paragraph (boost ×1.1 če rate > 80%, reduce ×0.9
 *               če rate < 40%).
 *   - Grid:     Domain dropdown (select over DOMAIN_DISPLAY) + a pair of
 *               ✅ Executed / ❌ Rejected buttons.
 *   - Footer:   POST /api/ai/brain/weights { action: 'record', ... } hint.
 *
 * Purely presentational — takes the currently selected feedbackDomain +
 * the recording flag + an onFeedbackDomainChange callback + an onRecord
 * callback as props. No internal state.
 */

import { Sparkles } from 'lucide-react';
import type { DomainName } from '../../types';
import { DOMAIN_DISPLAY } from '../types';
import type { FeedbackFormProps } from './types';

export function FeedbackForm({
  feedbackDomain,
  recording,
  onFeedbackDomainChange,
  onRecord,
}: FeedbackFormProps) {
  return (
    <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-2 sm:p-2.5 space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-orange-700/80 dark:text-orange-300/80 font-semibold flex items-center gap-1">
        <Sparkles className="w-3 h-3" />
        Demo: zabeleži akcijski feedback
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Simuliraj uporabnikovo oznako akcije. Vsaka 10. akcija per domeno
        sproži re-evaluacijo uteži (boost ×1.1 če rate &gt; 80%, reduce ×0.9
        če rate &lt; 40%).
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* Domain dropdown */}
        <div>
          <label className="text-[9px] uppercase text-muted-foreground font-semibold block mb-1">
            Domena
          </label>
          <select
            value={feedbackDomain}
            onChange={(e) => onFeedbackDomainChange(e.target.value as DomainName)}
            className="h-8 w-full text-xs bg-background/50 border border-orange-500/20 rounded px-2"
          >
            {DOMAIN_DISPLAY.map((d) => (
              <option key={d.key} value={d.key}>
                {d.icon} {d.label}
              </option>
            ))}
          </select>
        </div>
        {/* Feedback buttons */}
        <div>
          <label className="text-[9px] uppercase text-muted-foreground font-semibold block mb-1">
            Feedback
          </label>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => onRecord('executed')}
              disabled={recording}
              className="h-8 text-[11px] font-bold rounded border bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
            >
              ✅ Executed
            </button>
            <button
              type="button"
              onClick={() => onRecord('rejected')}
              disabled={recording}
              className="h-8 text-[11px] font-bold rounded border bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/25 disabled:opacity-50"
            >
              ❌ Rejected
            </button>
          </div>
        </div>
      </div>
      <div className="text-[9px] text-muted-foreground italic">
        POST /api/ai/brain/weights &#123; action: &apos;record&apos;, domain, feedback &#125;
      </div>
    </div>
  );
}
