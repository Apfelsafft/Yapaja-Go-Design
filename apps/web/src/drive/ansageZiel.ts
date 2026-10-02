/**
 * Eine Ansage der App -- ins laufende Radio oder selbst gesprochen.
 *
 * Läuft Yapaia Beat, mischt es die Ansage ein: Musik leiser, Ansage
 * darüber, Musik wieder lauter (`apps/core/src/ha/beatAnsage.ts`). Dann
 * spricht die App NICHT zusätzlich. Sonst -- kein Beat, Radio aus, kein Home
 * Assistant -- spricht die App wie bisher selbst.
 *
 * Höchstens {@link WARTE_MS}: dauert das Erzeugen der Sprache länger, spricht
 * die App lieber selbst, als eine Abbiege-Ansage zu verpassen. Kommt in der
 * Zeit eine neuere Ansage, entfällt die ältere (wie in `tts.ts#speak`).
 */

export const WARTE_MS = 8_000;

export type Prioritaet = 'navigation' | 'hinweis' | 'info';

let folge = 0;

export async function sageAn(text: string, prioritaet: Prioritaet, sprich: (text: string) => void): Promise<void> {
  const meine = ++folge;
  const abbruch = new AbortController();
  const frist = window.setTimeout(() => abbruch.abort(), WARTE_MS);
  let ueberRadio = false;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}api/v1/ansage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, prioritaet }),
      signal: abbruch.signal,
    });
    if (r.ok) ueberRadio = Boolean(((await r.json()) as { data?: { ueber_radio?: boolean } }).data?.ueber_radio);
  } catch {
    // Kein Kern, kein Home Assistant, zu langsam: selbst sprechen.
  } finally {
    window.clearTimeout(frist);
  }
  if (!ueberRadio && meine === folge) sprich(text);
}
