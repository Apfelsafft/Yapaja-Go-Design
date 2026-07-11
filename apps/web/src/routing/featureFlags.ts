/**
 * Feature flag for turn-by-turn navigation (E04). Routing (E03-T3) can
 * compute and display routes, but actually starting guided navigation ships
 * in E04 -- gated here so the "Navigation starten" button can exist now
 * (disabled) without a half-built nav flow behind it.
 */
export const NAV_ENABLED = false;
