/* eslint-disable no-undef -- `setTimeout` ist eine Standard-Globale in Node 22. */

/**
 * Das erzeugte Dashboard.
 *
 * ─── WAS HIER DER EIGENTLICHE PUNKT IST ─────────────────────────────────────
 * Nicht „steht der Text drin", sondern: TREFFEN die Entity-IDs? Ein Dashboard
 * mit falschen IDs sieht aus wie ein fertiges Dashboard und zeigt in jeder
 * Kachel „Entitaet nicht verfuegbar" -- genau der Zustand, den der Betreiber
 * mit „klappt nicht" gemeldet hat.
 *
 * Deshalb pruefen die Faelle unten die drei Formen, die es in echten Anlagen
 * gibt (dokumentiert, vor 0.6.7, ab 0.6.7) und die beiden Arten, danebenzu-
 * greifen: eine fremde Entitaet einsammeln oder zwei aehnlich benannte
 * verwechseln.
 */

import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import {
  DASHBOARD_ENTITIES,
  UTF8_BOM,
  befundText,
  buildDashboardYaml,
  resolveEntityIds,
  standardIds,
  starteDashboardPflege,
  writeDashboardYaml,
} from './dashboard.js';
import type { HaEntityState } from './client.js';

function zustand(entity_id: string, friendly_name?: string): HaEntityState {
  return {
    entity_id,
    state: '0',
    attributes: friendly_name ? { friendly_name } : {},
  };
}

describe('die Entitaeten in einer echten Anlage finden', () => {
  it('nimmt die dokumentierten IDs, wenn es sie gibt', () => {
    const { ids, vorgabe } = resolveEntityIds([
      zustand('sensor.yapaja_speed'),
      zustand('sensor.yapaja_eta'),
    ]);
    expect(ids.speed).toBe('sensor.yapaja_speed');
    expect(ids.eta).toBe('sensor.yapaja_eta');
    expect(vorgabe).toContain('nav_state'); // nicht vorhanden -> Vorgabe
  });

  it('findet auch die Form, die Home Assistant ohne object_id vergeben hat', () => {
    // Vor 0.6.9 schickte die Discovery kein `object_id` mit. Home Assistant
    // baute die ID dann aus Geraete- plus Entitaetsnamen -- und der
    // Geraetename hat sich in 0.6.7 auch noch geaendert. Beide Formen gibt es
    // draussen wirklich.
    const alt = resolveEntityIds([zustand('sensor.yapaja_go_speed', 'Yapaja Go Speed')]);
    expect(alt.ids.speed).toBe('sensor.yapaja_go_speed');

    const neu = resolveEntityIds([zustand('sensor.yapaia_go_speed', 'Yapaia Go Speed')]);
    expect(neu.ids.speed).toBe('sensor.yapaia_go_speed');
  });

  it('greift nicht nach fremden Entitaeten', () => {
    // „endet auf _speed" allein traefe das halbe Haus.
    const { ids, vorgabe } = resolveEntityIds([
      zustand('sensor.tesla_speed', 'Tesla Speed'),
      zustand('sensor.speed'),
      zustand('sensor.wind_speed', 'Wind Speed'),
    ]);
    expect(ids.speed).toBe('sensor.yapaja_speed'); // die Vorgabe
    expect(vorgabe).toContain('speed');
  });

  it('verwechselt Tempo und Tempolimit nicht', () => {
    const { ids } = resolveEntityIds([
      zustand('sensor.yapaia_go_speed', 'Yapaia Go Speed'),
      zustand('sensor.yapaia_go_speed_limit', 'Yapaia Go Speed Limit'),
    ]);
    expect(ids.speed).toBe('sensor.yapaia_go_speed');
    expect(ids.speed_limit).toBe('sensor.yapaia_go_speed_limit');
  });

  it('verwechselt Anweisung und Anweisungsentfernung nicht', () => {
    const { ids } = resolveEntityIds([
      zustand('sensor.yapaia_go_instruction', 'Yapaia Go Instruction'),
      zustand('sensor.yapaia_go_instruction_distance', 'Yapaia Go Instruction Distance'),
    ]);
    expect(ids.instruction).toBe('sensor.yapaia_go_instruction');
    expect(ids.instruction_distance).toBe('sensor.yapaia_go_instruction_distance');
  });

  it('achtet auf die Domain', () => {
    // `button.yapaja_stop` und ein `sensor.yapaja_stop` waeren zwei
    // verschiedene Dinge; die Schaltflaeche braucht die Schaltflaeche.
    const { ids } = resolveEntityIds([
      zustand('sensor.yapaja_stop'),
      zustand('button.yapaja_go_stop', 'Yapaia Go Stop'),
    ]);
    expect(ids.stop).toBe('button.yapaja_go_stop');
  });

  it('waehlt bei mehreren Treffern immer dieselbe', () => {
    // Sonst bekaeme dieselbe Anlage bei jedem Start eine andere Datei.
    const zustaende = [
      zustand('sensor.yapaia_go_speed_2', 'Yapaia Go Speed'),
      zustand('sensor.yapaia_go_speed', 'Yapaia Go Speed'),
    ];
    const a = resolveEntityIds(zustaende);
    const b = resolveEntityIds([...zustaende].reverse());
    expect(a.ids.speed).toBe(b.ids.speed);
    expect(a.ids.speed).toBe('sensor.yapaia_go_speed');
  });

  it('kommt mit einer leeren Anlage klar', () => {
    const { ids, gefunden, vorgabe } = resolveEntityIds([]);
    expect(ids).toEqual(standardIds());
    expect(gefunden).toEqual([]);
    expect(vorgabe).toHaveLength(DASHBOARD_ENTITIES.length);
  });
});

