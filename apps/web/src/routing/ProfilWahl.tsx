/**
 * Fahrzeug fürs Routing wählen -- im Routen-Zustand des Seitenpanels.
 *
 * Gewünscht: „Wir können unser Camper-Profil in den Einstellungen
 * konfigurieren und dann für die Navigation auswählbar machen aus der Liste
 * der Profile." Angelegt und bearbeitet wird in ⚙ → Fahrzeuge
 * (`ProfilesPanel`), gewählt hier.
 *
 * Ein Wechsel aktiviert das Profil (es gilt danach auch für die Fahrt und
 * die Tempowarnung) und rechnet eine bereits angefragte Route mit seinen
 * Abmessungen neu -- eine Route für das falsche Fahrzeug stehen zu lassen,
 * wäre die gefährlichste mögliche Antwort.
 */

import React, { useEffect, useState } from 'react';
import { useProfileStore } from '../profiles/store.js';
import { useRoutingStore } from './store.js';

export default function ProfilWahl(): React.ReactElement | null {
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfile = useProfileStore((s) => s.activeProfile);
  const fetchProfiles = useProfileStore((s) => s.fetchProfiles);
  const activateProfile = useProfileStore((s) => s.activateProfile);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (profiles.length === 0) void fetchProfiles();
  }, [profiles.length, fetchProfiles]);

  if (profiles.length === 0) return null;

  const wechsel = async (id: string): Promise<void> => {
    setFehler(null);
    try {
      await activateProfile(id);
    } catch {
      setFehler('Das Fahrzeug konnte nicht gewechselt werden.');
      return;
    }
    const routing = useRoutingStore.getState();
    if (routing.destination && (routing.routes.length > 0 || routing.status !== 'idle')) {
      void routing.requestRoute({ origin: 'current', profileId: id });
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2">
        <span aria-hidden="true">🚐</span>
        <span className="sr-only">Fahrzeug</span>
        <select
          value={activeProfile?.id ?? ''}
          onChange={(e) => void wechsel(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-700"
          data-testid="routing-profil-wahl"
        >
          {!activeProfile && <option value="">Fahrzeug wählen …</option>}
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.height_m.toFixed(2).replace('.', ',')} m · {p.weight_t.toFixed(1).replace('.', ',')} t
            </option>
          ))}
        </select>
      </label>
      {fehler && <p className="text-xs text-red-600 dark:text-red-400">{fehler}</p>}
    </div>
  );
}
