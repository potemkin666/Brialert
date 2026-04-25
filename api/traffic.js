import { applyCorsHeaders, requireAdminSession } from './_lib/admin-session.js';
import { createJsonKvStore } from './_lib/kv-store.js';
import {
  applyTrafficEvent,
  createVisitorHash,
  mergeTrafficIndex,
  publicTrafficSummary,
  sanitiseTrafficEvent,
  trafficDayKey
} from './_lib/traffic-analytics.js';
import { createDistributedRateLimiter, resolveClientKey } from './_lib/rate-limit.js';

const INDEX_KEY = 'traffic:index';
const SUMMARY_KEY_PREFIX = 'traffic:summary:';
const SUMMARY_TTL_SECONDS = 60 * 60 * 24 * 32;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_BURST = 40;

const trafficLimiter = createDistributedRateLimiter({
  keyPrefix: 'traffic-events',
  windowMs: RATE_LIMIT_WINDOW_MS,
  maxBurst: RATE_LIMIT_BURST
});

function sendError(response, error) {
  response.status(500).json({
    ok: false,
    error: 'traffic-storage-failure',
    message: error instanceof Error ? error.message : 'Failed to capture traffic event.'
  });
}

function parseBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string' && request.body.trim()) {
    try {
      return JSON.parse(request.body);
    } catch {
      return null;
    }
  }
  return {};
}

function summaryKey(dayKey) {
  return `${SUMMARY_KEY_PREFIX}${dayKey}`;
}

export function createTrafficHandler({
  store = createJsonKvStore(),
  limiter = trafficLimiter,
  requireAdmin = requireAdminSession
} = {}) {
  return async function handler(request, response) {
    applyCorsHeaders(request, response, 'GET,POST,OPTIONS');
    if (request.method === 'OPTIONS') {
      response.setHeader('Allow', 'GET,POST,OPTIONS');
      return response.status(204).end();
    }

    if (request.method === 'GET') {
      if (!requireAdmin(request, response)) return response;
      try {
        const index = await store.getJson(INDEX_KEY);
        const days = Array.isArray(index?.days) ? index.days : [];
        const summaries = await Promise.all(days.map((day) => store.getJson(summaryKey(day))));
        return response.status(200).json({
          ok: true,
          storageMode: store.mode || 'unknown',
          days: summaries.map((summary) => publicTrafficSummary(summary)).filter(Boolean)
        });
      } catch (error) {
        return sendError(response, error);
      }
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET,POST,OPTIONS');
      return response.status(405).json({
        ok: false,
        error: 'method-not-allowed',
        message: 'Only GET and POST are supported.'
      });
    }

    try {
      if (await limiter.isLimited(resolveClientKey(request))) {
        return response.status(429).json({
          ok: false,
          error: 'rate-limited',
          message: 'Too many traffic events received. Please slow down.'
        });
      }

      const occurredAt = new Date().toISOString();
      const event = sanitiseTrafficEvent(parseBody(request));
      const dayKey = trafficDayKey(occurredAt);
      const visitorHash = createVisitorHash({
        clientKey: resolveClientKey(request),
        userAgent: request?.headers?.['user-agent'],
        dayKey,
        salt: process.env.ALBERTALERT_TRAFFIC_SALT || process.env.ALBERTALERT_SESSION_SECRET || ''
      });

      const [currentSummary, currentIndex] = await Promise.all([
        store.getJson(summaryKey(dayKey)),
        store.getJson(INDEX_KEY)
      ]);

      const nextSummary = applyTrafficEvent(currentSummary, event, visitorHash, occurredAt);
      const nextIndex = mergeTrafficIndex(currentIndex, dayKey);

      await Promise.all([
        store.setJson(summaryKey(dayKey), nextSummary, { ex: SUMMARY_TTL_SECONDS }),
        store.setJson(INDEX_KEY, nextIndex, { ex: SUMMARY_TTL_SECONDS })
      ]);

      return response.status(202).json({
        ok: true,
        accepted: true
      });
    } catch (error) {
      return sendError(response, error);
    }
  };
}

export default createTrafficHandler();
