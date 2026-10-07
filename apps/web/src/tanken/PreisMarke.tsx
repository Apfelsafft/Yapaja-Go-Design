/**
 * Der Preis an einem Tankstellen-Treffer (0.42.0) -- siehe `preise.ts`.
 *
 * `useSpritpreise` holt die Preise für die übergebenen Punkte, sobald sich
 * die Liste ändert; `PreisMarke` zeigt den passenden zur Spritsorte des
 * aktiven Profils. Ohne Preis (aus, kein Netz, keine Zuordnung, Sorte ohne
 * Tankerkönig-Preis) zeigt sie nichts.
 */
import React, { useEffect, useState } from 'react';
import { useProfileStore } from '../profiles/store.js';
import { FRISCHE_KLASSE, FRISCHE_TEXT, frische, preiseFuer, preiseZuPunkten, preisText, type Punkt, type Zuordnung } from './preise.js';

export function useSpritpreise(punkte: readonly Punkt[]): Array<Zuordnung | null> {
  const [preise, setPreise] = useState<Array<Zuordnung | null>>([]);
  const schluessel = punkte.map((p) => `${p.lat},${p.lon}`).join(';');

  useEffect(() => {
    setPreise([]);
    if (punkte.length === 0) return undefined;
    let aktuell = true;
    void preiseZuPunkten(punkte).then((z) => {
      if (aktuell) setPreise(z);
    });
    return () => {
      aktuell = false;
    };
    // `schluessel` steht für `punkte`: ein neues Array mit gleichem Inhalt
    // soll nicht erneut fragen.
  }, [schluessel]);

  return preise;
}

/** Lässt die Farbe altern, ohne neu zu fragen. */
function useMinutenTakt(): number {
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setJetzt(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return jetzt;
}

export default function PreisMarke({
  zuordnung,
  testId,
}: {
  zuordnung: Zuordnung | null | undefined;
  testId: string;
}): React.ReactElement | null {
  const sorte = useProfileStore((s) => s.activeProfile?.fuel_type ?? null);
  const jetzt = useMinutenTakt();
  if (!zuordnung) return null;
  const angaben = preiseFuer(zuordnung.station, sorte);
  if (angaben.length === 0) return null;
  const f = frische(zuordnung.abgerufen, zuordnung.station.offen, jetzt);
  const text = angaben.map((a) => `${a.sorte} ${preisText(a.euro)}`).join(' · ');
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${FRISCHE_KLASSE[f]}`}
      title={`${FRISCHE_TEXT[f]} (Tankerkönig)`}
      aria-label={`${text.replace(/·/g, ',')} Euro, ${FRISCHE_TEXT[f]}`}
      data-testid={testId}
      data-frische={f}
    >
      {text} €
    </span>
  );
}
