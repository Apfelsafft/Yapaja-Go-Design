/**
 * Der Leser der Autobahn-Schnittstelle.
 *
 * ─── WAS DIESE PRÜFUNGEN KÖNNEN, UND WAS NICHT ──────────────────────────────
 * Sie prüfen, dass der Leser mit UNTERSCHIEDLICHEN Antwortformen zurechtkommt
 * und bei Unsinn nichts erfindet. Sie können NICHT prüfen, dass die echte
 * Schnittstelle so antwortet — von der Entwicklungsumgebung aus ist sie nicht
 * erreichbar.
 *
 * Genau deshalb ist der Leser suchend statt erwartend gebaut, und genau
 * deshalb gibt es `diagnose.ts`: die Wahrheit steht nachher auf dem
 * Bildschirm des Betreibers, nicht hier.
 *
 * Die Fälle unten sind daher bewusst nicht „die eine richtige Antwort",
 * sondern die Bandbreite dessen, was kommen KANN.
 */

import { describe, it, expect } from 'vitest';
import {
  alsZahl,
  ausAntwort,
  autobahnDienstUrl,
  autobahnStrassenUrl,
  AUTOBAHN_DIENSTE,
  leseKoordinate,
  leseText,
  normalisiere,
  parseListe,
  feldBericht,
} from './autobahn';

describe('parseListe — die Liste selbst finden', () => {
  it('nimmt die einzige Liste, wie immer sie heißt', () => {
    // Der ganze Punkt: der Feldname ist NICHT fest verdrahtet. Ein fest
    // erwarteter Name, den es nicht gibt, ergäbe „keine Baustellen" -- ein
    // Fehler, der wie eine gute Nachricht aussieht.
    expect(parseListe({ roadworks: [1, 2] }).eintraege).toEqual([1, 2]);
    expect(parseListe({ irgendwas: [1] }).schluessel).toBe('irgendwas');
  });

  it('nimmt eine Antwort, die selbst schon die Liste ist', () => {
    expect(parseListe([1, 2, 3]).eintraege).toEqual([1, 2, 3]);
    expect(parseListe([]).schluessel).toBe('(Wurzel)');
  });

  it('rät NICHT, wenn es mehrere Listen gibt', () => {
    // Zwei Listen und eine davon greifen hieße raten. Das ist der Fehler, der
    // hier schon dreimal Zeit gekostet hat.
    const r = parseListe({ roadworks: [1], warnings: [2] });
    expect(r.eintraege).toEqual([]);
    expect(r.schluessel).toBeNull();
    expect(r.mehrdeutig).toEqual(['roadworks', 'warnings']);
  });

  it('kommt mit allem zurecht, was gar keine Antwort ist', () => {
    for (const unsinn of [null, undefined, 42, 'text', true]) {
      expect(parseListe(unsinn).eintraege).toEqual([]);
    }
  });

  it('übersieht die Liste nicht neben anderen Feldern', () => {
    // Nur Felder zählen, die wirklich Listen sind.
    const r = parseListe({ meta: { a: 1 }, anzahl: 2, roadworks: [1] });
    expect(r.schluessel).toBe('roadworks');
  });
});

describe('alsZahl', () => {
  it('nimmt Zahlen und Zahlen als Text', () => {
    expect(alsZahl(49.2)).toBe(49.2);
    expect(alsZahl('49.2')).toBe(49.2);
    expect(alsZahl(' 8.31 ')).toBe(8.31);
  });

  it('gibt bei Unsinn `null` und NICHT 0', () => {
    // 0/0 liegt im Golf von Guinea und sähe auf der Karte wie eine echte
    // Position aus. Eine erfundene Position ist schlimmer als keine.
    for (const unsinn of ['', '  ', 'abc', null, undefined, {}, [], NaN, Infinity]) {
      expect(alsZahl(unsinn), `${JSON.stringify(unsinn)}`).toBeNull();
    }
  });

  it('nimmt die ehrliche Null', () => {
    // Eine tatsächlich gemeldete 0 ist ein gültiger Wert und darf nicht
    // mit „fehlt" verwechselt werden.
    expect(alsZahl(0)).toBe(0);
    expect(alsZahl('0')).toBe(0);
  });
});

describe('leseKoordinate', () => {
  it('liest `long` — die Schreibweise dieser Schnittstellenfamilie', () => {
    // `long` statt `lon` ist bei deutschen Behördenschnittstellen üblich. Eine
    // vertauschte Erwartung ergäbe keine Fehlermeldung, sondern eine
    // Baustelle im Atlantik.
    expect(leseKoordinate({ coordinate: { lat: '49.2', long: '8.3' } })).toEqual({
      lat: 49.2,
      lon: 8.3,
    });
  });

  it('liest auch `lon`, `lng` und `longitude`', () => {
    for (const feld of ['lon', 'lng', 'longitude']) {
      expect(leseKoordinate({ coordinate: { lat: 49, [feld]: 8 } }).lon, feld).toBe(8);
    }
  });

  it('liest Koordinaten auch direkt am Eintrag', () => {
    expect(leseKoordinate({ lat: 49, long: 8 })).toEqual({ lat: 49, lon: 8 });
  });

  it('liefert `null`, wenn nichts Brauchbares dasteht', () => {
    expect(leseKoordinate({ coordinate: {} })).toEqual({ lat: null, lon: null });
    expect(leseKoordinate(null)).toEqual({ lat: null, lon: null });
    expect(leseKoordinate({ coordinate: { lat: 'Nord', long: 'Ost' } })).toEqual({
      lat: null,
      lon: null,
    });
  });
});

