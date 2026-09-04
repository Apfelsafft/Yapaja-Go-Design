/**
 * Einbettungsseite: die Karte mit Route und eigener Position, sonst nichts.
 *
 * ─── WOFUER ─────────────────────────────────────────────────────────────────
 * Gefragt: „Die Idee des Navi in HA war ja, die Navigation oder auch nur Teile
 * davon in eigene Dashboards zu integrieren. Bspw. die Karte mit
 * eingezeichneter Route." Genau diese Seite laedt die Lovelace-Karte
 * (`yapaja_go/lovelace/yapaja-map-card.js`) in ihren Rahmen.
 *
 * ─── WARUM EINE EIGENE SEITE UND NICHT `App.tsx` MIT SCHALTER ───────────────
 * `App.tsx` bringt Suchleiste, Favoriten, Fahr-Overlay, Update-Hinweis,
 * Einrichtungsassistent und die Add-on-Buehne mit. In einer Dashboard-Kachel
 * gehoert davon nichts hin -- ein Einrichtungsassistent, der im Dashboard
 * aufpoppt, waere absurd, und Bedienknoepfe, die dort die laufende Navigation
 * umstellen, waeren eine Falle.
 *
 * Ein Schalter quer durch `App.tsx` haette ausserdem jede der 124 bestehenden
 * Browser-Pruefungen angefasst. Eine eigene Seite kostet drei Zeilen im
 * Vite-Aufbau (`rollupOptions.input`, wie `shell.html` schon eine ist) und
 * laesst die App unberuehrt.
 *
 * ─── WAS BEWUSST DRIN IST ───────────────────────────────────────────────────
 * `PositionInitializer` und `RoutingInitializer`: ohne sie zeigte die Kachel
 * eine Karte ohne Fahrzeug und ohne Route -- also genau das nicht, wofuer sie
 * da ist. `ThemeController`, damit die Kachel dem Hell/Dunkel der Karte folgt.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import MapView from '../map/MapView.js';
import PositionInitializer from '../position/PositionInitializer.js';
import RoutingInitializer from '../routing/RoutingInitializer.js';
import ThemeController from '../theme/ThemeController.js';
import '../index.css';

function EmbeddedMap(): React.ReactElement {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-white dark:bg-slate-900">
      <ThemeController />
      {/* `chrome={false}`: keine Knoepfe, keine Panels -- nur Karte. */}
      <MapView chrome={false} />
      <PositionInitializer />
      <RoutingInitializer />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <EmbeddedMap />
  </React.StrictMode>,
);
