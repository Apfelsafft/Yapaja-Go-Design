import { describe, it, expect } from 'vitest';
import { NEVER_CACHE_PATH_SEGMENTS, isNeverCachePath } from './cachePolicy.js';

describe('cachePolicy (E07-T5 plausibility: SW must never cache /api or /tiles)', () => {
  it('the denylist contains /api/ and /tiles/', () => {
    expect(NEVER_CACHE_PATH_SEGMENTS).toContain('/api/');
    expect(NEVER_CACHE_PATH_SEGMENTS).toContain('/tiles/');
  });

  it('flags root-deployed API and tile paths', () => {
    expect(isNeverCachePath('/api/v1/map/regions')).toBe(true);
    expect(isNeverCachePath('/api/v1/navigation/state')).toBe(true);
    expect(isNeverCachePath('/tiles/fixture/0/0/0.pmtiles')).toBe(true);
  });

  it('flags the same paths under an ingress sub-path (W-15)', () => {
    expect(isNeverCachePath('/rv-demo/api/v1/map/regions')).toBe(true);
    expect(isNeverCachePath('/rv-demo/tiles/fixture/0/0/0.pmtiles')).toBe(true);
  });

  it('does not flag the app shell / static assets', () => {
    expect(isNeverCachePath('/index.html')).toBe(false);
    expect(isNeverCachePath('/shell.html')).toBe(false);
    expect(isNeverCachePath('/assets/main-abc123.js')).toBe(false);
    expect(isNeverCachePath('/icons/pwa-512.png')).toBe(false);
    expect(isNeverCachePath('/manifest.webmanifest')).toBe(false);
  });

  it('does not false-positive on paths that merely contain "api"/"tiles" as a substring without slashes', () => {
    expect(isNeverCachePath('/apiary-map.png')).toBe(false);
    expect(isNeverCachePath('/rooftiles-icon.png')).toBe(false);
  });
});
