// v8.99: Shared helpers for trades modules.
// Extracted from trades-view.tsx.

export const CATEGORIES = ['elektronika', 'avto', 'nepremičnina', 'pohištvo', 'oblačila', 'orodje', 'kolektorstvo', 'drugo'];

/** v8.63: Parse comma-separated tags string into a clean array (client-side mirror of server parseTags). */
export function parseTagsLocal(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0);
}
