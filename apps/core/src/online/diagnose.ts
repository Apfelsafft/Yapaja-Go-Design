/* eslint-disable no-undef -- `fetch`/`Response`/`AbortController`/`setTimeout`/
 * `clearTimeout` sind Standard-Globale in Node 22 (typisiert ueber
 * @types/node); dieselbe Begruendung wie in `ha/client.ts`. */

/**
 * Was die Online-Dienste WIRKLICH antworten — im Klartext.
 *
 * ─── WARUM DIESER TEIL ZUERST GEBAUT WIRD ───────────────────────────────────
 * Von der Entwicklungsumgebung aus ist keine dieser Schnittstellen
 * erreichbar; die Netzregeln lassen sie nicht durch. Ich kann den Code also
 * schreiben und gegen aufgezeichnete Antworten prüfen, aber ich kann NICHT
 * nachsehen, ob die echte Schnittstelle antwortet, wie ich es annehme.
 *
 * Genau in dieser Lage ist der gpsd-Fehler entstanden: drei plausible
 * Diagnosen, alle falsch, weil geraten statt gemessen wurde. Was am Ende
 * geholfen hat, war nicht die vierte Vermutung, sondern das System dazu zu
 * bringen, SELBST zu antworten.
 *
 * Diese Datei ist dieses Mittel, nur vorweg statt hinterher. Sie ruft jeden
 * Dienst wirklich auf und berichtet, was zurückkam:
 *
 *   * die aufgerufene Adresse (damit man sie selbst im Browser öffnen kann)
 *   * den HTTP-Statuscode und wie lange es gedauert hat
 *   * ob überhaupt JSON kam
 *   * unter welchem Feld die Liste gefunden wurde -- oder dass es mehrdeutig
 *     war, mit den Namen zur Auswahl
 *   * wie viele Einträge kamen, wie viele davon unbrauchbar waren
 *   * einen Beispieleintrag, wie Yapaia ihn verstanden hat
 *
 * Wer das liest, weiß in einer Minute, ob die Annahme stimmte -- statt in
 * einer Version.
 *
 * ─── DIESE DATEI RUFT NACH DRAUSSEN ─────────────────────────────────────────
 * Sie ist der einzige Teil von Yapaia, der das Haus verlässt. Deshalb:
 * ausdrücklich angestoßen, nie von allein, und nur wenn die Online-Dienste in
 * der Add-on-Konfiguration eingeschaltet sind. Mitgeschickt wird nichts außer
 * der Anfrage selbst -- keine Position, keine Route, keine Kennung.
 */

import {
  AUTOBAHN_DIENSTE,
  ausAntwort,
  autobahnDienstUrl,
  autobahnStrassenUrl,
  parseListe,
  type AutobahnDienst,
  type Verkehrsmeldung,
} from './autobahn.js';

/** Wie lange auf eine Antwort gewartet wird. */
export const DIAGNOSE_ZEITGRENZE_MS = 8000;

/** Das Ergebnis EINES Aufrufs — auch wenn er scheiterte. */
export interface DiagnoseZeile {
  dienst: string;
  url: string;
  /** `null`, wenn die Verbindung gar nicht zustande kam. */
  status: number | null;
  dauer_ms: number;
  /** Im Klartext, auf Deutsch. Immer gesetzt. */
  befund: string;
  /** Unter welchem Feld die Liste lag. */
  schluessel?: string | null;
  eintraege?: number;
  verworfen?: number;
  /** Mit Titel, aber ohne Koordinaten — nicht auf die Karte zu bringen. */
  ohne_koordinaten?: number;
  /**
   * Die Feldnamen des ersten Eintrags, MIT Typen und OHNE Werte.
   *
   * Nur gesetzt, wenn etwas nicht aufging — sonst wäre es Lärm. Wer es liest,
   * sieht genau, wie der Dienst wirklich aufgebaut ist, und muss nicht raten.
   * Werte stehen bewusst nicht dabei: dieser Text wird weitergegeben.
   */
  felder?: string;
  /** Ein Beispiel, so wie Yapaia es verstanden hat. */
  beispiel?: Verkehrsmeldung;
}

/** Injizierbar — damit die Prüfungen ohne Netz auskommen. */
export interface DiagnoseDeps {
  fetchFn?: typeof fetch;
  jetzt?: () => number;
  zeitgrenzeMs?: number;
}

/**
 * Ein einzelner Aufruf, der NIE wirft.
 *
 * Eine Diagnose, die selbst abstürzt, sagt nichts. Jeder Fehler wird zu einer
 * Zeile mit Befund -- das ist der ganze Sinn.
 */
