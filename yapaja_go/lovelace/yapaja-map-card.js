/**
 * Yapaja Go — Lovelace-Karte: die Karte mit eingezeichneter Route.
 *
 * ─── WOFUER ─────────────────────────────────────────────────────────────────
 * Gefragt: „Die Idee des Navi in HA war ja, die Navigation oder auch nur Teile
 * davon in eigene Dashboards zu integrieren. Bspw. die Karte mit
 * eingezeichneter Route."
 *
 * Alle ZAHLEN (nächste Abbiegung, Entfernung, ETA, Tempo …) liegen als
 * MQTT-Entitäten vor und brauchen keine eigene Karte — dafür reichen die
 * Standard-Karten von Home Assistant. Was es NICHT als Entität gibt, ist die
 * Karte selbst mit Route und Offline-Kacheln. Genau die zeigt diese Karte.
 *
 * ─── WARUM EIN RAHMEN UND KEIN NACHBAU ──────────────────────────────────────
 * Die Route, die Offline-Kacheln, die fünf Kartenstile, die eigene Position —
 * das alles gibt es im Add-on bereits und funktioniert dort. Es hier ein
 * zweites Mal zu bauen hiesse, zwei Karten parallel zu pflegen, die
 * auseinanderlaufen. Diese Karte zeigt deshalb die ANZEIGESEITE des Add-ons
 * (`embed.html`): dieselbe Karte, dieselbe Route, ohne Bedienelemente.
 *
 * ─── WARUM DER PFAD ZUR LAUFZEIT ERFRAGT WIRD ───────────────────────────────
 * Das Add-on ist nur über Ingress erreichbar (`ports: {}`), und der
 * Ingress-Pfad enthält ein Token, das sich ändert. Eine fest eingetragene URL
 * wäre also nach kurzer Zeit tot — und zwar stumm: ein leerer Rahmen sieht
 * aus wie „die Karte lädt noch".
 *
 * Deshalb: bei jedem Anzeigen den Pfad beim Supervisor erfragen und eine
 * Ingress-Sitzung öffnen. Schlägt das fehl, sagt diese Karte WARUM — mit dem
 * echten Fehlertext, statt einen leeren Rahmen zu zeigen.
 *
 * ─── EINRICHTUNG ────────────────────────────────────────────────────────────
 *   Einstellungen → Dashboards → ⋮ → Ressourcen → Ressource hinzufügen
 *     URL: /local/yapaja/yapaja-map-card.js      Typ: JavaScript-Modul
 *
 * Danach im Dashboard:
 *   type: custom:yapaja-map-card
 *   height: 400            # optional, Vorgabe 400
 *   title: Route           # optional
 */

const CARD_TAG = 'yapaja-map-card';
const DEFAULT_HEIGHT = 400;

/** Slug des Add-ons. Muss zu `yapaja_go/config.yaml` passen. */
const ADDON_SLUG = 'yapaja_go';

class YapajaMapCard extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = null;
    this._frameUrl = null;
    this._error = null;
    this._loading = false;
    this._rendered = false;
  }

  setConfig(config) {
    const height = config && config.height;
    if (height !== undefined && (typeof height !== 'number' || height <= 0)) {
      throw new Error('height muss eine positive Zahl sein (Pixel).');
    }
    this._config = {
      height: height || DEFAULT_HEIGHT,
      title: (config && config.title) || null,
    };
    this._rendered = false;
    this._render();
  }

  set hass(hass) {
    const first = this._hass === null;
    this._hass = hass;
    // Der Ingress-Pfad wird EINMAL geholt, nicht bei jedem `hass`-Update:
    // Home Assistant setzt diese Eigenschaft bei jeder Zustandsänderung im
    // ganzen System neu, also viele Male pro Minute. Eine Anfrage pro
    // Zustandsänderung wäre eine Dauerlast ohne jeden Nutzen.
    if (first && !this._frameUrl && !this._loading) {
      void this._resolveIngress();
    }
  }

  getCardSize() {
    return Math.max(1, Math.ceil(this._config.height / 50));
  }

  /**
   * Holt den Ingress-Pfad des Add-ons und öffnet eine Ingress-Sitzung.
   *
   * Beide Schritte sind nötig: der Pfad allein liefert ohne gültige Sitzung
   * eine 401, und die Sitzung allein kennt den Pfad nicht.
   */
  async _resolveIngress() {
    if (!this._hass) return;
    this._loading = true;
    this._error = null;
    this._render();

    try {
      const info = await this._hass.callApi('GET', `hassio/addons/${ADDON_SLUG}/info`);
      const ingressUrl = info && info.data && info.data.ingress_url;
      if (!ingressUrl) {
        throw new Error(
          'Das Add-on meldet keinen Ingress-Pfad. Ist „Yapaja Go" installiert und gestartet?',
        );
      }
      // Legt das Sitzungs-Cookie an, ohne das der Rahmen eine 401 bekäme.
      await this._hass.callApi('POST', 'hassio/ingress/session');

      const base = ingressUrl.endsWith('/') ? ingressUrl : `${ingressUrl}/`;
      this._frameUrl = `${base}embed.html`;
    } catch (err) {
      this._frameUrl = null;
      this._error = describeError(err);
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
    // lädt die Karte neu, und eine Karte, die im Dashboard alle paar Sekunden
    // von vorn beginnt, ist unbrauchbar.
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
      body = `<iframe src="${escapeHtml(this._frameUrl)}"
                      title="Yapaja Go — Karte"
                      allow="geolocation"></iframe>`;
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
}

/** Macht aus dem, was `callApi` wirft, einen Satz, mit dem man etwas anfangen kann. */
function describeError(err) {
  if (!err) return 'Unbekannter Fehler.';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  if (err.status_code === 401 || err.status === 401) {
    return 'Home Assistant hat den Zugriff auf das Add-on abgelehnt (401).';
  }
  if (err.status_code === 404 || err.status === 404) {
    return `Add-on „${ADDON_SLUG}" nicht gefunden. Ist es installiert?`;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

if (!customElements.get(CARD_TAG)) {
  customElements.define(CARD_TAG, YapajaMapCard);
}

// Damit die Karte im grafischen Karten-Auswahldialog auftaucht statt nur
// per YAML einsetzbar zu sein.
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === CARD_TAG)) {
  window.customCards.push({
    type: CARD_TAG,
    name: 'Yapaja Go — Karte',
    description: 'Die Karte mit eingezeichneter Route und eigener Position.',
    preview: false,
  });
}