describe('leseText', () => {
  it('fügt eine Liste von Zeilen zusammen', () => {
    expect(leseText(['erste', 'zweite'])).toBe('erste\nzweite');
  });

  it('lässt leere Zeilen weg, statt Lücken zu erzeugen', () => {
    expect(leseText(['a', '', '   ', 'b'])).toBe('a\nb');
  });

  it('gibt bei allem anderen eine leere Zeichenkette', () => {
    for (const unsinn of [null, undefined, 42, {}]) {
      expect(leseText(unsinn)).toBe('');
    }
  });
});

describe('normalisiere', () => {
  it('macht aus einem vollständigen Eintrag eine Meldung', () => {
    const m = normalisiere(
      {
        identifier: 'ABC-1',
        title: 'A61 Richtung Koblenz',
        subtitle: 'zwischen X und Y',
        description: ['Fahrbahnverengung', 'bis Ende Oktober'],
        coordinate: { lat: '49.9', long: '7.8' },
      },
      'A61',
      'roadworks',
    );
    expect(m).toEqual({
      id: 'ABC-1',
      art: 'baustelle',
      strasse: 'A61',
      titel: 'A61 Richtung Koblenz',
      beschreibung: 'Fahrbahnverengung\nbis Ende Oktober',
      lat: 49.9,
      lon: 7.8,
    });
  });

  it('verwirft einen Eintrag ohne Titel', () => {
    // Ein Symbol auf der Karte, das niemand deuten kann, ist schlimmer als
    // keines.
    expect(normalisiere({ identifier: 'X' }, 'A61', 'roadworks')).toBeNull();
    expect(normalisiere(null, 'A61', 'roadworks')).toBeNull();
    expect(normalisiere('text', 'A61', 'roadworks')).toBeNull();
  });

  it('nimmt den Untertitel, wenn der Titel fehlt', () => {
    const m = normalisiere({ subtitle: 'Sperrung' }, 'A3', 'closure');
    expect(m?.titel).toBe('Sperrung');
  });

  it('behält eine Meldung ohne Koordinaten', () => {
    // Sie taugt dann nicht für die Karte, aber sehr wohl für eine Liste.
    const m = normalisiere({ title: 'Irgendwas' }, 'A61', 'warning');
    expect(m?.lat).toBeNull();
    expect(m?.titel).toBe('Irgendwas');
  });

  it('bildet eine STABILE Kennung, wenn die Quelle keine liefert', () => {
    // Eine Kennung, die sich bei jedem Abruf ändert, macht aus „schon
    // gesehen" eine Ansage bei jeder Aktualisierung.
    const a = normalisiere({ title: 'Gleich' }, 'A61', 'roadworks');
    const b = normalisiere({ title: 'Gleich' }, 'A61', 'roadworks');
    expect(a?.id).toBe(b?.id);
    expect(a?.id).toContain('A61');
  });

  it('ordnet jeden Dienst seiner Art zu', () => {
    for (const [dienst, art] of Object.entries(AUTOBAHN_DIENSTE)) {
      const m = normalisiere({ title: 't' }, 'A61', dienst as keyof typeof AUTOBAHN_DIENSTE);
      expect(m?.art, dienst).toBe(art);
    }
  });
});

describe('ausAntwort', () => {
  it('zählt, was unbrauchbar war, statt es zu verschweigen', () => {
    // Ohne diese Zahl sähe „3 von 3 verworfen" aus wie „keine Baustellen".
    const r = ausAntwort({ roadworks: [{ title: 'a' }, {}, { title: 'c' }] }, 'A61', 'roadworks');
    expect(r.meldungen).toHaveLength(2);
    expect(r.verworfen).toBe(1);
    expect(r.schluessel).toBe('roadworks');
  });

  it('reicht die Mehrdeutigkeit durch', () => {
    const r = ausAntwort({ a: [], b: [] }, 'A61', 'roadworks');
    expect(r.mehrdeutig).toEqual(['a', 'b']);
  });
});

describe('die Adressen', () => {
  it('bauen auf derselben Wurzel auf', () => {
    expect(autobahnStrassenUrl()).toContain('verkehr.autobahn.de');
    expect(autobahnDienstUrl('A61', 'roadworks')).toContain('verkehr.autobahn.de');
  });

  it('nennen Straße und Dienst', () => {
    const url = autobahnDienstUrl('A61', 'roadworks');
    expect(url).toContain('/A61/');
    expect(url).toContain('/roadworks');
  });

  it('kodieren die Straße, statt sie roh einzusetzen', () => {
    // Die Kennung kommt aus einer Anfrage. Sie wird zwar vorher geprüft, aber
    // zwei Schlösser an einer Tür, die nach draußen führt, sind hier richtig.
    expect(autobahnDienstUrl('A 61/../x', 'warning')).not.toContain('../');
  });
});

