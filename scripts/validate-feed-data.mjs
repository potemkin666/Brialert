import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const VALID_KINDS = new Set(['rss', 'atom', 'json', 'html', 'playwright_html']);
const VALID_LANES = new Set(['incidents', 'context', 'sanctions', 'oversight', 'border', 'prevention']);
const VALID_REGIONS = new Set(['uk', 'europe', 'london', 'eu', 'international', 'us']);

function validateSource(source, index) {
  const prefix = `source[${index}] (id=${JSON.stringify(source?.id)})`;
  if (!source || typeof source !== 'object') throw new Error(`${prefix}: not an object`);
  if (typeof source.id !== 'string' || !source.id.trim()) throw new Error(`${prefix}: missing or empty "id"`);
  if (typeof source.provider !== 'string' || !source.provider.trim()) throw new Error(`${prefix}: missing or empty "provider"`);
  if (typeof source.endpoint !== 'string' || !source.endpoint.trim()) throw new Error(`${prefix}: missing or empty "endpoint"`);
  if (!source.endpoint.startsWith('https://') && !source.endpoint.startsWith('http://')) {
    throw new Error(`${prefix}: "endpoint" must be an http/https URL, got ${JSON.stringify(source.endpoint)}`);
  }
  if (!VALID_KINDS.has(source.kind)) {
    throw new Error(`${prefix}: "kind" must be one of [${[...VALID_KINDS].join(', ')}], got ${JSON.stringify(source.kind)}`);
  }
  if (!VALID_LANES.has(source.lane)) {
    throw new Error(`${prefix}: "lane" must be one of [${[...VALID_LANES].join(', ')}], got ${JSON.stringify(source.lane)}`);
  }
  if (!VALID_REGIONS.has(source.region)) {
    throw new Error(`${prefix}: "region" must be one of [${[...VALID_REGIONS].join(', ')}], got ${JSON.stringify(source.region)}`);
  }
  if (typeof source.isTrustedOfficial !== 'boolean') {
    throw new Error(`${prefix}: "isTrustedOfficial" must be a boolean`);
  }
  if (typeof source.requiresKeywordMatch !== 'boolean') {
    throw new Error(`${prefix}: "requiresKeywordMatch" must be a boolean`);
  }
  if (source.quarantined != null && typeof source.quarantined !== 'boolean') {
    throw new Error(`${prefix}: "quarantined" must be a boolean when present`);
  }
  if (source.refreshEveryHours != null) {
    const cadence = Number(source.refreshEveryHours);
    if (!Number.isInteger(cadence) || cadence < 1) {
      throw new Error(`${prefix}: "refreshEveryHours" must be a positive integer when present`);
    }
  }
  if (source.refreshOffset != null) {
    const offset = Number(source.refreshOffset);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`${prefix}: "refreshOffset" must be a non-negative integer when present`);
    }
  }
}

const targets = [
  {
    label: 'sources catalog',
    relativePath: 'data/sources.json',
    validate(parsed) {
      const sources = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sources) ? parsed.sources : null;
      if (!sources) throw new Error('expected a top-level array or an object with a sources array');
      const ids = new Set();
      const fieldErrors = [];
      for (let i = 0; i < sources.length; i++) {
        try {
          validateSource(sources[i], i);
        } catch (error) {
          fieldErrors.push(error instanceof Error ? error.message : String(error));
        }
        if (sources[i]?.id) {
          if (ids.has(sources[i].id)) fieldErrors.push(`duplicate source id: ${JSON.stringify(sources[i].id)}`);
          ids.add(sources[i].id);
        }
      }
      if (fieldErrors.length) {
        throw new Error(`${fieldErrors.length} source(s) failed validation:\n  ${fieldErrors.join('\n  ')}`);
      }
    }
  },
  {
    label: 'source requests',
    relativePath: 'data/source-requests.json',
    validate(parsed) {
      const requests = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.requests) ? parsed.requests : null;
      if (!requests) {
        throw new Error('expected a top-level array or an object with a requests array');
      }
      const ids = new Set();
      const fieldErrors = [];
      for (let i = 0; i < requests.length; i++) {
        try {
          validateSource(requests[i], i);
        } catch (error) {
          fieldErrors.push(error instanceof Error ? error.message : String(error));
        }
        if (requests[i]?.id) {
          if (ids.has(requests[i].id)) fieldErrors.push(`duplicate requested source id: ${JSON.stringify(requests[i].id)}`);
          ids.add(requests[i].id);
        }
      }
      if (fieldErrors.length) {
        throw new Error(`${fieldErrors.length} requested source(s) failed validation:\n  ${fieldErrors.join('\n  ')}`);
      }
    }
  },
  {
    label: 'geo lookup',
    relativePath: 'data/geo-lookup.json',
    validate(parsed) {
      if (!Array.isArray(parsed)) {
        throw new Error('expected a top-level array');
      }
    }
  }
];

function stripBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF/, '') : text;
}

async function validateTarget(target) {
  const filePath = path.join(repoRoot, target.relativePath);
  const raw = stripBom(await fs.readFile(filePath, 'utf8'));

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${target.relativePath}: invalid JSON (${message})`);
  }

  try {
    target.validate(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${target.relativePath}: invalid structure (${message})`);
  }

  return `${target.label} OK`;
}

async function main() {
  for (const target of targets) {
    const result = await validateTarget(target);
    console.log(result);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
