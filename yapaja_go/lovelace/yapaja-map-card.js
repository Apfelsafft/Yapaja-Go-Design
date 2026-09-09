/**
 * Yapaia Go — Lovelace-Karte: die Karte mit eingezeichneter Route.
 *
 * ─── WOFUER ─────────────────────────────────────────────────────────────────
 * Gefragt: „Die Idee des Navi in HA war ja, die Navigation oder auch nur Teile
 * davon in eigene Dashboards zu integrieren. Bspw. die Karte mit
 * eingezeichneter Route."
 *
 * Alle ZAHLEN (nächste Abbiegung, Entfernung, ETA, Tempo …) liegen als
 * MQTT-Entitäten vor und brauchen keine eigene Karte — dafür reichen die
 * Standard-Karten von Home Assistant (siehe `dashboard.yaml` daneben). Was es
 * NICHT als Entität gibt, ist die Karte selbst mit Route und Offline-Kacheln.
 * Genau die zeigt diese Karte.
 *
 * ─── WARUM EIN RAHMEN UND KEIN NACHBAU ──────────────────────────────────────
 * Die Route, die Offline-Kacheln, die fünf Kartenstile, die eigene Position —
 * das alles gibt es im Add-on bereits und funktioniert dort. Es hier ein
 * zweites Mal zu bauen hiesse, zwei Karten parallel zu pflegen, die
 * auseinanderlaufen. Diese Karte zeigt deshalb die ANZEIGESEITE des Add-ons
 * (`embed.html`): dieselbe Karte, dieselbe Route, ohne Bedienelemente.
 *
 * ─── WAS BIS 0.6.8 FEHLTE, UND WARUM DIE KARTE DESHALB LEER BLIEB ───────────
 * Zwei Fehler, jeder für sich schon genug, um die Kachel unbrauchbar zu
 * machen. Beide sind nachgeschlagen, nicht geraten:
 *
 *  1. DER SLUG. Hier stand fest `yapaja_go`. So heisst das Add-on aber nur,
 *     wenn es aus dem EINGEBAUTEN Store käme. Der Supervisor setzt dem Slug
 *     die Herkunft voran (`supervisor/store/data.py`:
 *     `f"{repository}_{app[ATTR_SLUG]}"`) — bei einem eigenen Repository also
 *     eine Prüfsumme, bei lokaler Ablage `local_`. Die Abfrage lief damit ins
 *     Leere: „Add-on nicht gefunden".
 *
 *  2. DAS SITZUNGS-COOKIE. Die Sitzung wurde angelegt — und weggeworfen. Der
 *     Rückgabewert von `/ingress/session` ist genau die Zeichenkette, die als
 *     Cookie `ingress_session` gesetzt werden MUSS; Home Assistants eigene
 *     Oberfläche tut nichts anderes (`frontend/src/data/hassio/ingress.ts`).
 *     Ohne dieses Cookie beantwortet der Ingress jeden Aufruf mit 401, und im
 *     Rahmen steht nichts.
 *
 * Beide Abfragen laufen jetzt über `hass.callWS({type: 'supervisor/api'})`.
 * Das ist der Weg, den Home Assistant selbst nimmt, und die drei benötigten
 * Endpunkte (`/addons/<slug>/info`, `/ingress/session`,
 * `/ingress/validate_session`) sind dort ausdrücklich auch OHNE
 * Administratorrechte erlaubt (`hassio/websocket_api.py`).
 *
 * ─── WARUM DIE SITZUNG VERLAENGERT WIRD ─────────────────────────────────────
 * Eine Ingress-Sitzung läuft ab. Ein Dashboard, das im Wohnmobil stundenlang
 * offen steht, wäre sonst nach kurzer Zeit ein leerer Kasten — und zwar ohne
 * jede Meldung. Deshalb wird sie regelmässig bestätigt, solange die Karte am
 * Dashboard hängt, und beim Abhängen wieder eingestellt.
 *
 * ─── EINRICHTUNG ────────────────────────────────────────────────────────────
 *   Einstellungen → Dashboards → ⋮ → Ressourcen → Ressource hinzufügen
 *     URL: /local/yapaja/yapaja-map-card.js      Typ: JavaScript-Modul
 *
 * Danach im Dashboard:
 *   type: custom:yapaja-map-card
 *   height: 400            # optional, Vorgabe 400
 *   title: Route           # optional
 *   addon: abcd1234_yapaja_go   # optional, nur falls die Suche danebenliegt
 */

