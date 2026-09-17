/* eslint-disable no-undef -- `fetch`/`AbortController`/`setTimeout`/
 * `clearTimeout` sind Standard-Globale in Node 22 (typisiert ueber
 * @types/node); dieselbe Begruendung wie in `ha/client.ts`. */

/**
 * Verkehrsmeldungen für eine Handvoll Autobahnen holen.
 *
 * ─── WAS DIESE DATEI TUT UND WAS SIE NICHT TUT ──────────────────────────────
 * Sie holt Baustellen und Sperrungen für genannte Straßen, legt sie in den
 * Zwischenspeicher und gibt zurück, was sie hat. Sie entscheidet NICHT, welche
 * Straßen gefragt werden — das weiß nur, wer die Route kennt.
 *
 * ─── DREI ZUSICHERUNGEN, DIE HIER ALLES BESTIMMEN ───────────────────────────
 *
 * 1. SIE WIRFT NIE. Yapaia ist eine Offline-Navigation. Kein Netz, ein
 *    Zeitablauf oder eine unerwartete Antwort dürfen die Fahrt nicht stören —
 *    sie werden zu einer Auskunft, nicht zu einem Abbruch.
 *
 * 2. SIE SAGT JE STRASSE, WOHER DIE DATEN KOMMEN. Wenn von drei Autobahnen
 *    eine nicht antwortet, ist das Ergebnis dünner als es sein sollte — und
 *    das muss DASTEHEN. Eine leere Liste ist sonst nicht davon zu
 *    unterscheiden, dass gerade nichts gemeldet ist. Genau diese Verwechslung
 *    hat dieses Projekt schon mehrfach Tage gekostet.
 *
 * 3. SIE ZÄHLT, WAS NICHT AUF DIE KARTE KANN. Aus der ersten echten Prüfung
 *    auf dem Gerät: sechzig LKW-Parkplätze, alle ohne Koordinaten, gemeldet
 *    als „alle brauchbar". Der Befund klang gut und war für eine Karte
 *    wertlos. Deshalb hier getrennt: `meldungen` sind die zeichenbaren,
 *    `ohne_ort` ist die Zahl der übrigen.
 */

import {
  ausAntwort,
  autobahnDienstUrl,
  type AutobahnDienst,
  type Verkehrsmeldung,
} from './autobahn.js';
import { symbolFuer } from '../map/styles/verkehrSymbole.js';
import { VerkehrCache } from './verkehrCache.js';

/**
 * Eine Meldung, wie sie an die Oberfläche geht: mit dem Namen ihres Bildes.
 *
 * ─── WARUM DER KERN DAS SYMBOL MITLIEFERT ───────────────────────────────────
 * Weil sonst die Oberfläche die Zuordnung Art→Bild kennen müsste. Ein
 * Versuch, sie dort per `import` aus dem Kern zu holen, hätte alle Tests
 * bestanden und den BROWSER-BAU gebrochen: `@yapaia/core` steht in der
 * Auflösung von `vitest.config.ts`, aber nicht in der von
 * `apps/web/vite.config.ts`.
 *
 * Die Zuordnung zweimal zu schreiben wäre die andere Möglichkeit gewesen —
 * und damit zwei Stellen, die auseinanderlaufen können, während MapLibre zu
 * einem unbekannten `icon-image` schweigt.
 *
 * Also trägt die Meldung ihr Bild selbst. Ein Besitzer, keine Kopie.
 */
export interface VerkehrsmeldungMitBild extends Verkehrsmeldung {
  /** Der Name im Sprite-Blatt, oder `null`, wenn es für die Art keines gibt. */
  symbol: string | null;
}

/**
 * Welche Dienste für die Karte abgefragt werden.
 *
 * Bewusst NUR diese beiden. `warning` ist auf einer Autobahn fast immer leer,
 * `parking_lorry` liefert nach heutigem Stand keine Koordinaten, und
 * `electric_charging_station` gehört zu den POIs und nicht zu den
 * Verkehrsmeldungen. Jeder zusätzliche Dienst ist ein weiterer Aufruf nach
 * draußen je Straße — das gehört begründet und nicht vorsichtshalber gemacht.
 */
export const VERKEHR_DIENSTE: readonly AutobahnDienst[] = ['roadworks', 'closure'];

