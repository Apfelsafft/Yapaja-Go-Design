/**
 * Line-buffering for gpsd's newline-delimited JSON stream. TCP delivers a
 * byte stream, not message boundaries: a single gpsd line can arrive split
 * across multiple `data` events, and multiple gpsd lines can arrive in one
 * `data` event. This tiny stateful buffer normalizes both into a sequence
 * of complete, trimmed, non-empty lines -- kept as a standalone pure-string
 * class (no `net` dependency) so it's testable without a real/mock socket.
 */
export class LineBuffer {
  private pending = '';

  /** Feeds a chunk of received bytes (already decoded to a string); returns
   * every complete line terminated within the accumulated buffer so far.
   * Any trailing partial line is retained for the next `feed()` call. */
  feed(chunk: string): string[] {
    this.pending += chunk;
    const lines: string[] = [];

    let newlineIndex = this.pending.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.pending.slice(0, newlineIndex).trim();
      this.pending = this.pending.slice(newlineIndex + 1);
      if (line.length > 0) lines.push(line);
      newlineIndex = this.pending.indexOf('\n');
    }

    return lines;
  }

  /** Discards any partial line held from a previous `feed()`. Call on reconnect. */
  reset(): void {
    this.pending = '';
  }
}
