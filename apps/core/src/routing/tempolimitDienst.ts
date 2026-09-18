/**
 * Führt die Spur, fragt Valhalla und merkt sich das Ergebnis.
 *
 * ─── WARUM DAS VON `tempolimitHier.ts` GETRENNT IST ─────────────────────────
 * Dort stehen die Regeln, hier steht die Zeit. Die Regeln sind rein und ohne
 * Uhr, ohne Netz und ohne Valhalla prüfbar; was hier liegt, ist der Rest:
 * wann gefragt wird, was gemerkt wird, und was gilt, solange nichts zurück
 * ist.
 *
 * ─── DIE EINE REGEL DIESER DATEI ────────────────────────────────────────────
 * `aktuell()` antwortet SOFORT und lügt dabei nicht.
 *
 * Die Home-Assistant-Brücke schreibt im Takt und kann nicht warten. Sie
 * bekommt deshalb, was zuletzt bekannt war — und im `stand` steht, woran
 * man ist: noch nie gefragt, unterwegs, veraltet, oder hier gilt wirklich
 * nichts. Ohne diese Unterscheidung sähe „Valhalla antwortet seit zehn
 * Minuten nicht" genauso aus wie „hier ist kein Tempolimit ausgeschildert".
 */

import type { Position } from '@yapaia/shared';
import { speedLimitOf, roadClassOf } from './speedLimits.js';
import {
  alsSpurpunkt,
  spurPflegen,
  spurBrauchbar,
  buildSpurBody,
  limitAusSpurAntwort,
  abfrageFaellig,
  type HierGefunden,
  type Spurpunkt,
} from './tempolimitHier.js';

/**
 * Wie lange eine Auskunft gilt, nachdem sie geholt wurde.
 *
 * Bei 100 km/h sind dreissig Sekunden rund 800 Meter — ein Stück Straße. Was
 * älter ist, kann von einer anderen Straße stammen, und dann ist es nicht
 * mehr „das Limit hier", sondern „das Limit von vorhin".
 */
export const STAND_HOECHSTALTER_MS = 30_000;

export type Tempostand =
  /** Noch nie gefragt worden. */
  | 'unbekannt'
  /** Die Spur reicht nicht (zu ungenau, zu kurz, steht). */
  | 'keine_spur'
  /** Frisch geholt und gültig. */
  | 'frisch'
  /** Die letzte Auskunft ist älter als `STAND_HOECHSTALTER_MS`. */
  | 'veraltet'
  /** Gefragt, aber Valhalla wusste hier nichts. */
  | 'ohne_treffer'
  /** Die Abfrage selbst ist fehlgeschlagen. */
  | 'fehler';

export interface Tempoauskunft {
  /** Das ausgeschilderte Limit, oder `null`. */
  kmh: number | null;
  /** Valhallas Straßenklasse, oder `null`. */
  road_class: string | null;
  /** Woran man ist. */
  stand: Tempostand;
}

const NICHTS: Tempoauskunft = { kmh: null, road_class: null, stand: 'unbekannt' };

/** Was der Dienst von aussen braucht. */
export interface TempolimitDienstDeps {
  /** `/trace_attributes`. Gibt `null` zurück, statt zu werfen. */
  traceAttributes: (body: Record<string, unknown>) => Promise<unknown | null>;
  /** Das Kostenmodell des aktiven Profils (`auto`, `truck`, …). */
  costing: () => string;
  /** Nur für Tests. */
  jetzt?: () => number;
}

export class TempolimitDienst {
  private spur: Spurpunkt[] = [];
  private gefunden: HierGefunden | null = null;
  private geholtAmMs: number | null = null;
  private zuletztGefragtMs: number | null = null;
  private letzterStand: Tempostand = 'unbekannt';
  /** Läuft gerade eine Abfrage? Ohne das stünden bei einer langsamen
   *  Antwort mehrere gleichzeitig an, und die letzte gewänne — nicht die
   *  neueste. Dieselbe Sperre wie beim Verkehrsabruf. */
  private laeuft = false;