/** Wie lange auf EINEN Aufruf gewartet wird. */
export const VERKEHR_ZEITGRENZE_MS = 6000;

/** Mehr Straßen auf einmal ergäben eine Salve nach draußen. */
export const VERKEHR_HOECHSTZAHL_STRASSEN = 8;

export type Quelle = 'frisch' | 'zwischenspeicher' | 'fehler';

export interface StrassenBefund {
  strasse: string;
  quelle: Quelle;
  /** Nur bei `zwischenspeicher`: wie alt die Daten sind, in Sekunden. */
  alter_s?: number;
  /** Nur bei `fehler`: im Klartext, auf Deutsch. */
  fehler?: string;
  /** Wie viele zeichenbare Meldungen diese Straße beigesteuert hat. */
  meldungen: number;
}

export interface VerkehrBefund {
  /** Alle zeichenbaren Meldungen, entdoppelt — jede mit ihrem Bildnamen. */
  meldungen: VerkehrsmeldungMitBild[];
  /** Je Straße: woher die Daten kommen. */
  strassen: StrassenBefund[];
  /** Meldungen MIT Text, aber OHNE Ort — sie können nicht auf die Karte. */
  ohne_ort: number;
}

export interface VerkehrDeps {
  fetchFn?: typeof fetch;
  cache?: VerkehrCache;
  zeitgrenzeMs?: number;
}

/** Ein Aufruf, der nie wirft. `null` heißt „kam nichts Brauchbares". */
async function rufDienst(
  strasse: string,
  dienst: AutobahnDienst,
  fetchFn: typeof fetch,
  grenzeMs: number,
): Promise<{ meldungen: Verkehrsmeldung[]; ohneOrt: number } | { fehler: string }> {
  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), grenzeMs);
  try {
    const antwort = await fetchFn(autobahnDienstUrl(strasse, dienst), {
      signal: abbruch.signal,
      headers: { accept: 'application/json' },
    });
    if (!antwort.ok) return { fehler: `${dienst}: Status ${antwort.status}` };

    const json: unknown = await antwort.json();
    const befund = ausAntwort(json, strasse, dienst);
    return {
      // Nur was einen Ort hat, geht auf die Karte. Der Rest wird gezählt,
      // nicht stillschweigend mitgeschleppt.
      meldungen: befund.meldungen.filter((m) => m.lat !== null && m.lon !== null),
      ohneOrt: befund.ohneKoordinaten,
    };
  } catch (err) {
    const abgebrochen = (err as Error)?.name === 'AbortError';
    return {
      fehler: abgebrochen
        ? `${dienst}: keine Antwort innerhalb von ${grenzeMs} ms`
        : `${dienst}: ${(err as Error)?.message ?? 'unbekannter Fehler'}`,
    };
  } finally {
    clearTimeout(wecker);
  }
}

/**
 * Prüft und normalisiert eine Straßenkennung.
 *
 * Sie landet in einer URL. Kodiert wird sie ohnehin, aber ein freier Text an
 * dieser Stelle wäre trotzdem eine Einladung — und „A61" ist ein eng
 * umrissenes Format. Dieselbe Prüfung wie bei der Diagnose.
 */
const STRASSE_MUSTER = /^[A-Za-z]{1,2}[0-9]{1,4}$/;

export function normalisiereStrassen(roh: readonly string[]): string[] {
  const gesehen = new Set<string>();
  const heraus: string[] = [];
  for (const kandidat of roh) {
    const s = kandidat.trim().toUpperCase();
    if (!STRASSE_MUSTER.test(s) || gesehen.has(s)) continue;
    gesehen.add(s);
    heraus.push(s);
    if (heraus.length >= VERKEHR_HOECHSTZAHL_STRASSEN) break;
  }
  return heraus;
}

/**
 * Holt die Verkehrslage für die genannten Straßen.
 *
 * Die Straßen werden NACHEINANDER gefragt, nicht gleichzeitig: zwei bis acht
 * parallele Aufrufe an denselben offenen Dienst sind eine Salve, und der
 * Gewinn wäre eine Sekunde. Der Zwischenspeicher sorgt ohnehin dafür, dass
 * das selten passiert.
 */
