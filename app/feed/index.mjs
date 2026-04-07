import {
  loadGeoLookup,
  loadLiveFeed,
  loadWatchGeography
} from '../../shared/feed-controller.mjs';
import { reportBackgroundError } from '../../shared/logger.mjs';

const LIVE_FEED_TRIGGER_API_BASES = [
  'https://brialertbackend.vercel.app',
  ''
];
const LIVE_FEED_TRIGGER_API_PATHS = [
  '/api/trigger-live-feed',
  '/api/trigger-feed-refresh'
];
const LIVE_FEED_TRIGGER_API_URLS = Array.from(new Set(
  LIVE_FEED_TRIGGER_API_BASES.flatMap((base) => LIVE_FEED_TRIGGER_API_PATHS.map((path) => `${base}${path}`))
));

async function triggerFeedRunVia(url) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'hero-refresh-button' })
  });
  const payload = await response.json().catch(() => ({}));
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
    try {
      const payload = await triggerFeedRunVia(apiUrl);
      return { apiUrl, payload };
    } catch (error) {
      failures.push(`${apiUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const previewFailures = failures.slice(0, 2).join(' | ');
  const extraCount = Math.max(0, failures.length - 2);
  const message = `Unable to trigger live-feed run. ${previewFailures}${extraCount ? ` | +${extraCount} more` : ''}`;
  reportBackgroundError('feed', message, new Error(message), { operation: 'triggerLiveFeedRun' });
  throw new Error(message);
}
