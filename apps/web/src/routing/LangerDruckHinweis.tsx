/**
 * „Ziel setzen: lange drücken" — der Satz, den ein verworfener Tipper sagt.
 *
 * ─── WARUM ES DAS GEBEN MUSS ────────────────────────────────────────────────
 * Seit 0.17.1 setzt ein kurzer Tipper auf die Karte kein Ziel mehr. Das war
 * gewünscht („Oftmals passiert das wenn man auf der Karte sucht, dass ein
 * neues Ziel gewählt wird"), und es ist richtig.
 *
 * Ohne diesen Hinweis wäre es trotzdem ein Rückschritt. Wer die App kennt,
 * tippt — und bekommt ab jetzt gar keine Antwort. Nichts passiert, nichts
 * erklärt sich, und die naheliegende Deutung ist „kaputt", nicht „anders zu
 * bedienen". Genau diese Sorte stiller Sackgasse zieht sich durch die halbe
 * Fehlergeschichte dieses Projekts: eine Antwort, die es gibt, die aber von
 * dort aus, wo jemand hinsieht, nicht zu erreichen ist.
 *
 * ─── WARUM ER VON ALLEIN GEHT ───────────────────────────────────────────────
 * Weil er über der Karte liegt, auf der man gerade sucht. Ein Hinweis mit
 * Schließen-Kreuz wäre ein zweites Ziel, das man im fahrenden Fahrzeug
 * treffen müsste, nur um weiterzuarbeiten.
 */

import React, { useEffect, useState } from 'react';
import { useRoutingStore } from './store.js';

export default function LangerDruckHinweis(): React.ReactElement | null {
  const bis = useRoutingStore((s) => s.langerDruckHinweisBis);
  const [jetzt, setJetzt] = useState(() => Date.now());

  useEffect(() => {
    if (bis === null) return;
    const verbleibend = bis - Date.now();
    if (verbleibend <= 0) {
      setJetzt(Date.now());
      return;
    }
    // ─── EIN ZEITGEBER, NICHT EIN TAKT ────────────────────────────────────
    // Der Hinweis muss genau einmal verschwinden. Ein Intervall, das jede
    // Sekunde nachsieht, würde die Karte während seiner ganzen Standzeit
    // ohne Not neu zeichnen -- auf einem Tablet im Fahrerhaus ist das
    // Rechenzeit, die der Kartendarstellung fehlt.
    const t = setTimeout(() => setJetzt(Date.now()), verbleibend);
    return () => clearTimeout(t);
  }, [bis]);

  if (bis === null || bis <= jetzt) return null;

  return (
    <div
      // `pointer-events-none`: der Hinweis darf den nächsten Versuch nicht
      // abfangen. Wer ihn liest und sofort lange drückt, drückt womöglich
      // genau dorthin, wo er steht.
      className="pointer-events-none fixed inset-x-0 top-20 z-20 flex justify-center px-4"
      // `status` und nicht `alert`: es ist eine Auskunft, keine Warnung.
      // Ein `alert` unterbricht Screenreader mitten im Satz.
      role="status"
      data-testid="langer-druck-hinweis"
    >
      <div className="rounded-full bg-slate-900/85 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-100/90 dark:text-slate-900">
        Ziel setzen: lange auf die Karte drücken
      </div>
    </div>
  );
}
