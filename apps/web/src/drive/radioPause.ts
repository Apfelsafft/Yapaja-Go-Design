/**
 * Vor einer Ansage im Browser das Radio anhalten (Yapaia Beat).
 *
 * Gemeldet: „Toll wäre, wenn es für die Ansage die aktuelle Musik
 * unterbricht und danach die Musik wieder hörbar ist." Der Kern hält das
 * Radio über Home Assistant an und startet es nach der Sprechdauer wieder
 * (`apps/core/src/ha/ansagePause.ts`). Er antwortet, sobald es still ist --
 * dann erst wird gesprochen.
 *
 * Höchstens {@link WARTE_MS} Wartezeit: eine Abbiege-Ansage darf nicht
 * deshalb zu spät kommen, weil Home Assistant trödelt. Kommt in der Zeit eine
 * neuere Ansage, entfällt die ältere (wie in `tts.ts#speak`).
 */

export const WARTE_MS = 1_500;

let folge = 0;

export function ansageNachRadioPause(text: string, sprich: (text: string) => void): Promise<void> {
  const meine = ++folge;
  const anfrage = fetch(`${import.meta.env.BASE_URL}api/v1/ansage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then(
    () => undefined,
    () => undefined,
  );
  const frist = new Promise<void>((r) => window.setTimeout(r, WARTE_MS));
  return Promise.race([anfrage, frist]).then(() => {
    if (meine === folge) sprich(text);
  });
}
