/**
 * Holt die Tonfreigabe beim ersten Antippen — einmal, für die ganze App.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Gemeldet: „keine Ansagen mehr über Audio."
 *
 * Browser geben Ton erst frei, nachdem der Mensch etwas angetippt hat. Für
 * eine Navigation ist das genau verkehrt herum: die Ansage kommt, wenn 200 m
 * bis zur Abbiegung übrig sind, nicht wenn jemand tippt. Wer die Seite lädt,
 * das Ziel per Favorit startet und danach die Hände ans Lenkrad legt, fährt
 * sonst stumm — und nichts auf dem Bildschirm sagt, warum.
 *
 * Die Begründung im Einzelnen steht in `tts.ts` bei `unlockAudio`.
 *
 * ─── WARUM EIN EIGENES BAUTEIL UND KEIN AUFRUF IRGENDWO ─────────────────────
 * Weil es GENAU EINMAL passieren soll, unabhängig davon, welcher Knopf zuerst
 * gedrückt wird, und weil das Aufräumen dazugehört. Ein `unlockAudio()` in
 * jeden Klickpfad zu streuen wäre dieselbe Regel an einem Dutzend Stellen —
 * von denen eine irgendwann vergessen wird.
 *
 * `pointerdown` statt `click`: es feuert früher und auch dann, wenn die Geste
 * am Ende ein Wischen wird. Beide zählen für den Browser als Nutzeraktion.
 */

import { useEffect } from 'react';
import { unlockAudio } from './tts.js';

export default function AudioUnlock(): null {
  useEffect(() => {
    const holen = (): void => {
      unlockAudio();
      entfernen();
    };
    const entfernen = (): void => {
      window.removeEventListener('pointerdown', holen);
      window.removeEventListener('keydown', holen);
    };
    // `keydown` dazu, damit auch eine Tastaturbedienung freischaltet.
    window.addEventListener('pointerdown', holen);
    window.addEventListener('keydown', holen);
    return entfernen;
  }, []);

  return null;
}
