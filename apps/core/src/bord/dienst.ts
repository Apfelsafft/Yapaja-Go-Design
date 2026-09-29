/* eslint-disable no-undef -- `setInterval`/`clearInterval` und `NodeJS.ProcessEnv` sind Node-Globale; die ESLint-Umgebung dieses Pakets kennt sie nicht (wie in `ha/commandWatcher.ts`). */
/**
 * Der Bordsensoren-Dienst: liest die eingerichteten Home-Assistant-Entitäten,
 * wendet die Regeln an und sucht zu jedem Hinweis die passende Station.
 *
 * Die Entscheidungen stehen in `regeln.ts` und `entlangRoute.ts` und sind
 * dort ohne Home Assistant und ohne Route geprüft. Hier wird nur verdrahtet.
 *
 * ─── DIE HARTE REGEL ────────────────────────────────────────────────────────
 * Ein langsames oder ausgefallenes Home Assistant darf nichts blockieren. Der
 * Takt liest mit Zeitlimit (`ha/client.ts`), ein fehlender Wert ist `null`,
 * und ein Fehler beim Suchen der Station lässt den Hinweis ohne Station
 * stehen, statt ihn zu verschlucken.
 */

import type { RouteGeometry } from '../navigation/mapMatching.js';
import { naechsteStationen, type Fundstelle, type Kandidat } from './entlangRoute.js';
import {
  bordBefunde,
  haZahl,
  PASSENDE_STATION,
  STANDARD_SCHWELLEN,
  type BordArt,
  type BordBefund,
  type BordSchwellen,
  type BordWerte,
} from './regeln.js';

/** Welche HA-Entität welchen Wert liefert. Fehlt eine, gibt es diesen Hinweis nicht. */
export interface BordEntitaeten {
  grauwasser?: string;
  frischwasser?: string;
  batterie?: string;
  aussentemperatur?: string;
}

export interface BordKonfiguration {
  entitaeten: BordEntitaeten;
  schwellen: BordSchwellen;
}

export interface BordHinweis extends BordBefund {
  /** Die nächste passende Station, sofern es eine Kategorie dafür gibt und eine gefunden wurde. */
  station: Fundstelle | null;
}

export interface BordZustand {
  /** `false`, solange keine einzige Entität eingerichtet ist. */
  eingerichtet: boolean;
  werte: BordWerte;
  hinweise: BordHinweis[];
  /** Zeitpunkt der letzten Abfrage (ISO), `null` vor der ersten. */
  stand: string | null;
}

/** Wie oft Home Assistant gefragt wird. Füllstände ändern sich langsam. */
export const BORD_TAKT_MS = 60_000;

const ENTITAET = /^[a-z_]+\.[a-z0-9_]+$/;

function entitaet(wert: string | undefined): string | undefined {
  const t = wert?.trim();
  return t && ENTITAET.test(t) ? t : undefined;
}

function schwelle(wert: string | undefined, vorgabe: number): number {
  const n = haZahl(wert ?? null);
  return n === null ? vorgabe : n;
}

/**
 * Liest die Einstellungen aus der Umgebung (gesetzt vom Init-Skript des
 * Add-ons aus der Add-on-Konfiguration).
 *
 * Eine Entität, die nicht wie eine aussieht (`sensor.tank`), wird ignoriert,
 * statt Home Assistant mit Unsinn zu fragen.
 */
export function bordKonfigurationAusUmgebung(env: NodeJS.ProcessEnv): BordKonfiguration {
  const s = STANDARD_SCHWELLEN;
  const entitaeten: BordEntitaeten = {};
  const g = entitaet(env.YAPAIA_BORD_GRAUWASSER);
  const f = entitaet(env.YAPAIA_BORD_FRISCHWASSER);
  const b = entitaet(env.YAPAIA_BORD_BATTERIE);
  const t = entitaet(env.YAPAIA_BORD_AUSSENTEMPERATUR);
  if (g) entitaeten.grauwasser = g;
  if (f) entitaeten.frischwasser = f;
  if (b) entitaeten.batterie = b;
  if (t) entitaeten.aussentemperatur = t;
  return {
    entitaeten,
    schwellen: {
      grauwasser_ab_prozent: schwelle(env.YAPAIA_BORD_GRAUWASSER_AB, s.grauwasser_ab_prozent),
      frischwasser_bis_prozent: schwelle(env.YAPAIA_BORD_FRISCHWASSER_BIS, s.frischwasser_bis_prozent),
      batterie_bis_prozent: schwelle(env.YAPAIA_BORD_BATTERIE_BIS, s.batterie_bis_prozent),
      frost_bis_c: schwelle(env.YAPAIA_BORD_FROST_BIS, s.frost_bis_c),
    },
  };
}

