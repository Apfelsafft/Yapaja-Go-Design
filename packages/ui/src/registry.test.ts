import { describe, it, expect } from 'vitest';
import { WidgetRegistry } from './registry.js';
import type { Widget } from './types.js';

function makeWidget(id: string): Widget {
  return {
    id,
    name: id,
    sizes: ['S'],
    topics: [],
    render: () => null,
  };
}

describe('WidgetRegistry', () => {
  it('registers and retrieves a widget by id', () => {
    const registry = new WidgetRegistry();
    const widget = makeWidget('speed');
    registry.register(widget);
    expect(registry.get('speed')).toBe(widget);
    expect(registry.has('speed')).toBe(true);
  });

  it('returns undefined for an unknown id instead of throwing', () => {
    const registry = new WidgetRegistry();
    expect(registry.get('does-not-exist')).toBeUndefined();
    expect(registry.has('does-not-exist')).toBe(false);
  });

  it('rejects a duplicate id', () => {
    const registry = new WidgetRegistry();
    registry.register(makeWidget('speed'));
    expect(() => registry.register(makeWidget('speed'))).toThrow(/already registered/);
  });

  it('list() returns all registered widgets in insertion order', () => {
    const registry = new WidgetRegistry();
    registry.register(makeWidget('a'));
    registry.register(makeWidget('b'));
    registry.register(makeWidget('c'));
    expect(registry.list().map((w) => w.id)).toEqual(['a', 'b', 'c']);
  });

  it('unregister removes a widget and is idempotent (E09-T2 add-on teardown)', () => {
    const registry = new WidgetRegistry();
    registry.register(makeWidget('com.example.addon/w1'));
    expect(registry.has('com.example.addon/w1')).toBe(true);
    expect(registry.unregister('com.example.addon/w1')).toBe(true);
    expect(registry.has('com.example.addon/w1')).toBe(false);
    // Idempotent: a second removal (or an unknown id) is a no-op, never throws.
    expect(registry.unregister('com.example.addon/w1')).toBe(false);
    // And the id is free to register again afterwards (no residue).
    expect(() => registry.register(makeWidget('com.example.addon/w1'))).not.toThrow();
  });
});
