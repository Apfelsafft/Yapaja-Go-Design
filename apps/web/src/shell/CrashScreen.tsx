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
  /** Die Komponentenspur von React -- sie NENNT die Stelle. */
  componentStack: string | null;
}

interface CrashScreenProps {
  children: React.ReactNode;
  /** Nur fuer Tests: wird zusaetzlich zum Protokoll aufgerufen. */
  onError?: (error: Error) => void;
}

export default class CrashScreen extends React.Component<CrashScreenProps, CrashScreenState> {
  constructor(props: CrashScreenProps) {
    super(props);
    this.state = { error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): CrashScreenState {
    // Die Spur kommt erst in `componentDidCatch` -- hier nur der Fehler.
    return { error, componentStack: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Yapaja: Oberflaeche abgestuerzt', error, info.componentStack);
    // ─── DIE SPUR GEHOERT AUF DEN BILDSCHIRM, NICHT NUR INS PROTOKOLL ────────
    // Beim ersten Absturz stand hier nur die Meldung („Maximum call stack size
    // exceeded."). Die sagt, WAS passiert ist, aber nicht WO -- und an die
    // Browser-Konsole kommt auf einem Tablet im Fahrzeug niemand heran.
    // React liefert die Komponentenspur mit; sie nennt die Stelle.
    this.setState({ componentStack: info.componentStack ?? null });
    this.props.onError?.(error);
  }

  private reload = (): void => {
    window.location.reload();
  };

  /** Alles, was zum Weitergeben taugt, in einem Stueck. */
  private report(): string {
    const { error, componentStack } = this.state;
    return [
      error?.message ?? String(error),
      error?.stack ?? '',
      componentStack ?? '',
    ]
      .filter((teil) => teil.trim().length > 0)
      .join('\n\n');
  }

  private copy = (): void => {
    // Ohne Erfolgsmeldung: der Text steht ohnehin sichtbar da, und eine
    // Zwischenablage, die im Ingress-Rahmen gesperrt ist, soll hier keine
    // Fehlermeldung ueber die Fehlermeldung legen.
    void navigator.clipboard?.writeText(this.report()).catch(() => undefined);
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

        <details className="w-full max-w-2xl text-left text-xs text-slate-600 dark:text-slate-300">
          <summary className="cursor-pointer">Was ist passiert?</summary>
          <p className="mt-2">
            Bitte diesen Text weitergeben — ohne ihn lässt sich der Fehler nicht finden:
          </p>
          <pre
            className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-2 dark:bg-slate-800"
            data-testid="crash-message"
          >
            {this.report()}
          </pre>
          <button
            type="button"
            onClick={this.copy}
            className="mt-2 min-h-[44px] rounded-lg border border-slate-300 px-4 text-xs dark:border-slate-600"
            data-testid="crash-copy"
          >
            Text kopieren
          </button>
        </details>
      </div>
    );
  }
}
