/**
 * Geolocation Hints Component (E02-T2)
 *
 * Displays W-03 hints for:
 * - Insecure context (non-HTTPS, non-localhost)
 * - Permission denied
 * - Not supported
 * - Other errors
 */

import React, { useState } from 'react';
import type { BrowserSourceState, BrowserSourceError } from './browserSource';

interface GeolocationHintsProps {
  sourceState: BrowserSourceState;
}

export default function GeolocationHints({ sourceState }: GeolocationHintsProps): React.ReactElement | null {
  const [visible, setVisible] = useState(true);

  if (sourceState.status !== 'error' || !sourceState.error || !visible) {
    return null;
  }

  const renderError = (error: BrowserSourceError): React.ReactElement => {
    switch (error) {
      case 'insecure-context':
        return (
          <div className="space-y-2">
            <p className="font-semibold">Standortzugriff nicht verfügbar (unsicherer Kontext)</p>
            <p className="text-sm">Die Browser-Geolocation-API benötigt ein sicheres Protokoll (HTTPS).</p>
            <p className="text-sm">
              Optionen:
            </p>
            <ul className="text-sm list-disc list-inside space-y-1">
              <li>Nutze HTTPS statt HTTP</li>
              <li>Nutze Home Assistant Ingress (immer HTTPS)</li>
              <li>Verwende localhost (automatische Ausnahme)</li>
              <li>Wähle stattdessen gpsd als GPS-Quelle</li>
            </ul>
          </div>
        );

      case 'permission-denied':
        return (
          <div className="space-y-2">
            <p className="font-semibold">Standortzugriff verweigert</p>
            <p className="text-sm">Die Berechtigung für Standortzugriff wurde verweigert.</p>
            <p className="text-sm">
              Empfohlene Lösungen:
            </p>
            <ul className="text-sm list-disc list-inside space-y-1">
              <li>Überprüfe die Browser-Einstellungen und erteile Berechtigung erneut</li>
              <li>Nutze stattdessen gpsd als GPS-Quelle (verbundenes USB-GPS-Gerät)</li>
              <li>Starte die App neu, nachdem du die Berechtigung erteilt hast</li>
            </ul>
          </div>
        );

      case 'not-supported':
        return (
          <div className="space-y-2">
            <p className="font-semibold">Browser-Geolocation wird nicht unterstützt</p>
            <p className="text-sm">Dieser Browser oder diese Umgebung unterstützt die Geolocation-API nicht.</p>
            <p className="text-sm">
              Verwende stattdessen gpsd als GPS-Quelle.
            </p>
          </div>
        );

      case 'position-unavailable':
      case 'timeout':
        return (
          <div className="space-y-2">
            <p className="font-semibold">GPS-Signal nicht verfügbar</p>
            <p className="text-sm">
              Das Gerät konnte eine Position nicht ermitteln. Dies kann passieren, wenn:
            </p>
            <ul className="text-sm list-disc list-inside space-y-1">
              <li>Du dich in einem Gebäude oder Tunnel befindest</li>
              <li>Das GPS-Signal schwach ist</li>
              <li>Die App keine Geolocation-Berechtigung hat</li>
            </ul>
            <p className="text-sm">
              Tipp: Verwende gpsd als GPS-Quelle für zuverlässigeres Tracking mit einem USB-GPS.
            </p>
          </div>
        );

      default:
        return (
          <div className="space-y-2">
            <p className="font-semibold">Fehler beim Abrufen der Position</p>
            <p className="text-sm">Ein unbekannter Fehler ist aufgetreten. Versuche die App neu zu laden.</p>
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 pointer-events-none">
      <div className="absolute top-4 left-4 right-4 pointer-events-auto">
        {/* `data-testid` added in E10-T1 so docs/07 §5 flow 11
            (`e2e/flow-11-permission-denied.spec.ts`) can assert this banner
            directly instead of text-matching a loose `page.locator('text=...')`.
            Purely additive: no styling or behaviour change. */}
        <div
          data-testid="geolocation-hint"
          data-geolocation-error={sourceState.error}
          className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 shadow-lg"
        >
          <div className="flex gap-3">
            <div className="flex-shrink-0 text-lg">⚠️</div>
            <div className="flex-1">
              {renderError(sourceState.error)}
            </div>
            <button
              onClick={() => setVisible(false)}
              className="flex-shrink-0 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              aria-label="Schließen"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
