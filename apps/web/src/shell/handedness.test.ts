import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HANDEDNESS,
  isHandedness,
  itemsAlignClassFor,
  sideClassFor,
} from './handedness.js';

describe('isHandedness', () => {
  it('accepts the two valid values', () => {
    expect(isHandedness('lhd')).toBe(true);
    expect(isHandedness('rhd')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isHandedness('left')).toBe(false);
    expect(isHandedness('')).toBe(false);
    expect(isHandedness(null)).toBe(false);
    expect(isHandedness(undefined)).toBe(false);
    expect(isHandedness(1)).toBe(false);
  });
});

describe('DEFAULT_HANDEDNESS', () => {
  it('is rhd (preserves the pre-existing hard-coded right-side FAB placement)', () => {
    expect(DEFAULT_HANDEDNESS).toBe('rhd');
  });
});

describe('sideClassFor / itemsAlignClassFor', () => {
  it('rhd anchors right / aligns end (the pre-existing default layout)', () => {
    expect(sideClassFor('rhd')).toBe('right-3');
    expect(itemsAlignClassFor('rhd')).toBe('items-end');
  });

  it('lhd mirrors to left / aligns start', () => {
    expect(sideClassFor('lhd')).toBe('left-3');
    expect(itemsAlignClassFor('lhd')).toBe('items-start');
  });
});
