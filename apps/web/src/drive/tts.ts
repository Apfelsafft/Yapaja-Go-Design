/**
 * TTS via Web Speech API (E04-T3, docs/06 §5, Wargame W-23).
 *
 * - `de-DE` speech synthesis of the `say` text from `nav/instruction`.
 * - Availability check (`window.speechSynthesis`); when unavailable, a short
 *   WebAudio "gong" beep stands in (W-23's documented fallback: "Fallback:
 *   Gong + große visuelle Anweisung" -- the "große visuelle Anweisung" half
 *   is the maneuver panel itself, already always shown).
 * - W-23 "Ansage-Queue verwirft veraltete Ansagen (nie zwei überlappend)":
 *   every `speak()` call cancels whatever utterance is still pending/
 *   speaking first, so a new announcement always displaces an old one
 *   instead of queueing behind it.
 *
 * All DOM/API access is guarded so this degrades gracefully in the headless
 * test browser (no real audio output device, and some CI browsers ship
 * without `speechSynthesis` at all).
 */

/** Whether the Web Speech Synthesis API is available in this browser. */
export function isSpeechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

/**
 * Speak `text` in `lang` (default de-DE). Cancels any still-pending/speaking
 * utterance first (W-23: never two overlapping, a new one always displaces
 * an old one). No-op (does not throw) when the API is unavailable -- callers
 * that care should check {@link isSpeechAvailable} first and fall back to
 * {@link playGong}.
 */
export function speak(text: string, lang = 'de-DE'): void {
  if (!isSpeechAvailable()) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('[tts] speak() failed:', err);
  }
}

/** Cancels the current utterance, if any (used when TTS is toggled off mid-speech). */
export function cancelSpeech(): void {
  if (!isSpeechAvailable()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Best-effort; nothing else to do if the API misbehaves.
  }
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Whether a WebAudio gong can be played at all in this browser. */
export function isGongAvailable(): boolean {
  return getAudioContextCtor() !== null;
}

/**
 * Short two-tone "gong" beep (~500 ms), the TTS-unavailable fallback (W-23).
 * Best-effort: swallows any error (e.g. autoplay policy blocking audio
 * without a prior user gesture, or no AudioContext at all in a headless test
 * browser) rather than throwing -- an announcement's visual panel is the
 * primary channel regardless.
 */
export function playGong(): void {
  const Ctx = getAudioContextCtor();
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.18;
      const end = start + 0.22;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    });
    // Best-effort cleanup once the tail has played out.
    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 1000);
  } catch (err) {
    console.warn('[tts] playGong() failed:', err);
  }
}

/**
 * Announce `text`: speaks it if TTS is available, otherwise plays the gong
 * fallback. Single entry point so callers never have to duplicate the
 * availability branching.
 */
export function announce(text: string, lang = 'de-DE'): void {
  if (isSpeechAvailable()) {
    speak(text, lang);
  } else {
    playGong();
  }
}
