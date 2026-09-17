/* eslint-disable no-undef -- `fetch`/`Response`/`AbortController`/`setTimeout`/
 * `clearTimeout` sind Standard-Globale in Node 22 (typisiert ueber
 * @types/node); dieselbe Begruendung wie in `ha/client.ts`. */

/**
 * Die Diagnose der Online-Dienste.
 *
 * ─── WAS HIER GEPRÜFT WIRD ──────────────────────────────────────────────────
 * Dass sie in JEDEM Fall etwas Verständliches sagt. Eine Diagnose, die selbst
 * abstürzt oder nur „Fehler" meldet, ist wertlos — und sie wäre in genau der
 * Lage wertlos, für die es sie gibt: wenn die Annahme über die Schnittstelle
 * falsch war.
 *
 * Kein Test hier ruft ins Netz; `fetchFn` kommt herein.
 */

import { describe, it, expect } from 'vitest';
import { beschreibeListe, diagnoseAutobahn, gesamturteil, type DiagnoseZeile } from './diagnose';

/** Eine Antwort, wie `fetch` sie liefert — so viel davon, wie gebraucht wird. */
function antwort(status: number, koerper: unknown, kaputt = false): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (kaputt) throw new SyntaxError('Unexpected token < in JSON');
      return koerper;
    },
  } as unknown as Response;
}

/** Ein `fetch`, das je nach Adresse antwortet. */
function fetchMit(regeln: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (eingabe: unknown) => regeln(String(eingabe))) as unknown as typeof fetch;
}

describe('beschreibeListe — der Befund in einem Satz', () => {
  it('nennt Mehrdeutigkeit BEIM NAMEN', () => {
    // Damit der nächste Schritt ohne Rückfrage klar ist: welcher Name es
    // sein soll, steht dann da.
    const t = beschreibeListe(0, 0, null, ['roadworks', 'warnings']);
    expect(t).toContain('roadworks');
    expect(t).toContain('warnings');
    expect(t).toContain('NICHT');
  });

  it('unterscheidet „leer" von „nicht gefunden"', () => {
    // Das ist der wichtigste Unterschied dieser ganzen Datei. „Leer" ist auf
    // einer Autobahn ohne Baustelle die Wahrheit; „nicht gefunden" heißt, die
    // Annahme war falsch.
    const leer = beschreibeListe(0, 0, 'roadworks', []);
    const fehlt = beschreibeListe(0, 0, null, []);
    expect(leer).toContain('leer');
    expect(leer).toContain('Normalfall');
    expect(fehlt).toContain('keine Liste');
    expect(fehlt).not.toContain('Normalfall');
  });

  it('sagt deutlich, wenn ALLE Einträge unbrauchbar waren', () => {
    // Ohne diesen Zweig sähe „12 Einträge, 12 verworfen" aus wie Erfolg.
    const t = beschreibeListe(12, 12, 'roadworks', []);
    expect(t).toContain('KEINER');
    expect(t).toContain('anders');
  });

  it('nennt die Zahl der übersprungenen, wenn es nur einige waren', () => {
    expect(beschreibeListe(10, 3, 'roadworks', [])).toContain('3');
  });

  it('meldet den guten Fall als guten Fall', () => {
    // Früher „alle brauchbar". Das war für eine KARTE nicht dasselbe — siehe
    // den Block darunter.
    expect(beschreibeListe(5, 0, 'roadworks', [])).toContain('alle mit Koordinaten');
  });
});

