/**
 * „Für A3 liegen gerade keine Verkehrsdaten vor."
 *
 * ─── WOFÜR DIESER HINWEIS DA IST ────────────────────────────────────────────
 * Eine Karte ohne Baustellensymbole kann zweierlei heißen: es ist nichts
 * gemeldet, oder es konnte niemand nachsehen. Beides sieht gleich aus — und
 * für jemanden, der auf eine gesperrte Autobahn zufährt, ist das der ganze
 * Unterschied.
 *
 * Genau diese Verwechslung verfolgt dieses Projekt seit Monaten: bei den
 * Kartenregionen (leere Fläche statt „hier gibt es keine Karte"), beim
 * Routing (Route unmöglich statt „für dieses Land gibt es keinen Graphen"),
 * bei den LKW-Parkplätzen („alle brauchbar" für sechzig Einträge ohne Ort).
 * Jedes Mal war die Auskunft vorhanden und nur nicht erreichbar.
 *
 * ─── UND WARUM ER MEISTENS NICHT DA IST ─────────────────────────────────────
 * Ein Hinweis, der bei jeder Fahrt steht, wird nach drei Tagen nicht mehr
 * gelesen. `verkehrHinweisText.ts` entscheidet, wann etwas zu sagen ist; die
 * Abwägung steht dort und ist dort geprüft. Diese Datei zeigt nur an.
 */

import React, { useEffect, useState } from 'react';
import { useVerkehrStore } from './verkehrStore.js';
import { HINWEIS_SICHTBAR_MS, verkehrHinweis } from './verkehrHinweisText.js';

export default function VerkehrHinweis(): React.ReactElement | null {
  const strassen = useVerkehrStore((s) => s.strassen);
  const ohneOrt = useVerkehrStore((s) => s.ohneOrt);
  const fehler = useVerkehrStore((s) => s.fehler);

  const hinweis = verkehrHinweis({ strassen, ohneOrt, fehler });

  // ─── NUR KURZ ───────────────────────────────────────────────────────────
  // Gemeldet: „Verkehrsdaten für A5 sind etwa 17 Minuten alt" — „Die war die
  // ganze Zeit über sichtbar, für längere Zeit." Ein Hinweis, der die ganze
  // Fahrt über dasteht, ist Tapete: er verdeckt die Karte und wird nicht
  // mehr gelesen.
  //
  // Deshalb verschwindet ein `hinweis` nach `HINWEIS_SICHTBAR_MS` von selbst,
  // und jeder Hinweis — auch eine `warnung` — auf Antippen. Er kommt erst
  // wieder, wenn sich der SCHLÜSSEL ändert, also eine andere Straße betroffen
  // ist; das weiterlaufende Alter zählt nicht dazu.
  const [weg, setWeg] = useState<string | null>(null);
  const schluessel = hinweis?.schluessel ?? null;
  const vergeht = hinweis?.stufe === 'hinweis';
  useEffect(() => {
    if (schluessel === null || !vergeht || weg === schluessel) return;
    const t = setTimeout(() => setWeg(schluessel), HINWEIS_SICHTBAR_MS);
    return () => clearTimeout(t);
  }, [schluessel, vergeht, weg]);

  if (hinweis === null || weg === hinweis.schluessel) return null;

  const warnung = hinweis.stufe === 'warnung';
  return (
    <div
      // Unterhalb des Regionen-Hinweises, damit sich die beiden nicht
      // überdecken, wenn sie einmal gleichzeitig zutreffen.
      className="pointer-events-none fixed left-1/2 top-[calc(12rem+var(--kopf-mehr,0px))] z-30 w-[min(calc(var(--sicht-b,100vw)*0.92),30rem)] -translate-x-1/2"
      data-testid="verkehr-hinweis"
    >
      <div
        role="status"
        onClick={() => setWeg(hinweis.schluessel)}
        title="Antippen zum Ausblenden"
        className={
          'pointer-events-auto cursor-pointer rounded-lg px-3 py-2 text-xs shadow-lg ' +
          (warnung
            ? 'border border-amber-300 bg-amber-50/95 text-amber-900 dark:border-amber-700 dark:bg-amber-950/95 dark:text-amber-100'
            : 'border border-slate-300 bg-white/95 text-slate-700 dark:border-slate-600 dark:bg-slate-900/95 dark:text-slate-200')
        }
      >
        {hinweis.text}
      </div>
    </div>
  );
}