export const CARD_TAG = 'yapaja-map-card';
export const DEFAULT_HEIGHT = 400;

/** Der Slug aus `yapaja_go/config.yaml` — ohne die Herkunft davor. */
export const ADDON_SLUG = 'yapaja_go';

/** Wie oft die Ingress-Sitzung bestätigt wird (ms). */
export const SESSION_REFRESH_MS = 60_000;

/**
 * Alle Slugs, unter denen dieses Add-on stecken kann — in der Reihenfolge,
 * in der es sich zu suchen lohnt.
 *
 * `hass.panels` ist die verlässlichste Quelle: Home Assistant legt für jedes
 * Ingress-Add-on einen Eintrag mit `config: {addon: '<slug>'}` an
 * (`hassio/addon_panel.py`). Dahinter stehen die beiden Formen, die ohne
 * Panel-Eintrag noch in Frage kommen.
 */
export function slugKandidaten(config, hass) {
  const gefunden = [];
  const merken = (wert) => {
    if (typeof wert === 'string' && wert.length > 0 && !gefunden.includes(wert)) {
      gefunden.push(wert);
    }
  };

  merken(config && config.addon);

  const panels = (hass && hass.panels) || {};
  for (const schluessel of Object.keys(panels)) {
    const panel = panels[schluessel] || {};
    const ausConfig = panel.config && panel.config.addon;
    for (const kandidat of [ausConfig, panel.url_path, schluessel]) {
      if (typeof kandidat === 'string' && istUnserSlug(kandidat)) merken(kandidat);
    }
  }

  merken(ADDON_SLUG);
  merken(`local_${ADDON_SLUG}`);
  return gefunden;
}

/** `yapaja_go` selbst oder mit vorangestellter Herkunft (`local_`, Prüfsumme). */
export function istUnserSlug(slug) {
  return slug === ADDON_SLUG || slug.endsWith(`_${ADDON_SLUG}`);
}

/**
 * Das Cookie, ohne das der Rahmen eine 401 bekommt.
 *
 * `path` und `SameSite` wie in Home Assistants eigener Oberfläche; `Secure`
 * nur über HTTPS — mit `Secure` über einfaches HTTP würde der Browser das
 * Cookie verwerfen, und diese Installation läuft über HTTP.
 */
export function ingressCookie(session, sicher) {
  const secure = sicher ? ';Secure' : '';
  return `ingress_session=${session};path=/api/hassio_ingress/;SameSite=Strict${secure}`;
}

/** Aus dem Ingress-Pfad die Adresse der Anzeigeseite. */
export function rahmenUrl(ingressUrl) {
  const basis = ingressUrl.endsWith('/') ? ingressUrl : `${ingressUrl}/`;
  return `${basis}embed.html`;
}

