import {
  loadGeoLookup,
  loadLiveFeed,
  loadWatchGeography
} from '../../shared/feed-controller.mjs';
import { reportBackgroundError } from '../../shared/logger.mjs';
import { DEFAULT_API_BASE } from '../../shared/api-base.mjs';

const MANUAL_REFRESH_POLL_INTERVAL_MS = 5_000;
const MANUAL_REFRESH_MAX_WAIT_MS = 90_000;

function currentOriginBase() {
  if (typeof window === 'undefined' || !window.location) return null;
  const origin = window.location.origin.trim();
  return origin.length > 0 ? origin : null;
}

const LIVE_FEED_TRIGGER_API_BASES = [
  DEFAULT_API_BASE,
  currentOriginBase()
].filter(Boolean);
const LIVE_FEED_TRIGGER_API_PATHS = [
  '/api/trigger-live-feed',
  '/api/trigger-feed-refresh'
];
const MAX_FAILURE_PREVIEW_COUNT = 2;
const LIVE_FEED_TRIGGER_API_URLS = LIVE_FEED_TRIGGER_API_BASES
  .flatMap((base) => LIVE_FEED_TRIGGER_API_PATHS.map((path) => `${base}${path}`));

async function triggerFeedRunVia(url) {
  let payload = {};
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'hero-refresh-button' })
  });
  payload = await response.json().catch((error) => {
    reportBackgroundError('feed', `Failed to parse trigger response from ${url}`, error, {
      operation: 'triggerFeedRunVia.parseResponse',
      url
    });
    return {};
  });
  if (!response.ok) {
    const error = new Error(String(payload?.detail || `HTTP ${response.status}`));
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function loadInitialResources(state, urls, normaliseAlert, onAfterLoad) {
  Promise.allSettled([
    loadGeoLookup(state, urls.geoLookupUrl),
    loadWatchGeography(state, urls.watchGeographyUrl)
  ]).finally(() => {
    loadLiveFeed(state, {
      liveFeedUrl: urls.liveFeedUrl,
      normaliseAlert,
      onAfterLoad
    });
  });
}

export function startFeedPolling(state, pollIntervalMs, liveFeedUrl, normaliseAlert, onAfterLoad) {
  return setInterval(() => {
    loadLiveFeed(state, {
      liveFeedUrl,
      normaliseAlert,
      onAfterLoad
    });
  }, pollIntervalMs);
}

export function refreshLiveFeedNow(state, liveFeedUrl, normaliseAlert, onAfterLoad) {
  return loadLiveFeed(state, {
    liveFeedUrl,
    normaliseAlert,
    onAfterLoad
  });
}

function feedGeneratedAtMs(state) {
  const value = state?.liveFeedGeneratedAt;
  if (!(value instanceof Date)) return NaN;
  const timeMs = value.getTime();
  return Number.isFinite(timeMs) ? timeMs : NaN;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function refreshLiveFeedUntilUpdated(
  state,
  liveFeedUrl,
  normaliseAlert,
  onAfterLoad,
  options = {}
) {
  const previousGeneratedAt = options.previousGeneratedAt instanceof Date
    ? options.previousGeneratedAt
    : state?.liveFeedGeneratedAt;
  const previousGeneratedAtMs = previousGeneratedAt instanceof Date
    ? previousGeneratedAt.getTime()
    : NaN;
  const pollIntervalMs = Number(options.pollIntervalMs || MANUAL_REFRESH_POLL_INTERVAL_MS);
  const maxWaitMs = Number(options.maxWaitMs || MANUAL_REFRESH_MAX_WAIT_MS);
  const deadline = Date.now() + Math.max(0, maxWaitMs);
  let attempts = 0;

  while (attempts === 0 || Date.now() < deadline) {
    attempts += 1;
    await refreshLiveFeedNow(state, liveFeedUrl, normaliseAlert, onAfterLoad);
    const currentGeneratedAtMs = feedGeneratedAtMs(state);
    if (!Number.isFinite(previousGeneratedAtMs) || (Number.isFinite(currentGeneratedAtMs) && currentGeneratedAtMs > previousGeneratedAtMs)) {
      return {
        updated: true,
        attempts,
        generatedAt: state?.liveFeedGeneratedAt instanceof Date ? state.liveFeedGeneratedAt.toISOString() : null
      };
    }
    if (Date.now() >= deadline) break;
    await delay(pollIntervalMs);
  }

  return {
    updated: false,
    attempts,
    generatedAt: state?.liveFeedGeneratedAt instanceof Date ? state.liveFeedGeneratedAt.toISOString() : null
  };
}

export async function triggerLiveFeedRun() {
  const failures = [];
  for (const apiUrl of LIVE_FEED_TRIGGER_API_URLS) {
    console.info(`[feed] Trigger start: ${apiUrl}`);
    try {
      const payload = await triggerFeedRunVia(apiUrl);
      console.info(`[feed] Trigger success: ${apiUrl}`);
      return { apiUrl, payload };
    } catch (error) {
      console.warn(`[feed] Trigger failed: ${apiUrl}`, error);
      failures.push(`${apiUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const previewFailures = failures.slice(0, MAX_FAILURE_PREVIEW_COUNT).join(' | ');
  const extraCount = Math.max(0, failures.length - MAX_FAILURE_PREVIEW_COUNT);
  const technicalMessage = `Unable to trigger live-feed run. ${previewFailures}${extraCount ? ` | +${extraCount} more failures` : ''}`;
  reportBackgroundError('feed', technicalMessage, new Error(technicalMessage), { operation: 'triggerLiveFeedRun' });
  throw new Error('Unable to trigger live-feed run automatically.');
}
