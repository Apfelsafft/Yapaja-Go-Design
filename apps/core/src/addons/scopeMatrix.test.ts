/**
 * Unit tests for the server-side route -> scope table (E09-T3, docs/05 §2,
 * W-14). The end-to-end HTTP/WS proof lives in `scopeEnforcement.test.ts`;
 * this file pins the TABLE itself: default-deny, every rule in both the
 * granted and the missing-scope direction, own-namespace isolation, and the
 * WS topic families.
 */

import { describe, it, expect } from 'vitest';
import {
  ADDON_ROUTE_RULES,
  authorizeAddonRequest,
  authorizeAddonTopic,
  matchAddonRoute,
  normalizeAddonEventTopic,
  pathOfUrl,
  type AddonPrincipal,
} from './scopeMatrix.js';

function principal(scopes: string[], addonId = 'com.example.addon'): AddonPrincipal {
  return {
    addonId,
    scopes: new Set(scopes),
    netFetchDeclarations: scopes
      .filter((s) => s.startsWith('net.fetch:'))
      .map((s) => s.slice('net.fetch:'.length)),
  };
}

/** Concrete request for a rule, with `:id`/`:key` filled in. */
function concretePath(template: string, addonId: string): string {
  return template.replace(':id', addonId).replace(':key', 'somekey').replace(':id', addonId);
}

