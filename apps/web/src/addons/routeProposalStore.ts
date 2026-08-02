/**
 * Pending ROUTE PROPOSALS from add-ons (E09-T2, Wargame W-10). An add-on's
 * `route.propose` bridge call NEVER activates a route -- it only adds a
 * proposal here, which `AddonRouteProposalBanner` renders as a confirmation
 * banner. Navigation state is UNCHANGED until the user explicitly clicks
 * "Übernehmen"; "Verwerfen" (or a disable) drops the proposal with zero
 * routing effect. An add-on can never "silently" reroute the vehicle.
 */

import { create } from 'zustand';
import type { RouteProposeWaypoint } from '@yapaja/addon-sdk';

export interface RouteProposal {
  /** Unique id for this proposal instance (dismiss/accept target). */
  id: string;
  addonId: string;
  waypoints: RouteProposeWaypoint[];
  reason: string;
}

interface RouteProposalState {
  proposals: RouteProposal[];
  add: (proposal: RouteProposal) => void;
  dismiss: (id: string) => void;
  clearForAddon: (addonId: string) => void;
}

let seq = 0;
export function nextProposalId(): string {
  return `rp-${Date.now()}-${++seq}`;
}

export const useRouteProposalStore = create<RouteProposalState>((set) => ({
  proposals: [],
  add: (proposal) => set((state) => ({ proposals: [...state.proposals, proposal] })),
  dismiss: (id) => set((state) => ({ proposals: state.proposals.filter((p) => p.id !== id) })),
  clearForAddon: (addonId) => set((state) => ({ proposals: state.proposals.filter((p) => p.addonId !== addonId) })),
}));
