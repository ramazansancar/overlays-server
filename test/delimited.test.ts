import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DelimitedDecoder } from '../src/lib/delimited.ts';

describe('DelimitedDecoder', () => {
  it('splits on NUL and keeps partial frames for the next chunk', () => {
    const d = new DelimitedDecoder();
    assert.deepEqual(d.push(Buffer.from('{"a":1}\0{"b"')), ['{"a":1}']);
    assert.deepEqual(d.push(Buffer.from(':2}\0\0{"c":3}\0')), ['{"b":2}', '{"c":3}']);
    assert.deepEqual(d.push(Buffer.from('')), []);
  });

  it('keeps a UTF-8 character split across chunks intact', () => {
    const d = new DelimitedDecoder();
    const bytes = Buffer.from('şğü\0');
    assert.deepEqual(d.push(bytes.subarray(0, 1)), []);
    assert.deepEqual(d.push(bytes.subarray(1)), ['şğü']);
  });

  it('drops oversized frames and recovers', () => {
    const d = new DelimitedDecoder({ maxFrameBytes: 8 });
    let overflow = 0;
    assert.deepEqual(d.push(Buffer.from('0123456789'), (n) => (overflow = n)), []);
    assert.equal(overflow, 10);
    assert.deepEqual(d.push(Buffer.from('ok\0')), ['ok']);
  });

  it('reset() discards a partial frame', () => {
    const d = new DelimitedDecoder();
    d.push(Buffer.from('half'));
    d.reset();
    assert.deepEqual(d.push(Buffer.from('new\0')), ['new']);
  });
});
