import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, isPrivateHost, NotRoutable } from '../src/target.js';

test('addresses inside a local network are refused', () => {
  for (const h of [
    'localhost', 'nas.localhost', '127.0.0.1', '127.5.5.5', '::1',
    '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.1.1', 'fe80::1', 'fc00::1', 'fd12:3456::1', '[fd00::1]',
    'nas.local', 'nas', 'printer',
  ]) {
    assert.equal(isPrivateHost(h), true, h);
  }
});

test('public hosts are not refused', () => {
  for (const h of [
    'example.com', 'www.example.com', '172.32.0.1', '11.0.0.1',
    '192.169.1.1', '169.255.1.1', 'local.example.com',
  ]) {
    assert.equal(isPrivateHost(h), false, h);
  }
});

// A registered name that begins like an address range is still a registered name. Getting this
// wrong made real sites unopenable.
test('a registered name is never read as an address range', () => {
  for (const h of [
    'fcbarcelona.com', 'fdny.org', 'fc-koeln.de',
    '127.example.com', '10.example.com', '192.168.example.com',
    '169.254.example.com', '172.16.example.com',
  ]) {
    assert.equal(isPrivateHost(h), false, h);
  }
});

test('classify names why a page cannot be routed', () => {
  assert.deepEqual(classify('https://example.com/a'), {
    ok: true, origin: 'https://example.com', host: 'example.com',
  });
  assert.equal(/** @type {any} */ (classify('chrome://extensions')).reason, NotRoutable.scheme);
  assert.equal(/** @type {any} */ (classify('file:///tmp/x.html')).reason, NotRoutable.scheme);
  assert.equal(/** @type {any} */ (classify(undefined)).reason, NotRoutable.scheme);
  assert.equal(/** @type {any} */ (classify('http://192.168.0.1/')).reason, NotRoutable.private);
});

test('a port belongs to the origin, not the host label', () => {
  assert.equal(/** @type {any} */ (classify('http://example.com:8080/x')).origin, 'http://example.com:8080');
  assert.equal(/** @type {any} */ (classify('http://example.com:8080/x')).host, 'example.com:8080');
});
