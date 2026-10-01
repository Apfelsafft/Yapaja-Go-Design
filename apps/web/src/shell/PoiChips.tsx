/**
 * Die POI-Chips unter der Suchzeile -- wie bei Google Maps „Restaurants",
 * „Kaffee", „Hotels".
 *
 * Gewünscht: „Können wir da noch einen Marker einbauen, damit die als Chips
 * wie bei Maps in der Kopfzeile sichtbar sind? Wenn man auf einen Chip
 * klickt, wird dieser aktiviert bzw. getoggelt, und nur die POIs der
 * aktivierten Chips werden angezeigt."
 *
 * Welche Kategorien hier stehen, legt das 📌 in den Einstellungen fest
 * (`StylePanel.tsx`). Was ein aktiver Chip bewirkt, steht in
 * `state/styleStore.ts` (`wirksamesPoiAus`).
 */

import React from 'react';
import { POI_AUSWAHL } from '@yapaia/shared';
import { useStyleStore } from '../state/styleStore.js';

/** Ein Zeichen je Kategorie -- die Kartensymbole sind Bilder im Sprite, kein Text. */
export const CHIP_ZEICHEN: Readonly<Record<string, string>> = {
  'poi-wohnmobil': '🚐',
  'poi-camping': '⛺',
  'poi-tanken': '⛽',
  'poi-laden': '🔌',
  'poi-parken': '🅿️',
  'poi-einkaufen': '🛒',
  'poi-essen': '🍴',
  'poi-sehenswert': '⭐',
  'poi-versorgung': '🚰',
  'poi-entsorgung': '🚽',
  'poi-frischwasser': '💧',
  'poi-muell': '🗑️',
  'poi-dusche': '🚿',
};

export default function PoiChips(): React.ReactElement | null {
  const poiChips = useStyleStore((s) => s.poiChips);
  const chipFilter = useStyleStore((s) => s.chipFilter);
  const toggleChip = useStyleStore((s) => s.toggleChip);

  const eintraege = POI_AUSWAHL.filter((e) => poiChips.includes(e.schluessel));
  if (eintraege.length === 0) return null;

  return (
    <ul
      className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:none]"
      aria-label="Sonderziele filtern"
      data-testid="poi-chips"
    >
      {eintraege.map((e) => {
        const an = chipFilter.includes(e.schluessel);
        return (
          <li key={e.schluessel} className="flex-shrink-0">
            <button
              type="button"
              aria-pressed={an}
              onClick={() => toggleChip(e.schluessel)}
              data-testid={`poi-chip-${e.schluessel}`}
              className={`flex min-h-[40px] items-center gap-1.5 rounded-full px-3 text-sm shadow-md ${
                an
                  ? 'bg-blue-600 text-white'
                  : 'bg-white/95 text-slate-800 hover:bg-slate-100 dark:bg-slate-800/95 dark:text-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <span aria-hidden="true">{CHIP_ZEICHEN[e.schluessel] ?? '📍'}</span>
              {e.name}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
