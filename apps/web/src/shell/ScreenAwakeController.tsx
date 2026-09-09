/**
 * Haengt die Zustandsmaschine aus `screenAwake.ts` an den echten Browser.
 *
 * Zeichnet nichts. Legt ein 2x2 Bildpunkte grosses, stummes, endlos laufendes
 * Video an -- den Rueckfall fuer alle Faelle ohne `navigator.wakeLock`, und
 * das ist ueber einfaches HTTP JEDER Fall (siehe `screenAwake.ts`).
 *
 * ─── WARUM DAS VIDEO IM DOKUMENT HAENGT ─────────────────────────────────────
 * Ein Video, das nirgends steht, spielen manche WebKit-Fassungen nicht ab. Es
 * haengt deshalb wirklich in der Seite -- 2 Bildpunkte gross, fast
 * durchsichtig, hinter allem, nicht anklickbar und fuer Vorleseprogramme
 * unsichtbar.
 *
 * ─── WARUM ZUERST WEBM, DANN MP4 ────────────────────────────────────────────
 * Safari kann kein WebM garantiert, Chromium nicht in jeder Fassung H.264.
 * Der Browser nimmt die erste Quelle, die er versteht; mit beiden ist keiner
 * ausgeschlossen. (Die Reihenfolge ist auch der Grund, warum die
 * Browser-Pruefung ueberhaupt etwas sieht: die mitgelieferte Chromium-Fassung
 * spielt das WebM.)
 */

import { useEffect } from 'react';
import { ScreenAwake, type VideoLike, type WakeLockLike, type Zustand } from './screenAwake.js';

/** Die beiden Fassungen des Wachhalte-Videos, in der Reihenfolge der Wahl. */
const QUELLEN: ReadonlyArray<{ pfad: string; typ: string }> = [
  { pfad: 'media/awake.webm', typ: 'video/webm' },
  { pfad: 'media/awake.mp4', typ: 'video/mp4' },
];

/** Sichtbar genug fuer WebKit, unsichtbar genug fuer den Betrachter. */
const VIDEO_STIL =
  'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;border:0';

export function videoAnlegen(dokument: Document): HTMLVideoElement {
  const video = dokument.createElement('video');
  // `muted` doppelt: die Eigenschaft fuer den Abspieler, das Attribut fuer
  // WebKits Pruefung „darf das ohne Geste laufen?" -- die schaut aufs Attribut.
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute('muted', '');
  video.loop = true;
  video.setAttribute('loop', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('disablepictureinpicture', '');
  video.setAttribute('aria-hidden', 'true');
  video.tabIndex = -1;
  video.style.cssText = VIDEO_STIL;

  const basis = import.meta.env.BASE_URL;
  for (const { pfad, typ } of QUELLEN) {
    const quelle = dokument.createElement('source');
    quelle.src = `${basis}${pfad}`;
    quelle.type = typ;
    video.appendChild(quelle);
  }
  return video;
}

export default function ScreenAwakeController(): null {
  useEffect(() => {
    const video = videoAnlegen(document);
    document.body.appendChild(video);

    const wach = new ScreenAwake({
      wakeLock: (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock ?? null,
      video: video as VideoLike,
      sichtbar: () => document.visibilityState !== 'hidden',
    });

    const sichtbarkeit = (): void => void wach.sichtbarkeitGeaendert();
    const geste = (): void => void wach.geste();

    document.addEventListener('visibilitychange', sichtbarkeit);
    window.addEventListener('pointerdown', geste, { passive: true });
    window.addEventListener('keydown', geste, { passive: true });
    window.__yapaiaScreenAwake = () => wach.zustand();

    void wach.an();

    return () => {
      document.removeEventListener('visibilitychange', sichtbarkeit);
      window.removeEventListener('pointerdown', geste);
      window.removeEventListener('keydown', geste);
      delete window.__yapaiaScreenAwake;
      void wach.aus();
      video.remove();
    };
  }, []);

  return null;
}

declare global {
  interface Window {
    /** Debug/E2E: womit der Bildschirm gerade wachgehalten wird. */
    __yapaiaScreenAwake?: () => Zustand;
  }
}