describe('diagnoseAutobahn', () => {
  it('prüft die Straßenliste UND jeden Dienst', () => {
    // Sechs Zeilen: die Wurzel plus fünf Dienste. Weniger hieße, ein Dienst
    // fiele still aus der Prüfung heraus.
    return diagnoseAutobahn('A61', {
      fetchFn: fetchMit(() => antwort(200, { roadworks: [] })),
    }).then((zeilen) => {
      expect(zeilen).toHaveLength(6);
      expect(zeilen[0].dienst).toContain('Straßenliste');
    });
  });

  it('nennt in JEDER Zeile die Adresse, die gerufen wurde', () => {
    // Damit man sie selbst im Browser öffnen kann. Das ist der kürzeste Weg
    // von „Yapaia sagt X" zu „stimmt X?".
    return diagnoseAutobahn('A3', {
      fetchFn: fetchMit(() => antwort(200, { x: [] })),
    }).then((zeilen) => {
      for (const z of zeilen) {
        expect(z.url, z.dienst).toMatch(/^https:\/\//);
      }
      expect(zeilen.some((z) => z.url.includes('/A3/'))).toBe(true);
    });
  });

  it('wirft NIE — auch wenn jeder Aufruf scheitert', async () => {
    // Eine Diagnose, die selbst abstürzt, sagt nichts. Genau dann braucht man
    // sie aber.
    const zeilen = await diagnoseAutobahn('A61', {
      fetchFn: (() => Promise.reject(new Error('getaddrinfo ENOTFOUND'))) as unknown as typeof fetch,
    });
    expect(zeilen).toHaveLength(6);
    for (const z of zeilen) {
      expect(z.status).toBeNull();
      expect(z.befund).toContain('ENOTFOUND');
    }
  });

  it('erklärt einen Zeitablauf als das, was er ist', async () => {
    const abbruch = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const zeilen = await diagnoseAutobahn('A61', {
      fetchFn: (() => Promise.reject(abbruch)) as unknown as typeof fetch,
      zeitgrenzeMs: 1234,
    });
    expect(zeilen[0].befund).toContain('1234');
    expect(zeilen[0].befund).toContain('kein Netz');
  });

  it('erkennt eine Anmeldeseite statt JSON', async () => {
    // Der häufigste Fall auf einem Campingplatz-WLAN, und er sieht sonst aus
    // wie ein kaputter Dienst.
    const zeilen = await diagnoseAutobahn('A61', {
      fetchFn: fetchMit(() => antwort(200, null, true)),
    });
    expect(zeilen[0].befund).toContain('kein JSON');
    expect(zeilen[0].befund).toContain('Portal');
  });

  it('reicht einen HTTP-Fehler mitsamt Code durch', async () => {
    const zeilen = await diagnoseAutobahn('A61', {
      fetchFn: fetchMit(() => antwort(503, null)),
    });
    expect(zeilen[0].status).toBe(503);
    expect(zeilen[0].befund).toContain('503');
  });

  it('zeigt ein Beispiel, so wie Yapaia es verstanden hat', async () => {
    // Das ist der Kern: nicht „12 Einträge", sondern einer davon, wie er
    // ankommt. Daran sieht man sofort, ob die Felder richtig gelesen wurden.
    const zeilen = await diagnoseAutobahn('A61', {
      fetchFn: fetchMit((url) =>
        url.includes('roadworks')
          ? antwort(200, {
              roadworks: [{ title: 'Fahrbahnverengung', coordinate: { lat: '49.9', long: '7.8' } }],
            })
          : antwort(200, { leer: [] }),
      ),
    });
    const zeile = zeilen.find((z) => z.dienst.includes('roadworks'));
    expect(zeile?.beispiel?.titel).toBe('Fahrbahnverengung');
    expect(zeile?.beispiel?.lat).toBe(49.9);
    expect(zeile?.beispiel?.lon).toBe(7.8);
  });

  it('misst die Dauer', async () => {
    let t = 1000;
    const zeilen = await diagnoseAutobahn('A61', {
      fetchFn: fetchMit(() => {
        t += 250;
        return antwort(200, { x: [] });
      }),
      jetzt: () => t,
    });
    expect(zeilen[0].dauer_ms).toBe(250);
  });
});

describe('gesamturteil', () => {
  function zeile(teil: Partial<DiagnoseZeile>): DiagnoseZeile {
    return { dienst: 'x', url: 'https://x', status: 200, dauer_ms: 1, befund: '', ...teil };
  }

  it('sagt bei völliger Stille, dass das folgenlos ist', () => {
    // Kein Netz ist für eine OFFLINE-Navigation kein Notfall. Wer das liest,
    // soll nicht anfangen, an der Installation zu schrauben.
    const t = gesamturteil([zeile({ status: null }), zeile({ status: null })]);
    expect(t).toContain('kein Internet');
    expect(t).toContain('folgenlos');
  });

  it('meldet den Erfolg als Erfolg', () => {
    const t = gesamturteil([zeile({ eintraege: 3, verworfen: 0, schluessel: 'roadworks' })]);
    expect(t).toContain('Daten mit Koordinaten');
  });

  it('unterscheidet „nichts gemeldet" von „Aufbau anders"', () => {
    // Die beiden Fälle führen zu ganz verschiedenen nächsten Schritten.
    const leer = gesamturteil([zeile({ eintraege: 0, schluessel: 'roadworks' })]);
    const fremd = gesamturteil([zeile({ eintraege: 0, schluessel: null })]);
    expect(leer).toContain('nichts gemeldet');
    expect(fremd).toContain('anderer als angenommen');
  });

  it('sagt auch dann etwas, wenn gar nichts geprüft wurde', () => {
    expect(gesamturteil([])).toContain('nichts geprüft');
  });
});

/**
 * ─── DIE KORREKTUR AUS DER ERSTEN ECHTEN PRUEFUNG ───────────────────────────
 *
 * Auf dem Gerät kam heraus:
 *
 *   Autobahn A61 — parking_lorry: 60 Einträge, alle brauchbar.
 *   Beispiel: „A61 | undefined" — ohne Koordinaten
 *   ⇒ „6 von 6 Diensten antworteten, und 5 davon lieferten verwertbare Daten."
 *
 * Sechzig Einträge, kein einziger zeichenbar — und der Befund klang gut. Genau
 * diese Sorte Aussage sollte diese Datei verhindern; sie ist die teuerste, die
 * es in diesem Projekt gibt, weil sie niemanden zum Nachsehen bewegt.
 *
 * Diese Tests halten die Korrektur fest. Sie prüfen ausdrücklich auch, dass
 * das alte Wort NICHT mehr fällt — sonst bestünden sie, während daneben
 * weiterhin „alle brauchbar" stünde.
 */
describe('Einträge ohne Koordinaten sind nicht „brauchbar"', () => {
  function zeile(teil: Partial<DiagnoseZeile>): DiagnoseZeile {
    return { dienst: 'x', url: 'https://x', status: 200, dauer_ms: 1, befund: '', ...teil };
  }

  it('sagt es deutlich, wenn KEINER Koordinaten hat', () => {
    const t = beschreibeListe(60, 0, 'parking_lorry', [], 60);
    expect(t).toContain('KEINER hat Koordinaten');
    expect(t).toContain('auf die Karte kann davon nichts');
  });

  it('und behauptet dann nicht mehr, alles sei brauchbar', () => {
    const t = beschreibeListe(60, 0, 'parking_lorry', [], 60);
    expect(t).not.toContain('alle brauchbar');
    expect(t).not.toContain('alle mit Koordinaten');
  });

  it('nennt die Zahl, wenn es nur einen Teil betrifft', () => {
    const t = beschreibeListe(10, 0, 'parking_lorry', [], 4);
    expect(t).toContain('4 ohne Koordinaten');
    expect(t).not.toContain('alle mit Koordinaten');
  });

  /**
   * ─── DER GANZE ZWECK DIESER AENDERUNG ─────────────────────────────────
   * Die Feldnamen nützen nur, wenn sie AUF DEM BILDSCHIRM landen. Eine
   * Mutation, die das Anhängen entfernte, hat alle Tests überlebt — es prüfte
   * niemand den Weg von `ausAntwort` bis in die Zeile.
   *
   * Das ist dieselbe Lücke wie bei der Route `build-graph`: beide Seiten für
   * sich richtig, die Naht dazwischen ungeprüft.
   */
  it('die Feldnamen landen wirklich in der Diagnosezeile', async () => {
    const zeilen = await diagnoseAutobahn('A61', {
      fetchFn: fetchMit((url) =>
        url.includes('parking_lorry')
          ? antwort(200, {
              parking_lorry: [{ title: 'A61 | undefined', lorryParkingFeatureIcons: [] }],
            })
          : antwort(200, { x: [] }),
      ),
    });
    const parken = zeilen.find((z) => z.dienst.includes('parking_lorry'));
    expect(parken?.ohne_koordinaten).toBe(1);
    expect(parken?.felder).toContain('lorryParkingFeatureIcons:array');
  });

  it('aber NICHT bei einem Dienst, der sauber liefert', async () => {
    // Sonst stünde unter jeder Zeile eine Wand aus Fachtext, und der eine
    // Fall, auf den es ankommt, ginge darin unter.
    const zeilen = await diagnoseAutobahn('A61', {
      fetchFn: fetchMit(() =>
        antwort(200, { roadworks: [{ title: 'Baustelle', coordinate: { lat: '49.9', long: '7.8' } }] }),
      ),
    });
    for (const z of zeilen) {
      expect(z.felder, z.dienst).toBeUndefined();
    }
  });

  it('verweist auf die Feldnamen, statt eine Ursache zu erfinden', () => {
    // Warum die Koordinaten fehlen, WEISS hier niemand. Der Satz darf das
    // nicht überspielen — er schickt zum Nachsehen.
    expect(beschreibeListe(60, 0, 'parking_lorry', [], 60)).toContain('Feldnamen');
  });

  it('das Gesamturteil zählt sie nicht als verwertbar mit', () => {
    const t = gesamturteil([
      zeile({ eintraege: 30, verworfen: 0, schluessel: 'roadworks' }),
      zeile({ eintraege: 60, verworfen: 0, schluessel: 'parking_lorry', ohne_koordinaten: 60 }),
    ]);
    expect(t).toContain('1 davon lieferten Daten mit Koordinaten');
    expect(t).toContain('1 weiteren');
    expect(t).toContain('fehlen');
  });

  it('und sagt im guten Fall weiterhin nur den guten Fall', () => {
    // Der Zusatz darf nicht immer erscheinen — sonst liest ihn niemand mehr.
    const t = gesamturteil([zeile({ eintraege: 30, verworfen: 0, schluessel: 'roadworks' })]);
    expect(t).not.toContain('fehlen');
  });
});
