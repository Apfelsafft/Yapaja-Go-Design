/**
 * Die Dashboard-Karte — die beiden Fehler, an denen sie bis 0.6.8 scheiterte.
 *
 * ─── WARUM ES DIESE DATEI GIBT ──────────────────────────────────────────────
 * Der Betreiber hat gemeldet: „Die Möglichkeit die Karte in einem eigenen
 * Dashboard anzuzeigen klappt nicht." Nachgesehen — und zwar in den Quellen
 * von Home Assistant und des Supervisors, nicht geraten — waren es zwei
 * Ursachen, die BEIDE für sich genügt hätten:
 *
 *   1. der fest eingetragene Slug `yapaja_go` (der Supervisor stellt die
 *      Herkunft voran, bei einem eigenen Repository eine Prüfsumme),
 *   2. das nie gesetzte Cookie `ingress_session`.
 *
 * Beide sind unsichtbar: die Kachel zeigt „lädt" oder bleibt leer. Genau
 * deshalb steht hier für jeden ein eigener Test.
 *
 * Geprüft wird die Logik, nicht das Element: alles, was der Browser braucht
 * (`HTMLElement`, `customElements`), wird in `yapaja-map-card.js` erst dann
 * angefasst, wenn es da ist — sonst liesse sich hier gar nichts prüfen.
 */

import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error -- reines Browser-Modul ohne Typen; hier zählt das Verhalten.
import {
  ADDON_SLUG,
  IngressVerbindung,
  beschreibeFehler,
  ingressCookie,
  istUnserSlug,
  rahmenUrl,
  slugKandidaten,
} from './yapaja-map-card.js';

/** Ein `hass`, dessen `callWS` sich je Endpunkt steuern lässt. */
function hassBauen(antworten: Record<string, unknown>, panels: unknown = {}) {
  const rufe: Array<{ endpoint: string; method: string; data?: unknown }> = [];
  return {
    rufe,
    hass: {
      panels,
      callWS: vi.fn(async (nachricht: { endpoint: string; method: string; data?: unknown }) => {
        rufe.push({
          endpoint: nachricht.endpoint,
          method: nachricht.method,
          data: nachricht.data,
        });
        const antwort = antworten[nachricht.endpoint];
        if (antwort === undefined) throw new Error(`not found: ${nachricht.endpoint}`);
        if (antwort instanceof Error) throw antwort;
        return antwort;
      }),
    },
  };
}

function verbindungBauen(hass: unknown) {
  const cookies: string[] = [];
  const verbindung = new IngressVerbindung(
    () => hass,
    (c: string) => cookies.push(c),
    () => false,
  );
  return { verbindung, cookies };
}

describe('welche Slugs überhaupt in Frage kommen', () => {
  it('erkennt die vorangestellte Herkunft', () => {
    // `supervisor/store/data.py`: f"{repository}_{app[ATTR_SLUG]}"
    expect(istUnserSlug('yapaja_go')).toBe(true);
    expect(istUnserSlug('local_yapaja_go')).toBe(true);
    expect(istUnserSlug('a0d7b954_yapaja_go')).toBe(true);
    expect(istUnserSlug('yapaja_go_alt')).toBe(false);
    expect(istUnserSlug('etwas_anderes')).toBe(false);
  });

  it('nimmt den Slug aus den Panels von Home Assistant', () => {
    // So legt HA ihn an: `hassio/addon_panel.py`, config={"addon": addon}.
    const panels = {
      'abc123_yapaja_go': { url_path: 'abc123_yapaja_go', config: { addon: 'abc123_yapaja_go' } },
      mosquitto: { url_path: 'mosquitto', config: { addon: 'core_mosquitto' } },
    };
    expect(slugKandidaten({}, { panels })[0]).toBe('abc123_yapaja_go');
  });

  it('lässt den eingetragenen Slug immer gewinnen', () => {
    const panels = { x: { config: { addon: 'abc123_yapaja_go' } } };
    expect(slugKandidaten({ addon: 'von_hand' }, { panels })[0]).toBe('von_hand');
  });

  it('kennt auch ohne Panels die beiden gängigen Formen', () => {
    expect(slugKandidaten({}, {})).toEqual([ADDON_SLUG, `local_${ADDON_SLUG}`]);
  });

  it('nennt keinen Slug doppelt', () => {
    const panels = { yapaja_go: { url_path: 'yapaja_go', config: { addon: 'yapaja_go' } } };
    const kandidaten = slugKandidaten({ addon: 'yapaja_go' }, { panels });
    expect(kandidaten.filter((k: string) => k === 'yapaja_go')).toHaveLength(1);
  });
});

describe('das Cookie, ohne das der Rahmen 401 bekommt', () => {
  it('sieht aus wie das von Home Assistant', () => {
    expect(ingressCookie('abc', false)).toBe(
      'ingress_session=abc;path=/api/hassio_ingress/;SameSite=Strict',
    );
  });

  it('trägt „Secure" nur über HTTPS', () => {
    // Mit `Secure` über einfaches HTTP verwirft der Browser das Cookie --
    // und genau über HTTP läuft diese Installation.
    expect(ingressCookie('abc', true)).toContain(';Secure');
    expect(ingressCookie('abc', false)).not.toContain('Secure');
  });
});

