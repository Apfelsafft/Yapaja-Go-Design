/**
 * Tests für die Installationsprüfung (`preflight.ts`).
 *
 * Leitgedanke: jede Behauptung eines Prüfergebnisses muss aus einer
 * INJIZIERTEN Sonde stammen. Deshalb setzt `deps()` unten ALLE Sonden auf
 * einen bekannten Zustand und kein Test lässt eine offen — sonst könnte ein
 * grünes Ergebnis daher rühren, dass zufällig etwas Echtes auf dem
 * Testrechner lief (oder eben nicht lief).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runPreflight,
  PHOTON_COMFORTABLE_RAM_BYTES,
  type PreflightCheck,
  type PreflightCheckId,
  type PreflightDeps,
} from './preflight.js';

const GB = 1024 ** 3;

/** Eine vollständig gesunde Installation. Jeder Test kippt daran genau das
 *  eine Ding, das er untersucht — so ist der Unterschied im Ergebnis
 *  eindeutig diesem einen Ding zuzuordnen. */
function healthyDeps(overrides: Partial<PreflightDeps> = {}): PreflightDeps {
  return {
    env: {
      TILES_DIR: '/data/tiles',
      VALHALLA_URL: 'http://valhalla:8002',
      PHOTON_URL: 'http://photon:2322',
      PHOTON_ENABLED: 'true',
      LITE_SEARCH_DB_PATH: '/data/lite/lite_search.db',
      GPSD_ENABLED: 'true',
      GPSD_HOST: 'localhost',
      GPSD_PORT: '2947',
      MQTT_BROKER_URL: 'mqtt://core-mosquitto:1883',
    },
    listDir: async () => ['liechtenstein.pmtiles'],
    fileSize: async () => 4 * 1024 * 1024,
    tcpProbe: async () => true,
    httpProbe: async () => true,
    totalMem: () => 16 * GB,
    diskFree: async () => 40 * GB,
    now: () => new Date('2026-09-01T10:00:00.000Z'),
    ...overrides,
  };
}

function byId(checks: PreflightCheck[], id: PreflightCheckId): PreflightCheck {
  const found = checks.find((c) => c.id === id);
  if (!found) {
    throw new Error(`Prüfung "${id}" fehlt im Bericht`);
  }
  return found;
}

