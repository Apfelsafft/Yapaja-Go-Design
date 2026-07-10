/**
 * Unit tests for Follow-Me Logic (E01-T3)
 *
 * Test pause/resume logic, auto-resume timeout.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useFollowMeStore, initializeFollowMe } from './followMe';
import { mapController } from '../state/mapStore';

// Mock mapController
vi.mock('../state/mapStore', () => ({
  mapController: {
    getMap: vi.fn(() => mockMap),
    setCamera: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
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

const mockMap = {};

describe('FollowMeStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFollowMeStore.setState({ isFollowing: true, isPaused: false });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('initializes with following enabled and not paused', () => {
    const state = useFollowMeStore.getState();
    expect(state.isFollowing).toBe(true);
    expect(state.isPaused).toBe(false);
  });

  it('pauses follow and sets paused state', () => {
    vi.useFakeTimers();

    const { pause } = useFollowMeStore.getState();

    pause();

    expect(useFollowMeStore.getState().isPaused).toBe(true);

    vi.useRealTimers();
  });

  it('resumes follow and clears paused state', () => {
    useFollowMeStore.setState({ isPaused: true });

    const { resume } = useFollowMeStore.getState();
    resume();

    expect(useFollowMeStore.getState().isPaused).toBe(false);
  });

  it('pauses and can be manually resumed', () => {
    const { pause, resume } = useFollowMeStore.getState();

    pause();
    expect(useFollowMeStore.getState().isPaused).toBe(true);

    resume();
    expect(useFollowMeStore.getState().isPaused).toBe(false);
  });

  it('disables following globally', () => {
    const { setFollowing } = useFollowMeStore.getState();

    setFollowing(false);

    expect(useFollowMeStore.getState().isFollowing).toBe(false);
    expect(useFollowMeStore.getState().isPaused).toBe(false);
  });

  it('resume clears existing pause timer', () => {
    vi.useFakeTimers();

    const { pause, resume } = useFollowMeStore.getState();

    pause();
    expect(useFollowMeStore.getState().isPaused).toBe(true);

    // Resume before timeout
    vi.advanceTimersByTime(5_000);
    resume();

    // Advance past original timeout
    vi.advanceTimersByTime(6_000);

    // Should still be resumed (not auto-resumed)
    expect(useFollowMeStore.getState().isPaused).toBe(false);

    vi.useRealTimers();
  });

  it('setFollowing clears pause timer', () => {
    vi.useFakeTimers();

    const { pause, setFollowing } = useFollowMeStore.getState();

    pause();
    setFollowing(false);

    // Advance past pause duration
    vi.advanceTimersByTime(10_000);

    // Should stay false (no auto-resume)
    expect(useFollowMeStore.getState().isFollowing).toBe(false);

    vi.useRealTimers();
  });
});

describe('initializeFollowMe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a cleanup function', () => {
    const cleanup = initializeFollowMe();
    expect(typeof cleanup).toBe('function');
  });

  it('subscribes to map dragstart/movestart events', () => {
    const mockOn = vi.mocked(mapController.on);

    initializeFollowMe();

    // Should have registered listeners for dragstart and movestart
    expect(mockOn).toHaveBeenCalledWith('dragstart', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('movestart', expect.any(Function));
  });

  it('pauses on user dragstart (originalEvent present)', () => {
    const mockOn = vi.mocked(mapController.on);
    useFollowMeStore.setState({ isFollowing: true, isPaused: false });

    initializeFollowMe();

    // Get the dragstart handler
    const dragstartCall = mockOn.mock.calls.find((call) => call[0] === 'dragstart');
    const dragstartHandler = dragstartCall?.[1];

    if (dragstartHandler) {
      // Simulate user drag (originalEvent set)
      dragstartHandler({ originalEvent: {} });

      expect(useFollowMeStore.getState().isPaused).toBe(true);
    }
  });

  it('ignores programmatic move (no originalEvent)', () => {
    const mockOn = vi.mocked(mapController.on);
    useFollowMeStore.setState({ isFollowing: true, isPaused: false });

    initializeFollowMe();

    const moveCall = mockOn.mock.calls.find((call) => call[0] === 'movestart');
    const moveHandler = moveCall?.[1];

    if (moveHandler) {
      // Simulate programmatic move (no originalEvent)
      moveHandler({});

      expect(useFollowMeStore.getState().isPaused).toBe(false);
    }
  });

  it('unsubscribes from events on cleanup', () => {
    const mockOff = vi.mocked(mapController.off);

    const cleanup = initializeFollowMe();
    cleanup();

    expect(mockOff).toHaveBeenCalledWith('dragstart', expect.any(Function));
    expect(mockOff).toHaveBeenCalledWith('movestart', expect.any(Function));
  });
});
