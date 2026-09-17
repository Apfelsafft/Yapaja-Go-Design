/**
 * Verkehrsmeldungen vom Kern holen.
 *
 * ─── WARUM POST FÜR EINEN LESEVORGANG ───────────────────────────────────────
 * Weil der Aufruf hinter dem Kern das Haus verlässt. Ein GET sieht harmlos
 * aus — Browser holen ihn vor, Erreichbarkeitsprüfungen fragen ihn ab, ein
 * Dashboard lädt ihn im Hintergrund nach. Nichts davon soll ungefragt eine
 * Anfrage an einen fremden Server auslösen. Dieselbe Begründung wie bei der
 * Online-Prüfung; die Regel „Yapaia telefoniert nur auf Ansage" wiegt hier
 * schwerer als die Form.
 *
 * ─── UND WARUM DIESE DATEI NIE WIRFT ────────────────────────────────────────
 * Yapaia navigiert offline. Kein Netz, ein Zeitablauf oder eine unerwartete
 * Antwort dürfen die Fahrt nicht stören — sie werden zu einer Auskunft.
 */

import type { KartenMeldung } from './verkehrGeoJson.js';

/** Wie lange gewartet wird. Der Kern fragt bis zu acht Straßen nacheinander. */
const ZEITGRENZE_MS = 45_000;

export interface StrassenBefund {
  strasse: string;
  quelle: 'frisch' | 'zwischenspeicher' | 'fehler';
  alter_s?: number;
  fehler?: string;
  meldungen: number;
}

export interface VerkehrAntwort {
  meldungen: KartenMeldung[];
  strassen: StrassenBefund[];
  ohne_ort: number;
  urteil: string;
}

export type VerkehrErgebnis = VerkehrAntwort | { fehler: string };

function apiUrl(pfad: string): string {
  return `${import.meta.env.BASE_URL}${pfad}`;
}

/**
 * Holt die Verkehrslage für die genannten Autobahnen.
 *
 * Eine LEERE Liste wird gar nicht erst geschickt: der Kern antwortete zwar
 * brav, aber es wäre eine Anfrage, deren Antwort schon feststeht.
 */
export async function holeVerkehr(strassen: readonly string[]): Promise<VerkehrErgebnis> {
  if (strassen.length === 0) {
    return { meldungen: [], strassen: [], ohne_ort: 0, urteil: 'Keine Autobahn auf der Strecke.' };
  }

  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), ZEITGRENZE_MS);
  try {
    const antwort = await fetch(apiUrl('api/v1/online/verkehr'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strassen }),
      signal: abbruch.signal,
    });
    const rumpf = (await antwort.json()) as {
      data?: VerkehrAntwort;
      error?: { message?: string };
    };
    if (!antwort.ok) {
      // Die Meldung des Kerns sagt bereits, wo der Schalter sitzt. Sie durch
      // etwas Eigenes zu ersetzen hiesse, sie zu verlieren.
      return {
        fehler: rumpf?.error?.message ?? `Die Verkehrslage antwortete mit Status ${antwort.status}.`,
      };
    }
    if (!rumpf?.data || !Array.isArray(rumpf.data.meldungen)) {
      return { fehler: 'Die Antwort hatte nicht die erwartete Form.' };
    }
    return rumpf.data;
  } catch (err) {
    const abgebrochen = (err as Error)?.name === 'AbortError';
    return {
      fehler: abgebrochen
        ? 'Die Verkehrslage hat zu lange gedauert und wurde abgebrochen.'
        : `Die Verkehrslage war nicht erreichbar: ${(err as Error)?.message ?? 'unbekannter Fehler'}.`,
    };
  } finally {
    clearTimeout(wecker);
  }
}
