/**
 * CRASH-LOOP FIXTURE (E09-T3, W-14): exits non-zero immediately, every time.
 * The service host respawns it; after more than 5 crashes inside the 10-minute
 * window the watchdog auto-disables the add-on (`enabled = 0`) and the
 * respawning stops.
 */

process.exit(1);