describe('der Handschlag mit dem Ingress', () => {
  it('findet das Add-on hinter der Prüfsumme und setzt das Cookie', async () => {
    const { hass, rufe } = hassBauen(
      {
        '/addons/abc123_yapaja_go/info': { state: 'started', ingress_url: '/api/hassio_ingress/t0' },
        '/ingress/session': { session: 'sitzung-1' },
      },
      { p: { config: { addon: 'abc123_yapaja_go' } } },
    );
    const { verbindung, cookies } = verbindungBauen(hass);

    const ergebnis = await verbindung.verbinden({});

    expect(ergebnis).toEqual({ url: '/api/hassio_ingress/t0/embed.html', slug: 'abc123_yapaja_go' });
    expect(cookies).toEqual(['ingress_session=sitzung-1;path=/api/hassio_ingress/;SameSite=Strict']);
    expect(rufe.map((r) => r.endpoint)).toEqual([
      '/addons/abc123_yapaja_go/info',
      '/ingress/session',
    ]);
  });

  it('probiert die nächste Form, wenn eine nicht gefunden wird', async () => {
    const { hass, rufe } = hassBauen({
      '/addons/local_yapaja_go/info': { state: 'started', ingress_url: '/api/hassio_ingress/t9' },
      '/ingress/session': { session: 's' },
    });
    const { verbindung } = verbindungBauen(hass);

    const ergebnis = await verbindung.verbinden({});
    expect(ergebnis.slug).toBe('local_yapaja_go');
    expect(rufe[0].endpoint).toBe('/addons/yapaja_go/info');
  });

  it('sagt beim gestoppten Add-on, dass es gestoppt ist', async () => {
    // Ohne diese Unterscheidung stünde da „nicht gefunden", und man suchte
    // an der falschen Stelle.
    const { hass } = hassBauen({ '/addons/yapaja_go/info': { state: 'stopped' } });
    const { verbindung } = verbindungBauen(hass);
    await expect(verbindung.verbinden({})).rejects.toThrow(/nicht gestartet/);
  });

  it('nennt die versuchten Slugs, wenn gar nichts passt', async () => {
    const { hass } = hassBauen({});
    const { verbindung } = verbindungBauen(hass);
    await expect(verbindung.verbinden({})).rejects.toThrow(/local_yapaja_go/);
  });

  it('hängt embed.html auch an einen Pfad mit Schrägstrich richtig an', () => {
    expect(rahmenUrl('/api/hassio_ingress/t/')).toBe('/api/hassio_ingress/t/embed.html');
    expect(rahmenUrl('/api/hassio_ingress/t')).toBe('/api/hassio_ingress/t/embed.html');
  });
});

describe('die Sitzung am Leben halten', () => {
  it('bestätigt die laufende Sitzung', async () => {
    const { hass, rufe } = hassBauen({
      '/addons/yapaja_go/info': { state: 'started', ingress_url: '/i/t' },
      '/ingress/session': { session: 's1' },
      '/ingress/validate_session': {},
    });
    const { verbindung, cookies } = verbindungBauen(hass);
    await verbindung.verbinden({});

    expect(await verbindung.verlaengern()).toBe(true);
    expect(rufe.at(-1)).toEqual({
      endpoint: '/ingress/validate_session',
      method: 'post',
      data: { session: 's1' },
    });
    expect(cookies).toHaveLength(1); // kein neues Cookie noetig
  });

  it('legt eine neue an, wenn die alte abgelaufen ist', async () => {
    // Sonst stünde im Dashboard ab diesem Moment ein leerer Kasten -- ohne
    // jede Meldung.
    const antworten: Record<string, unknown> = {
      '/addons/yapaja_go/info': { state: 'started', ingress_url: '/i/t' },
      '/ingress/session': { session: 's1' },
      '/ingress/validate_session': new Error('401'),
    };
    const { hass } = hassBauen(antworten);
    const { verbindung, cookies } = verbindungBauen(hass);
    await verbindung.verbinden({});

    antworten['/ingress/session'] = { session: 's2' };
    expect(await verbindung.verlaengern()).toBe(true);
    expect(cookies).toHaveLength(2);
    expect(cookies[1]).toContain('s2');
  });

  it('meldet ehrlich, wenn auch das nicht klappt', async () => {
    const antworten: Record<string, unknown> = {
      '/addons/yapaja_go/info': { state: 'started', ingress_url: '/i/t' },
      '/ingress/session': { session: 's1' },
      '/ingress/validate_session': new Error('401'),
    };
    const { hass } = hassBauen(antworten);
    const { verbindung } = verbindungBauen(hass);
    await verbindung.verbinden({});

    antworten['/ingress/session'] = new Error('kaputt');
    expect(await verbindung.verlaengern()).toBe(false);
  });

  it('verlängert nichts, was es nicht gibt', async () => {
    const { hass } = hassBauen({});
    const { verbindung } = verbindungBauen(hass);
    expect(await verbindung.verlaengern()).toBe(false);
    expect(hass.callWS).not.toHaveBeenCalled();
  });
});

describe('Fehlertexte', () => {
  it('nehmen die Meldung, wenn es eine gibt', () => {
    expect(beschreibeFehler(new Error('so nicht'))).toBe('so nicht');
    expect(beschreibeFehler('roh')).toBe('roh');
  });

  it('erklären die 401 statt sie nur zu nennen', () => {
    expect(beschreibeFehler({ status_code: 401 })).toContain('abgelehnt');
  });

  it('kommen auch mit nichts klar', () => {
    expect(beschreibeFehler(null)).toBe('Unbekannter Fehler.');
  });
});

describe('ohne Browser tut das Modul nichts', () => {
  it('registriert kein Element', () => {
    // Der Test selbst ist der Beweis: liefe beim Import
    // `customElements.define`, wäre diese Datei gar nicht erst geladen.
    expect(typeof customElements).toBe('undefined');
  });
});
