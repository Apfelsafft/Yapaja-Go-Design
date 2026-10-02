/** Der 🎤-Knopf: öffnet das Sprachfenster. */

import React from 'react';
import { useSprachStore } from './sprachStore.js';

export default function SprachKnopf({ className = '' }: { className?: string }): React.ReactElement {
  const oeffne = useSprachStore((s) => s.oeffne);
  return (
    <button
      type="button"
      onClick={oeffne}
      aria-label="Sprachbefehl"
      title="Sprachbefehl"
      className={`pointer-events-auto flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white/95 text-lg shadow-md hover:bg-slate-100 dark:bg-slate-800/95 dark:hover:bg-slate-700 ${className}`}
      data-testid="sprach-knopf"
    >
      🎤
    </button>
  );
}
