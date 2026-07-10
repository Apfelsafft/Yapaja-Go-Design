/**
 * Performance Debug Overlay (E01-T6): Displays FPS and degradation level.
 * Only shown when ?perf=1 query parameter is present.
 */

import React, { useEffect, useState } from 'react';
import { useDegradationStore } from './degrade';

interface PerfStats {
  fps: number;
  level: number;
}

export default function PerfOverlay(): React.ReactElement | null {
  const [stats, setStats] = useState<PerfStats>({ fps: 0, level: 0 });
  const level = useDegradationStore((state) => state.level);

  // Check if ?perf=1 is in the URL
  const showOverlay =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).has('perf')
      : false;

  // Expose a test hook: tests can call window.__yapajaSetPerfStats to inject fps values
  useEffect(() => {
    const handleSetStats = (event: Event) => {
      const customEvent = event as CustomEvent<{ fps: number }>;
      setStats((prev) => ({ ...prev, fps: customEvent.detail.fps }));
    };

    window.addEventListener('perf-stats-update', handleSetStats);
    return () => {
      window.removeEventListener('perf-stats-update', handleSetStats);
    };
  }, []);

  if (!showOverlay) {
    return null;
  }

  return (
    <div
      data-testid="perf-overlay"
      className="fixed bottom-4 right-4 bg-black bg-opacity-75 text-white px-3 py-2 rounded font-mono text-sm z-50"
    >
      <div>FPS: <span data-testid="perf-fps">{stats.fps.toFixed(1)}</span></div>
      <div>Level: <span data-testid="perf-level">{level}</span></div>
    </div>
  );
}
