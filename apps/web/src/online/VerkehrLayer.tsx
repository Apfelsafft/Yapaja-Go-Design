/**
 * Baustellen und Sperrungen auf der Karte.
 *
 * ─── WAS HIER ZU SEHEN IST ──────────────────────────────────────────────────
 * Ein bernsteinfarbener Leitkegel je Baustelle, ein roter Balken je Sperrung —
 * beide als runde Marke wie die POIs, damit sie auf jedem Untergrund stehen.
 *
 * ─── WANN GEFRAGT WIRD, UND WANN NICHT ──────────────────────────────────────
 * NUR wenn es eine aktive Route gibt. Ohne Route gibt es keine Autobahnen, für
 * die zu fragen wäre — und Yapaia soll nicht aus reiner Anwesenheit nach
 * draußen telefonieren.
 *
 * Neu gefragt wird, wenn sich die Liste der Autobahnen ÄNDERT, nicht bei jeder
 * Positionsmeldung. Die Route kommt im Sekundentakt herein; danach zu fragen
 * wäre eine Salve. Der Kern hält zusätzlich fünf Minuten lang fest, was er
 * schon weiß.
 *
 * ─── DIE MUSTERTREUE ZU `RouteLayer` IST ABSICHT ────────────────────────────
 * `addSource`/`addLayer` laufen erst, wenn der Stil sie annimmt
 * (`runWhenStyleReady`). Der frühere Weg über `isStyleLoaded()` verlor das
 * Rennen, sobald der Effekt nach `load` zum ersten Mal lief — die Ebene blieb
 * dann dauerhaft leer, ohne Fehler. Wer hier etwas ändert, lese zuerst
 * `map/styleReady.ts`.
 *
 * ─── UND DIE LÜCKE, DIE MAN SEHEN MUSS ──────────────────────────────────────
 * Diese Ebene zeichnet, was da ist. Was FEHLT — eine Autobahn, die nicht
 * antwortete; Meldungen ohne Ort — steht im Store und wird von
 * `VerkehrHinweis` angezeigt. Eine Karte mit drei fehlenden Baustellen sieht
 * aus wie eine mit null Baustellen, und dieser Unterschied entscheidet, ob
 * man in eine Sperrung fährt.
 */

import { useEffect, useMemo } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useMapStore } from '../state/mapStore.js';
import { runWhenStyleReady } from '../map/styleReady.js';
import { useRoutingStore, selectActiveRoute } from '../routing/store.js';
import { autobahnenAusRoute } from './autobahnenAusRoute.js';
import { verkehrGeoJson } from './verkehrGeoJson.js';
import { useVerkehrStore } from './verkehrStore.js';

export const VERKEHR_SOURCE_ID = 'yapaja-verkehr';
export const VERKEHR_LAYER_ID = 'yapaja-verkehr-marken';

const LEER = { type: 'FeatureCollection' as const, features: [] };

interface GeoJSONQuelle {
  setData(data: unknown): void;
}

export default function VerkehrLayer(): null {
  const map = useMapStore((state) => state.map);
  const route = useRoutingStore(selectActiveRoute);
  const meldungen = useVerkehrStore((s) => s.meldungen);
  const abrufen = useVerkehrStore((s) => s.abrufen);

  /**
   * Die Autobahnen der Route, als STABILE Zeichenkette.
   *
   * Als Liste wäre sie bei jedem Durchlauf ein neues Objekt, und der Effekt
   * unten liefe bei jeder Positionsmeldung erneut — also im Sekundentakt nach
   * draußen. Die Zeichenkette ändert sich nur, wenn sich die Autobahnen
   * wirklich ändern.
   */
  const autobahnen = useMemo(
    () => autobahnenAusRoute(route?.maneuvers ?? []).join(','),
    [route?.maneuvers],
  );

  // Abrufen — nur bei einer Änderung der Strecke, nie bei jeder Position.
  useEffect(() => {
    if (autobahnen.length === 0) return;
    void abrufen(autobahnen.split(','));
  }, [autobahnen, abrufen]);

  // Quelle und Ebene anlegen, sobald der Stil sie annimmt.
  useEffect(() => {
    if (!map) return;

    const setup = (): void => {
      if (map.getSource(VERKEHR_SOURCE_ID)) return; // schon da

      map.addSource(VERKEHR_SOURCE_ID, { type: 'geojson', data: LEER });
      map.addLayer({
        id: VERKEHR_LAYER_ID,
        type: 'symbol',
        source: VERKEHR_SOURCE_ID,
        layout: {
          'icon-image': ['get', 'symbol'],
          // Die Marke ist 18 Bildpunkte gross gezeichnet. Nicht skalieren:
          // vergroessert wird sie weich, verkleinert unleserlich.
          'icon-size': 1,
          // ─── SPERRUNGEN GEWINNEN GEGEN BAUSTELLEN ────────────────────
          // MapLibre laesst bei Ueberschneidung das Symbol mit dem
          // KLEINEREN Sortierschluessel stehen. Eine Sperrung ist die
          // wichtigere Nachricht: eine Baustelle kostet Zeit, eine Sperrung
          // die ganze Strecke.
          'symbol-sort-key': ['case', ['==', ['get', 'art'], 'sperrung'], 0, 1],
          // Nicht zusammen mit der Karte drehen: im Fahrmodus steht die
          // Karte schraeg, und eine gekippte Marke ist schlechter zu
          // erkennen als eine aufrechte.
          'icon-rotation-alignment': 'viewport',
          'icon-pitch-alignment': 'viewport',
          // Lieber ueberlappen als verschwinden. Eine Baustelle, die wegen
          // einer anderen ausgeblendet wird, ist eine Baustelle, von der
          // niemand erfaehrt.
          'icon-allow-overlap': true,
        },
      });
    };

    return runWhenStyleReady(map, setup);
  }, [map]);

  // Die Punkte hineinschreiben.
  useEffect(() => {
    if (!map) return;
    const quelle = map.getSource(VERKEHR_SOURCE_ID) as unknown as GeoJSONQuelle | undefined;
    if (!quelle) return;
    quelle.setData(verkehrGeoJson(meldungen).geojson);
  }, [map, meldungen]);

  return null;
}

/** Nur fuer Tests: der Typ, den die Ebene von der Karte braucht. */
export type VerkehrKarte = Pick<MapLibreMap, 'getSource' | 'addSource' | 'addLayer'>;
