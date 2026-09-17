/**
 * Entsorgungsstationen und Müllentsorgung auf der Karte.
 *
 * ─── DIE LÜCKE, DIE DAS SCHLIESST ───────────────────────────────────────────
 * `amenity=sanitary_dump_station` kommt im OpenMapTiles-Schema nicht vor —
 * nachgezählt, 0×. Für ein Wohnmobil ist das die schmerzlichste Lücke der
 * ganzen POI-Liste, und sie stand seit 0.9.0 als „nur beim Kachelbau zu
 * schliessen" im Quelltext.
 *
 * Das war zur Hälfte falsch. Die Stationen lagen die ganze Zeit im
 * SUCHINDEX: `build-lite-index.sh` filtert sie mit derselben Liste aus der
 * PBF, aus der auch die deutschen Suchbegriffe kommen. Wer „Entsorgung"
 * SUCHTE, fand sie. Wer auf die KARTE sah, nicht.
 *
 * ─── EINMAL HOLEN, NICHT JE BEWEGUNG ────────────────────────────────────────
 * Sie ändern sich nur, wenn jemand den Suchindex neu baut. Eine Abfrage je
 * Kartenbewegung wäre Aufwand ohne Gegenwert.
 *
 * ─── DIE MUSTERTREUE ZU `VerkehrLayer` IST ABSICHT ──────────────────────────
 * `addSource`/`addLayer` laufen erst, wenn der Stil sie annimmt
 * (`runWhenStyleReady`). Der frühere Weg über `isStyleLoaded()` verlor das
 * Rennen, sobald der Effekt nach `load` zum ersten Mal lief — die Ebene blieb
 * dann dauerhaft leer, ohne Fehler.
 */

import { useEffect } from 'react';
import { useMapStore } from '../state/mapStore.js';
import { runWhenStyleReady } from './styleReady.js';
import { useSonderzieleStore } from './sonderzieleStore.js';

export const SONDERZIELE_SOURCE_ID = 'yapaja-sonderziele';
export const SONDERZIELE_LAYER_ID = 'yapaja-sonderziele-marken';

const LEER = { type: 'FeatureCollection' as const, features: [] };

interface GeoJSONQuelle {
  setData(data: unknown): void;
}

export default function SonderzieleLayer(): null {
  const map = useMapStore((state) => state.map);
  const merkmale = useSonderzieleStore((s) => s.merkmale);
  const abrufen = useSonderzieleStore((s) => s.abrufen);

  useEffect(() => {
    void abrufen();
  }, [abrufen]);

  useEffect(() => {
    if (!map) return;

    const setup = (): void => {
      if (map.getSource(SONDERZIELE_SOURCE_ID)) return;

      map.addSource(SONDERZIELE_SOURCE_ID, { type: 'geojson', data: LEER });
      map.addLayer({
        id: SONDERZIELE_LAYER_ID,
        type: 'symbol',
        source: SONDERZIELE_SOURCE_ID,
        layout: {
          'icon-image': ['get', 'symbol'],
          // Die Marke ist 18 Bildpunkte gross gezeichnet. Nicht skalieren.
          'icon-size': 1,
          // ─── DERSELBE ZAHLENRAUM WIE DIE KACHEL-POIS ──────────────────
          // `rang` kommt aus `sonderziele/fehlendeKlassen.ts` und setzt die
          // Reihe aus `poiKategorien.ts` fort. Nur deshalb ist ein Vergleich
          // ueberhaupt sinnvoll: beide Ebenen liegen auf derselben Karte,
          // und MapLibre laesst bei Ueberschneidung das Symbol mit dem
          // KLEINEREN Schluessel stehen.
          'symbol-sort-key': ['get', 'rang'],
          // Nicht mit der Karte kippen: im Fahrmodus steht sie schraeg.
          'icon-rotation-alignment': 'viewport',
          'icon-pitch-alignment': 'viewport',
          // ─── HIER BEWUSST *NICHT* `icon-allow-overlap` ────────────────
          // Bei den Verkehrsmeldungen ist Ueberlappen richtig: eine
          // ausgeblendete Sperrung ist eine Sperrung, von der niemand
          // erfaehrt, und es sind wenige. Entsorgungsstationen sind
          // ortsfest und stehen auf einem Stellplatz oft direkt neben der
          // Wassermarke. Uebereinandergedruckte Marken waeren dort ein
          // Fleck, aus dem nichts mehr zu lesen ist -- und weil `rang`
          // entscheidet, bleibt im Zweifel die Entsorgung stehen.
        },
      });
    };

    return runWhenStyleReady(map, setup);
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const quelle = map.getSource(SONDERZIELE_SOURCE_ID) as unknown as GeoJSONQuelle | undefined;
    if (!quelle) return;
    quelle.setData({ type: 'FeatureCollection', features: merkmale });
  }, [map, merkmale]);

  return null;
}
