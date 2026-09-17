/**
 * Aus Verkehrsmeldungen werden Kartenpunkte.
 *
 * ─── WORAUF ES ANKOMMT ──────────────────────────────────────────────────────
 * Nicht darauf, dass aus zwanzig Meldungen zwanzig Punkte werden. Darauf, was
 * mit denen passiert, aus denen KEINER wird — und ob man das hinterher merkt.
 *
 * Eine Karte, auf der drei von zwanzig Meldungen fehlen, sieht genauso aus
 * wie eine, auf der alle stehen. Genau diese Verwechslung verfolgt dieses
 * Projekt seit Monaten: bei den Kartenregionen, beim Routing, bei den
 * LKW-Parkplätzen. Deshalb zählt diese Funktion, was sie weglässt.
 */

import { describe, it, expect } from 'vitest';
import { verkehrGeoJson, type KartenMeldung } from './verkehrGeoJson';

function meldung(teil: Partial<KartenMeldung> = {}): KartenMeldung {
  return {
    id: 'm1',
    art: 'baustelle',
    strasse: 'A61',
    titel: 'Fahrbahnverengung',
    beschreibung: '',
    lat: 49.9,
    lon: 7.8,
    symbol: 'verkehr-baustelle',
    ...teil,
  };
}

describe('verkehrGeoJson — der gute Fall', () => {
  it('macht aus einer Meldung einen Punkt', () => {
    const { geojson } = verkehrGeoJson([meldung()]);
    expect(geojson.features).toHaveLength(1);
    expect(geojson.features[0].geometry.coordinates).toEqual([7.8, 49.9]);
  });

  it('schreibt Längengrad ZUERST — GeoJSON ist so herum', () => {
    // Vertauscht läge die Baustelle bei 7,8° Nord / 49,9° Ost: im Golf von
    // Guinea statt am Rhein. Kein Fehler, nur eine Meldung im Nirgendwo.
    const { geojson } = verkehrGeoJson([meldung({ lat: 50.0, lon: 7.0 })]);
    const [x, y] = geojson.features[0].geometry.coordinates;
    expect(x).toBe(7.0);
    expect(y).toBe(50.0);
  });

  it('reicht Titel, Straße und Symbol als Eigenschaften durch', () => {
    const { geojson } = verkehrGeoJson([meldung()]);
    expect(geojson.features[0].properties).toMatchObject({
      symbol: 'verkehr-baustelle',
      strasse: 'A61',
      titel: 'Fahrbahnverengung',
    });
  });

  it('lässt nichts weg, wenn nichts wegzulassen ist', () => {
    expect(verkehrGeoJson([meldung(), meldung({ id: 'm2' })]).weggelassen).toEqual({
      ohneOrt: 0,
      ohneSymbol: 0,
    });
  });
});

