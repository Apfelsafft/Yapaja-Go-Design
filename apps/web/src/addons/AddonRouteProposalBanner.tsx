/**
 * Confirmation banner for add-on ROUTE PROPOSALS (E09-T2, Wargame W-10).
 *
 * An add-on's `route.propose` only ever lands a pending proposal in
 * `useRouteProposalStore`. Navigation is UNCHANGED until the user clicks
 * "Übernehmen" here -- and ONLY then does the host attempt to apply it. A
 * proposal that is dismissed (or whose add-on is disabled) has ZERO routing
 * effect. This banner is the single, host-owned gate an add-on can never
 * bypass: it cannot start navigation directly, ever.
 */

import React, { useState } from 'react';
import { useRouteProposalStore, type RouteProposal } from './routeProposalStore.js';

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

/** Best-effort application of a user-confirmed proposal: routes to the final
 *  waypoint via the Core's destination endpoint. Only ever called from the
 *  user's own "Übernehmen" click -- never from add-on code. */
async function applyProposal(proposal: RouteProposal): Promise<void> {
  const last = proposal.waypoints[proposal.waypoints.length - 1];
  if (!last) return;
  try {
    await fetch(apiUrl('api/v1/navigation/destination'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latlng: { lat: last.lat, lon: last.lng } }),
    });
  } catch {
    /* an offline / routing failure must not throw out of a click handler */
  }
}

export default function AddonRouteProposalBanner(): React.ReactElement | null {
  const proposals = useRouteProposalStore((state) => state.proposals);
  const dismiss = useRouteProposalStore((state) => state.dismiss);
  const [applying, setApplying] = useState<string | null>(null);
  if (proposals.length === 0) return null;

  return (
    <div className="absolute top-2 left-1/2 z-50 flex w-[min(92vw,32rem)] -translate-x-1/2 flex-col gap-2" data-testid="addon-route-proposals">
      {proposals.map((proposal) => (
        <div
          key={proposal.id}
          data-testid="addon-route-proposal"
          data-addon-id={proposal.addonId}
          className="pointer-events-auto rounded-lg border border-amber-400 bg-slate-900/95 p-3 text-sm text-amber-50 shadow-lg"
          role="alertdialog"
          aria-label="Routenvorschlag eines Add-ons"
        >
          <p className="mb-2">
            <span className="font-semibold">Routenvorschlag:</span>{' '}
            <span data-testid="addon-route-proposal-reason">{proposal.reason}</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="addon-route-accept"
              disabled={applying === proposal.id}
              onClick={async () => {
                setApplying(proposal.id);
                await applyProposal(proposal);
                dismiss(proposal.id);
                setApplying(null);
              }}
              className="rounded bg-emerald-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
            >
              Übernehmen
            </button>
            <button
              type="button"
              data-testid="addon-route-dismiss"
              onClick={() => dismiss(proposal.id)}
              className="rounded bg-slate-700 px-3 py-1.5 font-semibold text-white"
            >
              Verwerfen
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
