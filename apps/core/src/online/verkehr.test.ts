/* eslint-disable no-undef -- `fetch`/`Response`/`AbortSignal` sind
 * Standard-Globale in Node 22 (typisiert ueber @types/node); dieselbe
 * Begruendung wie in `ha/client.ts` und `online/routes.test.ts`. */

/**
 * Verkehrsmeldungen holen — und ehrlich sagen, was dabei fehlte.
 *
 * ─── WORAUF ES HIER ANKOMMT ─────────────────────────────────────────────────
 * Nicht darauf, dass Meldungen ankommen. Darauf, was passiert, wenn sie es
 * NICHT tun.
 *
 * Eine leere Karte kann zweierlei heißen: „hier ist nichts" oder „ich konnte
 * nicht nachsehen". Für jemanden, der auf eine gesperrte Autobahn zufährt,
 * ist das der ganze Unterschied. Dieses Projekt hat diese Verwechslung schon
 * mehrfach bezahlt — zuletzt bei den LKW-Parkplätzen, die als „alle
 * brauchbar" gemeldet wurden, obwohl kein einziger einen Ort hatte.
 */

import { describe, it, expect } from 'vitest';
import {
  holeVerkehr,
  normalisiereStrassen,
  verkehrUrteil,
  VERKEHR_DIENSTE,
  VERKEHR_HOECHSTZAHL_STRASSEN,
} from './verkehr';
import { VerkehrCache, VERKEHR_FRISCH_MS } from './verkehrCache';

/** Eine Antwort, wie die Autobahn-Schnittstelle sie laut der echten Prüfung
 *  auf dem Gerät liefert: Liste unter dem Dienstnamen, Koordinaten als
 *  Zeichenketten unter `coordinate.lat` / `coordinate.long`. */
function antwort(dienst: string, eintraege: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ [dienst]: eintraege }),
  } as unknown as Response;
}

function baustelle(id: string, titel = 'Fahrbahnverengung'): unknown {
  return {
    identifier: id,
    title: titel,
    coordinate: { lat: '49.9000', long: '7.8000' },
  };
}

/** Ein `fetch`, das nach dem Dienstnamen in der URL entscheidet. */
function fetchMit(
  handler: (url: string) => Response | Promise<Response>,
): typeof fetch {
  return ((url: string) => Promise.resolve(handler(String(url)))) as unknown as typeof fetch;
}

function uhr(start = 1_000_000): { jetzt: () => number; weiter: (ms: number) => void } {
  let t = start;
  return { jetzt: () => t, weiter: (ms) => { t += ms; } };
}

describe('normalisiereStrassen', () => {
  it('macht Großbuchstaben und entfernt Leerraum', () => {
    expect(normalisiereStrassen([' a61 ', 'a3'])).toEqual(['A61', 'A3']);
  });

  it('wirft Unsinn weg, statt ihn in eine URL zu setzen', () => {
    // Die Kennung landet in einer Adresse. Kodiert wird sie ohnehin, aber
    // freier Text an dieser Stelle wäre trotzdem eine Einladung.
    expect(normalisiereStrassen(['A61', '../../etc/passwd', 'Köln', ''])).toEqual(['A61']);
  });

  it('entdoppelt', () => {
    expect(normalisiereStrassen(['A61', 'a61', 'A61'])).toEqual(['A61']);
  });

  it('begrenzt die Zahl — sonst wäre es eine Salve nach draußen', () => {
    const viele = Array.from({ length: 30 }, (_, i) => `A${i + 1}`);
    expect(normalisiereStrassen(viele)).toHaveLength(VERKEHR_HOECHSTZAHL_STRASSEN);
  });
});

