/**
 * E09-T5 acceptance criterion 1: both reference add-ons must use
 * `@yapaja/addon-sdk` EXCLUSIVELY -- no raw `fetch`, `postMessage`,
 * `XMLHttpRequest`, or `WebSocket` anywhere in the add-on's OWN source. The
 * SDK itself (`packages/addon-sdk/src/**`) legitimately uses all of those
 * under the hood -- that's what it's FOR -- so this scan is deliberately
 * scoped to `addons-examples/*\/src/**\/*.ts`, never the SDK package.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'raw fetch(', re: /(?<!addon\.)\bfetch\s*\(/ },
  { label: 'raw postMessage(', re: /\.postMessage\s*\(/ },
  { label: 'raw XMLHttpRequest', re: /XMLHttpRequest/ },
  { label: 'raw new WebSocket(', re: /new\s+WebSocket\s*\(/ },
];

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

const ADDON_SRC_DIRS = [join(HERE, 'poi-campsites', 'src'), join(HERE, 'track-recorder', 'src')];

describe('E09-T5 add-on source uses only @yapaja/addon-sdk (no raw fetch/postMessage/WS)', () => {
  for (const srcDir of ADDON_SRC_DIRS) {
    const files = collectSourceFiles(srcDir);

    it(`scans at least one source file under ${srcDir}`, () => {
      expect(files.length).toBeGreaterThan(0);
    });

    for (const file of files) {
      it(`${file} contains no raw transport calls`, () => {
        const content = readFileSync(file, 'utf-8');
        for (const { label, re } of FORBIDDEN_PATTERNS) {
          expect(re.test(content), `${file} contains ${label}`).toBe(false);
        }
      });
    }
  }
});
