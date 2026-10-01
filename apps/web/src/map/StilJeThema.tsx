/**
 * Kartenstil je Thema: einer für Hell, einer für Dunkel.
 *
 * Gemeldet: „Es wird zwar automatisch zwischen hell und dunkel umgestellt.
 * Wenn ich aber einen anderen Kartenstil wähle, wird das überschrieben
 * (dunkles Theme mit heller Karte). Können wir den Themes hell und dunkel
 * jeweils einen Stil zuweisen?"
 *
 * Oben zwei Reiter, darunter die Liste aller Stile. Geöffnet wird der Reiter
 * des Themas, das GERADE gilt -- ein Tipp auf einen Stil ändert dann sofort
 * die sichtbare Karte, wie vorher. Für das andere Thema wechselt man den
 * Reiter; die Karte bleibt dabei, wie sie ist, bis das Thema wechselt.
 */

import React, { useEffect, useState } from 'react';
import { useStyleStore, type StilThema } from '../state/styleStore.js';
import type { StyleSummary } from './styleClient.js';

const REITER: Array<{ thema: StilThema; titel: string; symbol: string }> = [
  { thema: 'light', titel: 'Hell', symbol: '☀️' },
  { thema: 'dark', titel: 'Dunkel', symbol: '🌙' },
];

export default function StilJeThema({ styles }: { styles: StyleSummary[] }): React.ReactElement {
  const aktivesThema = useStyleStore((s) => s.thema);
  const stilHell = useStyleStore((s) => s.stilHell);
  const stilDunkel = useStyleStore((s) => s.stilDunkel);
  const setStilFuer = useStyleStore((s) => s.setStilFuer);

  const [reiter, setReiter] = useState<StilThema>(aktivesThema);
  // Wechselt das Thema, während das Menü offen ist, geht der Reiter mit --
  // sonst stünde man auf einem Reiter, dessen Wahl gerade nicht zu sehen ist.
  useEffect(() => setReiter(aktivesThema), [aktivesThema]);

  const gewaehlt = reiter === 'dark' ? stilDunkel : stilHell;

  return (
    <div className="space-y-2">
      <div className="flex gap-1" role="tablist" aria-label="Kartenstil für">
        {REITER.map((r) => (
          <button
            key={r.thema}
            type="button"
            role="tab"
            aria-selected={reiter === r.thema}
            onClick={() => setReiter(r.thema)}
            data-testid={`stil-reiter-${r.thema}`}
            className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${
              reiter === r.thema
                ? 'border-blue-500 bg-blue-50 font-semibold dark:bg-blue-900/40'
                : 'border-slate-300 dark:border-slate-600'
            }`}
          >
            <span aria-hidden="true">{r.symbol}</span> {r.titel}
            {aktivesThema === r.thema && <span className="ml-1 text-[10px] font-normal opacity-70">(jetzt)</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1" role="tabpanel">
        {styles.map((style) => (
          <button
            key={style.id}
            type="button"
            onClick={() => setStilFuer(reiter, style.id)}
            aria-pressed={style.id === gewaehlt}
            data-testid={`style-option-${style.id}`}
            className={`text-left px-3 py-2 rounded-lg border ${
              style.id === gewaehlt
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 font-semibold'
                : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            {style.name}
          </button>
        ))}
      </div>

      <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400" data-testid="stil-hinweis">
        {reiter === aktivesThema
          ? 'Gilt jetzt und immer, wenn das Design auf ' + (reiter === 'dark' ? 'Dunkel' : 'Hell') + ' steht.'
          : 'Wird gezeigt, sobald das Design auf ' + (reiter === 'dark' ? 'Dunkel' : 'Hell') + ' wechselt.'}
      </p>
    </div>
  );
}
