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
import AudioUnlock from './AudioUnlock.js';
import { ManeuverArrowSprite } from './arrows.js';
import ManeuverPanel, { isDriveActive } from './ManeuverPanel.js';
import SpeedLimitSign from './SpeedLimitSign.js';
import DriveModeController from './DriveModeController.js';
import ResumePrompt from './ResumePrompt.js';
import ProfileChangeBanner from '../profiles/ProfileChangeBanner.js';
import { announce, cancelSpeech, isSpeechAvailable } from './tts.js';
import { applyAutoZoomNow } from '../map/followMe.js';
import FahrtMenue from './FahrtMenue.js';
import { ansageNachRadioPause } from './radioPause.js';

export default function DriveOverlay(): React.ReactElement {
  const navState = useNavStore((state) => state.navState);
  const instructionSeq = useNavStore((state) => state.instructionSeq);
  const lastInstruction = useNavStore((state) => state.lastInstruction);
  const ttsEnabled = useTtsStore((state) => state.enabled);
  // W-19 (E04-T5): see `ManeuverPanel.tsx`'s identical gate.
  const driveGateOpen = useNavStore((state) => state.resumeAcknowledged);

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
    // Läuft das Radio, hält es vorher an (und spielt danach weiter).
    void ansageNachRadioPause(lastInstruction.say, (t) => announce(t));
  }, [instructionSeq, lastInstruction, ttsEnabled]);

  // Stop any in-flight utterance the moment TTS is toggled off.
  useEffect(() => {
    if (!ttsEnabled) cancelSpeech();
  }, [ttsEnabled]);

  const active = driveGateOpen && isDriveActive(navState?.status);

  // ─── BEIM LOSFAHREN SOFORT HERANHOLEN ────────────────────────────────────
  // Ohne das blieb die Uebersicht stehen, in der die Route geplant wurde --
  // bis zur naechsten Positionsmeldung, und mit ihr die erste Abbiegung.
  // Gemeldet: „Insbesondere bei Start ist noch recht weit rausgezoomt."
  const warAktiv = useRef(false);
  useEffect(() => {
    if (active && !warAktiv.current) applyAutoZoomNow();
    warAktiv.current = active;
  }, [active]);

  return (
    <>
      {/* Holt die Tonfreigabe beim ersten Antippen -- irgendwo in der App,
          nicht erst im Fahrmodus. Rendert nichts. */}
      <AudioUnlock />
      <ManeuverArrowSprite />
      <DriveModeController />
      <ResumePrompt />
      <ProfileChangeBanner />
      {active && (
        <>
          <ManeuverPanel />
          <SpeedLimitSign />
          {/* Fahrtdaten, und dahinter Pause, Stopp, Ansagen und
              Zwischenstopps -- siehe FahrtMenue.tsx. */}
          <FahrtMenue navState={navState} />
        </>
      )}
    </>
  );
}

declare global {
  interface Window {
    /** Debug/E2E hook: whether the Web Speech API is available in THIS browser (headless test browsers sometimes lack it). */
    __yapaiaSpeechAvailable?: () => boolean;
  }
}

if (typeof window !== 'undefined') {
  window.__yapaiaSpeechAvailable = isSpeechAvailable;
}
