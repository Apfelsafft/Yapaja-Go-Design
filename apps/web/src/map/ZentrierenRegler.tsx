import React from 'react';
import { ZENTRIEREN_STUFEN, useZentrierenStore, zentrierenText } from './zentrieren.js';

/** Regler für `zentrieren.ts`: aus, 5 s … 2 min. */
export default function ZentrierenRegler(): React.ReactElement {
  const sekunden = useZentrierenStore((s) => s.sekunden);
  const setSekunden = useZentrierenStore((s) => s.setSekunden);
  const index = Math.max(0, (ZENTRIEREN_STUFEN as readonly number[]).indexOf(sekunden));

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={ZENTRIEREN_STUFEN.length - 1}
        step={1}
        value={index}
        onChange={(e) => setSekunden(ZENTRIEREN_STUFEN[Number(e.target.value)] ?? 10)}
        aria-label="Automatisch zentrieren nach"
        aria-valuetext={zentrierenText(sekunden)}
        className="h-8 flex-1 accent-blue-600"
        data-testid="zentrieren-slider"
      />
      <span className="w-12 text-right text-xs tabular-nums" data-testid="zentrieren-wert">
        {zentrierenText(sekunden)}
      </span>
    </div>
  );
}
