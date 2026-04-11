import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const sourcesPath = path.join(repoRoot, 'data', 'sources.json');

function normaliseEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return raw.replace(/\/$/, '').toLowerCase();
  }
}

async function main() {
  const raw = await fs.readFile(sourcesPath, 'utf8');
  const parsed = JSON.parse(raw);
  const sources = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sources) ? parsed.sources : [];
  const byHost = new Map();
  const byEndpoint = new Map();
  const hints = [];

  for (const source of sources) {
    const endpoint = normaliseEndpoint(source?.endpoint);
    if (!endpoint) continue;
    const host = (() => {
      try {
        return new URL(endpoint).hostname.toLowerCase();
      } catch {
        return '';
      }
    })();
    if (host) {
      if (!byHost.has(host)) byHost.set(host, []);
      byHost.get(host).push(source.id);
    }
    if (!byEndpoint.has(endpoint)) byEndpoint.set(endpoint, []);
    byEndpoint.get(endpoint).push(source.id);
  }

  for (const [endpoint, ids] of byEndpoint.entries()) {
    if (ids.length > 1) {
      hints.push(`duplicate endpoint candidate: ${endpoint} (ids=${ids.join(', ')})`);
    }
  }

  for (const [host, ids] of byHost.entries()) {
    if (ids.length >= 8) {
      hints.push(`high host concentration: ${host} (${ids.length} sources)`);
    }
  }

  if (!hints.length) {
    console.log('source-catalog hints: no notable duplicate or concentration patterns detected');
    return;
  }

  console.log(`source-catalog hints (${hints.length}):`);
  for (const hint of hints.slice(0, 30)) {
    console.log(`- ${hint}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
