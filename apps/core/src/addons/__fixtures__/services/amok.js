/**
 * "AMOK" FIXTURE (E09-T3, W-14): a service add-on that pegs a core in a busy
 * loop. Used by the integration test that proves the watchdog really does
 * SIGSTOP a runaway process (the /proc state character flips to `T`); the
 * POLICY itself is tested deterministically with injected metrics in
 * `watchdog.test.ts`.
 */

let x = 0;
for (;;) {
  x = (x + Math.sqrt(x + 1)) % 1e9;
}
