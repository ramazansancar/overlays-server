/**
 * Splits a byte stream into frames separated by a single delimiter byte (DDPAI uses NUL).
 * Works on bytes, so a multi-byte UTF-8 character split across two TCP chunks stays intact.
 */
export class DelimitedDecoder {
  private pending: Buffer[] = [];
  private pendingLength = 0;
  readonly delimiter: number;
  readonly maxFrameBytes: number;

  constructor(options: { delimiter?: number; maxFrameBytes?: number } = {}) {
    this.delimiter = options.delimiter ?? 0x00;
    this.maxFrameBytes = options.maxFrameBytes ?? 64 * 1024;
  }

  /**
   * Feeds a chunk and returns every frame it completed (decoded as UTF-8, empty frames skipped).
   * A frame that grows past `maxFrameBytes` without a delimiter is dropped, and `onOverflow` is called.
   */
  push(chunk: Buffer, onOverflow?: (bytes: number) => void): string[] {
    const frames: string[] = [];
    let start = 0;
    let index = chunk.indexOf(this.delimiter, start);
    while (index !== -1) {
      const part = chunk.subarray(start, index);
      const frame = this.pendingLength > 0 ? Buffer.concat([...this.pending, part]) : part;
      this.reset();
      if (frame.length > 0) frames.push(frame.toString('utf8'));
      start = index + 1;
      index = chunk.indexOf(this.delimiter, start);
    }
    if (start < chunk.length) {
      const rest = chunk.subarray(start);
      if (this.pendingLength + rest.length > this.maxFrameBytes) {
        onOverflow?.(this.pendingLength + rest.length);
        this.reset();
      } else {
        // Copy: the caller may reuse the chunk's memory.
        this.pending.push(Buffer.from(rest));
        this.pendingLength += rest.length;
      }
    }
    return frames;
  }

  /** Drops any partial frame (call on reconnect). */
  reset(): void {
    this.pending = [];
    this.pendingLength = 0;
  }
}
