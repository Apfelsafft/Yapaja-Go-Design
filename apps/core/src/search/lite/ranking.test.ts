/**
 * E05-T5 mandatory ranking tests (W-12): the "Vadu" -> Vaduz-before-street
 * case, city>street generally, and distance-bias -- all against the pure
 * `rankLiteCandidates` function, no DB/mocks needed.
 */
import { describe, it, expect } from 'vitest';
import { rankLiteCandidates, type LiteCandidate } from './ranking.js';

const VADUZ: LiteCandidate = { name: 'Vaduz', kind: 'city', lat: 47.141, lon: 9.5215, ftsRank: -1 };
const VADUZER_STRASSE: LiteCandidate = {
  name: 'Vaduzer Straße',
  kind: 'street',
  lat: 47.142,
  lon: 9.522,
  ftsRank: -1,
};
const SCHAAN: LiteCandidate = { name: 'Schaan', kind: 'town', lat: 47.166, lon: 9.509, ftsRank: -0.5 };
const TRIESENBERG: LiteCandidate = {
  name: 'Triesenberg',
  kind: 'village',
  lat: 47.115,
  lon: 9.531,
  ftsRank: -0.5,
};

describe('rankLiteCandidates', () => {
  it('MANDATORY: "Vadu" ranks Vaduz (city) above Vaduzer Straße (street), even though both are prefix matches', () => {
    // Deliberately give the street a BETTER (more negative) bm25 rank than
    // the city, to prove the ordering comes from the kind tier, not luck in
    // FTS ordering.
    const street = { ...VADUZER_STRASSE, ftsRank: -5 };
    const city = { ...VADUZ, ftsRank: -1 };
    const ranked = rankLiteCandidates([street, city], 'Vadu');
    expect(ranked.map((r) => r.name)).toEqual(['Vaduz', 'Vaduzer Straße']);
  });

  it('is case-insensitive and whitespace-tolerant for the prefix tier', () => {
    const ranked = rankLiteCandidates([VADUZER_STRASSE, VADUZ], '  vADU  ');
    expect(ranked[0].name).toBe('Vaduz');
  });

  it('a non-prefix FTS hit sorts after ANY prefix match, regardless of kind/bm25', () => {
    // "Straße" doesn't prefix-match "Vad", but does trigram-match it via FTS
    // (shares no actual "vad" substring here, but simulate a trigram hit by
    // just NOT starting with the query) -- a city that DOES prefix-match
    // must still win.
    const nonPrefixCity: LiteCandidate = { name: 'Neu-Vaduz', kind: 'city', lat: 0, lon: 0, ftsRank: -10 };
    const prefixStreet: LiteCandidate = { ...VADUZER_STRASSE, ftsRank: -0.1 };
    const ranked = rankLiteCandidates([nonPrefixCity, prefixStreet], 'Vadu');
    expect(ranked[0].name).toBe('Vaduzer Straße');
    expect(ranked[1].name).toBe('Neu-Vaduz');
  });

  it('cities rank above towns above villages above streets (equal prefix/fts tiers)', () => {
    const equalFts = [VADUZ, SCHAAN, TRIESENBERG, VADUZER_STRASSE].map((c) => ({ ...c, ftsRank: -1 }));
    // Shuffle input order to prove sort, not input order, decides this.
    const shuffled = [equalFts[3], equalFts[1], equalFts[0], equalFts[2]];
    const ranked = rankLiteCandidates(shuffled, 'x'); // none prefix-match "x" -> prefix tier is a no-op tie
    expect(ranked.map((r) => r.kind)).toEqual(['city', 'town', 'village', 'street']);
  });

  it('within the same prefix+kind tier, better (more negative) bm25 wins', () => {
    const worse: LiteCandidate = { name: 'Vaduz A', kind: 'city', lat: 0, lon: 0, ftsRank: -1 };
    const better: LiteCandidate = { name: 'Vaduz B', kind: 'city', lat: 0, lon: 0, ftsRank: -3 };
    const ranked = rankLiteCandidates([worse, better], 'Vaduz');
    expect(ranked.map((r) => r.name)).toEqual(['Vaduz B', 'Vaduz A']);
  });

  it('distance-bias: closer candidate wins remaining ties when an origin is given', () => {
    const near: LiteCandidate = { name: 'Nah', kind: 'city', lat: 47.141, lon: 9.5215, ftsRank: -1 };
    const far: LiteCandidate = { name: 'Fern', kind: 'city', lat: 48.5, lon: 11.5, ftsRank: -1 };
    const origin = { lat: 47.14, lon: 9.52 };
    const ranked = rankLiteCandidates([far, near], 'x', origin);
    expect(ranked.map((r) => r.name)).toEqual(['Nah', 'Fern']);
  });

  it('distance-bias never overrides an earlier tier (a far city still beats a near street for the same query)', () => {
    const nearStreet: LiteCandidate = { ...VADUZER_STRASSE, lat: 47.14, lon: 9.52 };
    const farCity: LiteCandidate = { ...VADUZ, lat: 47.5, lon: 10.0 };
    const origin = { lat: 47.14, lon: 9.52 }; // right at the street
    const ranked = rankLiteCandidates([nearStreet, farCity], 'Vadu', origin);
    expect(ranked[0].name).toBe('Vaduz');
  });

  it('is a no-op (identity order) without an origin, using only text-based tiers', () => {
    const ranked = rankLiteCandidates([VADUZ, SCHAAN], 'x');
    // No prefix match, different kinds -> city still wins over town by the
    // kind tier alone, distance tier never engages (origin undefined).
    expect(ranked[0].name).toBe('Vaduz');
  });

  it('does not mutate the input array', () => {
    const input = [VADUZER_STRASSE, VADUZ];
    const copy = [...input];
    rankLiteCandidates(input, 'Vadu');
    expect(input).toEqual(copy);
  });

  it('is stable: equal-tier candidates keep their original relative order', () => {
    const a: LiteCandidate = { name: 'A', kind: 'street', lat: 0, lon: 0, ftsRank: -1 };
    const b: LiteCandidate = { name: 'B', kind: 'street', lat: 0, lon: 0, ftsRank: -1 };
    const ranked = rankLiteCandidates([a, b], 'x');
    expect(ranked.map((r) => r.name)).toEqual(['A', 'B']);
  });

  it('handles an empty candidate list', () => {
    expect(rankLiteCandidates([], 'Vadu')).toEqual([]);
  });
});
