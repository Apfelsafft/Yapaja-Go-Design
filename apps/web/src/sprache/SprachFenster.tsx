/**
 * Das Sprachfenster: zuhören (wo der Browser darf), sonst tippen; Yapaias
 * Antwort lesen und hören.
 *
 * Gewünscht: „Bitte fahre mich zur Ziolkowskistraße nach Magdeburg", „Wo ist
 * die nächste Tankstelle?", „Stoppe Navigation", „Lies mir die nächste
 * Verkehrsinfo auf der Route vor".
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSprachStore } from './sprachStore.js';
import { erkennungVerfuegbar, hoereZu } from './erkennung.js';
import { cancelSpeech, unlockAudio } from '../drive/tts.js';
import { useBedienSeite } from '../shell/bedienSeite.js';
import { useSchmal } from '../shell/useSchmal.js';

const BEISPIELE = [
  'Fahre mich nach Magdeburg',
  'Wo ist die nächste Tankstelle?',
  'Lies die Verkehrsmeldungen vor',
  'Wann sind wir da?',
  'Stoppe die Navigation',
];

function km(m: number | null | undefined): string {
  if (typeof m !== 'number') return '';
  return m < 1000 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

/** Wartet, bis die Sprachausgabe fertig ist (höchstens 20 s). */
function nachDemSprechen(fn: () => void): () => void {
  const start = Date.now();
  const id = window.setInterval(() => {
    const spricht = typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis.speaking;
    if (!spricht || Date.now() - start > 20_000) {
      window.clearInterval(id);
      fn();
    }
  }, 250);
  return () => window.clearInterval(id);
}

