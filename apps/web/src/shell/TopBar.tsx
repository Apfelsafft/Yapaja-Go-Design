/**
 * Die Kopfzeile — EIN Layout statt vier unabhängiger `fixed`-Elemente.
 *
 * ─── WARUM ES DIESE DATEI GIBT ──────────────────────────────────────────────
 * Am oberen Rand saßen bisher vier Dinge, jedes für sich absolut positioniert
 * und keines von der Existenz der anderen wissend:
 *
 *   „Yapaia Go"      `absolute top-0 left-0`            (App.tsx, kein z-index)
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

import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ProfilesPanel from '../profiles/ProfilesPanel.js';
import SearchBar from '../search/SearchBar.js';
import PoiChips from './PoiChips.js';
import EinstellungsMenue from './EinstellungsMenue.js';
import OrtKarte from '../ort/OrtKarte.js';
import { useBedienSeite, PANEL_BREITE_PX } from './bedienSeite.js';

import { TOP_BAR_HEIGHT_PX, TOP_BAR_RIGHT_RESERVE_PX } from './mapControlLayout.js';
import { useSchmal } from './useSchmal.js';
import { useFahrtAnsicht } from '../drive/useFahrtAnsicht.js';

export default function TopBar(): React.ReactElement | null {
  const schmal = useSchmal();
  // ─── WAEHREND DER FAHRT: GAR NICHT ────────────────────────────────────────
  // Marke, Fahrzeugwahl und Suche braucht man beim Suchen und Planen. Waehrend
  // der Fahrt war die Suche ohnehin gesperrt („nur Favoriten"), und die
  // Favoriten liegen jetzt im Fahrtmenue (`drive/FahrtMenue.tsx`). Stehen
  // blieb eine Zeile, die Platz kostet und nichts anbietet.
  const fahrt = useFahrtAnsicht();
  const kopf = useRef<HTMLElement | null>(null);
  const seite = useBedienSeite();
  const [menueOffen, setMenueOffen] = useState(false);

  // ─── WIE VIEL HÖHER ALS FRÜHER ───────────────────────────────────────────
  // Die POI-Chips machen die Kopfzeile höher. Die Hinweise darunter (GPS,
  // Kartenabdeckung, Verkehr, Bord) standen auf festen Abständen, die von
  // 62 Punkten ausgingen -- sie lägen jetzt unter den Chips. `--kopf-mehr`
  // ist der Zuwachs; die Hinweise rücken um genau so viel nach unten. Ohne
  // Kopfzeile (Fahrt) ist er null.
  useLayoutEffect(() => {
    const html = document.documentElement;
    const el = kopf.current;
    if (!el) {
      html.style.setProperty('--kopf-mehr', '0px');
      return undefined;
    }
    const messen = (): void => {
      const mehr = Math.max(0, Math.round(el.getBoundingClientRect().height - TOP_BAR_HEIGHT_PX));
      html.style.setProperty('--kopf-mehr', `${mehr}px`);
    };
    messen();
    const beobachter = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(messen) : null;
    beobachter?.observe(el);
    return () => {
      beobachter?.disconnect();
      html.style.setProperty('--kopf-mehr', '0px');
    };
  }, [fahrt]);

  if (fahrt) return null;
  return (
    // `<header>` und nicht `<div>`: das ist die Kopfzeile der Anwendung, also
    // ein Landmark. Beim ersten Umbau stand hier ein `div` -- `pwa.spec.ts`
    // fiel darueber, und zwar zu Recht: die Pruefung „die Huelle ist
    // gestartet" haengt an genau diesem Landmark, und Screenreader auch.
    <header
      ref={kopf}
      className="fixed top-0 z-20 flex flex-col gap-2 p-3 pointer-events-none"
      // ─── DAS SEITENPANEL (0.23) ───────────────────────────────────────
      // Gewuenscht (Vorbild Google Maps): Menues und Suche im Drittel auf der
      // Fahrerseite, der Rest bleibt frei fuer die Karte. Auf grossen
      // Schirmen eine feste Breite (gewuenscht: „bei grossen Bildschirmen
      // eine fixe Breite"); auf schmalen die ganze Breite, wie bisher mit
      // Platz fuer Zoom und Tempolimit-Schild.
      style={
        schmal
          ? { left: 0, right: 0, paddingRight: TOP_BAR_RIGHT_RESERVE_PX }
          : { [seite]: 0, width: `min(${PANEL_BREITE_PX + 24}px, 100%)` }
      }
      data-testid="top-bar"
    >
      {/* Der Name steht seit 0.23 im ⚙-Menue (gewuenscht: „Yapaia Go kann
          in das Einstellungsmenue"). Fuer Screenreader bleibt er die
          Ueberschrift der Seite. */}
      <h1 className="sr-only">Yapaia Go</h1>
      {/* `z-10`: die Ausklappfenster der Suche (Treffer, Favoriten) liegen
          ueber der zweiten Zeile, nicht darunter. */}
      <div className="relative z-10 flex items-start gap-2">
        <button
          type="button"
          onClick={() => setMenueOffen(true)}
          aria-label="Einstellungen"
          aria-expanded={menueOffen}
          title="Einstellungen"
          className="pointer-events-auto flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white/95 text-lg shadow-md hover:bg-slate-100 dark:bg-slate-800/95 dark:hover:bg-slate-700"
          data-testid="einstellungen-toggle"
        >
          ⚙️
        </button>
        <SearchBar />
      </div>
      {/* ─── ZWEITE ZEILE: FAHRZEUG UND CHIPS ─────────────────────────────
          Das Fahrzeug stand neben der Suche und drückte sie im 380-px-Panel
          bei einem langen Profilnamen auf ein paar Bildpunkte zusammen --
          samt der Favoritenliste darunter. Die Suche bekommt die ganze
          erste Zeile; das Fahrzeug steht vor den POI-Chips. */}
      <div className="flex min-w-0 items-start gap-2">
        <ProfilesPanel />
        <div className="min-w-0 flex-1">
          <PoiChips />
        </div>
      </div>
      {/* Zustand 3: ein angetippter Ort. */}
      <OrtKarte />
      {/* Ueber ein Portal an den Wurzelkasten: innerhalb der Kopfzeile (z-20)
          laegen Hinweise mit z-30 ueber dem Menue. */}
      {menueOffen &&
        createPortal(
          <EinstellungsMenue onSchliessen={() => setMenueOffen(false)} />,
          document.getElementById('yapaia-sicht') ?? document.body,
        )}
    </header>
  );
}
