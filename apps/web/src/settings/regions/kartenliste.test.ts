/**
 * Die eine Kartenliste.
 *
 * ─── DIE LEITFRAGE ──────────────────────────────────────────────────────────
 * Kann eine Karte, die der Betreiber besitzt, aus dieser Liste verschwinden —
 * oder doppelt darin stehen?
 *
 * Bis 0.15.3 gab es zwei Listen, und eine Karte wechselte beim Installieren
 * von der einen in die andere. Wer sie dort suchte, wo er sie zuletzt gesehen
 * hatte, fand sie nicht mehr.
 */

import { describe, it, expect } from 'vitest';
import {
  kartenliste,
  istInstalliert,
  kannInstallieren,
  installierenText,
  type Karteneintrag,
} from './kartenliste';
import type { CatalogRegion, InstalledRegion } from './client';

function installiert(region: string, groesse = 1_000_000): InstalledRegion {
  return {
    region,
    size_bytes: groesse,
    bounds: [0, 0, 1, 1],
    minzoom: 0,
    maxzoom: 14,
    tile_type: 'mvt',
    compression: 'gzip',
  };
}

function katalog(
  id: string,
  opt: Partial<CatalogRegion> & { name?: string } = {},
): CatalogRegion {
  return {
    id,
    name: opt.name ?? id,
    sizeBytes: opt.sizeBytes ?? 2_000_000,
    bounds: [0, 0, 1, 1],
    installed: opt.installed ?? false,
    ...(opt.url ? { url: opt.url } : {}),
    ...(opt.pbfUrl ? { pbfUrl: opt.pbfUrl } : {}),
    ...(opt.buildEffort ? { buildEffort: opt.buildEffort } : {}),
    ...(opt.note ? { note: opt.note } : {}),
  };
}

function finde(liste: Karteneintrag[], id: string): Karteneintrag {
  const treffer = liste.find((e) => e.id === id);
  if (!treffer) throw new Error(`„${id}" fehlt in der Liste`);
  return treffer;
}

describe('installierte und verfügbare Karten stehen zusammen', () => {
  it('jede Karte kommt GENAU EINMAL vor', () => {
    // ─── DIE LEITFRAGE ──────────────────────────────────────────────────────
    const liste = kartenliste(
      [installiert('germany')],
      [katalog('germany', { installed: true, pbfUrl: 'x' }), katalog('austria', { pbfUrl: 'y' })],
    );
    expect(liste.map((e) => e.id)).toEqual(['germany', 'austria']);
  });

  it('auch wenn der Kern `installed` NICHT gesetzt hat', () => {
    // Die Gegenprobe: `installed` kommt vom Kern, die Liste der installierten
    // Karten ebenfalls. Widersprechen sie sich, darf die Karte nicht doppelt
    // erscheinen -- einmal als Besitz, einmal als Angebot.
    const liste = kartenliste(
      [installiert('germany')],
      [katalog('germany', { installed: false, pbfUrl: 'x' })],
    );
    expect(liste).toHaveLength(1);
    expect(liste[0].zustand).toBe('installiert');
  });

  it('installierte stehen vorn', () => {
    // Sie sind das, was der Betreiber besitzt. Alphabetisch ueber alles
    // hinweg verschwaenden sie zwischen Dutzenden fremder Laendernamen.
    const liste = kartenliste(
      [installiert('zypern')],
      [
        katalog('zypern', { installed: true, pbfUrl: 'x' }),
        katalog('austria', { pbfUrl: 'y' }),
      ],
    );
    expect(liste.map((e) => e.id)).toEqual(['zypern', 'austria']);
  });

  it('innerhalb der Gruppen alphabetisch nach NAMEN, nicht nach Kennung', () => {
    // Der Betreiber liest den Namen.
    const liste = kartenliste(
      [],
      [
        katalog('zz', { name: 'Österreich', pbfUrl: 'x' }),
        katalog('aa', { name: 'Schweiz', pbfUrl: 'y' }),
      ],
    );
    expect(liste.map((e) => e.name)).toEqual(['Österreich', 'Schweiz']);
  });

  it('ohne alles bleibt die Liste leer statt undefiniert', () => {
    expect(kartenliste([], [])).toEqual([]);
  });
});

describe('der Zustand einer Karte', () => {
  it('im Katalog und installiert: `installiert`', () => {
    const liste = kartenliste([installiert('germany')], [katalog('germany', { pbfUrl: 'x' })]);
    expect(finde(liste, 'germany').zustand).toBe('installiert');
  });

  it('im Katalog, nicht installiert: `verfuegbar`', () => {
    const liste = kartenliste([], [katalog('germany', { pbfUrl: 'x' })]);
    expect(finde(liste, 'germany').zustand).toBe('verfuegbar');
  });

  it('installiert, aber in KEINEM Katalog: `fremd`', () => {
    // ─── DER FALL, DEN DIE ZWEI ALTEN LISTEN NICHT KANNTEN ──────────────────
    // Eine von Hand nach /share gelegte `.pmtiles`. Sie wird gezeichnet, aber
    // fuer sie laesst sich nichts bauen -- der Gesamtbau ueberspringt sie.
    // Das zu verschweigen hiesse, den Betreiber den Fehler woanders suchen zu
    // lassen.
    const liste = kartenliste([installiert('selbstgebaut')], []);
    expect(finde(liste, 'selbstgebaut').zustand).toBe('fremd');
    expect(finde(liste, 'selbstgebaut').quelle).toBeNull();
  });

  it('im Katalog, aber ohne jede Quelle: `ohne_quelle`', () => {
    // Weder fertige Datei noch OSM-Extrakt. Ein „Installieren"-Knopf waere
    // hier einer, der sicher scheitert.
    const liste = kartenliste([], [katalog('geisterland')]);
    expect(finde(liste, 'geisterland').zustand).toBe('ohne_quelle');
  });
});

