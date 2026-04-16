import { lookup } from 'node:dns/promises';

const PRIVATE_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.internal'
]);

/**
 * Returns true when the hostname portion of `rawUrl` points at a
 * private / loopback / link-local / cloud-metadata IP address, or at
 * a well-known cloud metadata hostname.
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

  const hostname = parsed.hostname.toLowerCase();
  if (PRIVATE_HOSTNAMES.has(hostname)) return true;

  if (isPrivateIp(hostname)) return true;

  try {
    const { address } = await lookup(hostname);
    return isPrivateIp(address);
  } catch {
    return false;
  }
}

/**
 * Classify an IPv4 or IPv6 literal as private / reserved.
 */
function isPrivateIp(ip) {
  if (!ip) return false;

  // IPv4
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('127.')) return true;
  if (ip.startsWith('0.')) return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;

  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice(7);
    return isPrivateIp(mapped);
  }

  return false;
}
