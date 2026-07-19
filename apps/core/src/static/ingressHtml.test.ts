import { describe, it, expect } from 'vitest';
import { sanitizeIngressPath, injectBaseHref } from './ingressHtml.js';

describe('sanitizeIngressPath', () => {
  it('accepts a realistic HA ingress path', () => {
    expect(sanitizeIngressPath('/api/hassio_ingress/abc123')).toBe('/api/hassio_ingress/abc123');
  });

  it('accepts a trailing-slash path', () => {
    expect(sanitizeIngressPath('/api/hassio_ingress/abc123/')).toBe('/api/hassio_ingress/abc123/');
  });

  it('rejects missing / non-string / empty values', () => {
    expect(sanitizeIngressPath(undefined)).toBeNull();
    expect(sanitizeIngressPath(null)).toBeNull();
    expect(sanitizeIngressPath('')).toBeNull();
    expect(sanitizeIngressPath(42)).toBeNull();
    expect(sanitizeIngressPath(['/a', '/b'])).toBeNull();
  });

  it('rejects a value not starting with /', () => {
    expect(sanitizeIngressPath('api/hassio_ingress/abc123')).toBeNull();
  });

  it('rejects values containing HTML/attribute-breaking characters', () => {
    expect(sanitizeIngressPath('/x"><script>alert(1)</script>')).toBeNull();
    expect(sanitizeIngressPath("/x'onmouseover=alert(1)")).toBeNull();
    expect(sanitizeIngressPath('/x&y')).toBeNull();
    expect(sanitizeIngressPath('/x<y>')).toBeNull();
  });

  it('rejects query strings, fragments and dot-segments', () => {
    expect(sanitizeIngressPath('/a?b=1')).toBeNull();
    expect(sanitizeIngressPath('/a#frag')).toBeNull();
    expect(sanitizeIngressPath('/../etc/passwd')).toBeNull();
    expect(sanitizeIngressPath('/a/./b')).toBeNull();
  });

  it('rejects overly long values', () => {
    expect(sanitizeIngressPath('/' + 'a'.repeat(600))).toBeNull();
  });
});

describe('injectBaseHref', () => {
  it('inserts <base href> immediately after the opening <head> tag', () => {
    const html = '<!DOCTYPE html><html><head><title>Yapaja Go</title></head><body></body></html>';
    const result = injectBaseHref(html, '/api/hassio_ingress/abc123');
    expect(result).toBe(
      '<!DOCTYPE html><html><head><base href="/api/hassio_ingress/abc123/"><title>Yapaja Go</title></head><body></body></html>'
    );
  });

  it('normalizes a missing trailing slash onto the injected href', () => {
    const html = '<html><head></head><body></body></html>';
    const result = injectBaseHref(html, '/foo/bar');
    expect(result).toContain('<base href="/foo/bar/">');
  });

  it('does not double the trailing slash when already present', () => {
    const html = '<html><head></head><body></body></html>';
    const result = injectBaseHref(html, '/foo/bar/');
    expect(result).toContain('<base href="/foo/bar/">');
    expect(result).not.toContain('//">');
  });

  it('handles a <head> tag with attributes', () => {
    const html = '<html><head lang="de"></head><body></body></html>';
    const result = injectBaseHref(html, '/foo');
    expect(result).toBe('<html><head lang="de"><base href="/foo/"></head><body></body></html>');
  });

  it('returns the HTML unchanged when no <head> tag is present', () => {
    const html = '<html><body>no head here</body></html>';
    expect(injectBaseHref(html, '/foo')).toBe(html);
  });
});
