/**
 * Unit tests for LineBuffer: TCP-stream framing for gpsd's newline-delimited
 * JSON protocol (lines split across chunks, multiple lines per chunk).
 */

import { describe, it, expect } from 'vitest';
import { LineBuffer } from './lineBuffer.js';

describe('LineBuffer', () => {
  it('returns nothing until a newline arrives', () => {
    const buf = new LineBuffer();
    expect(buf.feed('{"class":"TPV"')).toEqual([]);
  });

  it('returns a single complete line once the newline arrives', () => {
    const buf = new LineBuffer();
    buf.feed('{"class":"TPV"');
    expect(buf.feed(',"mode":3}\n')).toEqual(['{"class":"TPV","mode":3}']);
  });

  it('handles a line split across three chunks', () => {
    const buf = new LineBuffer();
    expect(buf.feed('{"cla')).toEqual([]);
    expect(buf.feed('ss":"TP')).toEqual([]);
    expect(buf.feed('V","mode":3}\n')).toEqual(['{"class":"TPV","mode":3}']);
  });

  it('returns multiple complete lines from a single chunk', () => {
    const buf = new LineBuffer();
    const chunk = '{"class":"VERSION"}\n{"class":"TPV","mode":3}\n{"class":"SKY"}\n';
    expect(buf.feed(chunk)).toEqual([
      '{"class":"VERSION"}',
      '{"class":"TPV","mode":3}',
      '{"class":"SKY"}',
    ]);
  });

  it('retains a trailing partial line for the next feed() call', () => {
    const buf = new LineBuffer();
    const lines = buf.feed('{"class":"TPV","mode":3}\n{"class":"SK');
    expect(lines).toEqual(['{"class":"TPV","mode":3}']);
    expect(buf.feed('Y"}\n')).toEqual(['{"class":"SKY"}']);
  });

  it('skips blank lines produced by \\r\\n or repeated newlines', () => {
    const buf = new LineBuffer();
    expect(buf.feed('{"class":"TPV","mode":3}\r\n\n{"class":"SKY"}\n')).toEqual([
      '{"class":"TPV","mode":3}',
      '{"class":"SKY"}',
    ]);
  });

  it('reset() discards a pending partial line', () => {
    const buf = new LineBuffer();
    buf.feed('{"class":"TPV"');
    buf.reset();
    expect(buf.feed('junk-from-previous-connection\n')).toEqual(['junk-from-previous-connection']);
  });
});
