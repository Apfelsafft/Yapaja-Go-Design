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

/**
 * Beats Player für Music Assistant in diesem Browser („Yapaia iPad"), wenn
 * er gerade spielt. Er lebt im Home-Assistant-Fenster (Yapaia Beat ≥ 1.9).
 */
export interface BrowserPlayer {
  name: string;
  hoertHier(): boolean;
  sprich(url: string): Promise<boolean>;
}

export function browserPlayer(): BrowserPlayer | null {
  try {
    const p = (window.top as unknown as { YapaiaBeatMa?: Partial<BrowserPlayer> } | null)?.YapaiaBeatMa;
    if (p && typeof p.sprich === 'function' && typeof p.hoertHier === 'function' && typeof p.name === 'string' && p.hoertHier()) {
      return p as BrowserPlayer;
    }
  } catch {
    // anderes Fenster (nicht Home Assistant): gibt es nicht
  }
  return null;
}

export interface AnsageErgebnis {
  /** `radio`: Beat mischt; `browser`: dieser Browser hat eingemischt; `selbst`: die App spricht. */
  weg: 'radio' | 'browser' | 'selbst';
}

export async function sageAn(
  text: string,
  prioritaet: Prioritaet,
  sprich: (text: string) => void,
): Promise<AnsageErgebnis> {
  const meine = ++folge;
  const abbruch = new AbortController();
  const frist = window.setTimeout(() => abbruch.abort(), WARTE_MS);
  const player = browserPlayer();
  let weg: AnsageErgebnis['weg'] = 'selbst';
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}api/v1/ansage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, prioritaet, ...(player ? { browser_player: player.name } : {}) }),
      signal: abbruch.signal,
    });
    if (r.ok) {
      const d = ((await r.json()) as { data?: { ueber_radio?: boolean; im_browser?: { pfad?: string } } }).data;
      if (d?.im_browser?.pfad && player) {
        // Die Musik spielt hier: einmischen, ohne den Vorrat von Music
        // Assistant -- die Ansage kommt sofort.
        if (meine !== folge) return { weg: 'browser' };
        if (await player.sprich(`${window.location.origin}${d.im_browser.pfad}`)) return { weg: 'browser' };
      } else if (d?.ueber_radio) {
        weg = 'radio';
      }
    }
  } catch {
    // Kein Kern, kein Home Assistant, zu langsam: selbst sprechen.
  } finally {
    window.clearTimeout(frist);
  }
  if (weg === 'selbst' && meine === folge) sprich(text);
  return { weg };
}
