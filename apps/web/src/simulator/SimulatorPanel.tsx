/**
 * Der Testfahrer in der Oberflaeche.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Bitte fuege einen gps Simulator ein, der die gewaehlte route dann zum
 * test abfaehrt. Die jeweilige fahr Geschwindigkeit sollte der entsprechenden
 * Hoechstgeschwindigkeit entsprechen. Und es sollte eine Art fast forward
 * geben um die benoetigte Zeit zu verkuerzen. (2x, 4x, 8x, 16x, 32x und
 * zurueck) eventuell als schieberegler."
 *
 * ─── WARUM DER KNOPF NICHT IMMER DA IST ─────────────────────────────────────
 * Der Simulator kann beliebige Positionen einspeisen und verdraengt dabei den
 * echten Empfaenger. Im Add-on ist er deshalb gesperrt, bis jemand ihn in der
 * Add-on-Konfiguration ausdruecklich freischaltet. Solange er gesperrt ist,
 * erscheint dieser Knopf gar nicht erst -- ein Knopf, der immer scheitert,
 * ist schlimmer als keiner.
 *
 * Die Sperre wird EINMAL beim Start erfragt (`GET /simulator/status`, 403 =
 * gesperrt). Das ist auch der Grund, warum der Status hier nicht ueber den
 * Ereignisstrom kommt: es gibt keinen, und fuer eine Testhilfe lohnt kein
 * neuer Kanal.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRoutingStore } from '../routing/store.js';
import { TOP_RIGHT_INSET_PX, topRightSlotPx } from '../shell/mapControlLayout.js';
import {
  fetchSimulatorStatus,
  pauseSimulator,
  playRoute,
  resumeSimulator,
  setSimulatorSpeed,
  stopSimulator,
  SimulatorDisabledError,
  type SimulatorStatus,
} from './client.js';
import {
  SPEED_STEPS,
  controlAvailability,
  formatSimSeconds,
  playbackProgress,
  speedStepIndex,
  speedStepLabel,
} from './controls.js';

/** Wie oft der Fortschritt nachgefragt wird, waehrend etwas laeuft. */
const POLL_MS = 1000;