async function ruf(
  dienst: string,
  url: string,
  deps: DiagnoseDeps,
): Promise<{ zeile: DiagnoseZeile; json: unknown }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const jetzt = deps.jetzt ?? (() => Date.now());
  const grenze = deps.zeitgrenzeMs ?? DIAGNOSE_ZEITGRENZE_MS;
  const start = jetzt();

  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), grenze);
  try {
    const antwort = await fetchFn(url, {
      signal: abbruch.signal,
      headers: { accept: 'application/json' },
    });
    const dauer_ms = jetzt() - start;

    if (!antwort.ok) {
      return {
        zeile: {
          dienst,
          url,
          status: antwort.status,
          dauer_ms,
          befund: `Der Dienst antwortete mit ${antwort.status}. Die Adresse lässt sich im Browser öffnen, dann steht dort meist der Grund.`,
        },
        json: null,
      };
    }

    let json: unknown;
    try {
      json = await antwort.json();
    } catch {
      return {
        zeile: {
          dienst,
          url,
          status: antwort.status,
          dauer_ms,
          befund:
            'Die Antwort kam an, war aber kein JSON. Häufigste Ursache: ein Portal ' +
            'im Netz (Hotspot, Gastzugang) schiebt eine Anmeldeseite dazwischen.',
        },
        json: null,
      };
    }

    return {
      zeile: { dienst, url, status: antwort.status, dauer_ms, befund: 'Antwort erhalten.' },
      json,
    };
  } catch (err) {
    const dauer_ms = jetzt() - start;
    const abgebrochen = (err as Error)?.name === 'AbortError';
    return {
      zeile: {
        dienst,
        url,
        status: null,
        dauer_ms,
        befund: abgebrochen
          ? `Keine Antwort innerhalb von ${grenze} ms. Entweder ist gerade kein Netz da, oder der Dienst ist langsam.`
          : `Die Verbindung kam nicht zustande: ${(err as Error)?.message ?? 'unbekannter Fehler'}.`,
      },
      json: null,
    };
  } finally {
    clearTimeout(wecker);
  }
}

/** Beschreibt einen Listen-Befund so, dass man daraus etwas ableiten kann. */
export function beschreibeListe(
  eintraege: number,
  verworfen: number,
  schluessel: string | null,
  mehrdeutig: string[],
  /** Meldungen mit Titel, aber ohne Koordinaten — nicht zeichenbar. */
  ohneKoordinaten = 0,
): string {
  if (mehrdeutig.length > 0) {
    return (
      'Mehrdeutig: die Antwort führt mehrere Listen (' +
      mehrdeutig.join(', ') +
      '). Yapaia rät hier NICHT — welche gemeint ist, muss im Quelltext eingetragen werden.'
    );
  }
  if (schluessel === null) {
    return 'In der Antwort war überhaupt keine Liste zu finden. Der Aufbau ist ein anderer als angenommen.';
  }
  if (eintraege === 0) {
    return `Liste unter „${schluessel}" gefunden, sie ist leer. Das kann stimmen — auf einer Autobahn ohne Baustelle ist das der Normalfall.`;
  }
  if (verworfen === eintraege) {
    return `Liste unter „${schluessel}" mit ${eintraege} Einträgen — aber KEINER war brauchbar. Die Felder heißen anders als erwartet.`;
  }

  const brauchbar = eintraege - verworfen;
  const teile = [`Liste unter „${schluessel}": ${eintraege} Einträge`];
  if (verworfen > 0) teile.push(`davon ${verworfen} ohne Titel übersprungen`);

  // ─── DIE KORREKTUR AUS DER ERSTEN ECHTEN PRUEFUNG ───────────────────────
  // Hier stand „alle brauchbar" — auch bei sechzig LKW-Parkplätzen, von denen
  // kein einziger Koordinaten hatte. Für eine Karte ist das nicht brauchbar,
  // und genau diese Sorte beruhigender Befund sollte diese Datei verhindern.
  if (ohneKoordinaten === brauchbar) {
    teile.push(
      'aber KEINER hat Koordinaten — auf die Karte kann davon nichts. ' +
        'Die Feldnamen stehen unten; dieser Dienst ist anders aufgebaut als die übrigen',
    );
  } else if (ohneKoordinaten > 0) {
    teile.push(`${ohneKoordinaten} ohne Koordinaten (nicht zeichenbar)`);
  } else if (verworfen === 0) {
    teile.push('alle mit Koordinaten');
  }
  return `${teile.join(', ')}.`;
}

/**
 * Prüft die Autobahn-Schnittstelle: erst die Straßenliste, dann für EINE
 * Straße jeden Dienst.
 *
 * Nur eine Straße, und zwar die aus `strasse`: eine Diagnose, die alle ~130
 * Autobahnen abfragt, wäre selbst die Last, über die sie berichtet.
 */
