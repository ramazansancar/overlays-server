import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_ALLOWED_ORIGINS } from '../src/config.ts';
import { hostHeaderAllowed, originAllowed } from '../src/transports/security.ts';

describe('originAllowed', () => {
  const defaults = DEFAULT_ALLOWED_ORIGINS;

  it('allows the overlay site and local pages by default', () => {
    assert.ok(originAllowed('https://overlays.ramazansancar.com.tr', defaults));
    assert.ok(originAllowed('http://localhost:5173', defaults));
    assert.ok(originAllowed('http://127.0.0.1:4173', defaults));
    assert.ok(originAllowed(undefined, defaults), 'no Origin header (curl, address bar)');
  });

  it('refuses other sites, look-alikes and file:// pages', () => {
    assert.ok(!originAllowed('https://evil.example', defaults));
    assert.ok(!originAllowed('http://overlays.ramazansancar.com.tr', defaults), 'http instead of https');
    assert.ok(!originAllowed('https://overlays.ramazansancar.com.tr.evil.example', defaults));
    assert.ok(!originAllowed('https://localhost:5173', defaults), 'different scheme');
    assert.ok(!originAllowed('null', defaults));
  });

  it('supports * and null when configured', () => {
    assert.ok(originAllowed('https://anything.example', ['*']));
    assert.ok(originAllowed('null', ['null']));
  });
});

describe('hostHeaderAllowed', () => {
  it('only answers loopback names while bound to loopback (DNS rebinding)', () => {
    assert.ok(hostHeaderAllowed('127.0.0.1:3456', '127.0.0.1'));
    assert.ok(hostHeaderAllowed('localhost:3456', '127.0.0.1'));
    assert.ok(hostHeaderAllowed('[::1]:3456', '127.0.0.1'));
    assert.ok(!hostHeaderAllowed('evil.example:3456', '127.0.0.1'));
    assert.ok(!hostHeaderAllowed(undefined, '127.0.0.1'));
  });

  it('does not restrict when listening on the LAN', () => {
    assert.ok(hostHeaderAllowed('192.168.1.20:3456', '0.0.0.0'));
  });
});
