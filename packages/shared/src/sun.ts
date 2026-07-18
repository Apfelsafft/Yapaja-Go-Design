/**
 * Offline sunrise/sunset computation (E07-T3, docs/06 §3 "automatisch nach
 * Sonnenstand").
 *
 * A NOAA-derived solar-position algorithm -- the same closed-form formulas
 * underlying the widely used `suncalc` npm package, themselves an
 * approximation of the official NOAA Solar Calculator described at
 * https://aa.quae.nl/en/reken/zonpositie.html, accurate to within roughly a
 * minute for the sunrise/sunset events this module computes. That's well
 * inside the ±3 minute tolerance `sun.test.ts` checks reference values
 * against.
 *
 * PURE: no I/O, no wall-clock reads (`Date.now()` is never called) -- every
 * result is a deterministic function of the three inputs (`lat`, `lon`,
 * `date`). This is deliberate: the theme controller (`apps/web/src/theme/`)
 * needs to unit-test "what would the theme be at simulated time X and
 * position Y" without any fake-timer/clock-mocking gymnastics -- it just
 * passes in whatever `Date` it likes.
 *
 * NEVER THROWS. At high latitudes a given calendar day can have no sunrise/
 * sunset at all:
 *  - "polar night": the sun's peak (solar-noon) altitude never climbs above
 *    the sunrise/sunset threshold -- it stays below the horizon all day.
 *  - "midnight sun": the sun's lowest (solar-midnight) altitude never dips
 *    below that threshold -- it stays above the horizon all day.
 * Both are returned as a `kind` discriminant instead of an exception/NaN, so
 * callers (the theme controller's clock-fallback logic) can fall back
 * sensibly rather than crashing.
 */

const RAD = Math.PI / 180;
const DAY_MS = 1000 * 60 * 60 * 24;
const J1970 = 2440588;
const J2000 = 2451545;

/** Obliquity of the Earth's rotational axis relative to its orbital plane. */
const OBLIQUITY = RAD * 23.4397;

/**
 * Sunrise/sunset is conventionally defined as the moment the sun's centre
 * crosses -0.833° geometric altitude (not literally 0°): -0.833° = -0.267°
 * (mean atmospheric refraction at the horizon) - 0.5666° (the sun's angular
 * radius, since "sunrise" is when the disk's UPPER limb first appears).
 */
const SUNRISE_SUNSET_ANGLE = RAD * -0.833;

function toJulian(date: Date): number {
  return date.valueOf() / DAY_MS - 0.5 + J1970;
}

function fromJulian(j: number): Date {
  return new Date((j + 0.5 - J1970) * DAY_MS);
}

function toDays(date: Date): number {
  return toJulian(date) - J2000;
}

function solarMeanAnomaly(d: number): number {
  return RAD * (357.5291 + 0.98560028 * d);
}

/** Ecliptic longitude of the sun (equation of center + perihelion offset). */
function eclipticLongitude(M: number): number {
  const equationOfCenter = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const perihelion = RAD * 102.9372;
  return M + equationOfCenter + perihelion + Math.PI;
}

/** Declination of the sun given its ecliptic longitude (ecliptic latitude of the sun is ~0). */
function declination(eclipticLon: number): number {
  return Math.asin(Math.sin(eclipticLon) * Math.sin(OBLIQUITY));
}

function julianCycle(d: number, lw: number): number {
  return Math.round(d - 0.0009 - lw / (2 * Math.PI));
}

function approxTransit(hourAngle: number, lw: number, n: number): number {
  return 0.0009 + (hourAngle + lw) / (2 * Math.PI) + n;
}

function solarTransitJ(ds: number, M: number, eclipticLon: number): number {
  return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * eclipticLon);
}

export interface SunTimesNormal {
  kind: 'normal';
  /** Sunrise, this calendar day, as a UTC instant. */
  sunrise: Date;
  /** Sunset, this calendar day, as a UTC instant. */
  sunset: Date;
}

/** The sun never rises above the sunrise/sunset threshold on this day at this latitude. */
export interface SunTimesPolarNight {
  kind: 'polar-night';
}

/** The sun never sets below the sunrise/sunset threshold on this day at this latitude. */
export interface SunTimesMidnightSun {
  kind: 'midnight-sun';
}

export type SunTimes = SunTimesNormal | SunTimesPolarNight | SunTimesMidnightSun;

/**
 * Computes sunrise/sunset for the calendar day containing `date` at
 * (`lat`, `lon`), both in degrees (WGS84 is precise enough at this
 * accuracy level -- no datum correction needed). `date`'s own time-of-day is
 * only used to pick which calendar day (UTC) to compute for; the returned
 * `sunrise`/`sunset` instants do not depend on it otherwise.
 *
 * Pure and total: never throws, never returns `NaN` times (the polar edge
 * cases short-circuit to a `kind` discriminant before any trigonometric
 * function that could produce one).
 */
export function computeSunTimes(lat: number, lon: number, date: Date): SunTimes {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);

  const M = solarMeanAnomaly(ds);
  const eclipticLon = eclipticLongitude(M);
  const dec = declination(eclipticLon);

  const Jnoon = solarTransitJ(ds, M, eclipticLon);

  // cos(hourAngle) for the sunrise/sunset altitude. cos(phi) and cos(dec)
  // are both always >= 0 (phi in [-90, 90], dec bounded by Earth's ~23.44°
  // obliquity), so the sign of a >1 / <-1 excursion is unambiguous: see the
  // module doc comment for which direction means which polar case.
  const cosH =
    (Math.sin(SUNRISE_SUNSET_ANGLE) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));

  if (cosH > 1) {
    // The sun's highest point today (solar noon) is still below the
    // sunrise/sunset threshold -- it never comes up.
    return { kind: 'polar-night' };
  }
  if (cosH < -1) {
    // The sun's lowest point today (solar midnight) is still above the
    // sunrise/sunset threshold -- it never goes down.
    return { kind: 'midnight-sun' };
  }

  const hourAngle = Math.acos(cosH);
  const Jset = solarTransitJ(approxTransit(hourAngle, lw, n), M, eclipticLon);
  const Jrise = Jnoon - (Jset - Jnoon);

  return {
    kind: 'normal',
    sunrise: fromJulian(Jrise),
    sunset: fromJulian(Jset),
  };
}
