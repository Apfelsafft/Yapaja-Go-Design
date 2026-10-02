/**
 * Der Sprachdialog: Satz rein, kurze Antwort raus -- und, wo nötig, eine
 * Rückfrage, bevor sich an der Fahrt etwas ändert.
 *
 * ─── REGELN (docs/ideen-ki.md, Idee 1) ──────────────────────────────────────
 *  - Jede Routenänderung braucht eine Bestätigung („ja", „los").
 *  - Höchstens zwei Sätze. Details stehen auf dem Bildschirm.
 *  - Nicht verstanden → sagen, dass nicht verstanden wurde. Nicht raten.
 *
 * Der Dialog kennt die Dienste nur über `SprachDeps` -- so ist er ohne Kern,
 * Valhalla und Home Assistant prüfbar, und dieselbe Logik bedient später den
 * Mikrofon-Knopf in der App UND Home Assistant Assist.
 */

import type { NavState, Route } from '@yapaia/shared';
import { kategorieName, verstehe, type Absicht } from './verstehen.js';

export interface Treffer {
  name: string;
  /** „Ziolkowskistraße, Magdeburg" -- was vorgelesen wird. */
  beschreibung: string;
  lat: number;
  lon: number;
  /** Strecke dorthin (entlang der Route) oder Luftlinie, falls bekannt. */
  entfernung_m?: number | null;
}

export interface VerkehrsMeldung {
  titel: string;
  beschreibung: string;
  voraus_m: number | null;
}

export interface SprachDeps {
  /** Ortssuche (Suchindex), beste zuerst. */
  suche(text: string): Promise<Treffer[]>;
  /** Route von der aktuellen Position zum Ziel, mit dem aktiven Fahrzeug. */
  route(ziel: Treffer): Promise<Route>;
  /** Navigation mit dieser Route starten. */
  starte(route: Route, ziel: Treffer): void;
  navigation(): NavState;
  pause(): void;
  weiter(): void;
  stopp(): void;
  /** Nächste Treffer einer Kategorie: voraus auf der Route, sonst im Umkreis. */
  naechste(kategorie: string): Treffer[];
  /** „Der nächste Aldi": Sonderziele mit diesem Namen, die nächsten zuerst
   *  (entlang der Route, wenn eine läuft). */
  naechsteNamens?(name: string): Promise<Treffer[]>;
  /** Verkehrsmeldungen voraus auf der Route; `null`, wenn nichts abrufbar. */
  verkehr(): Promise<{ meldungen: VerkehrsMeldung[] } | { fehler: string }>;
  /** Uhrzeit für die Ankunft in Ortszeit formatieren („15:29"). */
  uhrzeit(iso: string): string;
  jetzt(): number;
  /**
   * Optional: die KI von Home Assistant für Sätze, die die Regeln nicht
   * verstehen (`ha/kiAgent.ts`). Liefert eine Absicht oder `null`.
   */
  ki?: (text: string) => Promise<Absicht | null>;
}

/** Was die Oberfläche nach der Antwort tun soll. */
export type Aktion =
  | { art: 'route_vorschlag'; route: Route; ziel: Treffer }
  | { art: 'navigation_gestartet' }
  | { art: 'navigation_beendet' }
  | { art: 'ansagen'; an: boolean }
  | { art: 'auswahl'; treffer: Treffer[] };

export interface Antwort {
  antwort: string;
  /** Was erkannt wurde -- für die Anzeige und die Fehlersuche. */
  absicht: Absicht['art'];
  aktion?: Aktion;
  /** Die Antwort ist eine Frage: die App hört danach gleich wieder zu. */
  rueckfrage?: boolean;
}

/** Wie lange eine offene Rückfrage gilt. */
const RUECKFRAGE_MS = 2 * 60_000;

type Offen =
  | { art: 'route'; route: Route; ziel: Treffer; bis: number }
  | { art: 'auswahl'; treffer: Treffer[]; bis: number };

export function entfernungText(m: number): string {
  if (m < 950) return `${Math.max(50, Math.round(m / 50) * 50)} Meter`;
  if (m < 10_000) return `${(m / 1000).toFixed(1).replace('.', ',')} Kilometer`;
  return `${Math.round(m / 1000)} Kilometer`;
}

