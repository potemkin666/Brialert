import crypto from 'node:crypto';

const VALID_EVENT_TYPES = new Set(['page_view', 'tab_view', 'map_mode']);
const VALID_TABS = new Set(['firstalert', 'map', 'watchlists', 'notes', 'sources']);
const VALID_MAP_MODES = new Set(['world', 'london', 'nearby']);
const MAX_TRACKED_DAYS = 14;
const MAX_VISITOR_HASHES = 10_000;

function clean(value) {
  return String(value || '').trim();
}

function sanitisePath(rawValue) {
  const raw = clean(rawValue);
  if (!raw) return '/';
  try {
    return new URL(raw, 'https://albertalert.local').pathname || '/';
  } catch {
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    return path.replace(/[?#].*$/, '') || '/';
  }
}

function sanitiseChoice(rawValue, validValues) {
  const value = clean(rawValue).toLowerCase();
  return validValues.has(value) ? value : null;
}

function sanitiseReferrerHost(rawValue) {
  const raw = clean(rawValue);
  if (!raw) return 'direct';
  try {
    return new URL(raw).hostname.toLowerCase() || 'direct';
  } catch {
    return 'unknown';
  }
}

function sanitiseLanguage(rawValue) {
  return clean(rawValue).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'unknown';
}

function sanitiseTimezone(rawValue) {
  return clean(rawValue).replace(/[^A-Za-z0-9/_+-]/g, '').slice(0, 64) || 'unknown';
}

function sanitiseDimension(rawValue) {
  const value = Number.parseInt(rawValue, 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 10_000) : null;
}

function bucketDimension(value) {
  if (!Number.isFinite(value) || value <= 0) return 'unknown';
  if (value <= 480) return '≤480';
  if (value <= 768) return '481-768';
  if (value <= 1024) return '769-1024';
  if (value <= 1440) return '1025-1440';
  return '1441+';
}

function incrementCount(counter, key) {
  if (!key) return;
  counter[key] = (counter[key] || 0) + 1;
}

function uniqueVisitorHashes(rawHashes) {
  const unique = new Set(Array.isArray(rawHashes) ? rawHashes.filter(Boolean) : []);
  return [...unique].slice(0, MAX_VISITOR_HASHES);
}

export function trafficDayKey(at = new Date()) {
  return new Date(at).toISOString().slice(0, 10);
}

export function sanitiseTrafficEvent(rawEvent = {}) {
  const eventType = sanitiseChoice(rawEvent.eventType || rawEvent.type, VALID_EVENT_TYPES) || 'page_view';
  const viewportWidth = sanitiseDimension(rawEvent.viewportWidth);
  const viewportHeight = sanitiseDimension(rawEvent.viewportHeight);
  const screenWidth = sanitiseDimension(rawEvent.screenWidth);
  const screenHeight = sanitiseDimension(rawEvent.screenHeight);

  return {
    eventType,
    path: sanitisePath(rawEvent.path),
    tab: sanitiseChoice(rawEvent.tab, VALID_TABS),
    mapMode: sanitiseChoice(rawEvent.mapMode, VALID_MAP_MODES),
    referrerHost: sanitiseReferrerHost(rawEvent.referrer),
    language: sanitiseLanguage(rawEvent.language),
    timezone: sanitiseTimezone(rawEvent.timezone),
    viewportBucket: `${bucketDimension(viewportWidth)}x${bucketDimension(viewportHeight)}`,
    screenBucket: `${bucketDimension(screenWidth)}x${bucketDimension(screenHeight)}`
  };
}

export function createVisitorHash({ clientKey, userAgent, dayKey, salt }) {
  const source = [
    clean(salt) || 'albertalert-traffic',
    clean(dayKey) || trafficDayKey(),
    clean(clientKey) || 'global',
    clean(userAgent) || 'unknown'
  ].join('|');
  return crypto.createHash('sha256').update(source).digest('hex').slice(0, 24);
}

export function mergeTrafficIndex(rawIndex, dayKey) {
  const days = [clean(dayKey), ...(Array.isArray(rawIndex?.days) ? rawIndex.days : [])]
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index)
    .slice(0, MAX_TRACKED_DAYS);

  return {
    days,
    updatedAt: new Date().toISOString()
  };
}

export function applyTrafficEvent(rawSummary, event, visitorHash, occurredAt = new Date().toISOString()) {
  const dayKey = clean(rawSummary?.day) || trafficDayKey(occurredAt);
  const summary = {
    day: dayKey,
    firstSeenAt: clean(rawSummary?.firstSeenAt) || occurredAt,
    lastSeenAt: occurredAt,
    totalEvents: Number(rawSummary?.totalEvents) || 0,
    pageViews: Number(rawSummary?.pageViews) || 0,
    uniqueVisitors: Number(rawSummary?.uniqueVisitors) || 0,
    eventTypes: { ...(rawSummary?.eventTypes || {}) },
    paths: { ...(rawSummary?.paths || {}) },
    tabs: { ...(rawSummary?.tabs || {}) },
    mapModes: { ...(rawSummary?.mapModes || {}) },
    referrers: { ...(rawSummary?.referrers || {}) },
    languages: { ...(rawSummary?.languages || {}) },
    timezones: { ...(rawSummary?.timezones || {}) },
    viewportBuckets: { ...(rawSummary?.viewportBuckets || {}) },
    screenBuckets: { ...(rawSummary?.screenBuckets || {}) },
    visitorHashes: uniqueVisitorHashes(rawSummary?.visitorHashes)
  };

  summary.totalEvents += 1;
  if (event?.eventType === 'page_view') {
    summary.pageViews += 1;
  }

  incrementCount(summary.eventTypes, event?.eventType);
  incrementCount(summary.paths, event?.path);
  incrementCount(summary.tabs, event?.tab);
  incrementCount(summary.mapModes, event?.mapMode);
  incrementCount(summary.referrers, event?.referrerHost);
  incrementCount(summary.languages, event?.language);
  incrementCount(summary.timezones, event?.timezone);
  incrementCount(summary.viewportBuckets, event?.viewportBucket);
  incrementCount(summary.screenBuckets, event?.screenBucket);

  if (visitorHash && !summary.visitorHashes.includes(visitorHash) && summary.visitorHashes.length < MAX_VISITOR_HASHES) {
    summary.visitorHashes.push(visitorHash);
  }
  summary.uniqueVisitors = summary.visitorHashes.length;

  return summary;
}

export function publicTrafficSummary(rawSummary) {
  if (!rawSummary || typeof rawSummary !== 'object') return null;
  const { visitorHashes, ...publicSummary } = rawSummary;
  return publicSummary;
}