/** Macht aus dem, was die Abfrage wirft, einen Satz, mit dem man etwas anfangen kann. */
export function beschreibeFehler(err) {
  if (!err) return 'Unbekannter Fehler.';
  if (typeof err === 'string') return err;
  if (typeof err.message === 'string' && err.message.length > 0) return err.message;
  if (err.status_code === 401 || err.status === 401) {
    return 'Home Assistant hat den Zugriff auf das Add-on abgelehnt (401).';
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Der Handschlag mit dem Ingress: Slug finden, Anzeigeseite bestimmen,
 * Sitzung anlegen und am Leben halten.
 *
 * Kennt weder DOM noch Lovelace — deshalb ist er prüfbar.
 */
export class IngressVerbindung {
  /**
   * @param {() => object} hassGeber      liefert das jeweils aktuelle `hass`
   * @param {(cookie: string) => void} cookieSchreiber
   * @param {() => boolean} istSicher     ob die Seite über HTTPS läuft
   */
  constructor(hassGeber, cookieSchreiber, istSicher) {
    this.hassGeber = hassGeber;
    this.cookieSchreiber = cookieSchreiber;
    this.istSicher = istSicher;
    this.session = null;
    this.slug = null;
  }

  async _ruf(endpoint, method, data) {
    const hass = this.hassGeber();
    if (!hass || typeof hass.callWS !== 'function') {
      throw new Error('Home Assistant ist noch nicht bereit.');
    }
    const nachricht = { type: 'supervisor/api', endpoint, method };
    if (data) nachricht.data = data;
    return hass.callWS(nachricht);
  }

  /** @returns {Promise<{url: string, slug: string}>} */
  async verbinden(config) {
    const kandidaten = slugKandidaten(config, this.hassGeber());
    let letzterFehler = null;
    for (const kandidat of kandidaten) {
      let info;
      try {
        info = await this._ruf(`/addons/${kandidat}/info`, 'get');
      } catch (err) {
        letzterFehler = err;
        continue;
      }
      if (!info || !info.ingress_url) {
        // Gefunden, aber ohne Ingress-Pfad: das passiert genau dann, wenn das
        // Add-on gestoppt ist. Ein anderer Slug hilft dagegen nicht.
        throw new Error(
          info && info.state && info.state !== 'started'
            ? `Das Add-on ist nicht gestartet (Zustand „${info.state}").`
            : 'Das Add-on meldet keinen Ingress-Pfad.',
        );
      }
      this.slug = kandidat;
      await this.sitzungAnlegen();
      return { url: rahmenUrl(info.ingress_url), slug: kandidat };
    }
    throw new Error(
      `Kein Add-on mit dem Slug „${ADDON_SLUG}" gefunden (versucht: ${kandidaten.join(', ')}). ` +
        `Ist „Yapaia Go" installiert? Sonst den echten Slug als „addon:" in der Karte eintragen. ` +
        `Letzte Meldung: ${beschreibeFehler(letzterFehler)}`,
    );
  }

  async sitzungAnlegen() {
    const antwort = await this._ruf('/ingress/session', 'post');
    const session = antwort && antwort.session;
    if (!session) throw new Error('Home Assistant hat keine Ingress-Sitzung geliefert.');
    this.session = session;
    this.cookieSchreiber(ingressCookie(session, this.istSicher()));
    return session;
  }

  /**
   * Bestätigt die laufende Sitzung. Schlägt das fehl (abgelaufen), wird eine
   * neue angelegt — sonst stünde im Dashboard ab da ein leerer Kasten.
   *
   * @returns {Promise<boolean>} ob die Sitzung danach gültig ist
   */
  async verlaengern() {
    if (!this.session) return false;
    try {
      await this._ruf('/ingress/validate_session', 'post', { session: this.session });
      return true;
    } catch {
      try {
        await this.sitzungAnlegen();
        return true;
      } catch {
        return false;
      }
    }
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Das Element selbst. Erst hier kommt der Browser ins Spiel — deshalb wird
 * die Klasse auch erst gebaut, wenn es einen gibt. So lässt sich alles
 * darüber ohne Browser prüfen.
 */
function kartenKlasse() {
  return class YapaiaMapCard extends HTMLElement {
    constructor() {
      super();
      this._config = { height: DEFAULT_HEIGHT, title: null };
      this._hass = null;
      this._frameUrl = null;
      this._error = null;
      this._loading = false;
      this._rendered = false;
      this._timer = null;
      this._ingress = new IngressVerbindung(
        () => this._hass,
        (cookie) => {
          document.cookie = cookie;
        },
        () => location.protocol === 'https:',
      );
    }

    setConfig(config) {
      const height = config && config.height;
      if (height !== undefined && (typeof height !== 'number' || height <= 0)) {
        throw new Error('height muss eine positive Zahl sein (Pixel).');
      }
      const addon = config && config.addon;
      if (addon !== undefined && typeof addon !== 'string') {
        throw new Error('addon muss der Slug des Add-ons sein (Text).');
      }
      this._config = {
        height: height || DEFAULT_HEIGHT,
        title: (config && config.title) || null,
        addon: addon || null,
      };
      this._rendered = false;
      this._render();
    }

    set hass(hass) {
      const erstes = this._hass === null;
      this._hass = hass;
      // Der Ingress-Pfad wird EINMAL geholt, nicht bei jedem `hass`-Update:
      // Home Assistant setzt diese Eigenschaft bei jeder Zustandsänderung im
      // ganzen System neu, also viele Male pro Minute.
      if (erstes && !this._frameUrl && !this._loading) {
        void this._verbinden();
      }
    }

    connectedCallback() {
      this._timerStarten();
    }

    disconnectedCallback() {
      this._timerStoppen();
    }

    getCardSize() {
      return Math.max(1, Math.ceil(this._config.height / 50));
    }

    _timerStarten() {
      if (this._timer !== null) return;
      this._timer = setInterval(() => {
        if (this._frameUrl) {
          void this._ingress.verlaengern();
        } else if (this._hass && !this._loading) {
          // Zweiter Zweck desselben Taktes: ein neuer Versuch, solange es
          // noch nicht geklappt hat. Wer das Dashboard aufruft, waehrend das
          // Add-on gerade neu startet, saehe sonst bis zum naechsten
          // Neuladen der Seite eine Fehlermeldung -- obwohl laengst alles
          // wieder laeuft.
          void this._verbinden();
        }
      }, SESSION_REFRESH_MS);
    }

    _timerStoppen() {
      if (this._timer === null) return;
      clearInterval(this._timer);
      this._timer = null;
    }

    async _verbinden() {
      if (!this._hass) return;
      this._loading = true;
      this._error = null;
      this._render();
      try {
        const { url } = await this._ingress.verbinden(this._config);
        this._frameUrl = url;
        this._timerStarten();
      } catch (err) {
        this._frameUrl = null;
        this._error = beschreibeFehler(err);
      } finally {
        this._loading = false;
        this._rendered = false;
        this._render();
      }
    }

    _render() {
      if (!this.shadowRoot) {
        this.attachShadow({ mode: 'open' });
      }
      // Ein bereits stehender Rahmen wird NICHT neu gebaut: jedes Neuaufbauen
      // lädt die Karte neu, und eine Karte, die im Dashboard alle paar
      // Sekunden von vorn beginnt, ist unbrauchbar.
      if (this._rendered && this._frameUrl) return;

      const title = this._config.title
        ? `<div class="title">${escapeHtml(this._config.title)}</div>`
        : '';

      let body;
      if (this._error) {
        body = `<div class="msg error">
                  <div class="msg-head">Die Karte konnte nicht geladen werden.</div>
                  <div class="msg-detail">${escapeHtml(this._error)}</div>
                </div>`;
      } else if (this._loading || !this._frameUrl) {
        body = `<div class="msg">Karte wird geladen …</div>`;
      } else {
        // `allow`: die Anzeigeseite darf die Position nutzen und den
        // Bildschirm wachhalten (dafür ist ein Dashboard im Wohnmobil da).
        body = `<iframe src="${escapeHtml(this._frameUrl)}"
                        title="Yapaia Go — Karte"
                        allow="geolocation; screen-wake-lock"></iframe>`;
      }

      this.shadowRoot.innerHTML = `
        <style>
          ha-card { overflow: hidden; }
          .title {
            padding: 12px 16px 0;
            font-size: var(--ha-card-header-font-size, 24px);
            color: var(--ha-card-header-color, var(--primary-text-color));
          }
          .frame { height: ${this._config.height}px; }
          iframe { width: 100%; height: 100%; border: 0; display: block; }
          .msg {
            height: 100%;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            gap: 6px; padding: 16px; box-sizing: border-box;
            text-align: center; color: var(--secondary-text-color);
          }
          .msg.error { color: var(--error-color, #db4437); }
          .msg-head { font-weight: 500; }
          .msg-detail { font-size: 0.9em; color: var(--secondary-text-color); }
        </style>
        <ha-card>
          ${title}
          <div class="frame">${body}</div>
        </ha-card>
      `;
      this._rendered = Boolean(this._frameUrl);
    }
  };
}

if (typeof HTMLElement !== 'undefined' && typeof customElements !== 'undefined') {
  if (!customElements.get(CARD_TAG)) {
    customElements.define(CARD_TAG, kartenKlasse());
  }
  // Damit die Karte im grafischen Karten-Auswahldialog auftaucht statt nur
  // per YAML einsetzbar zu sein.
  window.customCards = window.customCards || [];
  if (!window.customCards.some((card) => card.type === CARD_TAG)) {
    window.customCards.push({
      type: CARD_TAG,
      name: 'Yapaia Go — Karte',
      description: 'Die Karte mit eingezeichneter Route und eigener Position.',
      preview: false,
    });
  }
}