describe('holeVerkehr — der gute Fall', () => {
  it('sammelt die Meldungen der abgefragten Dienste ein', async () => {
    const befund = await holeVerkehr(['A61'], {
      fetchFn: fetchMit((url) =>
        url.includes('roadworks')
          ? antwort('roadworks', [baustelle('r1')])
          : antwort('closure', [baustelle('c1', 'Fahrbahninstandsetzung')]),
      ),
      cache: new VerkehrCache(),
    });
    expect(befund.meldungen).toHaveLength(2);
    expect(befund.strassen).toEqual([{ strasse: 'A61', quelle: 'frisch', meldungen: 2 }]);
  });

  it('fragt genau die festgelegten Dienste ab und keine weiteren', async () => {
    // Jeder zusätzliche Dienst ist ein weiterer Aufruf nach draußen JE
    // STRASSE. Das gehört begründet und nicht vorsichtshalber gemacht.
    const gerufen: string[] = [];
    await holeVerkehr(['A61'], {
      fetchFn: fetchMit((url) => {
        gerufen.push(url.split('/services/')[1] ?? url);
        return antwort('x', []);
      }),
      cache: new VerkehrCache(),
    });
    expect(gerufen).toEqual([...VERKEHR_DIENSTE]);
  });

  it('entdoppelt über Straßen hinweg', async () => {
    // Eine Baustelle an einem Autobahnkreuz steht bei beiden Autobahnen. Sie
    // zweimal zu zeichnen wäre eine erfundene zweite Baustelle.
    const befund = await holeVerkehr(['A61', 'A3'], {
      fetchFn: fetchMit(() => antwort('roadworks', [baustelle('gleiche-id')])),
      cache: new VerkehrCache(),
    });
    expect(befund.meldungen).toHaveLength(1);
  });

  it('zählt, was keinen Ort hat, statt es mitzuschleppen', async () => {
    // Die Lehre aus der ersten echten Prüfung: sechzig LKW-Parkplätze, alle
    // ohne Koordinaten, gemeldet als „alle brauchbar".
    const befund = await holeVerkehr(['A61'], {
      fetchFn: fetchMit((url) =>
        url.includes('roadworks')
          ? antwort('roadworks', [baustelle('mit-ort'), { title: 'A61 | undefined', identifier: 'ohne' }])
          : antwort('closure', []),
      ),
      cache: new VerkehrCache(),
    });
    expect(befund.meldungen).toHaveLength(1);
    expect(befund.ohne_ort).toBe(1);
  });
});

