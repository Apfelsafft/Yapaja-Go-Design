/**
 * Client-side ETA formatter (E04-T2, Wargame W-22).
 *
 * The Core computes and publishes `NavState.eta` purely in UTC (a Valhalla-
 * planned-time based `duration_remaining_s` plus `now`, see
 * `apps/core/src/navigation/eta.ts`), formatted as an ISO-8601 string WITH
 * offset (`Date#toISOString()`'s trailing `Z`). Rendering that instant as a
 * local clock time ("14:32") is deliberately NOT the Core's job -- it is a
 * pure, shared function so both the (future, E07) web UI and MQTT-adjacent
 * tooling format the exact same instant identically, and so it can be
 * unit-tested against fixed zones/instants independent of the machine
 * running the tests (docs/08 Wargame W-22: "Zeitzonen/DST: ETA falsch bei
 * Grenzübertritt/Zeitumstellung").
 *
 * Correctness comes entirely from `Intl.DateTimeFormat`'s `timeZone` option
 * applied to the ABSOLUTE instant `new Date(isoEta)` encodes -- the same
 * instant formats correctly whether it falls before or after a DST
 * transition, and independent of the process's local zone whenever
 * `timeZone` is passed explicitly.
 */

export interface FormatEtaOptions {
  /** IANA time zone, e.g. "Europe/Berlin". Omit to use the runtime's local zone. */
  timeZone?: string;
  /** BCP 47 locale, e.g. "de-DE". Defaults to "de-DE" (docs/06: German-first UI). */
  locale?: string;
}

/**
 * Format a Core-provided `eta` (UTC ISO-8601 with offset, see `NavState.eta`)
 * as a short local clock time, e.g. `"14:32"`. Throws `RangeError` for an
 * unparseable timestamp -- callers already guard on `eta !== null`, so a bad
 * string here means upstream corrupted the value, which must not fail silently.
 */
export function formatEta(isoEta: string, options: FormatEtaOptions = {}): string {
  const date = new Date(isoEta);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`formatEta: invalid ISO timestamp "${isoEta}"`);
  }

  const formatter = new Intl.DateTimeFormat(options.locale ?? 'de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: options.timeZone,
  });
  return formatter.format(date);
}
