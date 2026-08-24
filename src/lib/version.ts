// v8.90: Single source of truth for app version + stats.
// Update this file when bumping version — footer and other UI reads from here.
// Run `find src/app/api -name "route.ts" | wc -l` to verify counts.

export const APP_VERSION = 'v9.36.0';
export const AI_ENDPOINTS = 432;
export const ANALYTICS_ENDPOINTS = 84;
export const TOTAL_API_ROUTES = 651;
export const PLATFORMS = 11;
export const BRAIN_LAYERS = 8;

// Slovenian label for footer
export const VERSION_LABEL = `${APP_VERSION}`;
export const STATS_LABEL = `${AI_ENDPOINTS} AI + ${ANALYTICS_ENDPOINTS} analytics = ${TOTAL_API_ROUTES} routes`;
