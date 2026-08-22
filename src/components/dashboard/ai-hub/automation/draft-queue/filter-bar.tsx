/**
 * FilterBar — Status + Domain dropdown filters.
 *
 * Extracted from the original `draft-queue-card.tsx` (416 lines) as part of
 * v8.95.0-split-draft. Renders a 2-column grid of <select> dropdowns that
 * filter the draft list (and are passed to the API on the next fetch):
 *
 *   - Status  — Vsi statusi / ⏳ Čaka / 👍 Odobreno / ✅ Izvedeno /
 *               ❌ Zavrnjeno / ⌛ Poteklo
 *   - Domena  — Vse domene / 7 domain options from DOMAIN_DISPLAY
 *
 * Purely presentational — takes the current filter values + onChange handlers
 * as props. No internal state, no fetches.
 */

import { Filter } from 'lucide-react';
import type { DomainName, DraftStatus } from '../../types';
import { DOMAIN_DISPLAY } from '../types';
import type { FilterBarProps } from './types';

export function FilterBar({
  statusFilter,
  domainFilter,
  onStatusFilterChange,
  onDomainFilterChange,
}: FilterBarProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded border border-slate-500/20 bg-slate-500/5 p-1.5">
        <label className="text-[9px] uppercase text-muted-foreground font-semibold block mb-1 flex items-center gap-1">
          <Filter className="w-2.5 h-2.5" /> Status
        </label>
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value as DraftStatus | 'all')}
          className="h-7 w-full text-xs bg-background/50 border border-slate-500/20 rounded px-1.5"
        >
          <option value="all">Vsi statusi</option>
          <option value="pending">⏳ Čaka</option>
          <option value="approved">👍 Odobreno</option>
          <option value="executed">✅ Izvedeno</option>
          <option value="rejected">❌ Zavrnjeno</option>
          <option value="expired">⌛ Poteklo</option>
        </select>
      </div>
      <div className="rounded border border-slate-500/20 bg-slate-500/5 p-1.5">
        <label className="text-[9px] uppercase text-muted-foreground font-semibold block mb-1 flex items-center gap-1">
          <Filter className="w-2.5 h-2.5" /> Domena
        </label>
        <select
          value={domainFilter}
          onChange={(e) => onDomainFilterChange(e.target.value as DomainName | 'all')}
          className="h-7 w-full text-xs bg-background/50 border border-slate-500/20 rounded px-1.5"
        >
          <option value="all">Vse domene</option>
          {DOMAIN_DISPLAY.map((d) => (
            <option key={d.key} value={d.key}>
              {d.icon} {d.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