describe('holeVerkehr — wenn es NICHT klappt', () => {
  it('wirft nie, auch wenn gar nichts antwortet', async () => {
    const befund = await holeVerkehr(['A61'], {
      fetchFn: (() => Promise.reject(new Error('ENOTFOUND'))) as unknown as typeof fetch,
      cache: new VerkehrCache(),
    });
    expect(befund.meldungen).toEqual([]);
    expect(befund.strassen[0].quelle).toBe('fehler');
    expect(befund.strassen[0].fehler).toContain('ENOTFOUND');
  });

  it('nennt die betroffene Straße beim Namen', async () => {
    // „Es gab einen Fehler" nützt nichts. WELCHE Autobahn fehlt, ist die
    // Auskunft, aus der man etwas ableiten kann.
    const befund = await holeVerkehr(['A61', 'A3'], {
      fetchFn: fetchMit((url) => {
        if (url.includes('/A3/')) throw new Error('kaputt');
        return antwort('roadworks', [baustelle('r1')]);
      }),
      cache: new VerkehrCache(),
    });
    expect(befund.strassen.find((s) => s.strasse === 'A3')?.quelle).toBe('fehler');
    expect(befund.strassen.find((s) => s.strasse === 'A61')?.quelle).toBe('frisch');
  });

  it('liefert bei einem Fehlschlag ALTE Daten statt gar keiner', async () => {
    // Wer ohne Netz auf der A61 steht, ist mit einer zwanzig Minuten alten
    // Baustellenmeldung erheblich besser bedient als mit einer leeren Karte.
    const u = uhr();
    const cache = new VerkehrCache(u.jetzt);
    await holeVerkehr(['A61'], {
      fetchFn: fetchMit(() => antwort('roadworks', [baustelle('r1')])),
      cache,
    });

    u.weiter(VERKEHR_FRISCH_MS + 60_000);
    const befund = await holeVerkehr(['A61'], {
      fetchFn: (() => Promise.reject(new Error('kein Netz'))) as unknown as typeof fetch,
      cache,
    });
    expect(befund.meldungen).toHaveLength(1);
    expect(befund.strassen[0].quelle).toBe('zwischenspeicher');
    expect(befund.strassen[0].alter_s).toBe(360);
  });

  it('schreibt ein unvollständiges Ergebnis NICHT als frisch fort', async () => {
    // Fiel einer der beiden Dienste aus, fehlt etwas. Das dann fünf Minuten
    // lang als frisch auszugeben hiesse, eine Lücke festzuschreiben — eine,
    // die von außen wie „hier ist nichts" aussieht.
    const cache = new VerkehrCache();
    await holeVerkehr(['A61'], {
      fetchFn: fetchMit((url) => {
        if (url.includes('closure')) throw new Error('kaputt');
        return antwort('roadworks', [baustelle('r1')]);
      }),
      cache,
    });
    expect(cache.lies('A61')).toBeNull();
  });

  it('behandelt einen Fehlerstatus wie einen Fehler, nicht wie eine leere Liste', async () => {
    // 503 mit leerem Rumpf sähe sonst aus wie „keine Baustellen".
    const befund = await holeVerkehr(['A61'], {
      fetchFn: fetchMit(
        () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response,
      ),
      cache: new VerkehrCache(),
    });
    expect(befund.strassen[0].quelle).toBe('fehler');
    expect(befund.strassen[0].fehler).toContain('503');
  });

  it('bricht einen zu langsamen Aufruf ab, statt die Fahrt aufzuhalten', async () => {
    const befund = await holeVerkehr(['A61'], {
      fetchFn: ((_u: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_ok, fehl) => {
          init?.signal?.addEventListener('abort', () =>
            fehl(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        })) as unknown as typeof fetch,
      cache: new VerkehrCache(),
      zeitgrenzeMs: 10,
    });
    expect(befund.strassen[0].quelle).toBe('fehler');
    expect(befund.strassen[0].fehler).toContain('keine Antwort');
  });
});

describe('holeVerkehr — der Zwischenspeicher spart Aufrufe', () => {
  it('fragt beim zweiten Mal gar nicht mehr nach draußen', async () => {
    let aufrufe = 0;
    const cache = new VerkehrCache();
    const fetchFn = fetchMit(() => {
      aufrufe += 1;
      return antwort('roadworks', [baustelle('r1')]);
    });
    await holeVerkehr(['A61'], { fetchFn, cache });
    const nachErstem = aufrufe;
    await holeVerkehr(['A61'], { fetchFn, cache });
    expect(aufrufe).toBe(nachErstem);
  });

  it('fragt nach Ablauf wieder', async () => {
    const u = uhr();
    let aufrufe = 0;
    const cache = new VerkehrCache(u.jetzt);
    const fetchFn = fetchMit(() => {
      aufrufe += 1;
      return antwort('roadworks', []);
    });
    await holeVerkehr(['A61'], { fetchFn, cache });
    u.weiter(VERKEHR_FRISCH_MS + 1);
    await holeVerkehr(['A61'], { fetchFn, cache });
    expect(aufrufe).toBe(VERKEHR_DIENSTE.length * 2);
  });
});

describe('verkehrUrteil', () => {
  it('nennt eine fehlende Straße ZUERST', async () => {
    // Wer den Satz liest, soll nicht erst die Einzelzeilen durchgehen müssen,
    // um zu merken, dass die Hälfte fehlt.
    const satz = verkehrUrteil({
      meldungen: [],
      strassen: [
        { strasse: 'A61', quelle: 'frisch', meldungen: 0 },
        { strasse: 'A3', quelle: 'fehler', fehler: 'x', meldungen: 0 },
      ],
      ohne_ort: 0,
    });
    expect(satz.startsWith('Für A3')).toBe(true);
    expect(satz).toContain('KEINE Daten');
  });

  it('unterscheidet „nichts gemeldet" von „nicht nachgesehen"', () => {
    const nichts = verkehrUrteil({
      meldungen: [],
      strassen: [{ strasse: 'A61', quelle: 'frisch', meldungen: 0 }],
      ohne_ort: 0,
    });
    expect(nichts).toContain('nichts gemeldet');
    expect(nichts).not.toContain('KEINE Daten');
  });

  it('nennt das Alter, wenn aus dem Zwischenspeicher geliefert wurde', () => {
    const satz = verkehrUrteil({
      meldungen: [],
      strassen: [{ strasse: 'A61', quelle: 'zwischenspeicher', alter_s: 1200, meldungen: 0 }],
      ohne_ort: 0,
    });
    expect(satz).toContain('20 Minuten');
  });

  it('sagt es, wenn gar nichts abgefragt wurde', () => {
    // Sonst läse sich „nichts gemeldet" wie eine Entwarnung.
    expect(verkehrUrteil({ meldungen: [], strassen: [], ohne_ort: 0 })).toContain(
      'nichts abgefragt',
    );
  });
});