export async function diagnoseAutobahn(
  strasse = 'A61',
  deps: DiagnoseDeps = {},
): Promise<DiagnoseZeile[]> {
  const zeilen: DiagnoseZeile[] = [];

  const { zeile: wurzel, json: wurzelJson } = await ruf(
    'Autobahn — Straßenliste',
    autobahnStrassenUrl(),
    deps,
  );
  if (wurzelJson !== null) {
    const { schluessel, eintraege, mehrdeutig } = parseListe(wurzelJson);
    wurzel.schluessel = schluessel;
    wurzel.eintraege = eintraege.length;
    wurzel.befund = beschreibeListe(eintraege.length, 0, schluessel, mehrdeutig);
  }
  zeilen.push(wurzel);

  for (const dienst of Object.keys(AUTOBAHN_DIENSTE) as AutobahnDienst[]) {
    const url = autobahnDienstUrl(strasse, dienst);
    const { zeile, json } = await ruf(`Autobahn ${strasse} — ${dienst}`, url, deps);
    if (json !== null) {
      const befund = ausAntwort(json, strasse, dienst);
      const gesamt = befund.meldungen.length + befund.verworfen;
      zeile.schluessel = befund.schluessel;
      zeile.eintraege = gesamt;
      zeile.verworfen = befund.verworfen;
      zeile.ohne_koordinaten = befund.ohneKoordinaten;
      zeile.befund = beschreibeListe(
        gesamt,
        befund.verworfen,
        befund.schluessel,
        befund.mehrdeutig,
        befund.ohneKoordinaten,
      );
      if (befund.meldungen.length > 0) zeile.beispiel = befund.meldungen[0];
      // Die Feldnamen NUR, wenn etwas nicht aufging. Bei einem Dienst, der
      // sauber liefert, wären sie bloss eine Zeile Fachtext mehr.
      if (befund.felder && (befund.verworfen > 0 || befund.ohneKoordinaten > 0)) {
        zeile.felder = befund.felder;
      }
    }
    zeilen.push(zeile);
  }

  return zeilen;
}

/**
 * Eine Gesamteinschätzung in einem Satz.
 *
 * Damit oben auf der Seite steht, woran man ist, statt dass man sich das aus
 * sieben Zeilen zusammenreimen muss.
 */
export function gesamturteil(zeilen: readonly DiagnoseZeile[]): string {
  if (zeilen.length === 0) return 'Es wurde nichts geprüft.';
  const erreicht = zeilen.filter((z) => z.status !== null);
  if (erreicht.length === 0) {
    return 'Kein einziger Dienst war erreichbar. Sehr wahrscheinlich ist gerade kein Internet da — für die Navigation ist das folgenlos, sie arbeitet offline.';
  }
  // ─── „VERWERTBAR" HEISST: DAMIT LAESST SICH ETWAS ZEICHNEN ──────────────
  // Hier zählte nur `verworfen === 0`. Die erste echte Prüfung meldete
  // daraufhin „5 von 6 lieferten verwertbare Daten" — obwohl bei einem dieser
  // fünf sechzig Einträge ohne jede Koordinate lagen. Der Satz war beruhigend
  // und falsch, und beruhigend-falsch ist in diesem Projekt die teuerste
  // Sorte Aussage.
  const mitDaten = zeilen.filter(
    (z) => (z.eintraege ?? 0) > 0 && (z.verworfen ?? 0) === 0 && (z.ohne_koordinaten ?? 0) === 0,
  );
  const nurText = zeilen.filter(
    (z) => (z.eintraege ?? 0) > 0 && (z.ohne_koordinaten ?? 0) > 0,
  );
  if (mitDaten.length > 0) {
    const satz = `${erreicht.length} von ${zeilen.length} Diensten antworteten, und ${mitDaten.length} davon lieferten Daten mit Koordinaten.`;
    if (nurText.length === 0) return satz;
    return (
      `${satz} Bei ${nurText.length} weiteren kamen Einträge an, denen die Koordinaten ` +
      'fehlen — die stehen im Text, aber nicht auf der Karte. Die Feldnamen dazu stehen in der jeweiligen Zeile.'
    );
  }
  const verstanden = zeilen.filter((z) => z.schluessel != null);
  if (verstanden.length > 0) {
    return `${erreicht.length} von ${zeilen.length} Diensten antworteten. Listen wurden gefunden, aber es kamen keine brauchbaren Einträge — entweder ist gerade nichts gemeldet, oder die Felder heißen anders als erwartet.`;
  }
  return `${erreicht.length} von ${zeilen.length} Diensten antworteten, aber der Aufbau der Antworten ist ein anderer als angenommen. Die Einzelzeilen nennen die gefundenen Felder.`;
}
