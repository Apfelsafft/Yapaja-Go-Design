/**
 * Die Kopfzeile — EIN Layout statt vier unabhängiger `fixed`-Elemente.
 *
 * ─── WARUM ES DIESE DATEI GIBT ──────────────────────────────────────────────
 * Am oberen Rand saßen bisher vier Dinge, jedes für sich absolut positioniert
 * und keines von der Existenz der anderen wissend:
 *
 *   „Yapaja Go"      `absolute top-0 left-0`            (App.tsx, kein z-index)
 *   Fahrzeugprofil   `fixed top-4 left-44 z-10`         (ProfilesPanel)
 *   Suchleiste       `fixed top-4 left-1/2 … w-[min(92vw,26rem)] z-20`
 *   GPS-Warnung      `fixed top-4 left-4 right-4`       (kein z-index)
 *
 * Das musste sich überlagern, und es hat sich überlagert — dreimal, mit
 * jeweils demselben Ergebnis: ein Bedienelement ist da, aber unerreichbar.
 * Erst verdeckten Titel und Profil-Chip die GPS-Warnung (0.3.1). Dann, auf
 * einem schmaleren Fenster, wuchs die Suchleiste über ihre 92 vw nach links
 * und verschluckte den Profil-Chip — der Betreiber fragte: „Und ich sehe
 * gerade nicht mehr wo ich die Fahrzeug Profile eingeben kann?"
 *
 * Beim ersten Mal habe ich das Banner verschoben. Das war eine Reparatur an
 * einem Symptom: solange vier Elemente unabhängig um dieselbe Zeile
 * konkurrieren, ist die nächste Überlagerung nur eine Fenstergröße entfernt.
 *
 * ─── DIE REGEL ──────────────────────────────────────────────────────────────
 * Eine Zeile, ein Flex-Container. Marke und Profil-Chip nehmen ihre
 * natürliche Breite, die Suche bekommt den Rest (`flex-1 min-w-0`) und
 * SCHRUMPFT, statt sich über die anderen zu legen. Überlagerung ist damit
 * nicht mehr verhindert, sondern unmöglich — das ist der Unterschied.
 *
 * `pointer-events-none` auf dem Container, `auto` auf den Kindern: die Zeile
 * spannt über die volle Breite, darf aber keine Klicks auf die Karte
 * abfangen, die neben den Bedienelementen landen.
 *
 * Der rechte Rand bleibt frei: dort sitzen MapLibres Zoom-Bedienelemente und
 * die Panel-Knöpfe (🗺️ 🧩 🩺). Deshalb `pr-16` statt symmetrischer Polsterung.
 */

import React from 'react';
import ProfilesPanel from '../profiles/ProfilesPanel.js';
import SearchBar from '../search/SearchBar.js';

export default function TopBar(): React.ReactElement {
  return (
    // `<header>` und nicht `<div>`: das ist die Kopfzeile der Anwendung, also
    // ein Landmark. Beim ersten Umbau stand hier ein `div` -- `pwa.spec.ts`
    // fiel darueber, und zwar zu Recht: die Pruefung „die Huelle ist
    // gestartet" haengt an genau diesem Landmark, und Screenreader auch.
    <header
      className="fixed top-0 left-0 right-0 z-20 flex items-start gap-2 p-3 pr-16 pointer-events-none"
      data-testid="top-bar"
    >
      <h1 className="flex-shrink-0 pointer-events-auto bg-white/90 dark:bg-slate-900/90 rounded px-3 py-1 text-lg font-bold text-slate-900 dark:text-white shadow-md">
        Yapaja Go
      </h1>
      <ProfilesPanel />
      <SearchBar />
    </header>
  );
}
