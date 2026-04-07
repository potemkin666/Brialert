import {
  loadGeoLookup,
  loadLiveFeed,
  loadWatchGeography
} from '../../shared/feed-controller.mjs';
import { reportBackgroundError } from '../../shared/logger.mjs';

function currentOriginBase() {
  if (typeof window === 'undefined' || !window.location) return null;
  const origin = window.location.origin.trim();
  return origin.length > 0 ? origin : null;
}

const LIVE_FEED_TRIGGER_API_BASES = [
  'https://brialertbackend.vercel.app',
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