  constructor(private readonly deps: TempolimitDienstDeps) {}

  private jetzt(): number {
    return this.deps.jetzt?.() ?? Date.now();
  }

  /**
   * Eine neue Position ist da.
   *
   * Nimmt sie in die Spur auf und stösst bei Bedarf eine Abfrage an. Wirft
   * nie und wartet nicht: der Aufrufer ist der Positionsstrom, und der darf
   * an einer Tempolimit-Abfrage nicht hängen.
   */
  melde(position: Position | null | undefined): void {
    const punkt = alsSpurpunkt(position);
    if (punkt === null) return;
    const jetzt = this.jetzt();
    this.spur = spurPflegen(this.spur, punkt, jetzt);
    if (!spurBrauchbar(this.spur, jetzt)) return;
    if (this.laeuft) return;
    if (!abfrageFaellig(this.zuletztGefragtMs, jetzt)) return;
    void this.frage();
  }

  /** Holt die Auskunft. Wirft nie. */
  private async frage(): Promise<void> {
    this.laeuft = true;
    this.zuletztGefragtMs = this.jetzt();
    const spur = [...this.spur];
    try {
      const roh = await this.deps.traceAttributes(buildSpurBody(spur, this.deps.costing()));
      const treffer = limitAusSpurAntwort(roh, speedLimitOf, roadClassOf);
      if (treffer === null) {
        // ─── GEFRAGT UND NICHTS GEFUNDEN IST NICHT DASSELBE WIE FEHLER ────
        // Hier gibt es wirklich keine Zuordnung -- etwa auf einem Feldweg,
        // der nicht im Graphen steht. Die alte Auskunft wird dabei
        // WEGGEWORFEN: sie gehoerte zu einer anderen Strasse.
        this.gefunden = null;
        this.geholtAmMs = null;
        this.letzterStand = 'ohne_treffer';
        return;
      }
      this.gefunden = treffer;
      this.geholtAmMs = this.jetzt();
      this.letzterStand = 'frisch';
    } catch {
      // Die alte Auskunft BLEIBT stehen. Ein fehlgeschlagener Abruf ist kein
      // Grund, ein Schild von der Anzeige zu nehmen, das vor zehn Sekunden
      // noch galt -- der Stand sagt daneben, dass gerade nichts Neues kam.
      this.letzterStand = 'fehler';
    } finally {
      this.laeuft = false;
    }
  }

  /**
   * Was gerade gilt — sofort, ohne zu warten.
   *
   * Der `stand` ist hier das Wichtigste. Ohne ihn sähe „Valhalla antwortet
   * nicht" genauso aus wie „hier ist nichts ausgeschildert", und beides
   * ergäbe ein leeres Schild.
   */
  aktuell(): Tempoauskunft {
    const jetzt = this.jetzt();

    if (this.gefunden === null) {
      // Nie etwas gefunden. Welcher Fall genau, sagt der letzte Stand -- ist
      // noch gar nichts passiert, entscheidet die Spur.
      if (this.letzterStand === 'unbekannt' && !spurBrauchbar(this.spur, jetzt)) {
        return { ...NICHTS, stand: 'keine_spur' };
      }
      return { ...NICHTS, stand: this.letzterStand };
    }

    const alt = this.geholtAmMs === null || jetzt - this.geholtAmMs > STAND_HOECHSTALTER_MS;
    return {
      kmh: this.gefunden.kmh,
      road_class: this.gefunden.road_class,
      // Ein Fehlschlag nach einer gueltigen Auskunft bleibt sichtbar: sonst
      // sähe ein hängender Valhalla wie ein gültiger Stand aus.
      stand: alt ? 'veraltet' : this.letzterStand === 'fehler' ? 'fehler' : 'frisch',
    };
  }

  /** Alles vergessen — etwa beim Wechsel der Region. */
  leeren(): void {
    this.spur = [];
    this.gefunden = null;
    this.geholtAmMs = null;
    this.zuletztGefragtMs = null;
    this.letzterStand = 'unbekannt';
  }
}
