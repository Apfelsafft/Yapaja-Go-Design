/**
 * Drive overlay (E04-T3) -- mounts the nav WS connection, the maneuver panel,
 * the speed-limit sign, and the TTS on/off toggle + speaks each `nav/instruction`
 * exactly once. Mirrors `position/PositionInitializer.tsx`'s lifecycle
 * pattern (connect on mount, disconnect on unmount).
 *
 * Mounted unconditionally in `App.tsx` (so the WS connection is ready before
 * any navigation starts, same as position's), but everything it renders
 * stays hidden until `nav/state` actually reports an active drive -- so it
 * never interferes with any other screen/testid.
 */

import React, { useEffect, useRef } from 'react';
import { navWSManager, useNavStore } from './navStore.js';
import { useTtsStore } from './ttsStore.js';
import { ManeuverArrowSprite } from './arrows.js';
import ManeuverPanel, { isDriveActive } from './ManeuverPanel.js';
import SpeedLimitSign from './SpeedLimitSign.js';
import { announce, cancelSpeech, isSpeechAvailable } from './tts.js';

function TtsToggle(): React.ReactElement {
  const enabled = useTtsStore((state) => state.enabled);
  const toggle = useTtsStore((state) => state.toggle);

  return (
    <button
      type="button"
      data-testid="tts-toggle"
      aria-pressed={enabled}
      onClick={() => {
        toggle();
        if (enabled) cancelSpeech(); // was on, is being turned off -> stop mid-utterance
      }}
      className="absolute bottom-24 right-3 z-20 rounded-full bg-slate-900/90 text-white px-3 py-2 text-sm font-medium shadow-lg"
    >
      {enabled ? '🔊 Ansagen an' : '🔇 Ansagen aus'}
    </button>
  );
}

export default function DriveOverlay(): React.ReactElement {
  const navState = useNavStore((state) => state.navState);
  const instructionSeq = useNavStore((state) => state.instructionSeq);
  const lastInstruction = useNavStore((state) => state.lastInstruction);
  const ttsEnabled = useTtsStore((state) => state.enabled);

  // Connect the nav WS once at app root (same lifecycle as PositionInitializer).
  useEffect(() => {
    void navWSManager.connect();
    return () => navWSManager.disconnect();
  }, []);

  // Speak each `nav/instruction` EXACTLY once (mirrors the core's
  // once-per-threshold contract, W-23: a new one always displaces a still-
  // speaking/queued old one -- see `tts.ts#speak`'s `cancel()`-first behaviour).
  const lastAnnouncedSeq = useRef(0);
  useEffect(() => {
    if (instructionSeq === 0 || instructionSeq === lastAnnouncedSeq.current) return;
    lastAnnouncedSeq.current = instructionSeq;
    if (!ttsEnabled || !lastInstruction) return;
    announce(lastInstruction.say);
  }, [instructionSeq, lastInstruction, ttsEnabled]);

  // Stop any in-flight utterance the moment TTS is toggled off.
  useEffect(() => {
    if (!ttsEnabled) cancelSpeech();
  }, [ttsEnabled]);

  const active = isDriveActive(navState?.status);

  return (
    <>
      <ManeuverArrowSprite />
      {active && (
        <>
          <ManeuverPanel />
          <SpeedLimitSign />
          <TtsToggle />
        </>
      )}
    </>
  );
}

declare global {
  interface Window {
    /** Debug/E2E hook: whether the Web Speech API is available in THIS browser (headless test browsers sometimes lack it). */
    __yapajaSpeechAvailable?: () => boolean;
  }
}

if (typeof window !== 'undefined') {
  window.__yapajaSpeechAvailable = isSpeechAvailable;
}