export interface BordDienstOptionen {
  konfiguration: BordKonfiguration;
  /** Liest die Zustände der genannten Entitäten; fehlende fehlen in der Map. */
  leseZustaende: (ids: string[]) => Promise<Map<string, string>>;
  /** Alle bekannten Stationen einer Kategorie (aus dem Suchindex). */
  stationen: (kategorie: string) => readonly Kandidat[];
  /** Wo man gerade ist -- mit laufender Route oder ohne. */
  ort: () => {
    route: { geom: RouteGeometry; progressM: number } | null;
    position: { lat: number; lon: number } | null;
  };
  taktMs?: number;
  jetzt?: () => Date;
  logger?: { warn: (msg: string, meta?: Record<string, unknown>) => void };
}

export class BordDienst {
  private readonly opt: BordDienstOptionen;
  private timer: ReturnType<typeof setInterval> | null = null;
  private aktiv = new Set<BordArt>();
  private zustandJetzt: BordZustand;

  constructor(opt: BordDienstOptionen) {
    this.opt = opt;
    this.zustandJetzt = {
      eingerichtet: this.ids().length > 0,
      werte: { grauwasser_prozent: null, frischwasser_prozent: null, batterie_prozent: null, aussentemperatur_c: null },
      hinweise: [],
      stand: null,
    };
  }

  private ids(): string[] {
    return Object.values(this.opt.konfiguration.entitaeten).filter((x): x is string => typeof x === 'string');
  }

  /** Startet den Takt. Ohne eingerichtete Entität passiert nichts. */
  start(): void {
    if (this.timer || this.ids().length === 0) return;
    void this.aktualisiere();
    this.timer = setInterval(() => void this.aktualisiere(), this.opt.taktMs ?? BORD_TAKT_MS);
    // Ein Node-Prozess soll nicht an diesem Takt haengen bleiben.
    this.timer.unref?.();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  zustand(): BordZustand {
    return this.zustandJetzt;
  }

  /** Ein Takt: lesen, bewerten, Stationen suchen. Öffentlich für Tests. */
  async aktualisiere(): Promise<BordZustand> {
    const e = this.opt.konfiguration.entitaeten;
    const ids = this.ids();
    if (ids.length === 0) return this.zustandJetzt;

    let zustaende = new Map<string, string>();
    try {
      zustaende = await this.opt.leseZustaende(ids);
    } catch (err) {
      this.opt.logger?.warn('Bordsensoren: Lesen fehlgeschlagen', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }
    const lies = (id: string | undefined) => (id ? haZahl(zustaende.get(id)) : null);

    const werte: BordWerte = {
      grauwasser_prozent: lies(e.grauwasser),
      frischwasser_prozent: lies(e.frischwasser),
      batterie_prozent: lies(e.batterie),
      aussentemperatur_c: lies(e.aussentemperatur),
    };

    const befunde = bordBefunde(werte, this.opt.konfiguration.schwellen, this.aktiv);
    this.aktiv = new Set(befunde.map((b) => b.art));

    const ort = this.opt.ort();
    const hinweise: BordHinweis[] = befunde.map((b) => {
      const kategorie = PASSENDE_STATION[b.art];
      if (!kategorie) return { ...b, station: null };
      try {
        const [erste] = naechsteStationen(this.opt.stationen(kategorie), ort, 1);
        return { ...b, station: erste ?? null };
      } catch (err) {
        this.opt.logger?.warn('Bordsensoren: Stationssuche fehlgeschlagen', {
          art: b.art,
          reason: err instanceof Error ? err.message : String(err),
        });
        return { ...b, station: null };
      }
    });

    this.zustandJetzt = {
      eingerichtet: true,
      werte,
      hinweise,
      stand: (this.opt.jetzt?.() ?? new Date()).toISOString(),
    };
    return this.zustandJetzt;
  }
}
