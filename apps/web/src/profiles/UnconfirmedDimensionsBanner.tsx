/**
 * „Diese Masse hat nie jemand bestaetigt."
 *
 * ─── WOZU ───────────────────────────────────────────────────────────────────
 * Beim ersten Start entsteht ein Profil „Camper" mit 3,00 m Hoehe. Diese Zahl
 * ist GERATEN -- die Anwendung kann das Fahrzeug nicht kennen. Sie ging aber
 * ununterscheidbar von einer gemessenen Zahl als `height` an Valhalla, und der
 * Weg dorthin war offen: der Fahrzeug-Schritt des Assistenten ist
 * ueberspringbar, und freigeschaltet wird die Navigation nur vom
 * Haftungshinweis. Bei einem 3,20-m-Wohnmobil plant die Route dann mit 3,00 m
 * -- 20 cm in die gefaehrliche Richtung, und auffallen wuerde es unter einer
 * Bruecke.
 *
 * ─── WARUM DIE ZAHLEN IM HINWEIS STEHEN ─────────────────────────────────────
 * Eine allgemeine Warnung („bitte Profil pruefen") wird weggeklickt. „3,00 m
 * hoch" ist bei einem 3,20-m-Fahrzeug sofort als falsch zu erkennen. Der
 * Hinweis nennt deshalb die Masse, mit denen wirklich geroutet wird.
 *
 * ─── WARUM DIALOG UND NICHT BAND ────────────────────────────────────────────
 * Zuerst war das ein Band am oberen Rand. Die Playwright-Suite hat den Fehler
 * gefunden, bevor er auf ein Geraet kam:
 *
 *     <div data-testid="unconfirmed-dimensions-banner"> subtree intercepts
 *     pointer events
 *
 * Es lag ueber Zoom-Reglern und Suchleiste -- und zwar SOLANGE, bis jemand
 * antwortet. Ein Hinweis, der die Bedienung dauerhaft lahmlegt, ist kein
 * Hinweis, sondern ein Defekt.
 *
 * Als Dialog wird er einmal beantwortet und ist dann fuer immer weg. Das ist
 * dieselbe Form, die der Haftungshinweis im Assistenten schon benutzt -- und
 * dieselbe Art Frage.
 *
 * ─── WARUM ER WAEHREND DER FAHRT SCHWEIGT ───────────────────────────────────
 * Ein Dialog, der sich waehrend einer laufenden Navigation ueber die Karte
 * legt, ist im Fahrzeug gefaehrlicher als die Frage, die er stellt. Wer noch
 * nicht faehrt, bekommt ihn ohnehin vor dem Losfahren zu sehen -- er blockiert
 * ja genau bis zur Antwort.
 */

import React, { useCallback, useState } from 'react';
import { useNavState } from '../drive/navStore.js';
import { isDriveActive } from '../drive/ManeuverPanel.js';
import { useOnboardingStore, selectShouldShowWizard } from '../onboarding/store.js';
import { useProfileStore } from './store.js';
import { formatDimensions, needsDimensionConfirmation } from './unconfirmedDimensions.js';

export interface UnconfirmedDimensionsBannerProps {
  /** Oeffnet die Fahrzeug-Einstellungen. Optional -- ohne sie entfaellt der
   *  „Masse aendern"-Knopf, der Hinweis bleibt aber vollstaendig nutzbar. */
  onEdit?: () => void;
}

export default function UnconfirmedDimensionsBanner({
  onEdit,
}: UnconfirmedDimensionsBannerProps = {}): React.ReactElement | null {
  const activeProfile = useProfileStore((state) => state.activeProfile);
  // Solange der Assistent laeuft, schweigt der Hinweis: dort gibt es den
  // Fahrzeug-Schritt, und beide sind Vollbild-Overlays mit `z-50` -- das
  // spaeter montierte laege sonst UEBER dem Assistenten und verdeckte genau
  // das Formular, das die Masse setzt.
  const wizardVisible = useOnboardingStore(selectShouldShowWizard);
  const navState = useNavState();
  const confirmDimensions = useProfileStore((state) => state.confirmDimensions);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    if (!activeProfile) return;
    setIsBusy(true);
    setError(null);
    try {
      await confirmDimensions(activeProfile.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bestätigen fehlgeschlagen.');
    } finally {
      setIsBusy(false);
    }
  }, [activeProfile, confirmDimensions]);

  if (wizardVisible) return null;
  if (isDriveActive(navState?.status)) return null;
  if (!needsDimensionConfirmation(activeProfile) || !activeProfile) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unconfirmed-dimensions-title"
    >
      <div
        data-testid="unconfirmed-dimensions-banner"
        className="max-w-md rounded-lg border-t-4 border-amber-500 bg-amber-50 px-5 py-4 text-amber-950 shadow-xl dark:bg-slate-800 dark:text-amber-50"
      >
        <p id="unconfirmed-dimensions-title" className="text-lg font-semibold">
          Stimmen die Maße deines Fahrzeugs?
        </p>
        <p className="mt-1 text-sm">
          Routen werden gerade für{' '}
          <span data-testid="unconfirmed-dimensions-values" className="font-mono font-semibold">
            {formatDimensions(activeProfile)}
          </span>{' '}
          geplant. Diese Werte sind eine Voreinstellung — sie wurden nie bestätigt. Sind sie zu
          klein, führt die Route unter zu niedrigen Brücken hindurch.
        </p>
        {error && (
          <p className="mt-1 text-sm font-semibold" data-testid="unconfirmed-dimensions-error">
            {error}
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            data-testid="confirm-dimensions-button"
            onClick={handleConfirm}
            disabled={isBusy}
            className="rounded bg-amber-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            Maße stimmen
          </button>
          {onEdit && (
            <button
              type="button"
              data-testid="edit-dimensions-button"
              onClick={onEdit}
              disabled={isBusy}
              className="rounded border border-amber-700 px-4 py-2 font-semibold disabled:opacity-60"
            >
              Maße ändern
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