describe('die Datei selbst', () => {
  const yaml = buildDashboardYaml(
    resolveEntityIds([
      zustand('sensor.yapaia_go_speed', 'Yapaia Go Speed'),
      zustand('sensor.yapaia_go_eta', 'Yapaia Go ETA'),
    ]).ids,
  );

  it('ist gueltiges YAML', () => {
    // Eine Einrueckung daneben, und Home Assistant lehnt den ganzen
    // Rohkonfigurationseditor ab -- ohne zu sagen, wo.
    expect(() => load(yaml)).not.toThrow();
  });

  it('hat genau eine Ansicht mit den bestellten Kacheln', () => {
    const geladen = load(yaml) as { views: Array<{ cards: Array<Record<string, unknown>> }> };
    expect(geladen.views).toHaveLength(1);
    const typen = geladen.views[0].cards.map((k) => k.type);
    expect(typen).toContain('custom:yapaja-map-card'); // Karte mit Route
    expect(typen).toContain('markdown'); // naechste Richtungsanzeige
    expect(typen).toContain('gauge'); // Geschwindigkeit
    expect(typen).toContain('entities'); // Entfernung und ETA
  });

  it('setzt die gefundenen IDs ein, nicht die Vorgabe', () => {
    expect(yaml).toContain('sensor.yapaia_go_speed');
    expect(yaml).toContain('sensor.yapaia_go_eta');
    expect(yaml).not.toContain('sensor.yapaja_speed\n');
  });

  it('nennt die Schaltflaechen mit der Aktion, die sie ausloest', () => {
    expect(yaml).toContain('perform_action: button.press');
  });

  it('erklaert oben, wie man sie benutzt', () => {
    // Ohne die Ressource bleibt die Kartenkachel leer -- das ist der
    // haeufigste Grund, warum „das Dashboard nicht klappt".
    expect(yaml).toContain('/local/yapaja/yapaja-map-card.js');
    expect(yaml).toContain('Rohkonfigurationseditor');
  });
});

