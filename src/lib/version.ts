// v8.89: Single source of truth for app version + stats.
// Update this file when bumping version — footer and other UI reads from here.

export const APP_VERSION = 'v8.89.0';
export const AI_ENDPOINTS = 432;
export const ANALYTICS_ENDPOINTS = 73;
export const TOTAL_API_ROUTES = AI_ENDPOINTS + ANALYTICS_ENDPOINTS + 143; // 143 = core API routes (trades, monitors, listings, alerts, settings, cron, etc.)
export const PLATFORMS = 11;
export const BRAIN_LAYERS = 8;

// Slovenian label for footer
export const VERSION_LABEL = `${APP_VERSION}`;
export const STATS_LABEL = `${AI_ENDPOINTS} AI + ${ANALYTICS_ENDPOINTS} analytics = ${TOTAL_API_ROUTES} routes`;
