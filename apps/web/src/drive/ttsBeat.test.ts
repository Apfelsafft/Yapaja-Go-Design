/**
 * Spricht Go selbst im Browser, hält das iPad das Radio von Yapaia Beat im
 * selben Fenster an. Go meldet Beginn und Ende -- Beat spielt danach weiter.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { beatImBrowser, speak } from './tts.js';

class Aeusserung {
  lang = '';
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

function browser(beat: object | undefined) {
  const gesprochen: Aeusserung[] = [];
  const w = {
    speechSynthesis: { cancel: vi.fn(), speak: (u: Aeusserung) => gesprochen.push(u) },
    SpeechSynthesisUtterance: Aeusserung,
    top: beat ? { YapaiaBeatPlayer: beat } : null,
  };
  vi.stubGlobal('window', w);
  vi.stubGlobal('SpeechSynthesisUtterance', Aeusserung);
  return gesprochen;
}

afterEach(() => vi.unstubAllGlobals());

describe('speak + Yapaia Beat im Browser', () => {
  it('Beat erfährt Beginn und Ende -- nur die letzte Ansage gibt frei', () => {
    const beat = { wanted: true, ansageBeginnt: vi.fn(), ansageEndet: vi.fn() };
    const gesprochen = browser(beat);
    speak('alt');
    speak('neu');
    expect(beat.ansageBeginnt).toHaveBeenCalledTimes(2);
    gesprochen[0]!.onerror?.(); // „alt" wurde abgebrochen
    expect(beat.ansageEndet).not.toHaveBeenCalled();
    gesprochen[1]!.onend?.();
    expect(beat.ansageEndet).toHaveBeenCalledTimes(1);
  });

  it('ohne Beat oder ohne Ton im Browser: nichts', () => {
    browser(undefined);
    expect(beatImBrowser()).toBeNull();
    expect(() => speak('x')).not.toThrow();
    const aus = { wanted: false, ansageBeginnt: vi.fn() };
    browser(aus);
    speak('x');
    expect(aus.ansageBeginnt).not.toHaveBeenCalled();
  });
});
