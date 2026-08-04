/**
 * E10-T2 -- die Budget-Tabelle als DATEN.
 *
 * Einzige Quelle der Wahrheit fuer die Schwellen der Performance-Pipeline.
 * Jeder Eintrag traegt seine Doku-Herkunft mit (`source`), damit eine
 * Aenderung an docs/00 bzw. docs/01 §4 hier nachvollziehbar nachgezogen wird
 * und nicht als anonyme Magic Number verschwindet.
 *
 * WICHTIG: Diese Datei ist reine Daten- und Typdefinition ohne Seiteneffekte.
 * Die Bewertung (gruen/gelb/rot) liegt in `evaluate.ts`, der Trend/Regressions-
 * Vergleich in `trend.ts` -- beide sind pur und unit-getestet
 * (`evaluate.test.ts`, `trend.test.ts`, `statistics.test.ts`).
 */

/** `max`: Messwert muss <= Budget sein. `min`: Messwert muss >= Budget sein. */
export type BudgetDirection = 'max' | 'min';

/** Wo die Groesse anfaellt -- steuert nur die Gruppierung im Report. */
export type BudgetScope = 'client' | 'server';

export interface BudgetDefinition {
  /** Stabiler Schluessel; taucht so im JSON-Artefakt und im Trend-Kommentar auf. */
  readonly id: string;
  /** Bedienertext (deutsch). */
  readonly label: string;
  readonly unit: 'ms' | 'fps' | 'MB';
  readonly budget: number;
  readonly direction: BudgetDirection;
  readonly scope: BudgetScope;
  /** Fundstelle in der Doku, woertlich zitierbar. */
  readonly source: string;
}

/**
 * MB-Konvention dieser Datei: 1 GB = 1024 MB (MiB). docs/01 §4 nennt
 * "1,5 GB" / "1 GB" / "2,9 GB"; hier als 1536 / 1024 / 2970 MB gefuehrt.
 */
const GB = 1024;

/**
 * Die Latenz-/Rendering-Budgets aus docs/00 "Erfolgs-/Abnahmekriterien"
 * (Produkt-Ebene), gemessen im N100-Profil (Playwright CPU-Throttle 4x,
 * Viewport 1280x800 = die in docs/00 genannte Referenzaufloesung).
 */
export const RUNTIME_BUDGETS: readonly BudgetDefinition[] = [
  {
    id: 'cold_start_ms',
    label: 'Kaltstart bis interaktive Karte',
    unit: 'ms',
    budget: 5_000,
    direction: 'max',
    scope: 'client',
    source: 'docs/00 Erfolgskriterien: "Kaltstart App (Browser, Mini-PC) < 5 s bis interaktive Karte"',
  },
  {
    id: 'fps_pan_zoom',
    label: 'fps beim scripted Pan/Zoom',
    unit: 'fps',
    budget: 30,
    direction: 'min',
    scope: 'client',
    source: 'docs/00 Erfolgskriterien: ">= 30 fps beim Schwenken/Zoomen auf N100"; Wargame W-04',
  },
  {
    id: 'fps_drive',
    label: 'fps waehrend simulierter Fahrt',
    unit: 'fps',
    budget: 30,
    direction: 'min',
    scope: 'client',
    source: 'docs/00 Erfolgskriterien (Rendering) + E10-T2 "fps beim scripted Pan/Zoom/Fahrt"',
  },
  {
    id: 'reroute_ms',
    label: 'Reroute-Latenz nach bestaetigter Abweichung',
    unit: 'ms',
    budget: 3_000,
    direction: 'max',
    scope: 'server',
    source: 'docs/00 Erfolgskriterien: "Rerouting nach Abweichung < 3 s"; Wargame W-05',
  },
  {
    id: 'ws_latency_ms',
    label: 'WS-Latenz Position -> UI',
    unit: 'ms',
    budget: 500,
    direction: 'max',
    scope: 'client',
    source: 'docs/00 Erfolgskriterien: "GPS-Update -> UI < 500 ms Latenz"',
  },
];

/**
 * Die RSS-Tabelle aus docs/01 §4.
 *
 * `measurableInCi` sagt AUSDRUECKLICH, ob dieser Wert in der per-PR-Pipeline
 * ueberhaupt erhebbar ist. Valhalla/Photon/gpsd laufen dort NICHT als
 * langlebige Container (siehe .github/workflows/ci.yml: die Jobs
 * `valhalla-li-build`, `photon-setup`, `lite-search-li-build` bauen Fixtures
 * und smoke-testen, sie betreiben keine Dienste) -- ihr RSS ist hier
 * strukturell nicht messbar und wird deshalb als `not_measured` mit Grund
 * ausgewiesen statt geschaetzt.
 */
export const RSS_BUDGETS: readonly BudgetDefinition[] = [
  {
    id: 'rss_core_mb',
    label: 'RSS yapaja-core (Node)',
    unit: 'MB',
    budget: 300,
    direction: 'max',
    scope: 'server',
    source: 'docs/01 §4: "yapaja-core (Node) <= 300 MB"',
  },
  {
    id: 'rss_valhalla_mb',
    label: 'RSS Valhalla',
    unit: 'MB',
    budget: 1.5 * GB,
    direction: 'max',
    scope: 'server',
    source: 'docs/01 §4: "Valhalla <= 1,5 GB"',
  },
  {
    id: 'rss_photon_mb',
    label: 'RSS Photon (JVM, -Xmx)',
    unit: 'MB',
    budget: 1 * GB,
    direction: 'max',
    scope: 'server',
    source: 'docs/01 §4: "Photon (JVM, -Xmx) <= 1 GB"',
  },
  {
    id: 'rss_gpsd_mb',
    label: 'RSS gpsd',
    unit: 'MB',
    budget: 10,
    direction: 'max',
    scope: 'server',
    source: 'docs/01 §4: "gpsd <= 10 MB"',
  },
  {
    id: 'rss_server_total_mb',
    label: 'RSS Summe Server-Seite',
    unit: 'MB',
    budget: 2.9 * GB,
    direction: 'max',
    scope: 'server',
    source: 'docs/01 §4: "Summe Server-Seite <= 2,9 GB"',
  },
];

export const ALL_BUDGETS: readonly BudgetDefinition[] = [...RUNTIME_BUDGETS, ...RSS_BUDGETS];

/** Nachschlag per id; wirft, wenn eine Messung eine unbekannte id meldet. */
export function budgetById(id: string): BudgetDefinition {
  const found = ALL_BUDGETS.find((b) => b.id === id);
  if (!found) {
    throw new Error(`Unbekannte Budget-id "${id}" -- in e2e/perf/budgets.ts nicht definiert.`);
  }
  return found;
}
