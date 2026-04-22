import { lookup } from 'node:dns/promises';
import { Agent } from 'undici';

const PRIVATE_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata.internal'
]);

/**
 * Strip surrounding brackets from an IPv6 hostname returned by WHATWG
 * URL parsing (e.g. "[::1]" -> "::1").
 */
function normaliseHostname(hostname) {
  const value = String(hostname || '').toLowerCase();
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Returns true when the hostname portion of `rawUrl` points at a
 * private / loopback / link-local / cloud-metadata IP address, or at
 * a well-known cloud metadata hostname.
 *
 * Resolves *all* A/AAAA records and returns true if any one of them is
 * private, so a multi-record host cannot smuggle an internal address
 * through a single-record lookup.
 *
 * Designed to block SSRF probes against internal infrastructure.
 */
export async function isPrivateUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return true;
  }

  const hostname = normaliseHostname(parsed.hostname);
  if (PRIVATE_HOSTNAMES.has(hostname)) return true;

  if (isPrivateIp(hostname)) return true;

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!Array.isArray(addresses) || addresses.length === 0) return true;
    return addresses.some((entry) => isPrivateIp(entry?.address));
  } catch {
    return false;
  }
}

/**
 * Resolve a URL to a single public IP address and return an undici
 * dispatcher that pins every connection attempt (including redirects)
 * to that exact address.
 *
 * This closes the DNS-rebinding TOCTOU gap between `isPrivateUrl` and
 * the subsequent outbound `fetch`: a malicious authoritative server
 * cannot flip a public A record to a private one between the two
 * lookups because the dispatcher's `lookup` always returns the
 * pre-resolved, validated address.
 *
 * Returns `{ ok: false, reason }` when the hostname only resolves to
 * private / reserved addresses or when resolution fails.
 *
 * Returns `{ ok: true, dispatcher, address, family }` when a usable
 * public address is available; callers should pass `dispatcher` to
 * `fetch(..., { dispatcher })` and *not* follow redirects manually to
 * a different host without re-running this helper.
 */
export async function createPinnedSafeDispatcher(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }

  const hostname = normaliseHostname(parsed.hostname);
  if (PRIVATE_HOSTNAMES.has(hostname) || isPrivateIp(hostname)) {
    return { ok: false, reason: 'private-hostname' };
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    return { ok: false, reason: `dns-failure:${error?.code || 'unknown'}` };
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return { ok: false, reason: 'no-address' };
  }
  if (addresses.some((entry) => isPrivateIp(entry?.address))) {
    return { ok: false, reason: 'private-address' };
  }

  // Prefer the first public address, matching Node's default resolver
  // ordering, but force every subsequent lookup to yield that same IP.
  // Lookups for any other hostname (e.g. after a cross-host redirect)
  // are rejected so the pinned dispatcher cannot silently mis-route
  // traffic to the original IP for an unrelated host.
  const pinned = addresses[0];
  const dispatcher = new Agent({
    connect: {
      lookup(host, _options, cb) {
        if (String(host).toLowerCase() !== hostname) {
          cb(new Error(`Pinned dispatcher refuses lookup for ${host}; only ${hostname} is allowed.`));
          return;
        }
        cb(null, pinned.address, pinned.family);
      }
    }
  });

  return {
    ok: true,
    dispatcher,
    address: pinned.address,
    family: pinned.family
  };
}

/**
 * Classify an IPv4 or IPv6 literal as private / reserved / unroutable.
 *
 * Coverage:
 *  - RFC1918 (10/8, 172.16/12, 192.168/16)
 *  - Loopback (127/8, ::1)
 *  - Unspecified (0/8, ::)
 *  - Link-local (169.254/16, fe80::/10)
 *  - CGNAT (100.64/10, RFC6598)
 *  - Benchmark (198.18/15, RFC2544)
 *  - TEST-NET-1/2/3 (192.0.2/24, 198.51.100/24, 203.0.113/24)
 *  - Multicast + reserved (224-255)
 *  - Unique local IPv6 (fc00::/7)
 *  - IPv4-mapped IPv6 (::ffff:)
 *  - 6to4 private mappings (2002:)
 *  - Cloud metadata address 169.254.169.254 (AWS/Azure IMDS)
 */
export function isPrivateIp(ip) {
  if (!ip) return false;

  // IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const octets = ip.split('.').map((part) => Number(part));
    if (octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
    const [a, b] = octets;
    if (a === 0) return true;                              // 0.0.0.0/8 unspecified
    if (a === 10) return true;                             // 10/8 RFC1918
    if (a === 127) return true;                            // loopback
    if (a === 169 && b === 254) return true;               // link-local + IMDS
    if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16/12 RFC1918
    if (a === 192 && b === 168) return true;               // 192.168/16 RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true;     // 100.64/10 CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true;  // 198.18/15 benchmark
    if (a === 192 && b === 0 && octets[2] === 2) return true;       // 192.0.2/24 TEST-NET-1
    if (a === 198 && b === 51 && octets[2] === 100) return true;    // 198.51.100/24 TEST-NET-2
    if (a === 203 && b === 0 && octets[2] === 113) return true;     // 203.0.113/24 TEST-NET-3
    if (a >= 224) return true;                             // multicast + reserved + broadcast
    return false;
  }

  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true;
  // Unique local: fc00::/7 covers fcxx: and fdxx:
  if (/^fc[0-9a-f]{2}:/.test(lower) || /^fd[0-9a-f]{2}:/.test(lower)) return true;
  // IPv4-mapped ::ffff:a.b.c.d or ::ffff:0:a.b.c.d
  const mappedMatch = lower.match(/^::ffff:(?:0*:)?((?:\d+\.){3}\d+)$/);
  if (mappedMatch) return isPrivateIp(mappedMatch[1]);
  // IPv4-compatible (deprecated) ::a.b.c.d
  const compatMatch = lower.match(/^::((?:\d+\.){3}\d+)$/);
  if (compatMatch) return isPrivateIp(compatMatch[1]);
  // 6to4 2002:xxxx:yyyy:: embeds an IPv4 address in the second+third groups
  if (lower.startsWith('2002:')) {
    const groups = lower.split(':');
    const hex = (groups[1] || '').padStart(4, '0') + (groups[2] || '').padStart(4, '0');
    if (/^[0-9a-f]{8}$/.test(hex)) {
      const ipv4 = [0, 2, 4, 6]
        .map((i) => parseInt(hex.slice(i, i + 2), 16))
        .join('.');
      if (isPrivateIp(ipv4)) return true;
    }
  }

  return false;
}
