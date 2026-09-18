/**
 * Der Dienst, der die Spur führt — geprüft ohne Uhr und ohne Valhalla.
 *
 * ─── DIE LEITFRAGE ──────────────────────────────────────────────────────────
 * Sieht „ich konnte nicht nachsehen" jemals aus wie „hier gilt nichts"?
 *
 * Beides ergibt ein leeres Verkehrszeichen. Für jemanden, der auf eine
 * Ortseinfahrt zufährt, sind es zwei sehr verschiedene Auskünfte — und nur
 * eine davon darf ihn beruhigen.
 */

import { describe, it, expect } from 'vitest';
import type { Position } from '@yapaia/shared';
import { TempolimitDienst, STAND_HOECHSTALTER_MS } from './tempolimitDienst.js';
import { ABFRAGE_ABSTAND_MS, MINDESTABSTAND_M } from './tempolimitHier.js';

/** Eine steuerbare Uhr — sonst hinge jede Prüfung an echter Zeit. */
function uhr(start = 1_000_000) {
  let t = start;
  return { jetzt: () => t, vor: (ms: number) => (t += ms) };
}

function pos(lat: number, ts: number, accuracy = 8): Position {
  return {
    lat,
    lon: 8.32,
    alt: 120,
    speed: 25,
    heading: 180,
    accuracy,
    source: 'gpsd',
    fix: '3d',
    ts: new Date(ts).toISOString(),
  } as Position;
}

/** Zwei Punkte, die weit genug auseinanderliegen. */
const A = 49.239;
const B = 49.239 + (MINDESTABSTAND_M + 5) / 111_320;

interface Aufbau {
  dienst: TempolimitDienst;
  anfragen: Array<Record<string, unknown>>;
  antwort: (roh: unknown) => void;
  fehler: (an: boolean) => void;
  u: ReturnType<typeof uhr>;
}

function baue(): Aufbau {
  const u = uhr();
  const anfragen: Array<Record<string, unknown>> = [];
  let naechste: unknown = { edges: [{ speed_limit: 100, road_class: 'primary' }] };
  let wirft = false;
  const dienst = new TempolimitDienst({
    traceAttributes: async (body) => {
      anfragen.push(body);
      if (wirft) throw new Error('Valhalla antwortet nicht');
      return naechste;
    },
    costing: () => 'auto',
    jetzt: u.jetzt,
  });
  return {
    dienst,
    anfragen,
    antwort: (roh) => (naechste = roh),
    fehler: (an) => (wirft = an),
    u,
  };
}

/** Zwei Positionen melden und die Abfrage abwarten. */
async function fahre(a: Aufbau, ts = a.u.jetzt()): Promise<void> {
  a.dienst.melde(pos(A, ts));
  a.dienst.melde(pos(B, ts + 1000));
  await Promise.resolve();
  await Promise.resolve();
}

describe('vor der ersten Auskunft', () => {
  it('ohne Spur heisst es `keine_spur` — nicht „kein Limit"', async () => {
    const a = baue();
    expect(a.dienst.aktuell()).toEqual({ kmh: null, road_class: null, stand: 'keine_spur' });
  });

  it('eine einzelne Position ergibt noch keine Spur', async () => {
    const a = baue();
    a.dienst.melde(pos(A, a.u.jetzt()));
    expect(a.dienst.aktuell().stand).toBe('keine_spur');
    expect(a.anfragen).toHaveLength(0);
  });

  it('eine zu ungenaue Position zählt gar nicht', async () => {
    // Der gemeldete Wert aus dem Betrieb war 53,2 m.
    const a = baue();
    a.dienst.melde(pos(A, a.u.jetzt(), 53.2));
    a.dienst.melde(pos(B, a.u.jetzt() + 1000, 53.2));
    await Promise.resolve();
    expect(a.anfragen).toHaveLength(0);
    expect(a.dienst.aktuell().stand).toBe('keine_spur');
  });
});

describe('mit einer Spur', () => {
  it('fragt und liefert das Limit', async () => {
    const a = baue();
    await fahre(a);
    expect(a.anfragen).toHaveLength(1);
    expect(a.dienst.aktuell()).toEqual({ kmh: 100, road_class: 'primary', stand: 'frisch' });
  });

  it('schickt die Spur mit `map_snap`', async () => {
    const a = baue();
    await fahre(a);
    expect(a.anfragen[0]?.shape_match).toBe('map_snap');
    expect((a.anfragen[0]?.shape as unknown[]).length).toBe(2);
  });

  it('fragt NICHT bei jeder Position', async () => {
    // Positionen kommen im Sekundentakt. Valhalla läuft auf demselben
    // kleinen Rechner wie alles andere.
    const a = baue();
    await fahre(a);
    for (let i = 0; i < 5; i += 1) {
      a.u.vor(1000);
      a.dienst.melde(pos(A + (i + 2) * 0.001, a.u.jetzt()));
      await Promise.resolve();
    }
    expect(a.anfragen).toHaveLength(1);
  });

  it('fragt wieder, wenn der Abstand verstrichen ist', async () => {
    const a = baue();
    await fahre(a);
    a.u.vor(ABFRAGE_ABSTAND_MS);
    a.dienst.melde(pos(A + 0.01, a.u.jetzt()));
    await Promise.resolve();
    await Promise.resolve();
    expect(a.anfragen).toHaveLength(2);
  });
});

