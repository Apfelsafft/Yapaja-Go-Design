/**
 * Test-only registry-index fixtures (E09-T7). Lives under `__fixtures__`
 * (like `buildTarball.ts`) so it's shared by `registry.test.ts`,
 * `registryRoutes.test.ts`, and `routes.test.ts`'s sha256-enforcement case
 * without duplicating the base entry shape.
 */

/** A fully valid raw registry-index entry, matching docs/05 §5's documented
 *  index fields exactly. `sha256` defaults to a well-FORMED but not
 *  necessarily tarball-matching digest -- callers that need it to actually
 *  match a real tarball's bytes must override it. */
export function validRawRegistryEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'com.example.poi-campsites',
    name: 'Stellplätze',
    version: '1.2.0',
    description: 'POI-Overlay für Stellplätze',
    icon: 'https://example.invalid/icon.png',
    download_url: 'https://example.invalid/poi-campsites-1.2.0.tar.gz',
    sha256: 'a'.repeat(64),
    scopes: ['pos.read', 'map.layer.write', 'net.fetch:api.example.invalid'],
    core_api: '^1.0',
    screenshots: ['https://example.invalid/shot1.png'],
    signature: null,
    ...overrides,
  };
}
