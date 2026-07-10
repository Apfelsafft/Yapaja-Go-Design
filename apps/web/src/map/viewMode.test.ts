/**
 * Unit tests for ViewModeController (E01-T3)
 *
 * Test mode state management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useViewModeStore } from './viewMode';
import { mapController } from '../state/mapStore';

// Mock mapController
vi.mock('../state/mapStore', () => ({
  mapController: {
    getMap: vi.fn(() => mockMap),
    setCamera: vi.fn(),
  },
  useMapStore: vi.fn(),
}));

// Mock positionStore
vi.mock('../position/positionStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockStore: any = {
    getState: vi.fn(() => ({
      position: { lat: 48.1, lon: 2.3, heading: 45 },
    })),
  };
  return { usePositionStore: mockStore };
});

const mockMap = {
  getBearing: vi.fn(() => 0),
};

describe('ViewModeStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useViewModeStore.setState({ mode: '2d-north' });
  });

  it('initializes in 2d-north mode', () => {
    const mode = useViewModeStore.getState().mode;
    expect(mode).toBe('2d-north');
  });

  it('switches between modes', () => {
    const { setMode } = useViewModeStore.getState();

    setMode('2d-course');
    expect(useViewModeStore.getState().mode).toBe('2d-course');

    setMode('3d-course');
    expect(useViewModeStore.getState().mode).toBe('3d-course');

    setMode('2d-north');
    expect(useViewModeStore.getState().mode).toBe('2d-north');
  });

  it('calls mapController.setCamera on mode switch', () => {
    const mockSetCamera = vi.mocked(mapController.setCamera);
    const { setMode } = useViewModeStore.getState();

    setMode('2d-course');

    expect(mockSetCamera).toHaveBeenCalled();
    const call = mockSetCamera.mock.calls[0];
    expect(call[0]).toEqual({ pitch: 0, bearing: 45 }); // heading from position
    expect(call[1]).toEqual({ animate: true, duration: 300 });
  });

  it('applies correct pitch for 3d-course mode', () => {
    const mockSetCamera = vi.mocked(mapController.setCamera);
    const { setMode } = useViewModeStore.getState();

    setMode('3d-course');

    const call = mockSetCamera.mock.calls[0];
    expect(call[0].pitch).toBe(55);
  });

  it('transitions to 2d-north mode', () => {
    const { setMode } = useViewModeStore.getState();

    setMode('3d-course'); // Move to different mode first
    expect(useViewModeStore.getState().mode).toBe('3d-course');

    setMode('2d-north');
    expect(useViewModeStore.getState().mode).toBe('2d-north');
  });

  it('no-ops if already in target mode', () => {
    const mockSetCamera = vi.mocked(mapController.setCamera);
    mockSetCamera.mockClear();

    const { setMode } = useViewModeStore.getState();
    setMode('2d-north'); // Already in 2d-north

    expect(mockSetCamera).not.toHaveBeenCalled();
  });
});