export default function SprachFenster(): React.ReactElement | null {
  const s = useSprachStore();
  const seite = useBedienSeite();
  const schmal = useSchmal();
  const [eingabe, setEingabe] = useState('');
  const abbrechen = useRef<(() => void) | null>(null);
  const verfuegbar = erkennungVerfuegbar();
  const unten = useRef<HTMLDivElement | null>(null);

  const zuhoeren = useCallback(() => {
    if (verfuegbar !== 'ja') return;
    cancelSpeech();
    useSprachStore.getState().setHoert(true);
    abbrechen.current = hoereZu(
      (t) => useSprachStore.getState().setZwischen(t),
      (text, fehler) => {
        abbrechen.current = null;
        const st = useSprachStore.getState();
        st.setHoert(false);
        if (text) void st.sende(text);
        else if (fehler) st.setZwischen(fehler);
      },
    );
  }, [verfuegbar]);

  // Beim Öffnen gleich zuhören (wo es geht).
  useEffect(() => {
    if (!s.offen) return undefined;
    unlockAudio();
    if (verfuegbar === 'ja') zuhoeren();
    return () => abbrechen.current?.();
  }, [s.offen]);

  // Nach einer Rückfrage („Soll ich losfahren?") wieder zuhören, sobald die
  // Antwort ausgesprochen ist.
  useEffect(() => {
    if (!s.offen || !s.rueckfrage || s.denkt || s.hoert || verfuegbar !== 'ja') return undefined;
    return nachDemSprechen(zuhoeren);
  }, [s.offen, s.rueckfrage, s.denkt, s.hoert, verfuegbar, zuhoeren]);

  useEffect(() => {
    unten.current?.scrollIntoView({ block: 'end' });
  }, [s.verlauf.length]);

  if (!s.offen) return null;

  const senden = (text: string): void => {
    setEingabe('');
    void s.sende(text);
  };

  return createPortal(
    <div
      role="dialog"
      aria-label="Sprachbefehl"
      className="pointer-events-auto fixed z-50 flex max-h-[calc(var(--sicht-h,100vh)*0.7)] flex-col rounded-2xl bg-white text-sm text-slate-800 shadow-2xl dark:bg-slate-800 dark:text-slate-100"
      style={
        schmal
          ? { left: 8, right: 8, bottom: 8 }
          : { [seite]: 12, bottom: 12, width: 'min(400px, calc(100% - 24px))' }
      }
      data-testid="sprach-fenster"
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <span className="text-lg" aria-hidden="true">
          🎤
        </span>
        <h2 className="flex-1 font-semibold">Yapaia</h2>
        <button
          type="button"
          onClick={() => {
            abbrechen.current?.();
            cancelSpeech();
            s.schliesse();
          }}
          aria-label="Sprachfenster schließen"
          className="h-9 w-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
          data-testid="sprach-schliessen"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3" data-testid="sprach-verlauf">
        {s.verlauf.length === 0 && (
          <div className="space-y-2 text-slate-500 dark:text-slate-400">
            <p>Sag oder tippe zum Beispiel:</p>
            <ul className="flex flex-wrap gap-1">
              {BEISPIELE.map((b) => (
                <li key={b}>
                  <button
                    type="button"
                    onClick={() => senden(b)}
                    className="rounded-full bg-slate-100 px-3 py-1 text-xs hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
                  >
                    {b}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {s.verlauf.map((z, i) => (
          <p
            key={i}
            className={
              z.wer === 'du'
                ? 'ml-8 rounded-xl bg-blue-600 px-3 py-2 text-white'
                : 'mr-8 rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-700'
            }
            data-testid={z.wer === 'yapaia' ? 'sprach-antwort' : 'sprach-frage'}
          >
            {z.text}
          </p>
        ))}
        {s.auswahl.length > 0 && (
          <ol className="space-y-1" data-testid="sprach-auswahl">
            {s.auswahl.map((t, i) => (
              <li key={`${t.lat},${t.lon}`}>
                <button
                  type="button"
                  onClick={() => senden(`nummer ${i + 1}`)}
                  className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
                >
                  <span className="font-semibold">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate">{t.beschreibung}</span>
                  <span className="text-xs text-slate-500">{km(t.entfernung_m)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {s.rueckfrage && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => senden('ja')}
              className="flex-1 rounded-full bg-blue-600 px-4 py-2 font-semibold text-white"
              data-testid="sprach-ja"
            >
              Ja
            </button>
            <button
              type="button"
              onClick={() => senden('nein')}
              className="flex-1 rounded-full border border-slate-300 px-4 py-2 dark:border-slate-600"
              data-testid="sprach-nein"
            >
              Nein
            </button>
          </div>
        )}
        {(s.hoert || s.zwischen) && (
          <p className="italic text-slate-500 dark:text-slate-400" data-testid="sprach-zwischen">
            {s.hoert ? `Ich höre zu … ${s.zwischen}` : s.zwischen}
          </p>
        )}
        {s.denkt && <p className="text-slate-500">…</p>}
        <div ref={unten} />
      </div>

      <form
        className="flex items-center gap-2 border-t border-slate-200 px-3 py-2 dark:border-slate-700"
        onSubmit={(e) => {
          e.preventDefault();
          senden(eingabe);
        }}
      >
        <input
          value={eingabe}
          onChange={(e) => setEingabe(e.target.value)}
          placeholder={verfuegbar === 'ja' ? 'Oder tippen …' : 'Befehl tippen …'}
          enterKeyHint="send"
          className="min-w-0 flex-1 rounded-full border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-700"
          data-testid="sprach-eingabe"
        />
        {verfuegbar === 'ja' ? (
          <button
            type="button"
            onClick={() => (s.hoert ? abbrechen.current?.() : zuhoeren())}
            aria-pressed={s.hoert}
            aria-label={s.hoert ? 'Zuhören beenden' : 'Sprechen'}
            className={`flex h-10 w-10 items-center justify-center rounded-full text-lg ${
              s.hoert ? 'animate-pulse bg-red-600 text-white' : 'bg-blue-600 text-white'
            }`}
            data-testid="sprach-mikrofon"
          >
            🎤
          </button>
        ) : (
          <button
            type="submit"
            className="rounded-full bg-blue-600 px-4 py-2 font-semibold text-white"
            data-testid="sprach-senden"
          >
            Senden
          </button>
        )}
      </form>
      {verfuegbar !== 'ja' && (
        <p className="px-4 pb-3 text-xs text-slate-500 dark:text-slate-400" data-testid="sprach-kein-mikrofon">
          {verfuegbar === 'kein-https'
            ? 'Sprechen geht hier nicht: Browser geben das Mikrofon nur über HTTPS frei. Sprich stattdessen über Home Assistant Assist (Satellit oder Assist-Knopf in der Home-Assistant-App).'
            : 'Dieser Browser kann keine Sprache erkennen. Tippe den Befehl oder nutze Home Assistant Assist.'}
        </p>
      )}
    </div>,
    document.getElementById('yapaia-sicht') ?? document.body,
  );
}