describe('was passiert, wenn etwas schiefgeht', () => {
  it('ein Fehlschlag lässt die alte Auskunft stehen — und sagt es', async () => {
    // ─── DIE ABWÄGUNG ───────────────────────────────────────────────────────
    // Ein fehlgeschlagener Abruf ist kein Grund, ein Schild wegzunehmen, das
    // vor zehn Sekunden noch galt. Aber er darf auch nicht als gültiger
    // Stand durchgehen — sonst sähe ein hängender Valhalla wie eine
    // bestätigte Auskunft aus.
    const a = baue();
    await fahre(a);
    expect(a.dienst.aktuell().kmh).toBe(100);

    a.fehler(true);
    a.u.vor(ABFRAGE_ABSTAND_MS);
    a.dienst.melde(pos(A + 0.01, a.u.jetzt()));
    await Promise.resolve();
    await Promise.resolve();

    const jetzt = a.dienst.aktuell();
    expect(jetzt.kmh, 'das alte Schild ist verschwunden').toBe(100);
    expect(jetzt.stand, 'der Fehlschlag ist unsichtbar').toBe('fehler');
  });

  it('„gefragt und nichts gefunden" wirft die alte Auskunft WEG', async () => {
    // Anders als beim Fehlschlag: hier hat Valhalla geantwortet und diese
    // Stelle nicht zugeordnet. Die alte Auskunft gehörte zu einer anderen
    // Straße und wäre hier eine Behauptung.
    const a = baue();
    await fahre(a);
    expect(a.dienst.aktuell().kmh).toBe(100);

    a.antwort({ edges: [] });
    a.u.vor(ABFRAGE_ABSTAND_MS);
    a.dienst.melde(pos(A + 0.01, a.u.jetzt()));
    await Promise.resolve();
    await Promise.resolve();

    expect(a.dienst.aktuell()).toEqual({ kmh: null, road_class: null, stand: 'ohne_treffer' });
  });

  it('eine alte Auskunft heisst `veraltet`, nicht `frisch`', async () => {
    // Bei 100 km/h sind dreissig Sekunden rund 800 Meter. Was älter ist,
    // kann von einer anderen Straße stammen.
    const a = baue();
    await fahre(a);
    a.u.vor(STAND_HOECHSTALTER_MS + 1);
    const jetzt = a.dienst.aktuell();
    expect(jetzt.kmh).toBe(100);
    expect(jetzt.stand).toBe('veraltet');
  });

  it('kurz vor der Grenze ist sie noch frisch', async () => {
    // Die Gegenprobe: ein `veraltet`, das immer gilt, wäre so wertlos wie
    // eines, das nie gilt.
    const a = baue();
    await fahre(a);
    a.u.vor(STAND_HOECHSTALTER_MS - 1);
    expect(a.dienst.aktuell().stand).toBe('frisch');
  });

  it('keine zwei Abfragen gleichzeitig', async () => {
    // Bei einer langsamen Antwort stünden sonst mehrere an, und die LETZTE
    // gewänne — nicht die neueste.
    const u = uhr();
    const anfragen: unknown[] = [];
    // Die Zuweisung geschieht im Promise-Konstruktor; ohne diese Schreibweise
    // verengt TypeScript den Typ auf `null` und haelt den Aufruf unten fuer
    // unmoeglich.
    let loesen!: (w: unknown) => void;
    const dienst = new TempolimitDienst({
      traceAttributes: (body) => {
        anfragen.push(body);
        return new Promise<unknown>((res) => {
          loesen = res;
        });
      },
      costing: () => 'auto',
      jetzt: u.jetzt,
    });

    dienst.melde(pos(A, u.jetzt()));
    dienst.melde(pos(B, u.jetzt() + 1000));
    await Promise.resolve();
    expect(anfragen).toHaveLength(1);

    u.vor(ABFRAGE_ABSTAND_MS * 3);
    dienst.melde(pos(A + 0.02, u.jetzt()));
    await Promise.resolve();
    expect(anfragen, 'eine zweite Abfrage lief parallel').toHaveLength(1);

    loesen({ edges: [{ speed_limit: 70, road_class: 'secondary' }] });
    await Promise.resolve();
    await Promise.resolve();
    expect(dienst.aktuell().kmh).toBe(70);
  });
});

describe('die unbegrenzte Autobahn', () => {
  it('kein Schild, aber die Klasse — daraus folgt die Fahrzeuggrenze', async () => {
    // Der Fall, um den es bei einem Wohnmobil geht. `kmh: null` heisst hier
    // NICHT „unbekannt", sondern „kein Schild" — und `road_class` sagt, dass
    // es eine Autobahn ist.
    const a = baue();
    a.antwort({ edges: [{ speed_limit: 'unlimited', road_class: 'motorway' }] });
    await fahre(a);
    expect(a.dienst.aktuell()).toEqual({ kmh: null, road_class: 'motorway', stand: 'frisch' });
  });
});

describe('leeren', () => {
  it('vergisst alles', async () => {
    const a = baue();
    await fahre(a);
    expect(a.dienst.aktuell().kmh).toBe(100);
    a.dienst.leeren();
    expect(a.dienst.aktuell()).toEqual({ kmh: null, road_class: null, stand: 'keine_spur' });
  });
});