export default function SimulatorPanel(): React.ReactElement | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<SimulatorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [speedFactor, setSpeedFactor] = useState(1);

  const activeRouteId = useRoutingStore((state) => state.activeRouteId);

  // Einmal beim Start: gibt es den Simulator in dieser Installation?
  useEffect(() => {
    let cancelled = false;
    void fetchSimulatorStatus()
      .then((s) => {
        if (cancelled) return;
        setAvailable(true);
        setStatus(s);
        setSpeedFactor(s.speedFactor);
      })
      .catch((err) => {
        if (cancelled) return;
        // Gesperrt heisst „nicht anbieten". Jeder ANDERE Fehler heisst
        // „Server gerade nicht erreichbar" -- das ist kein Grund, die
        // Funktion dauerhaft zu verstecken.
        setAvailable(!(err instanceof SimulatorDisabledError));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const running = status?.state === 'playing';

  // Fortschritt mitlaufen lassen, solange etwas faehrt und das Panel offen
  // ist. Zu: kein Abruf -- niemand sieht ihn.
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    if (!isOpen || !running) return;
    const timer = window.setInterval(() => {
      void fetchSimulatorStatus()
        .then(setStatus)
        .catch(() => {
          /* Ein einzelner Fehlschlag beim Nachfragen ist kein Anlass, die
             Bedienung mit einer Fehlermeldung zu ueberschreiben. */
        });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [isOpen, running]);

  const act = useCallback(async (fn: () => Promise<SimulatorStatus>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      setStatus(next);
      setSpeedFactor(next.speedFactor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Der Simulator hat nicht geantwortet.');
    } finally {
      setBusy(false);
    }
  }, []);

  const onSpeedChange = useCallback(
    (index: number) => {
      const factor = SPEED_STEPS[index] ?? 1;
      setSpeedFactor(factor); // sofort sichtbar, auch bevor der Server antwortet
      void act(() => setSimulatorSpeed(factor));
    },
    [act],
  );

  if (available !== true) return null;

  const can = controlAvailability(status, activeRouteId);
  const progress = playbackProgress(status);
  const stepIndex = speedStepIndex(speedFactor);

  return (
    <div className="fixed z-10" style={{ top: topRightSlotPx('simulator'), right: TOP_RIGHT_INSET_PX }}>
      {isOpen && (
        <div
          className="absolute top-14 right-0 mb-2 w-80 rounded-xl bg-white/95 dark:bg-slate-800/95 shadow-xl p-4 text-sm text-slate-800 dark:text-slate-100 space-y-3"
          data-testid="simulator-panel"
        >
          <h2 className="font-semibold">Testfahrt</h2>

          <p className="text-xs text-slate-600 dark:text-slate-300">
            Faehrt die geplante Route mit den jeweiligen Tempolimits ab. Die echte
            GPS-Position wird dabei ersetzt.
          </p>

          {!can.canPlay && (
            <p
              className="text-xs text-amber-700 dark:text-amber-400"
              data-testid="simulator-no-route"
            >
              Noch keine Route geplant — erst ein Ziel waehlen, dann laesst sich die
              Fahrt starten.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => activeRouteId && void act(() => playRoute(activeRouteId, speedFactor))}
              disabled={!can.canPlay || busy}
              className="px-3 py-2 rounded-md border border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50"
              data-testid="simulator-play"
            >
              ▶ Route abfahren
            </button>
            {can.canResume ? (
              <button
                type="button"
                onClick={() => void act(resumeSimulator)}
                disabled={busy}
                className="px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-xs disabled:opacity-50"
                data-testid="simulator-resume"
              >
                ▶ Weiter
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void act(pauseSimulator)}
                disabled={!can.canPause || busy}
                className="px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-xs disabled:opacity-50"
                data-testid="simulator-pause"
              >
                ⏸ Pause
              </button>
            )}
            <button
              type="button"
              onClick={() => void act(stopSimulator)}
              disabled={!can.canStop || busy}
              className="px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-xs disabled:opacity-50"
              data-testid="simulator-stop"
            >
              ⏹ Stopp
            </button>
          </div>

          <div>
            <label
              htmlFor="simulator-speed"
              className="flex items-baseline justify-between text-xs"
            >
              <span>Zeitraffer</span>
              <span className="font-semibold tabular-nums" data-testid="simulator-speed-value">
                {speedStepLabel(SPEED_STEPS[stepIndex])}
              </span>
            </label>
            <input
              id="simulator-speed"
              type="range"
              min={0}
              max={SPEED_STEPS.length - 1}
              step={1}
              value={stepIndex}
              disabled={!can.canChangeSpeed || busy}
              onChange={(e) => onSpeedChange(Number(e.target.value))}
              className="mt-1 w-full disabled:opacity-50"
              data-testid="simulator-speed"
              aria-label="Zeitraffer"
              aria-valuetext={speedStepLabel(SPEED_STEPS[stepIndex])}
            />
            <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
              {SPEED_STEPS.map((factor) => (
                <span key={factor}>{factor}×</span>
              ))}
            </div>
          </div>

          {progress !== null && (
            <div data-testid="simulator-progress" data-progress={progress.toFixed(3)}>
              <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className="h-1.5 rounded-full bg-blue-500"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-xs tabular-nums text-slate-600 dark:text-slate-300">
                {formatSimSeconds(status?.tickS)} von {formatSimSeconds(status?.totalDurationS)}{' '}
                <span className="opacity-70">(simulierte Fahrzeit)</span>
              </p>
            </div>
          )}

          {status?.trackDescription && (
            // Enthaelt, wie viele Abschnitte OHNE bekanntes Tempolimit
            // gefahren werden. Ohne diese Angabe saehe eine halb geratene
            // Fahrt genauso aus wie eine vollstaendig belegte.
            <p
              className="text-xs text-slate-500 dark:text-slate-400 break-words"
              data-testid="simulator-track"
            >
              {status.trackDescription}
            </p>
          )}

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400" data-testid="simulator-error">
              {error}
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="w-12 h-12 rounded-full bg-white/90 dark:bg-slate-800/90 shadow-lg hover:shadow-xl transition-shadow flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 text-lg"
        aria-label="Testfahrt"
        aria-expanded={isOpen}
        title="Testfahrt (GPS-Simulator)"
        data-testid="simulator-panel-toggle"
      >
        🧪
      </button>
    </div>
  );
}
