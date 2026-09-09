/**
 * Der Fahrzustand fuer die Dashboard-Kachel -- ohne jede Bedienoberflaeche.
 *
 * ─── WARUM DIE KACHEL DIE ROUTE NICHT ZEIGTE ────────────────────────────────
 * Gemeldet, mit Bildschirmfoto: die Kachel „Karte mit Route" zeigte die Karte
 * und keine Route, waehrend im Add-on selbst die blaue Linie und die laufende
 * Fahrt zu sehen waren.
 *
 * Die Linie zeichnet `RouteLayer` aus dem Routen-Speicher des Browsers, und
 * gefuellt wird der nach einem frischen Start von `RouteRestorer` -- aber nur,
 * wenn der Browser weiss, DASS gerade gefahren wird. Dieses Wissen kommt aus
 * `nav/state` ueber die WebSocket-Verbindung, und die baut in der Anwendung
 * `DriveOverlay` auf. Die Kachel hat aus gutem Grund kein `DriveOverlay`
 * (dort gehoert keine Fahrbedienung hin) -- und damit auch nie einen
 * Fahrzustand. `RouteRestorer` blieb also stumm, und die Route fehlte.
 *
 * Wieder dieselbe Sorte Luecke wie schon mehrfach: die Daten sind vorhanden,
 * es holt sie nur niemand.
 *
 * ─── WAS DIESE DATEI TUT, UND WAS NICHT ─────────────────────────────────────
 * Sie baut genau die Verbindung auf, sonst nichts: kein Manoeverpanel, keine
 * Ansagen, keine Fortsetzen-Frage, keine Knoepfe. Die Kachel bleibt eine
 * Anzeige. Was sie dadurch gewinnt, ist die Route -- und ein Fahrzustand, der
 * mit der Anwendung uebereinstimmt.
 *
 * ─── UND DER AUSSCHNITT STIMMT DAMIT AUCH ───────────────────────────────────
 * Auf demselben Bildschirmfoto stand die Kachel auf dem ganzen Kartengebiet:
 * Deutschland mit einem Punkt darin. Hier stand deshalb kurzzeitig ein
 * ausdruecklicher `applyAutoZoomNow()`. Nachgemessen war er wirkungslos --
 * die Verfolgung zieht die Zoomstufe seit 0.6.8 in derselben Kamerafahrt mit,
 * sobald ein Fahrzustand da ist. Genau der fehlte. Der Aufruf ist deshalb
 * wieder raus: eine Zeile, die nichts tut, sieht aus wie der Grund, warum
 * etwas funktioniert -- und beim naechsten Fehler sucht man an ihr.
 * (Gegenprobe: ohne diese Datei bleibt die Kachel auf Zoomstufe 6 stehen;
 * `nav-control.spec.ts` haelt das fest.)
 */

import { useEffect } from 'react';
import { navWSManager } from '../drive/navStore.js';

export default function NavFeed(): null {
  useEffect(() => {
    void navWSManager.connect();
    return () => navWSManager.disconnect();
  }, []);
  return null;
}
