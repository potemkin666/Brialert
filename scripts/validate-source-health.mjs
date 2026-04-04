import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sourcesPath = path.join(repoRoot, 'data', 'sources.json');

const REQUEST_TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;
const USER_AGENT = 'Mozilla/5.0 (compatible; BrialertSourceValidator/1.0; +https://github.com/potemkin666/Brialert)';

function stripBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF/, '') : text;
}

function isHtmlLike(contentType = '', sample = '') {
  const lowerType = contentType.toLowerCase();
  if (lowerType.includes('text/html') || lowerType.includes('application/xhtml+xml')) return true;
  const lowerSample = sample.toLowerCase();
  return (
    lowerSample.includes('<!doctype html') ||
    lowerSample.includes('<html') ||
    lowerSample.includes('<head') ||
    lowerSample.includes('<body')
  );
}

function looksUseful(sample = '') {
  const text = sample
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length >= 200;
}

async function loadLondonHtmlSources() {
  const raw = stripBom(await fs.readFile(sourcesPath, 'utf8'));
  const parsed = JSON.parse(raw);
  const sources = Array.isArray(parsed?.sources) ? parsed.sources : [];
  return sources.filter((source) =>
    source &&
    source.region === 'london' &&
    source.kind === 'html'
  );
}

async function readSample(response) {
  const text = await response.text();
  return text.slice(0, 4000);
}

function classifyError(message) {
  if (/non-HTML response/.test(message)) return 'hard';
  return 'warn';
}

async function validateSource(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(source.endpoint, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        'accept': 'text/html,application/xhtml+xml'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const sample = await readSample(response);
    const contentType = response.headers.get('content-type') || '';

    if (!isHtmlLike(contentType, sample)) {
      throw new Error(`non-HTML response (${contentType || 'unknown content-type'})`);
    }

    if (!looksUseful(sample)) {
      throw new Error('page body too small or not useful');
    }

    return {
      id: source.id,
      ok: true,
      status: response.status
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: source.id,
      ok: false,
      error: message,
      severity: classifyError(message)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency(items, worker, limit) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const current = cursor++;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => run()));
  return results;
}

async function main() {
  const sources = await loadLondonHtmlSources();
  const results = await mapWithConcurrency(sources, validateSource, CONCURRENCY);
  const failures = results.filter((result) => !result.ok);
  const hardFailures = failures.filter((result) => result.severity === 'hard');
  const softFailures = failures.filter((result) => result.severity !== 'hard');

  console.log(`Validated ${results.length} London HTML sources.`);
  for (const result of results) {
    if (result.ok) console.log(`OK ${result.id}`);
    else if (result.severity === 'hard') console.log(`FAIL ${result.id}: ${result.error}`);
    else console.log(`WARN ${result.id}: ${result.error}`);
  }

  if (softFailures.length) {
    console.log(`\n${softFailures.length} source(s) returned warnings (bot-protection, JS-rendered pages, or transient network errors).`);
  }

  if (hardFailures.length) {
    throw new Error(`London source health validation failed for ${hardFailures.length} source(s) with broken endpoints (non-HTML response).`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
