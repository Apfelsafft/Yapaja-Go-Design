/**
 * „Unterwegs finden" im Fahrtmenü: ⛽ tippen, die nächsten Tankstellen voraus
 * auf der Strecke sehen, eine davon als nächsten Halt nehmen.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Stufe 1 des Sprach-Copiloten (`docs/ideen-ki.md`, Idee 1): dieselbe Suche,
 * die der Copilot später als Werkzeug aufruft — hier per Tipp. Während der
 * Fahrt ist das Suchfeld gesperrt; zwei Tipps auf feste Knöpfe sind keine
 * Texteingabe und bleiben erlaubt, wie die Favoriten.
 *
 * Was „nächste" heißt, entscheidet der Kern (`GET /api/v1/unterwegs`): mit
 * Route voraus und höchstens 2 km neben der Strecke, ohne Route im Umkreis.
 */

import React, { useState } from 'react';
import { UNTERWEGS_KATEGORIEN, type UnterwegsKategorie } from '@yapaia/shared';
import { stationsZeile, type BordStation } from '../bord/bordStore.js';
import PreisMarke, { useSpritpreise } from '../tanken/PreisMarke.js';

export interface UnterwegsErgebnis {
  kategorie: UnterwegsKategorie;
  bezug: 'route' | 'position' | 'keiner';
  treffer: BordStation[];
}

type Stand =
  | { art: 'leer' }
  | { art: 'laedt'; kategorie: UnterwegsKategorie }
  | { art: 'fertig'; ergebnis: UnterwegsErgebnis }
  | { art: 'fehler'; kategorie: UnterwegsKategorie };

export async function holeUnterwegs(kategorie: string): Promise<UnterwegsErgebnis | null> {
  try {
    const antwort = await fetch(
      `${import.meta.env.BASE_URL}api/v1/unterwegs?kategorie=${encodeURIComponent(kategorie)}&anzahl=3`,
    );
    if (!antwort.ok) return null;
    const { data } = (await antwort.json()) as { data?: UnterwegsErgebnis };
    return data && Array.isArray(data.treffer) ? data : null;
  } catch {
    return null;
  }
}

/** Was man sagt, wenn nichts gefunden wurde -- mit dem Grund. */
export function nichtsGefunden(e: UnterwegsErgebnis): string {
  const was = e.kategorie.name;
  if (e.bezug === 'keiner') return `Ohne Position lässt sich keine ${was} in der Nähe suchen.`;
  if (e.bezug === 'route') return `Keine ${was} in den nächsten 80 km an der Strecke.`;
  return `Keine ${was} im Umkreis von 25 km.`;
}

export default function UnterwegsFinden({
  onGewaehlt,
  anfang,
}: {
  /** Ein Tipp auf einen Treffer -- mit der ganzen Liste, damit die Vorschau
   *  zwischen den Treffern blättern kann. */
  onGewaehlt: (treffer: BordStation, ergebnis: UnterwegsErgebnis, index: number) => void;
  /** Das letzte Ergebnis, wenn man aus der Vorschau zur Liste zurückkehrt. */
  anfang?: UnterwegsErgebnis | null;
}): React.ReactElement {
  const [stand, setStand] = useState<Stand>(anfang ? { art: 'fertig', ergebnis: anfang } : { art: 'leer' });

  const suche = async (k: UnterwegsKategorie) => {
    setStand({ art: 'laedt', kategorie: k });
    const ergebnis = await holeUnterwegs(k.id);
    setStand(ergebnis ? { art: 'fertig', ergebnis } : { art: 'fehler', kategorie: k });
  };

  // 0.42.0: bei Tankstellen gleich den Preis (Tankerkönig), sonst nichts.
  const tankTreffer = React.useMemo(
    () => (stand.art === 'fertig' && stand.ergebnis.kategorie.id === 'fuel' ? stand.ergebnis.treffer : []),
    [stand],
  );
  const preise = useSpritpreise(tankTreffer);

  const aktiv = stand.art === 'laedt' ? stand.kategorie.id : stand.art === 'fertig' ? stand.ergebnis.kategorie.id : null;

  return (
    <section aria-labelledby="fahrt-menue-unterwegs" data-testid="unterwegs-finden">
      <h2 id="fahrt-menue-unterwegs" className="mb-2 font-semibold">
        Unterwegs finden
      </h2>
      <ul className="flex flex-wrap gap-2">
        {UNTERWEGS_KATEGORIEN.map((k) => (
          <li key={k.id}>
            <button
              type="button"
              aria-pressed={aktiv === k.id}
              onClick={() => void suche(k)}
              className={`min-h-[48px] rounded-full px-3 py-2 ${
                aktiv === k.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600'
              }`}
              data-testid={`unterwegs-kategorie-${k.id}`}
            >
              <span aria-hidden="true">{k.symbol}</span> {k.name}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2" aria-live="polite">
        {stand.art === 'laedt' && <p className="text-xs text-slate-500">Suche {stand.kategorie.name} …</p>}
        {stand.art === 'fehler' && (
          <p className="text-xs text-red-700 dark:text-red-300" data-testid="unterwegs-fehler">
            Die Suche hat nicht geantwortet.
          </p>
        )}
        {stand.art === 'fertig' &&
          (stand.ergebnis.treffer.length === 0 ? (
            <p className="text-xs text-slate-500" data-testid="unterwegs-nichts">
              {nichtsGefunden(stand.ergebnis)}
            </p>
          ) : (
            <ul className="space-y-1" data-testid="unterwegs-treffer">
              {stand.ergebnis.treffer.map((t, i) => (
                <li key={`${t.lat},${t.lon}`}>
                  <button
                    type="button"
                    onClick={() => onGewaehlt(t, stand.ergebnis, i)}
                    className="flex min-h-[48px] w-full items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-left hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
                    data-testid={`unterwegs-treffer-${i}`}
                  >
                    <span className="flex-1">{stationsZeile(t)}</span>
                    <PreisMarke zuordnung={preise[i]} testId={`unterwegs-treffer-preis-${i}`} />
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}