/**
 * ─── DIE FRAGE, DIE ICH NICHT SELBST BEANTWORTEN KANN ───────────────────────
 *
 * Aus der ersten echten Prüfung auf dem Gerät:
 *
 *   Autobahn A61 — parking_lorry: 60 Einträge, alle brauchbar.
 *   Beispiel: „A61 | undefined" — ohne Koordinaten
 *
 * Dieser eine Dienst ist anders aufgebaut als die vier anderen. Warum, weiß
 * ich nicht — die Netzregeln dieser Entwicklungsumgebung lassen die
 * Schnittstelle nicht durch, ich kann sie nicht aufrufen.
 *
 * Ich könnte raten: `coordinates` statt `coordinate`, ein verschachteltes
 * `position`, GeoJSON. Alles plausibel, und genau so ist der gpsd-Fehler
 * entstanden — drei plausible Diagnosen, alle falsch.
 *
 * Also wird gefragt statt geraten. `feldBericht` nennt, was WIRKLICH in einem
 * Eintrag steht; die Prüfung zeigt es an; der nächste Lauf auf dem Gerät
 * beantwortet die Frage in einer Zeile.
 */
describe('feldBericht — den Aufbau nennen, statt ihn zu erraten', () => {
  it('nennt Feldnamen mit ihren Typen', () => {
    expect(feldBericht({ title: 'A61', isBlocked: true, lorryParkingFeatureIcons: [] })).toBe(
      'title:string, isBlocked:boolean, lorryParkingFeatureIcons:array',
    );
  });

  it('geht EINE Ebene tiefer — dort stecken bei den anderen die Koordinaten', () => {
    expect(feldBericht({ coordinate: { lat: '49.9', long: '7.8' } })).toBe(
      'coordinate{lat:string, long:string}',
    );
  });

  it('verrät KEINE Werte', () => {
    // Dieser Text wird vom Betreiber weitergegeben, damit ich ihn lese.
    // Feldnamen sagen nichts über ihn, Werte könnten es. Für den Aufbau
    // braucht sie ohnehin niemand.
    const bericht = feldBericht({
      title: 'Raststätte Geheim',
      coordinate: { lat: '49.123456', long: '7.654321' },
    });
    expect(bericht).not.toContain('Geheim');
    expect(bericht).not.toContain('49.123456');
    expect(bericht).toContain('title:string');
  });

  it('unterscheidet null von einem Objekt', () => {
    // `typeof null === 'object'` — wer das übersieht, meldet ein leeres
    // Klammerpaar und schickt damit auf die falsche Fährte.
    expect(feldBericht({ coordinate: null })).toBe('coordinate:null');
  });

  it('bricht bei sehr vielen Feldern ab, statt eine Wand zu erzeugen', () => {
    const viele: Record<string, number> = {};
    for (let i = 0; i < 100; i += 1) viele[`f${i}`] = i;
    expect(feldBericht(viele).split(', ')).toHaveLength(40);
  });

  it('kommt mit etwas zurecht, das gar kein Objekt ist', () => {
    expect(feldBericht('text')).toBe('string');
    expect(feldBericht(null)).toBe('object');
  });
});

describe('ausAntwort — was NICHT auf die Karte kann, wird gezählt', () => {
  const OHNE_KOORDINATEN = {
    parking_lorry: [
      { title: 'A61 | undefined', identifier: 'p1' },
      { title: 'A61 | undefined', identifier: 'p2' },
    ],
  };

  it('zählt Meldungen ohne Koordinaten getrennt', () => {
    const b = ausAntwort(OHNE_KOORDINATEN, 'A61', 'parking_lorry');
    expect(b.meldungen).toHaveLength(2);
    // Sie sind nicht verworfen — im Text steht ja etwas.
    expect(b.verworfen).toBe(0);
    // Aber zeichenbar sind sie nicht, und genau das war der blinde Fleck.
    expect(b.ohneKoordinaten).toBe(2);
  });

  it('liefert die Feldnamen des ersten Eintrags mit', () => {
    expect(ausAntwort(OHNE_KOORDINATEN, 'A61', 'parking_lorry').felder).toContain('title:string');
  });

  it('zählt bei sauberen Antworten nichts als fehlend', () => {
    const b = ausAntwort(
      { roadworks: [{ title: 'Baustelle', coordinate: { lat: '49.9', long: '7.8' } }] },
      'A61',
      'roadworks',
    );
    expect(b.ohneKoordinaten).toBe(0);
  });

  it('felder ist null, wenn die Liste leer war', () => {
    expect(ausAntwort({ warning: [] }, 'A61', 'warning').felder).toBeNull();
  });
});