describe('verkehrGeoJson — was NICHT gezeichnet wird, wird gezählt', () => {
  it('ohne Koordinaten', () => {
    const { geojson, weggelassen } = verkehrGeoJson([meldung({ lat: null, lon: null })]);
    expect(geojson.features).toEqual([]);
    expect(weggelassen.ohneOrt).toBe(1);
  });

  it('ohne Symbol', () => {
    // Ein Ersatzzeichen wäre falsch: ein Punkt, den niemand deuten kann,
    // kostet während der Fahrt Aufmerksamkeit und gibt nichts dafür.
    const { geojson, weggelassen } = verkehrGeoJson([meldung({ symbol: null })]);
    expect(geojson.features).toEqual([]);
    expect(weggelassen.ohneSymbol).toBe(1);
  });

  it('mit leerem Symbolnamen', () => {
    // `icon-image: ''` ist für MapLibre kein Fehler — die Ebene bleibt
    // einfach leer. Also hier abfangen, wo es noch auffällt.
    expect(verkehrGeoJson([meldung({ symbol: '' })]).weggelassen.ohneSymbol).toBe(1);
  });

  it('0/0 gilt NICHT als Ort', () => {
    // Der Wert, den eine fehlgeschlagene Umwandlung hinterlässt. Auf der
    // Karte sähe er wie eine echte Meldung aus — 2000 km vor Westafrika.
    expect(verkehrGeoJson([meldung({ lat: 0, lon: 0 })]).weggelassen.ohneOrt).toBe(1);
  });

  it('aber 0/7.8 schon — das liegt vor Ghana, ist aber ein Ort', () => {
    // Die Grenze gehört genau um den einen Punkt gezogen, nicht um die
    // ganze Null-Achse. Sonst fiele der Äquator heraus.
    expect(verkehrGeoJson([meldung({ lat: 0, lon: 7.8 })]).geojson.features).toHaveLength(1);
  });

  it('unmögliche Breitengrade fallen heraus — in BEIDE Richtungen', () => {
    // MapLibre zeichnet 91° klaglos irgendwohin. Eine Meldung, die dort
    // landet, ist schlimmer als keine.
    //
    // Beide Richtungen, weil der Wächter zwei Hälften hat: ein Mutationstest,
    // der nur `lat >= -90` entfernte, hat zunächst ÜBERLEBT — es prüfte
    // niemand die untere Grenze. Eine halb geprüfte Bedingung ist eine
    // ungeprüfte, sobald jemand die andere Hälfte anfasst.
    expect(verkehrGeoJson([meldung({ lat: 91 })]).weggelassen.ohneOrt).toBe(1);
    expect(verkehrGeoJson([meldung({ lat: -91 })]).weggelassen.ohneOrt).toBe(1);
    expect(verkehrGeoJson([meldung({ lon: 181 })]).weggelassen.ohneOrt).toBe(1);
    expect(verkehrGeoJson([meldung({ lon: -181 })]).weggelassen.ohneOrt).toBe(1);
  });

  it('und die Grenzwerte selbst gelten noch', () => {
    // Genau -90/90 und -180/180 sind gültige Orte. Ein `>` statt `>=` würde
    // den Südpol und die Datumsgrenze verwerfen — folgenlos in Europa, aber
    // falsch, und falsch aus keinem Grund.
    expect(verkehrGeoJson([meldung({ lat: -90, lon: -180 })]).geojson.features).toHaveLength(1);
    expect(verkehrGeoJson([meldung({ lat: 90, lon: 180 })]).geojson.features).toHaveLength(1);
  });

  it('NaN und Unendlich fallen heraus', () => {
    // Was über das Netz kommt, ist keine Zusicherung — auch dann nicht,
    // wenn auf der anderen Seite unser eigener Kern steht.
    expect(verkehrGeoJson([meldung({ lat: NaN })]).weggelassen.ohneOrt).toBe(1);
    expect(verkehrGeoJson([meldung({ lon: Infinity })]).weggelassen.ohneOrt).toBe(1);
  });

  it('zählt beide Gründe getrennt', () => {
    // „Drei fehlen" hilft nicht weiter. WARUM sie fehlen, ist die Auskunft,
    // aus der sich etwas ableiten lässt.
    const { weggelassen } = verkehrGeoJson([
      meldung({ id: 'a' }),
      meldung({ id: 'b', lat: null }),
      meldung({ id: 'c', symbol: null }),
    ]);
    expect(weggelassen).toEqual({ ohneOrt: 1, ohneSymbol: 1 });
  });
});

describe('verkehrGeoJson — die Sammlung', () => {
  it('eine leere Liste ergibt eine leere Sammlung, keinen Fehler', () => {
    const { geojson } = verkehrGeoJson([]);
    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features).toEqual([]);
  });

  it('jeder Punkt trägt die Kennung der Meldung', () => {
    // Ohne sie könnte die Karte beim nächsten Abruf nicht erkennen, dass es
    // dieselbe Baustelle ist — und ein Fingertipp fände nichts wieder.
    const { geojson } = verkehrGeoJson([meldung({ id: 'abc' })]);
    expect(geojson.features[0].id).toBe('abc');
    expect(geojson.features[0].properties.id).toBe('abc');
  });
});
