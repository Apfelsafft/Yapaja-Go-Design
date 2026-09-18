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

import { useEffect, useRef } from 'react';
import type { FilterSpecification } from 'maplibre-gl';
import { nichtAbgeschaltet } from '@yapaia/shared';
import { useMapStore } from '../state/mapStore.js';
import { useStyleStore } from '../state/styleStore.js';
import { runWhenStyleReady } from './styleReady.js';
import { useSonderzieleStore } from './sonderzieleStore.js';

export const SONDERZIELE_SOURCE_ID = 'yapaja-sonderziele';
export const SONDERZIELE_LAYER_ID = 'yapaja-sonderziele-marken';

const LEER = { type: 'FeatureCollection' as const, features: [] };

interface GeoJSONQuelle {
  setData(data: unknown): void;
}

/**
 * Der Filter fuer die abgeschalteten Kategorien.
 *
 * ─── WARUM HIER IM BROWSER UND NICHT IM KERN ────────────────────────────────
 * Diese Ebene ist ein GeoJSON, das einmal beim Start geholt wird und danach
 * vollstaendig im Browser liegt. Ein Schalter, der dafuer den Kern fragte,
 * wartete auf eine Antwort, die schon da ist.
 *
 * Die Kachel-POIs gehen den anderen Weg (`?poiAus=` an den Stil), weil sie
 * ihn gehen MUESSEN: ihre Ebene wird im Kern gebaut. Dass beide trotzdem
 * dieselben Schluessel und denselben Ausdruck benutzen, liegt an
 * `nichtAbgeschaltet` -- der Unterschied bleibt damit ein technischer und
 * wird nie einer, den jemand auf der Karte sieht.
 *
 * `['get', 'symbol']` ist hier die Kategorie: `ausIndex.ts` schreibt den
 * Sprite-Namen in genau dieses Feld, und der Sprite-Name IST der Schluessel.
 *
 * ─── DIE EINE UMDEUTUNG ─────────────────────────────────────────────────────
 * `nichtAbgeschaltet` liefert `unknown[]`, weil es im Kern liegt und dort
 * kein MapLibre bekannt ist. Die Umdeutung auf `FilterSpecification` ist
 * deshalb keine Behauptung ueber einen Wert, den der Uebersetzer nicht
 * pruefen KANN, sondern ueber einen, den er an dieser Stelle nicht pruefen
 * DARF -- und was dabei herauskommt (`['!', ['in', …, ['literal', […]]]]`)
 * steht drei Zeilen weiter oben im Quelltext.
 */
function filterFuer(abgeschaltet: readonly string[]): FilterSpecification | null {
  return nichtAbgeschaltet(['get', 'symbol'], abgeschaltet) as FilterSpecification | null;
}

export default function SonderzieleLayer(): null {
  const map = useMapStore((state) => state.map);
  const merkmale = useSonderzieleStore((s) => s.merkmale);
  const abrufen = useSonderzieleStore((s) => s.abrufen);
  const poiAus = useStyleStore((s) => s.options.poiAus);
  // ─── WARUM DIE SCHALTER AUCH IN EINEM REF LIEGEN ────────────────────────
  // Der Aufbau unten haengt bewusst nur an `[map]`: er darf NICHT bei jeder
  // Aenderung der Schalter neu laufen, sonst wuerde die Ebene dreizehnmal
  // hintereinander ab- und wieder aufgebaut. Er braucht den Wert trotzdem,
  // und zwar den aktuellen -- ein Stil-Wechsel loest ihn spaeter erneut aus.
  const poiAusRef = useRef(poiAus);
  poiAusRef.current = poiAus;

  useEffect(() => {
    void abrufen();
  }, [abrufen]);

  useEffect(() => {
    if (!map) return;

    const setup = (): void => {
      if (map.getSource(SONDERZIELE_SOURCE_ID)) return;

      const anfangsfilter = filterFuer(poiAusRef.current);

      map.addSource(SONDERZIELE_SOURCE_ID, { type: 'geojson', data: LEER });
      map.addLayer({
        id: SONDERZIELE_LAYER_ID,
        type: 'symbol',
        source: SONDERZIELE_SOURCE_ID,
        // Gleich beim Anlegen, nicht erst im Effekt darunter: der laeuft nach
        // dem Aufbau, und dazwischen lieferte ein Bildschirm die gerade
        // abgeschalteten Symbole kurz aus. Bei einem Stil-Wechsel waere das
        // jedes Mal ein Aufblitzen.
        ...(anfangsfilter ? { filter: anfangsfilter } : {}),
        layout: {
          'icon-image': ['get', 'symbol'],
          // Die Marke ist 18 Bildpunkte gross gezeichnet. Nicht skalieren.
          'icon-size': 1,
          // ─── DERSELBE ZAHLENRAUM WIE DIE KACHEL-POIS ──────────────────
          // `rang` kommt aus `poi/fehlendeKlassen.ts` in `@yapaia/shared` und
          // setzt die Reihe aus `poi/kategorien.ts` fort. Nur deshalb ist ein Vergleich
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

  // ─── AUF EINE AENDERUNG DER SCHALTER REAGIEREN ──────────────────────────
  // `setFilter` und kein Neuaufbau der Ebene: die Punkte liegen schon da,
  // MapLibre muss nur neu entscheiden, welche es zeichnet. Das ist der
  // Unterschied zwischen sofort und sichtbar.
  useEffect(() => {
    if (!map) return;
    if (!map.getLayer(SONDERZIELE_LAYER_ID)) return;
    // `null` heisst „nichts abgeschaltet" -- und `setFilter(id, undefined)`
    // ist bei MapLibre genau das Entfernen des Filters, nicht etwa ein
    // Filter, der nichts durchlaesst.
    map.setFilter(SONDERZIELE_LAYER_ID, filterFuer(poiAus) ?? undefined);
  }, [map, poiAus]);

  useEffect(() => {
    if (!map) return;
    const quelle = map.getSource(SONDERZIELE_SOURCE_ID) as unknown as GeoJSONQuelle | undefined;
    if (!quelle) return;
    quelle.setData({ type: 'FeatureCollection', features: merkmale });
  }, [map, merkmale]);

  return null;
}
