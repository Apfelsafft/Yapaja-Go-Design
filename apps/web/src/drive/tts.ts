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

/**
 * ─── DIE FREIGABE DURCH EINE NUTZERAKTION ───────────────────────────────────
 * Gemeldet: „keine Ansagen mehr über Audio".
 *
 * iOS (und mit anderer Strenge auch Chrome) gibt Ton erst frei, nachdem der
 * Mensch etwas angetippt hat. Das trifft BEIDE Wege hier: `speechSynthesis`
 * schluckt einen Aufruf ausserhalb einer Nutzeraktion stillschweigend, und ein
 * frischer `AudioContext` startet im Zustand `suspended`.
 *
 * Für eine Navigation ist das genau verkehrt herum: die Ansage kommt, wenn
 * 200 m bis zur Abbiegung übrig sind — nicht, wenn jemand tippt. Wer beim
 * Laden nichts anfasst, fährt stumm.
 *
 * Deshalb wird die Freigabe beim ERSTEN Antippen irgendwo in der App geholt,
 * einmalig, mit einer leeren Äusserung und einem stummen Ton. Danach darf die
 * App von sich aus sprechen.
 *
 * Kein Ersatz für Nachdenken, sondern die dokumentierte Voraussetzung der
 * Browser — ohne sie ist die Sprachausgabe auf einem Tablet Glückssache.
 */
let freigegeben = false;

/** Nur für Tests: den Freigabezustand zurücksetzen. */
export function _freigabeZuruecksetzen(): void {
  freigegeben = false;
  entsperrterKontext = null;
}

/**
 * Holt die Tonfreigabe. MUSS aus einem Ereignis heraus gerufen werden, das
 * der Mensch ausgelöst hat — sonst tut sie nichts, und zwar unbemerkt.
 * Mehrfachaufrufe sind harmlos; nur der erste tut etwas.
 */
export function unlockAudio(): void {
  if (freigegeben) return;
  freigegeben = true;

  if (isSpeechAvailable()) {
    try {
      // Eine leere Äusserung ist hörbar nichts und gilt dem Browser trotzdem
      // als „der Mensch wollte Sprachausgabe".
      const stumm = new SpeechSynthesisUtterance('');
      stumm.volume = 0;
      window.speechSynthesis.speak(stumm);
    } catch {
      // Best-effort -- siehe Modulkommentar.
    }
  }

  const Ctx = getAudioContextCtor();
  if (Ctx) {
    try {
      // EINEN Kontext anlegen und behalten: ein in einer Nutzeraktion
      // freigegebener Kontext bleibt freigegeben, ein später frisch
      // erzeugter nicht. Genau daran scheitert der Gong sonst.
      entsperrterKontext = new Ctx();
      void entsperrterKontext.resume().catch(() => undefined);
    } catch {
      entsperrterKontext = null;
    }
  }
}

/** Ob die Tonfreigabe schon geholt wurde. */
export function istAudioFreigegeben(): boolean {
  return freigegeben;
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

/** Der in einer Nutzeraktion freigegebene Kontext -- siehe `unlockAudio`. */
let entsperrterKontext: AudioContext | null = null;

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
    // Den in einer Nutzeraktion freigegebenen Kontext bevorzugen. Ein frisch
    // erzeugter startet auf iOS `suspended` und bleibt stumm -- der Gong
    // spielte dann „erfolgreich" und war nicht zu hoeren.
    const eigener = entsperrterKontext === null;
    const ctx = entsperrterKontext ?? new Ctx();
    void ctx.resume?.().catch(() => undefined);
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
    // Aufraeumen nur, was uns gehoert: den freigegebenen Kontext zu
    // schliessen hiesse, die Freigabe wegzuwerfen.
    if (eigener) {
      window.setTimeout(() => {
        void ctx.close().catch(() => undefined);
      }, 1000);
    }
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
