/**
 * Shared helpers for the E09-T6 security suite: building the evil fixture's
 * tarball from its REAL source files, driving the REAL install API, and
 * reading back the REAL `security` event log.
 *
 * Nothing here fakes a refusal. Every function is either "make the attempt"
 * or "observe what the Core recorded".
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { expect, type APIRequestContext } from '@playwright/test';
import type { AddonManifest } from '@yapaja/shared';
// The SAME in-process tarball builder the Core's own add-on unit tests use --
// so the security suite needs neither a system `tar` nor a pre-build step, and
// can construct the malicious headers (`../` names, symlinks) a real `tar` CLI
// refuses to produce.
import {
  buildTarball,
  buildZipBombTarball,
  type TarEntrySpec,
} from '../../../apps/core/src/addons/__fixtures__/buildTarball.js';
import { EVIL_FIXTURE_DIR, SECURITY_CORE_BASE_URL, SECURITY_CORE_TOKEN } from './constants.js';

export interface SecurityViolation {
  vector: string;
  addonId: string | null;
  detail: string;
  at: string;
}

/** Core-token headers (this suite's Core enforces auth -- see constants.ts). */
export function coreAuth(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${SECURITY_CORE_TOKEN}`, ...extra };
}

// ---------------------------------------------------------------------------
// The evil fixture
// ---------------------------------------------------------------------------

/**
 * Builds the evil fixture's installable tarball from the REAL files in
 * `addons-examples/evil-fixture/` -- manifest, UI and service are read off
 * disk, never inlined here, so the fixture the suite installs is exactly the
 * fixture that is committed and reviewable.
 */
export async function buildEvilFixtureTarball(
  manifestOverrides: Partial<AddonManifest> = {},
): Promise<{ bytes: Buffer; manifest: AddonManifest }> {
  const manifest = {
    ...(JSON.parse(readFileSync(join(EVIL_FIXTURE_DIR, 'yapaja-addon.json'), 'utf-8')) as AddonManifest),
    ...manifestOverrides,
  };
  const entries: TarEntrySpec[] = [
    { name: 'yapaja-addon.json', content: JSON.stringify(manifest, null, 2) },
    { name: 'ui/index.html', content: readFileSync(join(EVIL_FIXTURE_DIR, 'ui', 'index.html')) },
    { name: 'ui/evil.js', content: readFileSync(join(EVIL_FIXTURE_DIR, 'ui', 'evil.js')) },
    { name: 'service/main.mjs', content: readFileSync(join(EVIL_FIXTURE_DIR, 'service', 'main.mjs')) },
  ];
  const bytes = await buildTarball(entries, { gzip: true });
  return { bytes, manifest };
}

/** A minimal, valid manifest for a secondary fixture add-on. */
export function minimalManifest(id: string, permissions: string[], extra: Partial<AddonManifest> = {}): AddonManifest {
  return {
    id,
    name: `Fixture ${id}`,
    version: '1.0.0',
    core_api: '*',
    author: 'E09-T6',
    license: 'MIT',
    description: 'E09-T6 security-suite fixture add-on',
    permissions,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The REAL install API (two-step, exactly as an operator would drive it)
// ---------------------------------------------------------------------------

export interface InstallOutcome {
  beginStatus: number;
  confirmStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * Drives `POST /addons/install` (+ `/confirm`) with `bytes`. Returns the
 * OUTCOME rather than throwing, so a spec can assert on the refusal.
 */
export async function installTarball(
  request: APIRequestContext,
  bytes: Buffer,
): Promise<InstallOutcome> {
  const begin = await request.post(`${SECURITY_CORE_BASE_URL}/api/v1/addons/install`, {
    headers: coreAuth(),
    data: { source: 'upload', data: bytes.toString('base64') },
  });
  if (begin.status() !== 202) {
    const body = (await begin.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    return {
      beginStatus: begin.status(),
      confirmStatus: null,
      errorCode: body.error?.code ?? null,
      errorMessage: body.error?.message ?? null,
    };
  }
  const { data } = (await begin.json()) as { data: { pending_id: string } };
  const confirm = await request.post(
    `${SECURITY_CORE_BASE_URL}/api/v1/addons/install/${data.pending_id}/confirm`,
    { headers: coreAuth() },
  );
  const confirmBody = (await confirm.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };
  return {
    beginStatus: begin.status(),
    confirmStatus: confirm.status(),
    errorCode: confirmBody.error?.code ?? null,
    errorMessage: confirmBody.error?.message ?? null,
  };
}

/** Installs + confirms + enables an add-on, asserting each step succeeded. */
export async function installAndEnable(
  request: APIRequestContext,
  bytes: Buffer,
  addonId: string,
): Promise<void> {
  const outcome = await installTarball(request, bytes);
  expect(outcome.beginStatus, `install step 1 for ${addonId}`).toBe(202);
  expect(outcome.confirmStatus, `install step 2 for ${addonId}: ${outcome.errorMessage ?? ''}`).toBe(201);
  const enable = await request.post(`${SECURITY_CORE_BASE_URL}/api/v1/addons/${addonId}/enable`, {
    headers: coreAuth(),
  });
  expect(enable.status(), `enable ${addonId}`).toBe(200);
}

/** Mints (rotates) an add-on's scoped token via the operator endpoint. */
export async function issueAddonToken(request: APIRequestContext, addonId: string): Promise<string> {
  const res = await request.post(`${SECURITY_CORE_BASE_URL}/api/v1/addons/${addonId}/token`, {
    headers: coreAuth(),
  });
  expect(res.status(), `token for ${addonId}`).toBe(200);
  const body = (await res.json()) as { data: { token: string } };
  return body.data.token;
}

// ---------------------------------------------------------------------------
// The `security` event log
// ---------------------------------------------------------------------------

/** Reads the Core's recorded violations (optionally filtered by vector). */
export async function fetchSecurityEvents(
  request: APIRequestContext,
  filter: { vector?: string; addonId?: string } = {},
): Promise<SecurityViolation[]> {
  const params = new URLSearchParams();
  if (filter.vector) params.set('vector', filter.vector);
  if (filter.addonId) params.set('addon_id', filter.addonId);
  const qs = params.toString();
  const res = await request.get(
    `${SECURITY_CORE_BASE_URL}/api/v1/security/events${qs ? `?${qs}` : ''}`,
    { headers: coreAuth() },
  );
  expect(res.status(), 'GET /api/v1/security/events').toBe(200);
  const body = (await res.json()) as { data: SecurityViolation[] };
  return body.data;
}

/**
 * Asserts that a `security` event with `vector` was recorded (part (b) of
 * every vector's evidence). Polls, because a few producers record slightly
 * after the HTTP response the spec observed (the service-process stderr path,
 * and the browser's fire-and-forget host report).
 */
export async function expectSecurityEvent(
  request: APIRequestContext,
  vector: string,
  opts: { addonId?: string; detailMatches?: RegExp; timeoutMs?: number } = {},
): Promise<SecurityViolation> {
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
  let seen: SecurityViolation[] = [];
  for (;;) {
    seen = await fetchSecurityEvents(request, { vector });
    const matching = seen.filter(
      (e) =>
        (opts.addonId === undefined || e.addonId === opts.addonId) &&
        (opts.detailMatches === undefined || opts.detailMatches.test(e.detail)),
    );
    if (matching.length > 0) return matching[matching.length - 1];
    if (Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `no security event "${vector}"${opts.addonId ? ` for ${opts.addonId}` : ''} was recorded. ` +
      `Recorded for this vector: ${JSON.stringify(seen)}`,
  );
}

/** Asserts NO event of `vector` was ever recorded (used for negative controls). */
export async function expectNoSecurityEvent(
  request: APIRequestContext,
  vector: string,
): Promise<void> {
  expect(await fetchSecurityEvents(request, { vector })).toEqual([]);
}

/** Every violation ever recorded must be free of anything token-shaped. */
export async function expectNoSecretsInSecurityLog(request: APIRequestContext, secrets: string[]): Promise<void> {
  const all = await fetchSecurityEvents(request);
  const serialized = JSON.stringify(all);
  for (const secret of secrets) {
    expect(serialized, `the security log must never contain a token`).not.toContain(secret);
  }
}

// ---------------------------------------------------------------------------
// Malicious tarballs (E09-T1 fixtures, driven through the REAL install API)
// ---------------------------------------------------------------------------

const TARBALL_MANIFEST = JSON.stringify(minimalManifest('com.example.tarball-attack', ['pos.read']));

/** `../`-escaping entry. */
export function buildTraversalTarball(): Promise<Buffer> {
  return buildTarball(
    [
      { name: 'yapaja-addon.json', content: TARBALL_MANIFEST },
      { name: '../../../../etc/yapaja-pwned.txt', content: 'pwned' },
    ],
    { gzip: true },
  );
}

/** Absolute-path entry. */
export function buildAbsolutePathTarball(): Promise<Buffer> {
  return buildTarball(
    [
      { name: 'yapaja-addon.json', content: TARBALL_MANIFEST },
      { name: '/etc/yapaja-pwned.txt', content: 'pwned' },
    ],
    { gzip: true },
  );
}

/** Symlink entry pointing at the Core's database. */
export function buildSymlinkTarball(): Promise<Buffer> {
  return buildTarball(
    [
      { name: 'yapaja-addon.json', content: TARBALL_MANIFEST },
      { name: 'ui/db.sqlite', type: 'symlink', linkname: '../../../db.sqlite' },
    ],
    { gzip: true },
  );
}

/** Hardlink entry. */
export function buildHardlinkTarball(): Promise<Buffer> {
  return buildTarball(
    [
      { name: 'yapaja-addon.json', content: TARBALL_MANIFEST },
      { name: 'ui/db.sqlite', type: 'link', linkname: 'yapaja-addon.json' },
    ],
    { gzip: true },
  );
}

/** Highly compressible payload well past the 50 MB uncompressed cap. */
export function buildBombTarball(): Promise<Buffer> {
  return buildZipBombTarball(60 * 1024 * 1024);
}
