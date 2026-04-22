import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp, isPrivateUrl, createPinnedSafeDispatcher } from '../api/_lib/url-safety.js';

describe('isPrivateIp — IPv4 ranges', () => {
  it('blocks RFC1918 private ranges', () => {
    assert.equal(isPrivateIp('10.0.0.1'), true);
    assert.equal(isPrivateIp('10.255.255.255'), true);
    assert.equal(isPrivateIp('172.16.0.1'), true);
    assert.equal(isPrivateIp('172.31.255.254'), true);
    assert.equal(isPrivateIp('192.168.1.1'), true);
  });

  it('blocks loopback, unspecified, link-local', () => {
    assert.equal(isPrivateIp('127.0.0.1'), true);
    assert.equal(isPrivateIp('127.255.255.255'), true);
    assert.equal(isPrivateIp('0.0.0.0'), true);
    assert.equal(isPrivateIp('169.254.0.1'), true);
    assert.equal(isPrivateIp('169.254.169.254'), true, 'AWS/Azure IMDS');
  });

  it('blocks CGNAT 100.64.0.0/10 (RFC6598)', () => {
    assert.equal(isPrivateIp('100.64.0.1'), true);
    assert.equal(isPrivateIp('100.100.50.50'), true);
    assert.equal(isPrivateIp('100.127.255.254'), true);
    // Just outside the CGNAT block:
    assert.equal(isPrivateIp('100.63.255.255'), false);
    assert.equal(isPrivateIp('100.128.0.0'), false);
  });

  it('blocks benchmark 198.18.0.0/15 (RFC2544)', () => {
    assert.equal(isPrivateIp('198.18.0.1'), true);
    assert.equal(isPrivateIp('198.19.255.254'), true);
    // Neighbour address that must stay public:
    assert.equal(isPrivateIp('198.17.0.1'), false);
    assert.equal(isPrivateIp('198.20.0.1'), false);
  });

  it('blocks TEST-NET documentation ranges', () => {
    assert.equal(isPrivateIp('192.0.2.1'), true);
    assert.equal(isPrivateIp('198.51.100.42'), true);
    assert.equal(isPrivateIp('203.0.113.1'), true);
  });

  it('blocks multicast and reserved (224.0.0.0/3)', () => {
    assert.equal(isPrivateIp('224.0.0.1'), true);
    assert.equal(isPrivateIp('239.255.255.255'), true);
    assert.equal(isPrivateIp('255.255.255.255'), true);
  });

  it('allows genuine public addresses', () => {
    assert.equal(isPrivateIp('8.8.8.8'), false);
    assert.equal(isPrivateIp('1.1.1.1'), false);
    assert.equal(isPrivateIp('93.184.216.34'), false, 'example.com');
  });
});

describe('isPrivateIp — IPv6 ranges', () => {
  it('blocks loopback, unspecified, link-local', () => {
    assert.equal(isPrivateIp('::1'), true);
    assert.equal(isPrivateIp('::'), true);
    assert.equal(isPrivateIp('fe80::1'), true);
  });

  it('blocks unique-local fc00::/7', () => {
    assert.equal(isPrivateIp('fc00::1'), true);
    assert.equal(isPrivateIp('fd00:1234:5678::1'), true);
  });

  it('blocks IPv4-mapped IPv6 that wraps a private IPv4', () => {
    assert.equal(isPrivateIp('::ffff:127.0.0.1'), true);
    assert.equal(isPrivateIp('::ffff:169.254.169.254'), true);
    assert.equal(isPrivateIp('::ffff:10.0.0.1'), true);
    // Public IPv4 should still round-trip as public through the mapped form:
    assert.equal(isPrivateIp('::ffff:8.8.8.8'), false);
  });

  it('blocks IPv4-compatible IPv6 that wraps a private IPv4', () => {
    assert.equal(isPrivateIp('::127.0.0.1'), true);
  });

  it('blocks 6to4 mappings of private IPv4 addresses', () => {
    // 2002:: prefix embeds IPv4 in the next 32 bits.
    // 127.0.0.1 == 7f00:0001 -> 2002:7f00:0001::
    assert.equal(isPrivateIp('2002:7f00:1::'), true);
    // 169.254.169.254 == a9fe:a9fe -> 2002:a9fe:a9fe::
    assert.equal(isPrivateIp('2002:a9fe:a9fe::'), true);
  });
});

describe('isPrivateUrl', () => {
  it('blocks well-known metadata hostnames', async () => {
    assert.equal(await isPrivateUrl('http://localhost/'), true);
    assert.equal(await isPrivateUrl('http://metadata.google.internal/'), true);
  });

  it('blocks direct private IP URLs without hitting DNS', async () => {
    assert.equal(await isPrivateUrl('http://169.254.169.254/latest/meta-data/'), true);
    assert.equal(await isPrivateUrl('http://[::1]/'), true);
  });

  it('rejects malformed URLs', async () => {
    assert.equal(await isPrivateUrl('not a url'), true);
  });
});

describe('createPinnedSafeDispatcher', () => {
  it('rejects literal private IP URLs before any DNS call', async () => {
    const result = await createPinnedSafeDispatcher('http://127.0.0.1/');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'private-hostname');
  });

  it('rejects malformed URLs', async () => {
    const result = await createPinnedSafeDispatcher('not a url');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-url');
  });
});