export function dauerText(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} Minuten`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  const stunden = h === 1 ? 'eine Stunde' : `${h} Stunden`;
  return rest === 0 ? stunden : `${stunden} ${rest} Minuten`;
}

const AKTIV = new Set<NavState['status']>(['navigating', 'paused', 'off_route', 'routing']);

export const HILFE =
  'Du kannst zum Beispiel sagen: „Fahre mich nach Magdeburg", „Wo ist die nächste Tankstelle?", „Finde den nächsten Aldi", „Lies die Verkehrsmeldungen vor", „Wann sind wir da?" oder „Stoppe die Navigation".';

export class Sprachdialog {
  private offen: Offen | null = null;

  constructor(private readonly deps: SprachDeps) {}

  async verarbeite(text: string): Promise<Antwort> {
    let absicht = verstehe(text);
    if (absicht.art === 'unbekannt' && this.deps.ki) {
      // Erst die Regeln, dann die KI: was die Regeln können, geht auch ohne
      // Netz und ohne Wartezeit.
      absicht = (await this.deps.ki(text).catch(() => null)) ?? absicht;
    }
    const jetzt = this.deps.jetzt();
    if (this.offen && this.offen.bis < jetzt) this.offen = null;

    switch (absicht.art) {
      case 'ja':
        return this.bestaetigt();
      case 'nein':
        this.offen = null;
        return { antwort: 'Okay, abgebrochen.', absicht: 'nein' };
      case 'wahl':
        return this.waehle(absicht.nummer);
      case 'ziel':
        return this.ziel(absicht.ort);
      case 'naechste':
        return this.naechste(absicht.kategorie);
      case 'naechste_name':
        return this.naechsteNamens(absicht.name);
      case 'stopp': {
        if (!AKTIV.has(this.deps.navigation().status)) {
          return { antwort: 'Es läuft gerade keine Navigation.', absicht: 'stopp' };
        }
        this.deps.stopp();
        this.offen = null;
        return { antwort: 'Navigation beendet.', absicht: 'stopp', aktion: { art: 'navigation_beendet' } };
      }
      case 'pause': {
        if (this.deps.navigation().status !== 'navigating' && this.deps.navigation().status !== 'off_route') {
          return { antwort: 'Es läuft gerade keine Navigation, die ich pausieren könnte.', absicht: 'pause' };
        }
        this.deps.pause();
        return { antwort: 'Navigation pausiert. Sag „weiter", wenn es weitergeht.', absicht: 'pause' };
      }
      case 'weiter': {
        if (this.deps.navigation().status !== 'paused') {
          return { antwort: 'Die Navigation ist nicht pausiert.', absicht: 'weiter' };
        }
        this.deps.weiter();
        return { antwort: 'Weiter geht es.', absicht: 'weiter' };
      }
      case 'ankunft':
        return this.ankunft();
      case 'verkehr':
        return this.verkehr(absicht.anzahl);
      case 'ansagen':
        return {
          antwort: absicht.an ? 'Ansagen sind an.' : 'Ansagen sind aus.',
          absicht: 'ansagen',
          aktion: { art: 'ansagen', an: absicht.an },
        };
      case 'hilfe':
        return { antwort: HILFE, absicht: 'hilfe' };
      case 'unbekannt':
        return {
          antwort: 'Das habe ich nicht verstanden. Sag zum Beispiel „Fahre mich nach Magdeburg" oder „Wo ist die nächste Tankstelle?".',
          absicht: 'unbekannt',
        };
    }
  }

  private async ziel(ort: string): Promise<Antwort> {
    let treffer: Treffer[];
    try {
      treffer = await this.deps.suche(ort);
    } catch {
      return { antwort: 'Die Suche ist gerade nicht erreichbar.', absicht: 'ziel' };
    }
    if (treffer.length === 0) {
      return { antwort: `Zu „${ort}" habe ich nichts gefunden.`, absicht: 'ziel' };
    }
    return this.routeZu(treffer[0]!, 'ziel');
  }

  private async routeZu(ziel: Treffer, absicht: Absicht['art']): Promise<Antwort> {
    let route: Route;
    try {
      route = await this.deps.route(ziel);
    } catch (err) {
      const grund = err instanceof Error && err.message ? ` (${err.message})` : '';
      return { antwort: `Zu ${ziel.beschreibung} konnte ich keine Route berechnen${grund}.`, absicht };
    }
    this.offen = { art: 'route', route, ziel, bis: this.deps.jetzt() + RUECKFRAGE_MS };
    const laeuft = AKTIV.has(this.deps.navigation().status);
    return {
      antwort:
        `${ziel.beschreibung}: ${entfernungText(route.distance_m)}, etwa ${dauerText(route.duration_s)}. ` +
        (laeuft ? 'Soll ich die laufende Navigation dorthin ändern?' : 'Soll ich losfahren?'),
      absicht,
      aktion: { art: 'route_vorschlag', route, ziel },
      rueckfrage: true,
    };
  }

  private naechste(kategorie: string): Antwort {
    const name = kategorieName(kategorie);
    const treffer = this.deps.naechste(kategorie);
    if (treffer.length === 0) {
      return { antwort: `In der Nähe habe ich nichts gefunden (${name}).`, absicht: 'naechste' };
    }
    this.offen = { art: 'auswahl', treffer, bis: this.deps.jetzt() + RUECKFRAGE_MS };
    const erste = treffer[0]!;
    const wo = typeof erste.entfernung_m === 'number' ? `, in ${entfernungText(erste.entfernung_m)}` : '';
    const weitere = treffer.length > 1 ? ` Ich habe ${treffer.length} gefunden; sag „die zweite" für die nächste.` : '';
    return {
      antwort: `Nächste ${name}: ${erste.beschreibung}${wo}. Soll ich dich hinführen?${weitere}`,
      absicht: 'naechste',
      aktion: { art: 'auswahl', treffer },
      rueckfrage: true,
    };
  }

  private async naechsteNamens(name: string): Promise<Antwort> {
    let treffer: Treffer[] = [];
    try {
      treffer = (await this.deps.naechsteNamens?.(name)) ?? [];
    } catch {
      return { antwort: 'Die Suche ist gerade nicht erreichbar.', absicht: 'naechste_name' };
    }
    if (treffer.length === 0) {
      return { antwort: `„${name}" habe ich in der Nähe nicht gefunden.`, absicht: 'naechste_name' };
    }
    this.offen = { art: 'auswahl', treffer, bis: this.deps.jetzt() + RUECKFRAGE_MS };
    const erste = treffer[0]!;
    const wo = typeof erste.entfernung_m === 'number' ? `, in ${entfernungText(erste.entfernung_m)}` : '';
    const weitere = treffer.length > 1 ? ` Ich habe ${treffer.length} gefunden; sag „die zweite" für die nächste.` : '';
    return {
      antwort: `Am nächsten: ${erste.beschreibung}${wo}. Soll ich dich hinführen?${weitere}`,
      absicht: 'naechste_name',
      aktion: { art: 'auswahl', treffer },
      rueckfrage: true,
    };
  }

  private async waehle(nummer: number): Promise<Antwort> {
    if (!this.offen || this.offen.art !== 'auswahl') {
      return { antwort: 'Es gibt gerade keine Auswahl.', absicht: 'wahl' };
    }
    const t = this.offen.treffer[nummer - 1];
    if (!t) return { antwort: `Es gibt nur ${this.offen.treffer.length} Treffer.`, absicht: 'wahl' };
    return this.routeZu(t, 'wahl');
  }

  private async bestaetigt(): Promise<Antwort> {
    const o = this.offen;
    if (!o) return { antwort: 'Es gibt gerade nichts zu bestätigen.', absicht: 'ja' };
    if (o.art === 'auswahl') return this.routeZu(o.treffer[0]!, 'ja');
    this.offen = null;
    try {
      this.deps.starte(o.route, o.ziel);
    } catch (err) {
      const grund = err instanceof Error && err.message ? `: ${err.message}` : '.';
      return { antwort: `Die Navigation ließ sich nicht starten${grund}`, absicht: 'ja' };
    }
    return { antwort: `Los geht's nach ${o.ziel.name}.`, absicht: 'ja', aktion: { art: 'navigation_gestartet' } };
  }

  private ankunft(): Antwort {
    const s = this.deps.navigation();
    if (!AKTIV.has(s.status) || s.eta === null) {
      return { antwort: 'Es läuft gerade keine Navigation.', absicht: 'ankunft' };
    }
    const rest = s.distance_remaining_m !== null ? `, noch ${entfernungText(s.distance_remaining_m)}` : '';
    const dauer = s.duration_remaining_s !== null ? ` in ${dauerText(s.duration_remaining_s)}` : '';
    return { antwort: `Ankunft um ${this.deps.uhrzeit(s.eta)}${dauer}${rest}.`, absicht: 'ankunft' };
  }

  private async verkehr(anzahl: number): Promise<Antwort> {
    if (!AKTIV.has(this.deps.navigation().status)) {
      return { antwort: 'Verkehrsmeldungen lese ich während einer Navigation vor.', absicht: 'verkehr' };
    }
    const r = await this.deps.verkehr();
    if ('fehler' in r) return { antwort: r.fehler, absicht: 'verkehr' };
    const voraus = r.meldungen
      .filter((m) => m.voraus_m === null || m.voraus_m >= -200)
      .sort((a, b) => (a.voraus_m ?? 0) - (b.voraus_m ?? 0))
      .slice(0, anzahl);
    if (voraus.length === 0) return { antwort: 'Auf der Route voraus liegen keine Meldungen vor.', absicht: 'verkehr' };
    const saetze = voraus.map((m) => {
      const wo = m.voraus_m !== null ? `In ${entfernungText(Math.max(0, m.voraus_m))}: ` : '';
      const text = m.beschreibung.split(/\n/)[0]?.trim();
      return `${wo}${m.titel}${text ? `. ${text}` : ''}.`;
    });
    return { antwort: saetze.join(' '), absicht: 'verkehr' };
  }
}
