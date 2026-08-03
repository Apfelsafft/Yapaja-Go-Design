/**
 * Ambient module declaration so `import campsites from '../data/campsites.geojson'`
 * type-checks. esbuild is configured (see `build.mjs`'s `loader: { '.geojson': 'json' }`)
 * to parse `.geojson` files exactly like `.json` at bundle time -- this
 * declaration just tells `tsc` the same thing for the standalone typecheck.
 */
declare module '*.geojson' {
  const value: unknown;
  export default value;
}