describe('runPreflight — Gesamtform', () => {
  it('meldet eine vollständige Installation als ok', async () => {
    const report = await runPreflight(healthyDeps());
    expect(report.status).toBe('ok');
    expect(report.summary).toMatch(/Alle Voraussetzungen erfüllt/);
    expect(report.checkedAt).toBe('2026-09-01T10:00:00.000Z');
    expect(report.checks.every((c) => c.status === 'ok')).toBe(true);
  });

  it('liefert alle sieben Prüfungen, jede genau einmal', async () => {
    const report = await runPreflight(healthyDeps());
    const ids = report.checks.map((c) => c.id);
    expect(ids).toEqual(['tiles', 'routing', 'search', 'position', 'memory', 'disk', 'mqtt']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Der eigentliche Zweck dieser Datei: ein Befund ohne Handlungsanweisung
  // ist für jemanden, der keine Shell öffnen will, wertlos. Dieser Test
  // erzwingt, dass keine neue Prüfung ohne `remedy` hinzukommen kann.
  it('jede nicht-ok-Prüfung nennt, was zu tun ist', async () => {
    const report = await runPreflight({
      env: {},
      listDir: async () => {
        throw new Error('ENOENT');
      },
      fileSize: async () => null,
      tcpProbe: async () => false,
      httpProbe: async () => false,
      totalMem: () => 8 * GB,
      diskFree: async () => 1 * GB,
    });

    expect(report.checks.some((c) => c.status !== 'ok')).toBe(true);
    for (const check of report.checks) {
      if (check.status !== 'ok') {
        expect(check.remedy, `Prüfung "${check.id}" hat keine remedy`).toBeTruthy();
        expect((check.remedy ?? '').length).toBeGreaterThan(40);
      }
    }
  });

  it('stuft eine fehlende Pflichtvoraussetzung als fail ein, eine fehlende Empfehlung nur als warn', async () => {
    const failing = await runPreflight(
      healthyDeps({
        listDir: async () => [],
      }),
    );
    expect(failing.status).toBe('fail');
    expect(failing.summary).toContain('Kartenkacheln');

    const warning = await runPreflight(
      healthyDeps({
        env: { ...healthyDeps().env, MQTT_BROKER_URL: undefined },
      }),
    );
    expect(warning.status).toBe('warn');
    expect(byId(warning.checks, 'mqtt').status).toBe('warn');
  });

  // Eine Diagnoseseite, die selbst abstürzt, versagt genau dann, wenn man
  // sie braucht. Eine werfende Sonde muss als Prüfergebnis erscheinen.
  it('überlebt eine Sonde, die wirft, und meldet sie als eigenen Punkt', async () => {
    const report = await runPreflight(
      healthyDeps({
        diskFree: async () => {
          throw new Error('statfs kaputt');
        },
      }),
    );
    const disk = byId(report.checks, 'disk');
    expect(disk.status).toBe('warn');
    expect(disk.detail).toContain('statfs kaputt');
    expect(disk.remedy).toBeTruthy();
  });
});

describe('Kachelprüfung', () => {
  it('zählt installierte Regionen und nennt sie beim Namen', async () => {
    const report = await runPreflight(
      healthyDeps({ listDir: async () => ['liechtenstein.pmtiles', 'rheinland-pfalz.pmtiles'] }),
    );
    const tiles = byId(report.checks, 'tiles');
    expect(tiles.status).toBe('ok');
    expect(tiles.detail).toContain('liechtenstein');
    expect(tiles.detail).toContain('rheinland-pfalz');
  });

  it('erkennt ein fehlendes Verzeichnis als fail', async () => {
    const report = await runPreflight(
      healthyDeps({
        listDir: async () => {
          throw new Error('ENOENT');
        },
      }),
    );
    const tiles = byId(report.checks, 'tiles');
    expect(tiles.status).toBe('fail');
    expect(tiles.detail).toContain('/data/tiles');
  });

  // Eine `.part`-Datei ist ein ABGEBROCHENER Download, kein Defekt: er kann
  // fortgesetzt werden. Das muss in der Meldung stehen, sonst löscht der
  // Betreiber sie und lädt dieselben Gigabyte noch einmal.
  it('unterscheidet „nichts da" von „Download angefangen"', async () => {
    const nothing = await runPreflight(healthyDeps({ listDir: async () => [] }));
    expect(byId(nothing.checks, 'tiles').detail).toContain('Keine Kacheldatei');

    const partial = await runPreflight(
      healthyDeps({ listDir: async () => ['germany.pmtiles.part'] }),
    );
    const tiles = byId(partial.checks, 'tiles');
    expect(tiles.status).toBe('fail');
    expect(tiles.detail).toContain('angefangene');
    expect(tiles.remedy).toContain('fortgesetzt');
  });

  it('zählt eine .part-Datei nicht als installierte Region', async () => {
    const report = await runPreflight(
      healthyDeps({ listDir: async () => ['liechtenstein.pmtiles', 'germany.pmtiles.part'] }),
    );
    const tiles = byId(report.checks, 'tiles');
    expect(tiles.status).toBe('ok');
    expect(tiles.detail).toContain('1 Region');
    expect(tiles.detail).not.toContain('germany');
  });
});

describe('Suchprüfung (W-12: Photon ODER Lite)', () => {
  it('ist ok, wenn nur Photon läuft', async () => {
    const report = await runPreflight(healthyDeps({ fileSize: async () => null }));
    const search = byId(report.checks, 'search');
    expect(search.status).toBe('ok');
    expect(search.detail).toContain('photon');
  });

  // Das ist der Kern von W-12: ein Gerät ohne Photon ist nicht suchunfähig.
  // Eine Prüfung, die nur Photon kennt, würde die vorgesehene
  // Sparkonfiguration als Defekt melden.
  it('ist ok, wenn Photon abgeschaltet ist, aber ein Lite-Index existiert', async () => {
    const report = await runPreflight(
      healthyDeps({
        env: { ...healthyDeps().env, PHOTON_ENABLED: 'false' },
        httpProbe: async () => false,
        fileSize: async () => 12 * 1024 * 1024,
      }),
    );
    const search = byId(report.checks, 'search');
    expect(search.status).toBe('ok');
    expect(search.detail).toContain('Lite-Index');
  });

  it('ist ok, wenn Photon eingeschaltet ist aber nicht antwortet und der Lite-Index einspringt', async () => {
    const report = await runPreflight(
      healthyDeps({ httpProbe: async (url) => !url.includes('photon') }),
    );
    expect(byId(report.checks, 'search').status).toBe('ok');
  });

  it('warnt nur, wenn BEIDE Wege fehlen', async () => {
    const report = await runPreflight(
      healthyDeps({
        httpProbe: async (url) => !url.includes('photon'),
        fileSize: async () => null,
      }),
    );
    const search = byId(report.checks, 'search');
    expect(search.status).toBe('warn');
    expect(search.remedy).toContain('Lite-Index');
  });

  it('behandelt eine 0-Byte-Indexdatei nicht als fertigen Index', async () => {
    const report = await runPreflight(
      healthyDeps({
        httpProbe: async (url) => !url.includes('photon'),
        fileSize: async () => 0,
      }),
    );
    expect(byId(report.checks, 'search').status).toBe('warn');
  });

  it('fragt Photon gar nicht erst, wenn es abgeschaltet ist', async () => {
    const probed: string[] = [];
    await runPreflight(
      healthyDeps({
        env: { ...healthyDeps().env, PHOTON_ENABLED: 'false' },
        httpProbe: async (url) => {
          probed.push(url);
          return true;
        },
      }),
    );
    expect(probed.some((u) => u.includes('photon'))).toBe(false);
  });
});

describe('Positionsprüfung', () => {
  it('meldet erreichbares gpsd als ok', async () => {
    const report = await runPreflight(healthyDeps());
    const pos = byId(report.checks, 'position');
    expect(pos.status).toBe('ok');
    expect(pos.detail).toContain('2947');
  });

  it('warnt, wenn gpsd eingeschaltet ist aber nicht antwortet, und nennt den Browser als Ausweg', async () => {
    const report = await runPreflight(healthyDeps({ tcpProbe: async () => false }));
    const pos = byId(report.checks, 'position');
    expect(pos.status).toBe('warn');
    expect(pos.remedy).toContain('Browser');
  });

  // Kein gpsd ist ausdrücklich KEIN Fehler (ADR-007: gpsd > Browser >
  // Simulator). Die Warnung existiert nur wegen der HTTPS-Bedingung, die
  // man sonst erst im Fahrzeug bemerkt.
  it('behandelt „kein gpsd konfiguriert" als Hinweis, nicht als Defekt', async () => {
    const report = await runPreflight(
      healthyDeps({ env: { ...healthyDeps().env, GPSD_ENABLED: 'false' } }),
    );
    const pos = byId(report.checks, 'position');
    expect(pos.status).toBe('warn');
    expect(pos.severity).toBe('recommended');
    expect(pos.detail).toContain('Browser');
    expect(pos.remedy).toContain('HTTPS');
  });

  it('sagt ausdrücklich, dass der Simulator keine echte Position ist', async () => {
    const report = await runPreflight(
      healthyDeps({
        env: { ...healthyDeps().env, GPSD_ENABLED: 'false', ENABLE_SIMULATOR: 'true' },
      }),
    );
    expect(byId(report.checks, 'position').detail).toContain('keine echte Position');
  });

  it('benutzt den konfigurierten gpsd-Host und -Port', async () => {
    const seen: Array<[string, number]> = [];
    await runPreflight(
      healthyDeps({
        env: { ...healthyDeps().env, GPSD_HOST: 'gps-box', GPSD_PORT: '3333' },
        tcpProbe: async (host, port) => {
          seen.push([host, port]);
          return true;
        },
      }),
    );
    expect(seen).toContainEqual(['gps-box', 3333]);
  });
});

describe('Speicherprüfung (der 8-GB-Fall)', () => {
  it('warnt bei 8 GB mit eingeschaltetem Photon und empfiehlt den Lite-Index', async () => {
    const report = await runPreflight(healthyDeps({ totalMem: () => 8 * GB }));
    const mem = byId(report.checks, 'memory');
    expect(mem.status).toBe('warn');
    expect(mem.remedy).toContain('photon_enabled');
    expect(mem.remedy).toContain('Lite');
  });

  it('warnt bei 8 GB nicht, wenn Photon abgeschaltet ist', async () => {
    const report = await runPreflight(
      healthyDeps({
        totalMem: () => 8 * GB,
        env: { ...healthyDeps().env, PHOTON_ENABLED: 'false' },
      }),
    );
    expect(byId(report.checks, 'memory').status).toBe('ok');
  });

  it('warnt oberhalb der Schwelle auch mit Photon nicht', async () => {
    const report = await runPreflight(
      healthyDeps({ totalMem: () => PHOTON_COMFORTABLE_RAM_BYTES }),
    );
    expect(byId(report.checks, 'memory').status).toBe('ok');
  });
});

describe('Plattenplatzprüfung', () => {
  it('ist ok bei reichlich Platz', async () => {
    const report = await runPreflight(healthyDeps({ diskFree: async () => 40 * GB }));
    expect(byId(report.checks, 'disk').status).toBe('ok');
  });

  it('warnt bei knappem Platz und trennt kleine von großen Regionen', async () => {
    const report = await runPreflight(healthyDeps({ diskFree: async () => 2 * GB }));
    const disk = byId(report.checks, 'disk');
    expect(disk.status).toBe('warn');
    expect(disk.remedy).toContain('Liechtenstein');
  });

  it('misst den Platz im konfigurierten Kachelverzeichnis', async () => {
    const seen: string[] = [];
    await runPreflight(
      healthyDeps({
        env: { ...healthyDeps().env, TILES_DIR: '/mnt/gross/tiles' },
        diskFree: async (path) => {
          seen.push(path);
          return 40 * GB;
        },
      }),
    );
    expect(seen).toEqual(['/mnt/gross/tiles']);
  });
});

/**
 * ─── EINE ANWEISUNG DARF NICHT AUF ETWAS ZEIGEN, DAS ES NICHT GIBT ──────────
 *
 * Am 2026-09-02 zeigte die Installationsprüfung auf einer echten HAOS-Instanz
 * korrekt an, dass Kacheln und Routinggraph fehlen — und nannte als Abhilfe
 * den „Knopf ‚Kacheln bauen'" bzw. „‚Suchindex bauen'". Beide Knöpfe gibt es
 * nicht; sie stehen als B-04 im Backlog. Der Betreiber suchte in der
 * Oberfläche nach etwas, das nie gebaut wurde.
 *
 * Das ist exakt dieselbe Fehlerklasse wie der Katalog, der auf
 * nicht existierende `.pmtiles`-URLs zeigte: eine Anweisung, die nicht
 * befolgt werden KANN, ist schlimmer als gar keine — sie schickt den
 * Adressaten auf die Fehlersuche in seiner eigenen Installation.
 *
 * Dieser Test kann nicht jede Formulierung prüfen. Er prüft das, was
 * maschinell entscheidbar ist: nennt eine Anweisung ein Bedienelement in
 * deutschen Anführungszeichen, muss diese Beschriftung im Frontend-Quelltext
 * tatsächlich vorkommen.
 */
describe('Handlungsanweisungen verweisen nur auf real Vorhandenes', () => {
  const GB = 1024 ** 3;

  /** Beschriftungen, die in `„…"` stehen und wie ein Bedienelement aussehen.
   *  Pfade, Dateinamen und Konfigurationsschlüssel sind ausgenommen — die
   *  sind keine Knöpfe. */
  function quotedControls(text: string): string[] {
    const out: string[] = [];
    for (const m of text.matchAll(/„([^"„]{2,40})"/g)) {
      const label = m[1].trim();
      if (/[/.:]/.test(label)) continue; // Pfad/Datei/Key, kein Bedienelement
      if (/^[a-z_]+$/.test(label)) continue; // z. B. photon_enabled
      out.push(label);
    }
    return out;
  }

  it('jede in Anführungszeichen genannte Beschriftung existiert im Frontend', async () => {
    const report = await runPreflight({
      env: {},
      listDir: async () => [],
      fileSize: async () => null,
      tcpProbe: async () => false,
      httpProbe: async () => false,
      totalMem: () => 8 * GB,
      diskFree: async () => 1 * GB,
    });

    const webSrc = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'web',
      'src',
    );

    // Beschriftungen, die BEWUSST nicht aus dem Frontend stammen: sie
    // benennen Bedienelemente von Home Assistant bzw. fremden Add-ons, nicht
    // von Yapaja. Jede weitere Ausnahme braucht dieselbe Begründung.
    const FOREIGN_UI = new Set(['Samba share', 'File editor', 'Protokoll', 'Terminal']);

    const labels = report.checks
      .flatMap((c) => quotedControls(c.remedy ?? ''))
      .filter((l) => !FOREIGN_UI.has(l));

    if (labels.length === 0) {
      return; // keine Beschriftung genannt -- nichts zu prüfen
    }

    const haystack = readFileSync(join(webSrc, 'settings/regions/RegionsPanel.tsx'), 'utf-8');
    for (const label of labels) {
      expect(
        haystack.includes(label),
        `Eine Handlungsanweisung nennt das Bedienelement „${label}", das im ` +
          `RegionsPanel nicht vorkommt. Entweder das Element bauen oder die ` +
          `Anweisung auf das umschreiben, was es wirklich gibt.`,
      ).toBe(true);
    }
  });

  // Die Gegenprobe: seit B-04 GIBT es den Bau-Knopf, und die Anweisung soll
  // ihn auch nennen -- sonst schickt sie den Betreiber weiter über eine
  // Kommandozeile, obwohl der Weg in der Oberfläche existiert.
  it('nennt den Bau-Knopf, jetzt wo es ihn gibt', async () => {
    const report = await runPreflight({
      env: {},
      listDir: async () => [],
      fileSize: async () => null,
      tcpProbe: async () => false,
      httpProbe: async () => false,
      totalMem: () => 8 * GB,
      diskFree: async () => 1 * GB,
    });

    const tiles = report.checks.find((c) => c.id === 'tiles');
    expect(tiles?.remedy).toContain('Kacheln bauen');
  });
});