describe('add-on route -> scope table (E09-T3)', () => {
  describe('default-deny', () => {
    const allScopes = [
      'pos.read',
      'nav.read',
      'nav.control',
      'route.read',
      'route.propose',
      'map.layer.write',
      'widget.register',
      'events.publish',
      'storage.own',
      'ha.notify',
      'camera.view',
    ];

    it.each([
      ['GET', '/api/v1/settings'],
      ['PUT', '/api/v1/settings/auth.token'],
      ['POST', '/api/v1/auth/token'],
      ['DELETE', '/api/v1/auth/token'],
      ['GET', '/api/v1/auth/status'],
      ['GET', '/api/v1/health'],
      ['GET', '/api/v1/addons'],
      ['POST', '/api/v1/addons/install'],
      ['DELETE', '/api/v1/addons/com.example.addon'],
      ['POST', '/api/v1/addons/com.example.addon/enable'],
      ['POST', '/api/v1/addons/com.example.addon/disable'],
      ['POST', '/api/v1/addons/com.example.addon/token'],
      ['GET', '/api/v1/profiles'],
      ['PUT', '/api/v1/profiles/x/activate'],
      ['GET', '/api/v1/system/resources'],
      ['POST', '/api/v1/position/browser'],
      ['DELETE', '/api/v1/history'],
      ['GET', '/api/v1/map/regions'],
    ])('refuses %s %s even with EVERY scope granted', (method, path) => {
      const decision = authorizeAddonRequest(principal(allScopes), method, path);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.code).toBe('ROUTE_NOT_ALLOWED');
    });
  });

  describe('every rule, both directions', () => {
    for (const rule of ADDON_ROUTE_RULES) {
      const path = concretePath(rule.path, 'com.example.addon');

      it(`allows ${rule.method} ${rule.path} with ${rule.scope ?? '(no scope)'}`, () => {
        const decision = authorizeAddonRequest(
          principal(rule.scope ? [rule.scope] : []),
          rule.method,
          path,
        );
        expect(decision.allowed).toBe(true);
      });

      if (rule.scope) {
        it(`refuses ${rule.method} ${rule.path} when "${rule.scope}" is missing`, () => {
          // Grant every OTHER scope so the failure can only be this one.
          const others = ADDON_ROUTE_RULES.map((r) => r.scope).filter(
            (s): s is NonNullable<typeof s> => s !== null && s !== rule.scope,
          );
          const decision = authorizeAddonRequest(principal(others), rule.method, path);
          expect(decision.allowed).toBe(false);
          if (!decision.allowed) {
            expect(decision.code).toBe('SCOPE_MISSING');
            expect(decision.requiredScope).toBe(rule.scope);
          }
        });
      }

      if (rule.ownAddonOnly) {
        it(`refuses ${rule.method} ${rule.path} for ANOTHER add-on's id`, () => {
          const decision = authorizeAddonRequest(
            principal(rule.scope ? [rule.scope] : []),
            rule.method,
            concretePath(rule.path, 'com.other.addon'),
          );
          expect(decision.allowed).toBe(false);
          if (!decision.allowed) expect(decision.code).toBe('FOREIGN_ADDON');
        });
      }
    }
  });

  describe('path matching', () => {
    it('strips the query string and an insignificant trailing slash', () => {
      expect(pathOfUrl('/api/v1/position?foo=1')).toBe('/api/v1/position');
      expect(pathOfUrl('/api/v1/position/')).toBe('/api/v1/position');
      expect(pathOfUrl('/')).toBe('/');
    });

    it('matches the literal /addons/proxy rule, not the :id rules', () => {
      const match = matchAddonRoute('GET', '/api/v1/addons/proxy');
      expect(match?.rule.path).toBe('/api/v1/addons/proxy');
    });

    it('does not match a path with a different segment count', () => {
      expect(matchAddonRoute('GET', '/api/v1/addons/a/storage')).toBeNull();
      expect(matchAddonRoute('GET', '/api/v1/addons/a/storage/k/extra')).toBeNull();
    });

    it('is method-sensitive', () => {
      expect(matchAddonRoute('POST', '/api/v1/position')).toBeNull();
      expect(matchAddonRoute('GET', '/api/v1/position')).not.toBeNull();
    });

    it('decodes percent-encoded path parameters before the own-namespace check', () => {
      const decision = authorizeAddonRequest(
        principal(['storage.own']),
        'GET',
        '/api/v1/addons/com.example.addon/storage/a%2Fb',
      );
      expect(decision.allowed).toBe(true);
    });

    it('matches a percent-encoded spelling of a LITERAL segment (router agreement)', () => {
      // The router decodes before matching, so `/%61pi/...` really does reach
      // `/api/...` -- the matcher must see the same route, not "unknown".
      expect(matchAddonRoute('GET', '/%61pi/v1/position')?.rule.path).toBe('/api/v1/position');
      expect(matchAddonRoute('GET', '/api/v1/%70osition')?.rule.path).toBe('/api/v1/position');
    });

    it("sees through a percent-encoded foreign add-on id", () => {
      const decision = authorizeAddonRequest(
        principal(['storage.own']),
        'GET',
        '/api/v1/addons/%63om.other.addon/storage/k',
      );
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.code).toBe('FOREIGN_ADDON');
    });

    it('tolerates a malformed escape without throwing (and denies)', () => {
      expect(() => matchAddonRoute('GET', '/api/v1/%zz')).not.toThrow();
      expect(matchAddonRoute('GET', '/api/v1/%zz')).toBeNull();
    });
  });

  describe('WS topic scopes', () => {
    it('grants pos/* only with pos.read', () => {
      expect(authorizeAddonTopic(principal(['pos.read']), 'pos/*').allowed).toBe(true);
      expect(authorizeAddonTopic(principal(['pos.read']), 'pos/update').allowed).toBe(true);
      const denied = authorizeAddonTopic(principal(['nav.read']), 'pos/update');
      expect(denied.allowed).toBe(false);
      if (!denied.allowed) {
        expect(denied.code).toBe('SCOPE_MISSING');
        expect(denied.requiredScope).toBe('pos.read');
      }
    });

    it('grants nav/*, event/* with nav.read and route/* with route.read', () => {
      expect(authorizeAddonTopic(principal(['nav.read']), 'nav/state').allowed).toBe(true);
      expect(authorizeAddonTopic(principal(['nav.read']), 'event/arrived').allowed).toBe(true);
      expect(authorizeAddonTopic(principal(['route.read']), 'route/updated').allowed).toBe(true);
      expect(authorizeAddonTopic(principal(['pos.read']), 'nav/state').allowed).toBe(false);
      expect(authorizeAddonTopic(principal(['pos.read']), 'route/*').allowed).toBe(false);
    });

    it('NEVER grants a bare "*" wildcard, whatever the scopes', () => {
      const decision = authorizeAddonTopic(
        principal(['pos.read', 'nav.read', 'route.read', 'events.publish', 'storage.own']),
        '*',
      );
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.code).toBe('TOPIC_NOT_ALLOWED');
    });

    it('allows the add-on its OWN addon/{id}/* namespace without any scope', () => {
      const p = principal([]);
      expect(authorizeAddonTopic(p, 'addon/com.example.addon/*').allowed).toBe(true);
      expect(authorizeAddonTopic(p, 'addon/com.example.addon/jam').allowed).toBe(true);
    });

    it("refuses ANOTHER add-on's namespace", () => {
      const decision = authorizeAddonTopic(principal(['pos.read']), 'addon/com.other.addon/*');
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.code).toBe('TOPIC_NOT_ALLOWED');
    });

    it('refuses "addon/*" (all add-ons) and unrelated topics', () => {
      expect(authorizeAddonTopic(principal([]), 'addon/*').allowed).toBe(false);
      expect(authorizeAddonTopic(principal(['nav.read']), 'system/health').allowed).toBe(false);
    });

    it('refuses a prefix that would span more than one family', () => {
      // `p*` would match `pos/...` but is not fully inside the pos family.
      expect(authorizeAddonTopic(principal(['pos.read']), 'p*').allowed).toBe(false);
    });
  });

  describe('events.publish namespace normalization', () => {
    const id = 'com.example.addon';

    it('prefixes a relative topic with addon/{id}/', () => {
      expect(normalizeAddonEventTopic(id, 'jam-detected')).toBe(`addon/${id}/jam-detected`);
      expect(normalizeAddonEventTopic(id, 'a/b/c')).toBe(`addon/${id}/a/b/c`);
    });

    it('accepts an already fully-qualified own topic', () => {
      expect(normalizeAddonEventTopic(id, `addon/${id}/jam`)).toBe(`addon/${id}/jam`);
    });

    it.each([
      `addon/com.other.addon/jam`,
      `addon/`,
      `addon/${id}/`,
      '',
      '   ',
      '*',
      'nav/*',
      '../nav/state',
      '/absolute',
      'trailing/',
    ])('refuses "%s"', (topic) => {
      expect(normalizeAddonEventTopic(id, topic)).toBeNull();
    });

    it('cannot be tricked into another core topic', () => {
      // `nav/state` becomes `addon/{id}/nav/state` -- namespaced, harmless.
      expect(normalizeAddonEventTopic(id, 'nav/state')).toBe(`addon/${id}/nav/state`);
    });
  });
});
