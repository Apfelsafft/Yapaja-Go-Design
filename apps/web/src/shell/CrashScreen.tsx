/**
 * Die Fehlergrenze -- damit ein Absturz nicht als blanker Bildschirm endet.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Und das schlimmste, nach kurzer Zeit verschwindet die gesamte Anzeige und
 * man sieht nur noch einen blanken Screen. Nur die HA Menüs sind noch da, die
 * Yapaja Oberfläche ist weg."
 *
 * ─── WARUM DAS PASSIERT ─────────────────────────────────────────────────────
 * Schlaegt beim Zeichnen ein Fehler nach oben durch und faengt ihn niemand
 * auf, entfernt React 18 den GANZEN Baum. Das ist kein Fehlverhalten von
 * React, sondern seine ausdrueckliche Regel: lieber gar nichts zeigen als
 * etwas moeglicherweise Falsches. Nur gab es in dieser Anwendung nirgends
 * eine Fehlergrenze -- also wurde aus jedem Fehler ein leerer Rahmen, ohne
 * einen Hinweis, ohne einen Weg zurueck.
 *
 * Im Fahrzeug ist das die schlimmste Art zu scheitern: das Geraet ist an, die
 * Karte ist weg, und man faehrt.
 *
 * ─── WAS DIESE GRENZE NICHT IST ─────────────────────────────────────────────
 * Sie behebt keinen einzigen Fehler. Sie sorgt nur dafuer, dass ein Fehler
 * SICHTBAR wird statt still den Bildschirm zu leeren -- mit dem Text, der
 * wirklich aufgetreten ist, damit man ihn weitergeben kann. Ein Absturz, den
 * niemand beschreiben kann, laesst sich auch nicht beheben.
 *
 * ─── WARUM DIE NAVIGATION WEITERLAEUFT ──────────────────────────────────────
 * Die Fahrt liegt im Core, nicht im Browser. Ein Absturz der Oberflaeche
 * beendet sie nicht -- deshalb steht das hier ausdruecklich da. Wer im
 * Fahrzeug sitzt, soll wissen, dass die Ansagen weiterlaufen, waehrend er den
 * Knopf sucht.
 */

import React from 'react';

interface CrashScreenState {
  error: Error | null;
}

interface CrashScreenProps {
  children: React.ReactNode;
  /** Nur fuer Tests: wird zusaetzlich zum Protokoll aufgerufen. */
  onError?: (error: Error) => void;
}

export default class CrashScreen extends React.Component<CrashScreenProps, CrashScreenState> {
  constructor(props: CrashScreenProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): CrashScreenState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // In die Konsole, damit der Fehler im Protokoll des Browsers steht --
    // und mit der Komponentenspur, die React mitliefert. Ohne sie steht da
    // nur „irgendwo".
    console.error('Yapaja: Oberflaeche abgestuerzt', error, info.componentStack);
    this.props.onError?.(error);
  }

  private reload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white p-6 text-center text-slate-800 dark:bg-slate-900 dark:text-slate-100"
        data-testid="crash-screen"
      >
        <h1 className="text-lg font-semibold">Die Anzeige hat sich verabschiedet.</h1>

        <p className="max-w-md text-sm">
          {/* Das Wichtigste zuerst: die Fahrt laeuft weiter. */}
          <strong>Die Navigation läuft weiter</strong> — sie liegt im Yapaja-Dienst, nicht in
          dieser Anzeige. Ansagen kommen also weiterhin.
        </p>

        <button
          type="button"
          onClick={this.reload}
          className="min-h-[64px] min-w-[200px] rounded-xl bg-blue-600 px-6 text-base font-medium text-white shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
          data-testid="crash-reload"
        >
          Anzeige neu laden
        </button>

        <details className="max-w-md text-left text-xs text-slate-600 dark:text-slate-300">
          <summary className="cursor-pointer">Was ist passiert?</summary>
          <p className="mt-2">
            Bitte diesen Text weitergeben — ohne ihn lässt sich der Fehler nicht finden:
          </p>
          <pre
            className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-2 dark:bg-slate-800"
            data-testid="crash-message"
          >
            {error.message || String(error)}
          </pre>
        </details>
      </div>
    );
  }
}
