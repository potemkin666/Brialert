import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  FEED_BOT_USER_AGENT,
  RETRYABLE_STATUS_CODES,
  outputPath,
  repoRoot
} from './config.mjs';
import { clean } from '../../shared/taxonomy.mjs';

export function stripBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF/, '') : text;
}

export async function readJsonFile(jsonPath) {
  const raw = stripBom(await fs.readFile(jsonPath, 'utf8'));
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON at ${path.relative(repoRoot, jsonPath)}: ${message}`);
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function mapWithConcurrency(items, limit, mapper) {
  if (!Array.isArray(items) || !items.length) return [];
  const concurrency = Math.max(1, Math.min(limit || 1, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

export function arrayify(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function absoluteUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return base;
  }
}

export function parseSourceDate(rawDate) {
  if (!rawDate) return null;
  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normaliseLanguageTag(value) {
  return clean(value).toLowerCase().replace('_', '-');
}

export function isEnglishLanguage(value) {
  const lang = normaliseLanguageTag(value);
  return !lang || lang === 'en' || lang.startsWith('en-');
}

function mergedHeaders(source = null) {
  return {
    'user-agent': clean(source?.headers?.['user-agent']) || FEED_BOT_USER_AGENT,
    accept: clean(source?.headers?.accept) || 'application/feed+json, application/json;q=0.95, application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
    'accept-language': clean(source?.headers?.['accept-language']) || 'en-GB,en;q=0.9',
    'cache-control': clean(source?.headers?.['cache-control']) || 'no-cache'
  };
}

function classifyBodyBlock(text = '') {
  const lower = String(text).toLowerCase();
  if (!lower) return '';
  if (
    lower.includes('attention required') ||
    lower.includes('cloudflare') ||
    lower.includes('captcha') ||
    lower.includes('cf-challenge') ||
    lower.includes('just a moment') ||
    lower.includes('enable javascript and cookies')
  ) return 'anti-bot protection';
  if (
    lower.includes('access denied') ||
    lower.includes('request blocked') ||
    lower.includes('forbidden')
  ) return 'blocked access page';
  return '';
}

export async function fetchText(url, attempt = 1, options = {}) {
  const source = options?.source || null;
  const configuredTimeoutMs = Number(source?.timeoutMs);
  const configuredMaxRetries = Number(source?.maxRetries);
  const timeoutMs = configuredTimeoutMs > 0 ? configuredTimeoutMs : DEFAULT_TIMEOUT_MS;
  const maxAttempts = configuredMaxRetries > 0 ? configuredMaxRetries : DEFAULT_MAX_RETRIES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: mergedHeaders(source),
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) {
      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxAttempts) {
        const retryAfterHeader = Number(response.headers.get('retry-after'));
        const retryDelay = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : 1000 * Math.pow(2, attempt - 1);

        await sleep(retryDelay);
        return fetchText(url, attempt + 1, options);
      }

      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    const blockedClass = classifyBodyBlock(text);
    if (blockedClass) {
      throw new Error(`Blocked by ${blockedClass}`);
    }

    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable =
      message.includes('fetch failed') ||
      message.includes('aborted') ||
      message.includes('AbortError') ||
      message.includes('ECONNRESET') ||
      message.includes('ETIMEDOUT');

    if (retryable && attempt < maxAttempts) {
      await sleep(1000 * Math.pow(2, attempt - 1));
      return fetchText(url, attempt + 1, options);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchTextWithPlaywright(url, options = {}) {
  const timeoutMs = Math.max(5000, Number(options?.timeoutMs || DEFAULT_TIMEOUT_MS));
  const playwright = await import('playwright').catch(() => null);
  if (!playwright?.chromium) {
    throw new Error('Playwright fallback unavailable: install optional dependency "playwright" to enable browser fallback');
  }
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: clean(options?.source?.headers?.['user-agent']) || FEED_BOT_USER_AGENT
    });
    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });
    const html = await page.content();
    const blockedClass = classifyBodyBlock(html);
    if (blockedClass) {
      throw new Error(`Blocked by ${blockedClass}`);
    }
    return html;
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function readExisting() {
  try {
    return await readJsonFile(outputPath);
  } catch {
    return null;
  }
}

export function summariseSourceError(source, error) {
  const message = error instanceof Error ? error.message : String(error);
  let category = 'unknown';
  if (/HTTP 404|HTTP 410/i.test(message)) category = 'dead-or-moved-url';
  else if (/HTTP 403|HTTP 401|access denied|blocked/i.test(message)) category = 'blocked-or-auth';
  else if (/anti-bot|captcha|cloudflare|javascript and cookies/i.test(message)) category = 'anti-bot-protection';
  else if (/HTTP \d{3}/i.test(message)) category = 'http-status-error';
  else if (/abort|timeout|timed out|ETIMEDOUT/i.test(message)) category = 'timeout';
  else if (/fetch failed|ECONNRESET|ENOTFOUND/i.test(message)) category = 'network-failure';
  else if (/no items parsed|selector/i.test(message)) category = 'brittle-selectors-or-js-rendering';
  return {
    id: clean(source?.id) || 'unknown-source',
    provider: clean(source?.provider) || 'Unknown provider',
    endpoint: clean(source?.endpoint) || '',
    message,
    category
  };
}

export function normaliseSourcesPayload(rawSources) {
  const sources = Array.isArray(rawSources)
    ? rawSources
    : Array.isArray(rawSources?.sources)
      ? rawSources.sources
      : null;
  if (!sources) {
    throw new Error('Expected sources.json to contain an array or { sources: [] }.');
  }
  const seen = new Set();
  const duplicates = [];
  const unique = [];
  for (const source of sources) {
    const id = clean(source?.id);
    if (!id) {
      unique.push(source);
      continue;
    }
    if (seen.has(id)) {
      duplicates.push(id);
      continue;
    }
    seen.add(id);
    unique.push(source);
  }
  if (duplicates.length) {
    const uniqueDuplicates = [...new Set(duplicates)];
    console.warn(`Skipped ${duplicates.length} duplicate source entries across ${uniqueDuplicates.length} source id(s): ${uniqueDuplicates.join(', ')}`);
  }
  return unique;
}

export function normaliseSourceRequestsPayload(rawRequests) {
  if (rawRequests == null) return [];
  const requests = Array.isArray(rawRequests)
    ? rawRequests
    : Array.isArray(rawRequests?.requests)
      ? rawRequests.requests
      : null;
  if (!requests) {
    throw new Error('Expected source-requests.json to contain an array or { requests: [] }.');
  }
  return normaliseSourcesPayload(requests);
}

function normalisedEndpointKey(endpoint) {
  try {
    const url = new URL(clean(endpoint));
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return clean(endpoint).replace(/\/$/, '');
  }
}

export function mergeSourceCatalogs(baseSources, requestedSources) {
  const merged = [];
  const seenIds = new Set();
  const seenEndpoints = new Set();

  for (const source of [...(Array.isArray(baseSources) ? baseSources : []), ...(Array.isArray(requestedSources) ? requestedSources : [])]) {
    const id = clean(source?.id);
    const endpointKey = normalisedEndpointKey(source?.endpoint);
    if ((id && seenIds.has(id)) || (endpointKey && seenEndpoints.has(endpointKey))) continue;
    if (id) seenIds.add(id);
    if (endpointKey) seenEndpoints.add(endpointKey);
    merged.push(source);
  }

  return merged;
}
