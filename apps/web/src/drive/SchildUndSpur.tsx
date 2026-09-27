/**
 * Die Schildtafel und die Spurleiste im Manöver-Panel.
 *
 * Die Entscheidungen — was zuerst kommt, was wegfällt, wann überhaupt etwas
 * erscheint — stehen in `schildText.ts` und `spuren.ts` und sind dort ohne
 * Browser geprüft. Hier wird nur gezeichnet.
 */

import React from 'react';
import type { SchildAnzeige } from './schildText.js';
import type { SpurAnzeige } from './spuren.js';

/**
 * „26 · A 61 · Ludwigshafen" — in den Farben eines deutschen Autobahnschilds.
 *
 * Blau, weil das der Wegweiser ist, mit dem der Fahrer vergleicht. Eine
 * neutrale graue Zeile läse sich wie ein weiterer Straßenname und nicht wie
 * „das steht draußen auf dem Schild".
 */
export function SchildTafel({ schild }: { schild: SchildAnzeige }): React.ReactElement {
  return (
    <div
      data-testid="maneuver-sign"
      className="mt-1 flex min-w-0 items-center gap-1.5 rounded-md bg-blue-700 px-2 py-0.5 text-xs font-semibold text-white"
    >
      {schild.nummer && (
        <span
          data-testid="maneuver-sign-number"
          // Die Ausfahrtsnummer steht auf dem echten Schild in einem eigenen,
          // weiß umrandeten Kästchen. Hier genauso -- sie ist die Zahl, nach
          // der man als Erstes sucht.
          className="shrink-0 rounded border border-white/80 px-1 tabular-nums"
        >
          {schild.nummer}
        </span>
      )}
      {schild.teile.length > 0 && (
        <span data-testid="maneuver-sign-text" className="truncate">
          {schild.teile.join(' · ')}
        </span>
      )}
    </div>
  );
}

/**
 * Eine Reihe Spuren, die richtige hervorgehoben.
 *
 * Die Pfeile kommen aus demselben Sprite wie der große Manöverpfeil
 * (`arrows.tsx`, `#arrow-<key>`). Ein zweiter Satz sähe anders aus als der
 * darüber, und der Fahrer müsste zwei Bildsprachen lesen.
 */
export function SpurLeiste({ spuren }: { spuren: SpurAnzeige[] }): React.ReactElement {
  return (
    <div
      data-testid="maneuver-lanes"
      className="mt-2 flex items-stretch justify-center gap-0.5 border-t border-white/20 pt-2"
      role="img"
      aria-label={`Spuren: ${spuren
        .map((s, i) => `${i + 1}${s.aktiv ? ' (empfohlen)' : ''}`)
        .join(', ')}`}
    >
      {spuren.map((spur, i) => (
        <div
          key={i}
          data-testid="maneuver-lane"
          data-aktiv={spur.aktiv ? 'ja' : 'nein'}
          // Die nicht empfohlenen Spuren bleiben SICHTBAR, nur blass. Sie
          // wegzulassen hiesse, dem Fahrer die Zählung zu nehmen: „zweite von
          // rechts" geht nur, wenn man alle sieht.
          className={`flex items-center rounded px-1 py-0.5 ${
            spur.aktiv ? 'bg-white text-slate-900' : 'text-white/35'
          }`}
        >
          {spur.pfeile.map((key) => (
            <svg key={key} width={20} height={20} viewBox="0 0 24 24" aria-hidden="true">
              <use href={`#arrow-${key}`} />
            </svg>
          ))}
        </div>
      ))}
    </div>
  );
}
