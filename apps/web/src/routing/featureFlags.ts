/**
 * Feature flag for turn-by-turn navigation (E04). Routing (E03-T3) computes
 * and displays routes; E04-T5 wires "Navigation starten" up to
 * `POST /navigation/start` (with the E04-T4 reroute context) and the Drive
 * mode (camera, follow-me, pause/stop). Kept as a flag (rather than deleting
 * it) so a future E0x can still kill-switch navigation without touching
 * `RoutingPanel.tsx`.
 */
export const NAV_ENABLED = true;
