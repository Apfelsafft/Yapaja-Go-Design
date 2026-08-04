/**
 * Die `window`-Haken, die diese Suite im Browser anfasst -- LOKAL und
 * STRUKTURELL deklariert.
 *
 * Bewusst NICHT `apps/web/e2e/support/global.d.ts` wiederverwendet: das dort
 * importiert die echten Store-Module und zieht damit ganz `apps/web/src` in
 * das tsc-Programm dieser Suite (samt Vites `import.meta.env` und den
 * `@yapaja/*`-Alias-Pfaden) -- dieselbe Begruendung, die
 * `e2e/security/support/globals.d.ts` bereits dokumentiert.
 *
 * Die Messungen brauchen nur: die Karteninstanz (Kamera fahren, Ladezustand
 * abfragen) und den Positions-Store (Ankunftszeitpunkt einer Position im UI).
 */

interface PerfMapLike {
  loaded(): boolean;
  isStyleLoaded(): boolean;
  getCenter(): { lng: number; lat: number };
  easeTo(options: {
    center?: [number, number];
    zoom?: number;
    duration?: number;
    easing?: (t: number) => number;
  }): void;
  once(event: string, listener: () => void): void;
}

interface PerfPositionLike {
  lat: number;
  lon: number;
}

declare global {
  interface Window {
    __yapajaMapController?: {
      getMap?: () => PerfMapLike | null;
    };
    __yapajaNavStore?: {
      getState(): { navState: { route_id: string | null } | null };
      subscribe(
        listener: (state: { navState: { route_id: string | null } | null }) => void,
      ): () => void;
    };
    __yapajaPositionStore?: {
      getState(): { position: PerfPositionLike | null; isConnected: boolean };
      subscribe(listener: (state: { position: PerfPositionLike | null }) => void): () => void;
    };
    /** Von `installColdStartProbe()` gesetzt; loest mit `performance.now()` auf. */
    __perfMapInteractiveAt?: Promise<number>;
  }
}

export {};
