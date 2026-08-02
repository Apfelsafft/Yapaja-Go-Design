/**
 * PLAUSIBILITY FIXTURE (E09-T3): a HOSTILE add-on service that tries to read
 * the Core's SQLite database, and records exactly what happened.
 *
 * It probes the paths a real attacker would try, given that its cwd is
 * `data/addons/{id}` and `YAPAJA_DATA_DIR` is `data/addon-storage/{id}`:
 *   ../../db.sqlite                    (relative to its own code directory)
 *   <YAPAJA_DATA_DIR>/../../db.sqlite  (relative to its own storage directory)
 * -- both of which `path.join` turns into the REAL absolute path of the Core
 * database -- plus `/etc/passwd` as a generic "anything outside my grants"
 * probe, a directory listing of the data root, and a write attempt outside
 * its own storage directory.
 *
 * (It cannot be handed the DB path in an environment variable, because the
 * service host builds the child's environment from scratch -- the add-on
 * never learns `DB_PATH`. Deriving it from its own cwd is the realistic
 * attack, and it is exactly what this does.)
 *
 * The outcome is written to `<YAPAJA_DATA_DIR>/probe-result.json` (its ONE
 * writable location) and the test asserts every read FAILED. Reporting through
 * the filesystem rather than the API keeps the plausibility check independent
 * of the HTTP layer.
 */

const fs = require('node:fs');
const path = require('node:path');

const dataDir = process.env.YAPAJA_DATA_DIR;
const results = {};

function probeRead(label, target) {
  try {
    const bytes = fs.readFileSync(target);
    results[label] = { ok: true, bytes: bytes.length, path: target };
  } catch (err) {
    results[label] = { ok: false, code: err && err.code, message: String(err && err.message), path: target };
  }
}

probeRead('relative_from_cwd', path.join(process.cwd(), '..', '..', 'db.sqlite'));
probeRead('relative_from_storage', path.join(dataDir, '..', '..', 'db.sqlite'));
probeRead('outside_grants', '/etc/passwd');

try {
  const entries = fs.readdirSync(path.join(process.cwd(), '..', '..'));
  results.list_data_dir = { ok: true, entries };
} catch (err) {
  results.list_data_dir = { ok: false, code: err && err.code };
}

try {
  fs.writeFileSync(path.join(process.cwd(), 'escaped.txt'), 'x');
  results.write_outside_storage = { ok: true };
} catch (err) {
  results.write_outside_storage = { ok: false, code: err && err.code };
}

// Its own storage directory MUST stay usable -- otherwise the test could not
// distinguish "everything is denied" from "the permission model broke the
// add-on entirely".
fs.writeFileSync(path.join(dataDir, 'probe-result.json'), JSON.stringify(results, null, 2));
