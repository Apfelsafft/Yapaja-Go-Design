/**
 * GUARD (E09-T6, task spec: `addons-examples/evil-fixture/` -- "nicht im
 * Store!"): the evil fixture must never become an installable, discoverable
 * add-on.
 *
 * Three independent locks, so no single future edit can quietly publish it:
 *
 *  1. `addons-examples/README.md`'s EXAMPLE INDEX (the bullet list of shipped
 *     reference add-ons) lists exactly the two legitimate examples -- the evil
 *     fixture appears only inside the explicit "never publish this" warning.
 *  2. NO registry/store index anywhere in the repo mentions its add-on id.
 *     This is written against a registry that does not exist yet (E09-T7);
 *     it scans for `index.json`-shaped catalogs generically, so it starts
 *     protecting the moment one appears.
 *  3. NO production source (`apps/core/src`, `apps/web/src`, `packages/<pkg>/src`)
 *     mentions its add-on id -- so no store UI, seeder or default catalog can
 *     ever ship it. Test and e2e code is deliberately allowed (the security
 *     suite MUST reference it).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_ROOT = join(HERE, '..');
const REPO_ROOT = join(EXAMPLES_ROOT, '..');

/** The one string that must never leak into anything publishable. */
const EVIL_ADDON_ID = 'com.example.evil-fixture';

/** The add-ons that ARE legitimate, shippable reference examples. */
const PUBLISHABLE_EXAMPLES = ['poi-campsites', 'track-recorder'];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'test-results', '.tmp', 'public']);

function walk(dir: string, onFile: (full: string) => void): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // broken symlink / race -- nothing to scan
    }
    if (st.isDirectory()) walk(full, onFile);
    else if (st.isFile()) onFile(full);
  }
}

describe('E09-T6: the evil fixture is never in the store/registry', () => {
  it('the manifest really carries the id this guard protects', () => {
    const manifest = JSON.parse(
      readFileSync(join(HERE, 'yapaja-addon.json'), 'utf-8'),
    ) as { id: string; name: string };
    expect(manifest.id).toBe(EVIL_ADDON_ID);
    // Loud in every UI that ever renders a name, as a last line of defence.
    expect(manifest.name.toUpperCase()).toContain('DO NOT INSTALL');
  });

  it('addons-examples/README.md lists exactly the two publishable examples', () => {
    const readme = readFileSync(join(EXAMPLES_ROOT, 'README.md'), 'utf-8');
    // The index is the set of `[`name/`](./name)` links in the document.
    const linked = new Set(
      [...readme.matchAll(/\]\(\.\/([a-z0-9-]+)\)/g)].map((m) => m[1]),
    );
    for (const example of PUBLISHABLE_EXAMPLES) {
      expect(linked.has(example), `${example} should be listed as an example`).toBe(true);
    }
    expect(
      linked.has('evil-fixture'),
      'evil-fixture must NOT be linked from the example index',
    ).toBe(false);
  });

  it('addons-examples/README.md explicitly warns that the evil fixture is not shippable', () => {
    const readme = readFileSync(join(EXAMPLES_ROOT, 'README.md'), 'utf-8');
    expect(readme).toContain('evil-fixture');
    // `s` flag: the warning is line-wrapped in the Markdown source.
    expect(readme.toLowerCase()).toMatch(/niemals[\s\S]{0,80}store/);
  });

  it('no registry/store catalog in the repo references the evil add-on id', () => {
    const offenders: string[] = [];
    walk(REPO_ROOT, (full) => {
      const base = full.split('/').pop() ?? '';
      // Registry catalogs are `index.json` (docs/05 §5, E09-T7) or anything
      // named `*registry*.json` / `*catalog*.json`.
      const looksLikeCatalog =
        base === 'index.json' || /(registry|catalog)/i.test(base) ? base.endsWith('.json') : false;
      if (!looksLikeCatalog) return;
      if (readFileSync(full, 'utf-8').includes(EVIL_ADDON_ID)) {
        offenders.push(relative(REPO_ROOT, full));
      }
    });
    expect(offenders, `evil fixture leaked into a catalog: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no PRODUCTION source file references the evil add-on id', () => {
    const productionRoots = [
      join(REPO_ROOT, 'apps', 'core', 'src'),
      join(REPO_ROOT, 'apps', 'web', 'src'),
      join(REPO_ROOT, 'packages'),
    ];
    const offenders: string[] = [];
    for (const root of productionRoots) {
      walk(root, (full) => {
        if (!/\.(ts|tsx|js|mjs|json)$/.test(full)) return;
        // Tests and fixtures legitimately name it.
        if (/\.test\.tsx?$/.test(full) || full.includes('__fixtures__')) return;
        if (readFileSync(full, 'utf-8').includes(EVIL_ADDON_ID)) {
          offenders.push(relative(REPO_ROOT, full));
        }
      });
    }
    expect(offenders, `evil fixture leaked into production code: ${offenders.join(', ')}`).toEqual([]);
  });
});
