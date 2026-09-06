/**
 * Die blaue Linie nach einem Neuladen zurueckholen.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Wenn ich auf ein anderes HA Menü wechsle und dann wieder zurück zu Yapaia
 * ist alles wieder da und ich werde gefragt ob ich die Navigation fortsetzen
 * möchte. Bei Bestätigung wird weiter navigiert aber die blaue Streckenlinie
 * fehlt jetzt."
 *
 * ─── WARUM SIE FEHLT ────────────────────────────────────────────────────────
 * Gezeichnet wird die Linie aus dem Routen-Speicher DES BROWSERS
 * (`RouteLayer` liest `routes` + `activeRouteId`). Der lebt nur im
 * Arbeitsspeicher der Seite. Ein Wechsel des Home-Assistant-Menues laedt die
 * Seite neu -- danach ist er leer.
 *
 * Die FAHRT dagegen liegt im Core und laeuft weiter. Genau deshalb erscheint
 * die Rueckfrage „fortsetzen?" und die Ansagen kommen weiter: alles ist da,
 * nur die Linie nicht. Das ist wieder dieselbe Sorte Luecke wie schon
 * mehrfach -- die Daten sind vorhanden, es holt sie nur niemand.
 *
 * ─── WAS HIER PASSIERT ──────────────────────────────────────────────────────
 * Laeuft eine Fahrt und kennt der Browser die zugehoerige Route nicht, wird
 * sie beim Core erfragt und in den Speicher gelegt. Danach zeichnet
 * `RouteLayer` sie wie immer.
 *
 * Gefragt wird ueber `GET /navigation/state` -- dort liegt die LAUFENDE Route
 * ohnehin im Speicher des Dienstes. Der erste Entwurf ging ueber
 * `GET /routes/:id`, also den Routen-Zwischenspeicher; fuer eine Route, die
 * dort nie lag (etwa direkt an `navigation/start` uebergeben), gab das einen
 * 404 -- und damit einen Fehler im Browser-Protokoll fuer einen voellig
 * normalen Fall. Der Playwright-Lauf hat das gefunden.
 *
 * ─── WAS ES NICHT UEBERSCHREIBT ─────────────────────────────────────────────
 * Kennt der Browser die Route bereits, passiert nichts. Und ein Fehlschlag
 * beim Nachschlagen bleibt folgenlos: eine fehlende Linie ist aergerlich,
 * eine Fehlermeldung ueber der laufenden Navigation waere schlimmer.
 */

import { useEffect, useRef } from 'react';
import { useNavStore } from '../drive/navStore.js';
import { isDriveActive } from '../drive/driveActive.js';
import { useRoutingStore } from './store.js';
import { getNavigationState } from '../drive/client.js';

export default function RouteRestorer(): null {
  const navState = useNavStore((state) => state.navState);
  const routeId = navState?.route_id ?? null;
  const active = isDriveActive(navState?.status);

  // Woran gerade gearbeitet wird -- damit nicht bei jeder Positionsmeldung
  // (1 Hz) eine weitere Anfrage losgeht, solange die erste laeuft.
  const laufendFuer = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !routeId) return;

    const store = useRoutingStore.getState();
    if (store.routes.some((route) => route.id === routeId)) return;
    if (laufendFuer.current === routeId) return;

    laufendFuer.current = routeId;
    let abgebrochen = false;

    void getNavigationState()
      .then(({ activeRoute: route }) => {
        if (abgebrochen || !route || route.id !== routeId) return;
        // Erneut nachsehen: waehrend der Anfrage kann die Route auf dem
        // normalen Weg eingetroffen sein (etwa durch eine Neuberechnung).
        const jetzt = useRoutingStore.getState();
        if (jetzt.routes.some((r) => r.id === route.id)) return;
        useRoutingStore.setState({ routes: [route], activeRouteId: route.id });
      })
      .catch(() => {
        // Folgenlos -- siehe Kopfkommentar.
      })
      .finally(() => {
        if (laufendFuer.current === routeId) laufendFuer.current = null;
      });

    return () => {
      abgebrochen = true;
    };
  }, [active, routeId]);

  return null;
}