describe('schreiben', () => {
  function depsBauen(fehler?: Error) {
    const geschrieben: Array<{ pfad: string; inhalt: string }> = [];
    const ordner: string[] = [];
    const warnungen: string[] = [];
    return {
      geschrieben,
      ordner,
      warnungen,
      get deps() {
        return {
          mkdir: async (pfad: string) => {
            ordner.push(pfad);
          },
          writeFile: async (pfad: string, inhalt: string) => {
            if (fehler) throw fehler;
            geschrieben.push({ pfad, inhalt });
          },
          logger: {
            info: () => undefined,
            warn: (msg: string) => {
              warnungen.push(msg);
            },
          },
        };
      },
    };
  }

  it('legt die Datei unter www/yapaja ab -- zweimal', async () => {
    // `.txt` daneben, damit der Browser den Text ANZEIGT statt ihn
    // herunterzuladen: auf einem iPad ist eine heruntergeladene Datei
    // praktisch weg.
    const a = depsBauen();
    expect(await writeDashboardYaml('/homeassistant/www/yapaja', 'inhalt', a.deps)).toBe(true);
    expect(a.ordner).toEqual(['/homeassistant/www/yapaja']);
    expect(a.geschrieben.map((g) => g.pfad)).toEqual([
      '/homeassistant/www/yapaja/dashboard.yaml',
      '/homeassistant/www/yapaja/dashboard.txt',
    ]);
    expect(a.geschrieben[0].inhalt).toBe(a.geschrieben[1].inhalt);
  });

  it('haelt nichts an, wenn das Schreiben scheitert', async () => {
    // Ein nicht ablegbares Dashboard darf die Navigation nicht stoppen.
    const a = depsBauen(new Error('read-only file system'));
    expect(await writeDashboardYaml('/homeassistant/www/yapaja', 'inhalt', a.deps)).toBe(false);
    expect(a.warnungen).toHaveLength(1);
  });
});