export async function holeVerkehr(
  strassenRoh: readonly string[],
  deps: VerkehrDeps = {},
): Promise<VerkehrBefund> {
  const fetchFn = deps.fetchFn ?? fetch;
  const cache = deps.cache ?? new VerkehrCache();
  const grenzeMs = deps.zeitgrenzeMs ?? VERKEHR_ZEITGRENZE_MS;

  const strassen = normalisiereStrassen(strassenRoh);
  const befunde: StrassenBefund[] = [];
  const gesammelt = new Map<string, Verkehrsmeldung>();
  let ohneOrt = 0;

  for (const strasse of strassen) {
    const frisch = cache.lies(strasse);
    if (frisch?.frisch) {
      for (const m of frisch.meldungen) gesammelt.set(m.id, m);
      befunde.push({ strasse, quelle: 'frisch', meldungen: frisch.meldungen.length });
      continue;
    }

    const meldungen: Verkehrsmeldung[] = [];
    const fehler: string[] = [];
    for (const dienst of VERKEHR_DIENSTE) {
      const ergebnis = await rufDienst(strasse, dienst, fetchFn, grenzeMs);
      if ('fehler' in ergebnis) {
        fehler.push(ergebnis.fehler);
        continue;
      }
      meldungen.push(...ergebnis.meldungen);
      ohneOrt += ergebnis.ohneOrt;
    }

    // ─── EIN TEILWEISER FEHLSCHLAG IST EIN FEHLSCHLAG ────────────────────
    // Kam auch nur einer der Dienste nicht durch, ist das Ergebnis für diese
    // Straße unvollständig. Es dann als frisch in den Zwischenspeicher zu
    // legen hiesse, eine Lücke für fünf Minuten festzuschreiben — und zwar
    // eine, die von aussen wie „hier ist nichts" aussieht.
    if (fehler.length > 0) {
      const alt = cache.lies(strasse);
      if (alt) {
        for (const m of alt.meldungen) gesammelt.set(m.id, m);
        befunde.push({
          strasse,
          quelle: 'zwischenspeicher',
          alter_s: Math.round(alt.alterMs / 1000),
          fehler: fehler.join('; '),
          meldungen: alt.meldungen.length,
        });
        continue;
      }
      befunde.push({ strasse, quelle: 'fehler', fehler: fehler.join('; '), meldungen: 0 });
      continue;
    }

    cache.schreibe(strasse, meldungen);
    for (const m of meldungen) gesammelt.set(m.id, m);
    befunde.push({ strasse, quelle: 'frisch', meldungen: meldungen.length });
  }

  return {
    meldungen: [...gesammelt.values()].map((m) => ({ ...m, symbol: symbolFuer(m) })),
    strassen: befunde,
    ohne_ort: ohneOrt,
  };
}

/**
 * Ein Satz über die Lage, für die Oberfläche.
 *
 * Er nennt die Einschränkungen zuerst. Wer ihn liest, soll nicht erst die
 * Einzelzeilen durchgehen müssen, um zu merken, dass die Hälfte fehlt.
 */
export function verkehrUrteil(befund: VerkehrBefund): string {
  if (befund.strassen.length === 0) {
    return 'Keine Autobahn genannt — es wurde nichts abgefragt.';
  }
  const fehlend = befund.strassen.filter((s) => s.quelle === 'fehler');
  const alt = befund.strassen.filter((s) => s.quelle === 'zwischenspeicher');

  const teile: string[] = [];
  if (fehlend.length > 0) {
    teile.push(
      `Für ${fehlend.map((s) => s.strasse).join(', ')} liegen KEINE Daten vor — ` +
        'dort kann etwas sein, das hier nicht steht.',
    );
  }
  if (alt.length > 0) {
    const aeltest = Math.max(...alt.map((s) => s.alter_s ?? 0));
    teile.push(
      `Für ${alt.map((s) => s.strasse).join(', ')} stammen die Daten aus dem Zwischenspeicher ` +
        `(bis zu ${Math.round(aeltest / 60)} Minuten alt).`,
    );
  }
  teile.push(
    befund.meldungen.length === 0
      ? 'Aktuell ist nichts gemeldet.'
      : `${befund.meldungen.length} Meldung(en) auf der Strecke.`,
  );
  return teile.join(' ');
}
