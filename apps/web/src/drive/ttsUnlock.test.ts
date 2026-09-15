/**
 * Die Tonfreigabe.
 *
 * Gemeldet: „keine Ansagen mehr über Audio." Browser geben Ton erst frei,
 * nachdem der Mensch etwas angetippt hat — für eine Navigation ist das genau
 * verkehrt herum, denn die Ansage kommt, wenn 200 m bis zur Abbiegung übrig
 * sind, nicht wenn jemand tippt.
 *
 * Geprüft wird an gefälschten Browser-APIs, weil es genau um deren Verhalten
 * geht: ob `speak` überhaupt gerufen wird und ob der Klangkontext fortgesetzt
 * statt weggeworfen wird.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  _freigabeZuruecksetzen,
  istAudioFreigegeben,
  playGong,
  unlockAudio,
} from './tts.js';

interface Aufzeichnung {
  gesprochen: unknown[];
  fortgesetzt: number;
  geschlossen: number;
  kontexte: number;
}

function browserFaelschen(mit: { sprache?: boolean; klang?: boolean } = {}): Aufzeichnung {
  const { sprache = true, klang = true } = mit;
  const a: Aufzeichnung = { gesprochen: [], fortgesetzt: 0, geschlossen: 0, kontexte: 0 };

  const fensterr: Record<string, unknown> = {
    setTimeout: (fn: () => void) => globalThis.setTimeout(fn, 0),
  };

  if (sprache) {
    fensterr.speechSynthesis = {
      speak: (u: unknown) => a.gesprochen.push(u),
      cancel: () => undefined,
    };
    fensterr.SpeechSynthesisUtterance = class {
      volume = 1;
      lang = '';
      constructor(public text: string) {}
    };
    vi.stubGlobal('SpeechSynthesisUtterance', fensterr.SpeechSynthesisUtterance);
  }

  if (klang) {
    fensterr.AudioContext = class {
      currentTime = 0;
      destination = {};
      constructor() {
        a.kontexte++;
      }
      resume(): Promise<void> {
        a.fortgesetzt++;
        return Promise.resolve();
      }
      close(): Promise<void> {
        a.geschlossen++;
        return Promise.resolve();
      }
      createOscillator(): unknown {
        return {
          type: '',
          frequency: { value: 0 },
          connect: () => undefined,
          start: () => undefined,
          stop: () => undefined,
        };
      }
      createGain(): unknown {
        return {
          gain: {
            setValueAtTime: () => undefined,
            exponentialRampToValueAtTime: () => undefined,
          },
          connect: () => undefined,
        };
      }
    };
  }

  vi.stubGlobal('window', fensterr);
  return a;
}

describe('Tonfreigabe', () => {
  beforeEach(() => {
    _freigabeZuruecksetzen();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _freigabeZuruecksetzen();
  });

  it('spricht bei der Freigabe eine STUMME Äusserung', () => {
    const a = browserFaelschen();
    unlockAudio();
    expect(a.gesprochen).toHaveLength(1);
    // Hörbar nichts -- und für den Browser trotzdem „der Mensch wollte Ton".
    expect((a.gesprochen[0] as { text: string }).text).toBe('');
    expect((a.gesprochen[0] as { volume: number }).volume).toBe(0);
  });

  it('setzt den Klangkontext fort — ein frischer startet gesperrt', () => {
    const a = browserFaelschen();
    unlockAudio();
    expect(a.fortgesetzt).toBeGreaterThan(0);
  });

  it('tut beim zweiten Mal nichts mehr', () => {
    // Sonst spräche jede Berührung eine weitere leere Äusserung, und der
    // Klangkontext würde bei jedem Antippen neu angelegt.
    const a = browserFaelschen();
    unlockAudio();
    unlockAudio();
    unlockAudio();
    expect(a.gesprochen).toHaveLength(1);
    expect(a.kontexte).toBe(1);
  });

  it('meldet den Freigabezustand', () => {
    browserFaelschen();
    expect(istAudioFreigegeben()).toBe(false);
    unlockAudio();
    expect(istAudioFreigegeben()).toBe(true);
  });

  it('wirft den freigegebenen Kontext beim Gong NICHT weg', async () => {
    // Der eigentliche Fehler, wenn man ihn schlösse: der nächste Gong legte
    // einen frischen an, der auf iOS gesperrt startet -- er spielte
    // „erfolgreich" und wäre nicht zu hören.
    //
    // Das Abwarten ist nicht Zierde: das Aufräumen steht in einem
    // `setTimeout`. Ohne Abwarten prüft die Zusicherung, BEVOR überhaupt
    // etwas geschlossen werden könnte -- und hielte dann auch dann, wenn der
    // Kontext eine Millisekunde später weggeworfen wird.
    const a = browserFaelschen();
    unlockAudio();
    playGong();
    await new Promise((r) => globalThis.setTimeout(r, 5));
    expect(a.geschlossen).toBe(0);
    expect(a.kontexte, 'kein zweiter Kontext').toBe(1);
  });

  it('räumt einen selbst angelegten Kontext dagegen auf', async () => {
    // Ohne vorherige Freigabe gehört der Kontext dem Gong -- dann muss er weg.
    const a = browserFaelschen();
    playGong();
    await new Promise((r) => globalThis.setTimeout(r, 5));
    expect(a.kontexte).toBe(1);
    expect(a.geschlossen).toBe(1);
  });

  it('kommt ohne Sprachausgabe im Browser zurecht', () => {
    const a = browserFaelschen({ sprache: false });
    expect(() => unlockAudio()).not.toThrow();
    expect(a.fortgesetzt).toBeGreaterThan(0);
  });

  it('kommt ohne Klang-API zurecht', () => {
    const a = browserFaelschen({ klang: false });
    expect(() => unlockAudio()).not.toThrow();
    expect(a.gesprochen).toHaveLength(1);
  });
});
