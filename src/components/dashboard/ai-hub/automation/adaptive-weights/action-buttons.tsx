/**
 * ActionButtons — Reset + Save row for the adaptive weights card.
 *
 * Extracted from the original `adaptive-weights-card.tsx` (441 lines) as part
 * of v8.95.0-split-adaptive. Renders the bottom action row of the card:
 *
 *   - Left:  "🔄 Reset na default" button (calls onReset, disabled while
 *            resetting/loading).
 *   - Right: optional "Neshranjene spremembe" italic hint (when dirty) + a
 *            "💾 Shrani uteži" button (calls onSave, disabled when !dirty or
 *            while saving).
 *
 * Purely presentational — takes dirty / saving / resetting / loading flags
 * + onReset / onSave callbacks as props. No internal state.
 */

import { Button } from '@/components/ui/button';
import { RefreshCw, Save } from 'lucide-react';
import type { ActionButtonsProps } from './types';

export function ActionButtons({
  dirty,
  saving,
  resetting,
  loading,
  onReset,
  onSave,
}: ActionButtonsProps) {
  return (
    <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-orange-500/20">
      <Button
        size="sm"
        variant="outline"
        onClick={onReset}
        disabled={resetting || loading}
        className="h-7 px-3 text-[10px] gap-1.5 border-orange-500/40 text-orange-700 dark:text-orange-300 hover:bg-orange-500/10"
      >
        {resetting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        🔄 Reset na default
      </Button>
      <div className="flex items-center gap-2">
        {dirty && (
          <span className="text-[10px] text-amber-600 dark:text-amber-400 italic">
            Neshranjene spremembe
          </span>
        )}
        <Button
          size="sm"
          onClick={onSave}
          disabled={!dirty || saving}
          className="h-7 px-3 text-[10px] gap-1.5 bg-orange-600 hover:bg-orange-700 text-white border-orange-700"
        >
          {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          💾 Shrani uteži
        </Button>
      </div>
    </div>
  );
}