describe('woher die Kacheln kommen', () => {
  it('eine fertige Datei schlägt den Bau', () => {
    // Herunterladen dauert Minuten, Bauen Stunden. Gibt es beides, ist die
    // Wahl nicht schwer.
    const liste = kartenliste([], [katalog('germany', { url: 'a.pmtiles', pbfUrl: 'b.pbf' })]);
    expect(finde(liste, 'germany').quelle).toBe('download');
  });

  it('ohne Datei wird gebaut', () => {
    const liste = kartenliste([], [katalog('germany', { pbfUrl: 'b.pbf' })]);
    expect(finde(liste, 'germany').quelle).toBe('bau');
  });

  it('ohne beides gibt es keine Quelle', () => {
    const liste = kartenliste([], [katalog('germany')]);
    expect(finde(liste, 'germany').quelle).toBeNull();
  });
});

describe('die Grösse, die dasteht', () => {
  it('bei einer installierten Karte die TATSÄCHLICHE', () => {
    // Was auf der Platte liegt, ist die interessantere Zahl als das, was der
    // Katalog erwartet hat.
    const liste = kartenliste(
      [installiert('germany', 4_200_000)],
      [katalog('germany', { sizeBytes: 9_999_999, pbfUrl: 'x' })],
    );
    expect(finde(liste, 'germany').groesseBytes).toBe(4_200_000);
  });

  it('bei einer verfügbaren die erwartete', () => {
    const liste = kartenliste([], [katalog('germany', { sizeBytes: 9_999_999, pbfUrl: 'x' })]);
    expect(finde(liste, 'germany').groesseBytes).toBe(9_999_999);
  });
});

describe('was man mit einer Karte tun kann', () => {
  it('`installiert` und `fremd` zählen beide als installiert', () => {
    // Loeschen muss man beide koennen -- gerade die fremde, denn sie ist die
    // einzige, die man sonst nie wieder los wird.
    const liste = kartenliste([installiert('a'), installiert('b')], [katalog('a', { pbfUrl: 'x' })]);
    expect(istInstalliert(finde(liste, 'a'))).toBe(true);
    expect(istInstalliert(finde(liste, 'b'))).toBe(true);
  });

  it('eine verfügbare Karte gilt NICHT als installiert', () => {
    // Die Gegenprobe: sonst waere `istInstalliert` eine Funktion, die immer
    // `true` sagt.
    const liste = kartenliste([], [katalog('a', { pbfUrl: 'x' })]);
    expect(istInstalliert(finde(liste, 'a'))).toBe(false);
  });

  it('ohne Quelle gibt es keinen Knopf', () => {
    // Ein Knopf, der nicht funktionieren KANN, ist schlimmer als kein Knopf:
    // er schickt den Betreiber auf die Fehlersuche in seiner eigenen
    // Installation.
    const liste = kartenliste([installiert('fremd')], [katalog('leer')]);
    expect(kannInstallieren(finde(liste, 'fremd'))).toBe(false);
    expect(kannInstallieren(finde(liste, 'leer'))).toBe(false);
  });

  it('mit Quelle schon — auch bei einer installierten Karte', () => {
    // Das IST das Update: derselbe Bau, er ersetzt, was da ist.
    const liste = kartenliste([installiert('germany')], [katalog('germany', { pbfUrl: 'x' })]);
    expect(kannInstallieren(finde(liste, 'germany'))).toBe(true);
  });
});

describe('die Beschriftung des Knopfes', () => {
  it('heisst bei einer installierten Karte „Update"', () => {
    const liste = kartenliste([installiert('germany')], [katalog('germany', { pbfUrl: 'x' })]);
    expect(installierenText(finde(liste, 'germany'))).toBe('Update');
  });

  it('und sonst „Installieren"', () => {
    const liste = kartenliste([], [katalog('germany', { pbfUrl: 'x' })]);
    expect(installierenText(finde(liste, 'germany'))).toBe('Installieren');
  });

  it('die beiden sind NICHT dasselbe Wort', () => {
    // Die Gegenprobe zur ganzen Funktion.
    const a = kartenliste([installiert('g')], [katalog('g', { pbfUrl: 'x' })]);
    const b = kartenliste([], [katalog('g', { pbfUrl: 'x' })]);
    expect(installierenText(finde(a, 'g'))).not.toBe(installierenText(finde(b, 'g')));
  });
});

describe('die Hinweise aus dem Katalog', () => {
  it('ein grosser Bau bleibt als solcher erkennbar', () => {
    const liste = kartenliste([], [katalog('germany', { pbfUrl: 'x', buildEffort: 'large' })]);
    expect(finde(liste, 'germany').grosserBau).toBe(true);
  });

  it('ein kleiner nicht', () => {
    const liste = kartenliste([], [katalog('li', { pbfUrl: 'x', buildEffort: 'small' })]);
    expect(finde(liste, 'li').grosserBau).toBe(false);
  });

  it('der Freitext kommt mit — auch bei einer installierten Karte', () => {
    const liste = kartenliste(
      [installiert('germany')],
      [katalog('germany', { pbfUrl: 'x', note: 'Dauert mehrere Stunden.' })],
    );
    expect(finde(liste, 'germany').hinweis).toBe('Dauert mehrere Stunden.');
  });
});
