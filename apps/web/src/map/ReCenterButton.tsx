/**
 * Re-Center Button (E01-T3)
 *
 * Appears only when Follow-Me is paused (after user pan).
 * Click: resumes Follow-Me immediately and centers map on current position.
 */

import React, { useCallback } from 'react';
import { useFollowMeIsPaused, useResumeFollowMe } from './followMe';

export default function ReCenterButton(): React.ReactElement | null {
  const isPaused = useFollowMeIsPaused();
  const resume = useResumeFollowMe();

  const handleClick = useCallback(() => {
    resume();
  }, [resume]);

  if (!isPaused) {
    return null;
  }

  return (
    <button
      onClick={handleClick}
      className="fixed bottom-36 right-4 w-12 h-12 rounded-full bg-blue-500 dark:bg-blue-600 text-white shadow-lg hover:shadow-xl hover:bg-blue-600 dark:hover:bg-blue-700 transition-all flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
      aria-label="Zur Position zurückkehren"
      title="Zur Position zurückkehren"
      data-testid="recenter-button"
    >
      {/* Crosshair icon */}
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="1" />
        <path d="M12 8v-2M12 18v2M8 12H6M18 12h2" />
      </svg>
    </button>
  );
}
