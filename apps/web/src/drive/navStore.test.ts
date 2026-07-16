/**
 * Unit tests for navStore (E04-T3): NavState storage, `nav/instruction`
 * sequencing (the client-side "new one arrived" signal DriveOverlay's TTS
 * wiring keys off), and connection status -- mirrors
 * `position/positionStore.test.ts`'s structure.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { NavInstructionPayload, NavState } from '@yapaja/shared';
import { useNavStore } from './navStore.js';

function makeNavState(overrides: Partial<NavState> = {}): NavState {
  return {
    status: 'navigating',
    route_id: 'r1',
    next_maneuver: null,
    distance_to_maneuver_m: null,
    distance_remaining_m: 1000,
    duration_remaining_s: 120,
    eta: new Date().toISOString(),
    speed_kmh: 50,
    speed_limit_kmh: null,
    altitude_m: 400,
    destination: null,
    ...overrides,
  };
}

function makeInstruction(overrides: Partial<NavInstructionPayload> = {}): NavInstructionPayload {
  return {
    maneuver: {
      index: 1,
      type: 'turn_left',
      instruction: 'Links abbiegen',
      street_names: ['Teststraße'],
      distance_m: 100,
      begin_shape_index: 5,
    },
    distance_m: 300,
    say: 'In 300 Metern links abbiegen auf die Teststraße',
    ...overrides,
  };
}

describe('navStore', () => {
  beforeEach(() => {
    useNavStore.setState({ navState: null, lastInstruction: null, instructionSeq: 0, isConnected: false });
  });

  it('stores navState', () => {
    const state = makeNavState();
    useNavStore.getState().setNavState(state);
    expect(useNavStore.getState().navState).toEqual(state);
  });

  it('stores an instruction and bumps instructionSeq', () => {
    expect(useNavStore.getState().instructionSeq).toBe(0);

    const first = makeInstruction();
    useNavStore.getState().setInstruction(first);
    expect(useNavStore.getState().lastInstruction).toEqual(first);
    expect(useNavStore.getState().instructionSeq).toBe(1);

    const second = makeInstruction({ distance_m: 30, say: 'Jetzt links abbiegen auf die Teststraße' });
    useNavStore.getState().setInstruction(second);
    expect(useNavStore.getState().lastInstruction).toEqual(second);
    expect(useNavStore.getState().instructionSeq).toBe(2);
  });

  it('instructionSeq increments even for an IDENTICAL say text (each announcement is a distinct event)', () => {
    const instr = makeInstruction();
    useNavStore.getState().setInstruction(instr);
    useNavStore.getState().setInstruction(instr);
    expect(useNavStore.getState().instructionSeq).toBe(2);
  });

  it('tracks connection status', () => {
    useNavStore.getState().setConnected(true);
    expect(useNavStore.getState().isConnected).toBe(true);
    useNavStore.getState().setConnected(false);
    expect(useNavStore.getState().isConnected).toBe(false);
  });
});