describe('die Pflege der Datei', () => {
  function aufbauen(optionen: { verbindung?: { apiBase: string; token: string } | null } = {}) {
    const geschrieben: string[] = [];
    const meldungen: string[] = [];
    let geplant: (() => void) | null = null;
    let abbestellt = false;
    const datei = {
      mkdir: async () => undefined,
      writeFile: async (_p: string, inhalt: string) => {
        geschrieben.push(inhalt);
      },
      logger: {
        info: (msg: string) => {
          meldungen.push(msg);
        },
        warn: (msg: string) => {
          meldungen.push(msg);
        },
      },
    };
    return {
      geschrieben,
      meldungen,
      ausloesen: () => geplant?.(),
      istAbbestellt: () => abbestellt,
      deps: {
        wwwDir: '/homeassistant/www/yapaja',
        verbindung: () =>
          optionen.verbindung === undefined
            ? { apiBase: 'http://supervisor/core/api', token: 't' }
            : optionen.verbindung,
        ladeZustaende: async () => [zustand('sensor.yapaia_go_speed', 'Yapaia Go Speed')],
        datei,
        setTimeoutImpl: (fn: () => void) => {
          geplant = fn;
          return 1;
        },
        clearTimeoutImpl: () => {
          abbestellt = true;
        },
      },
    };
  }

  it('legt sofort eine brauchbare Datei ab', async () => {
    // Wer gleich nach der Installation nachschaut, soll etwas finden --
    // nicht eine 404 und den Eindruck, es gaebe die Funktion nicht.
    const a = aufbauen();
    starteDashboardPflege(a.deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(a.geschrieben).toHaveLength(2);
    expect(a.geschrieben[0]).toContain('sensor.yapaja_speed');
  });

  it('ersetzt sie durch die wirklich vorhandenen IDs', async () => {
    const a = aufbauen();
    starteDashboardPflege(a.deps);
    a.ausloesen();
    await new Promise((r) => setTimeout(r, 0));
    expect(a.geschrieben).toHaveLength(4);
    expect(a.geschrieben[2]).toContain('sensor.yapaia_go_speed');
  });

  it('laesst die Vorgabe stehen, wenn Home Assistant nicht erreichbar ist', async () => {
    // Und schreibt die Datei trotzdem noch einmal -- diesmal mit dem Grund
    // im Kopf. „Keine Verbindung" nur ins Protokoll zu schreiben half
    // niemandem, der vor einer Wand aus „Entitaet nicht gefunden" sitzt.
    const a = aufbauen({ verbindung: null });
    starteDashboardPflege(a.deps);
    a.ausloesen();
    await new Promise((r) => setTimeout(r, 0));
    expect(a.geschrieben).toHaveLength(4);
    expect(a.geschrieben[3]).toContain('nicht erreichbar');
    expect(a.meldungen.some((m) => m.includes('keine Home-Assistant-Verbindung'))).toBe(true);
  });

  it('warnt im Protokoll, wenn Home Assistant keine Yapaia-Entitaet kennt', async () => {
    const a = aufbauen();
    a.deps.ladeZustaende = async () => [zustand('sensor.wohnzimmer_temperatur')];
    starteDashboardPflege(a.deps);
    a.ausloesen();
    await new Promise((r) => setTimeout(r, 0));
    expect(a.geschrieben[2]).toContain('KEINE EINZIGE');
    expect(a.meldungen.some((m) => m.includes('MQTT'))).toBe(true);
  });

  it('tut ausserhalb des Add-ons gar nichts', async () => {
    // Der Core laeuft auch eigenstaendig; dort gibt es kein HA-Konfigurationsverzeichnis.
    const a = aufbauen();
    const abbestellen = starteDashboardPflege({ ...a.deps, wwwDir: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(a.geschrieben).toEqual([]);
    expect(() => abbestellen()).not.toThrow();
  });

  it('bestellt die Nachbesserung beim Herunterfahren ab', () => {
    const a = aufbauen();
    starteDashboardPflege(a.deps)();
    expect(a.istAbbestellt()).toBe(true);
  });
});

describe('der Befund oben in der Datei', () => {
  it('nennt MQTT beim Namen, wenn es keine einzige Entitaet gibt', () => {
    // Der Fall vom iPad: Home Assistant antwortet, hat aber keine
    // Yapaia-Entitaet. Vorher zeigte das Dashboard nur eine Wand aus
    // „Entitaet nicht gefunden" und sagte nirgends, warum.
    const text = befundText({ erreichbar: true, zustaende: 342, gefunden: 0, vorgabe: ['speed'] });
    expect(text).toContain('342');
    expect(text).toContain('KEINE EINZIGE');
    expect(text).toContain('MQTT');
    expect(text).toContain('Installationsprüfung');
  });

  it('unterscheidet „nicht erreichbar" von „nichts gefunden"', () => {
    // Zwei sehr verschiedene Ursachen, die dieselbe leere Kachelwand ergeben.
    const text = befundText({ erreichbar: false, zustaende: 0, gefunden: 0, vorgabe: ['speed'] });
    expect(text).toContain('nicht erreichbar');
    expect(text).not.toContain('MQTT');
  });

  it('nennt die fehlenden, wenn nur ein Teil fehlt', () => {
    const text = befundText({
      erreichbar: true,
      zustaende: 10,
      gefunden: 11,
      vorgabe: ['speed_limit', 'altitude'],
    });
    expect(text).toContain('11 von 13');
    expect(text).toContain('speed_limit, altitude');
  });

  it('sagt es auch, wenn alles da ist', () => {
    expect(befundText({ erreichbar: true, zustaende: 10, gefunden: 13, vorgabe: [] })).toContain(
      'Alle 13',
    );
  });

  it('bleibt leer, wenn nichts nachgesehen wurde', () => {
    expect(befundText(undefined)).toBe('');
  });

  it('steht im Kopf der Datei, nicht mittendrin', () => {
    const yaml = buildDashboardYaml(standardIds(), {
      erreichbar: true,
      zustaende: 5,
      gefunden: 0,
      vorgabe: [],
    });
    expect(yaml.indexOf('KEINE EINZIGE')).toBeLessThan(yaml.indexOf('views:'));
    expect(() => load(yaml)).not.toThrow();
  });
});

describe('der Zeichensatz', () => {
  it('schreibt die Marke fuer UTF-8 voran', async () => {
    // Ohne sie liest Safari die Datei als Latin-1, und der Betreiber kopiert
    // „NÃ¤chste Anweisung" ins Dashboard. Auf dem iPad genau so passiert.
    const geschrieben: string[] = [];
    await writeDashboardYaml('/w', 'Nächste Anweisung', {
      mkdir: async () => undefined,
      writeFile: async (_p: string, inhalt: string) => {
        geschrieben.push(inhalt);
      },
      logger: { info: () => undefined, warn: () => undefined },
    });
    for (const inhalt of geschrieben) {
      expect(inhalt.codePointAt(0)).toBe(0xfeff);
      expect(inhalt).toBe(`${UTF8_BOM}Nächste Anweisung`);
    }
  });
});
