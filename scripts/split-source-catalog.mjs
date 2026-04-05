import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sourcesPath = path.join(repoRoot, 'data', 'sources.json');
const shardsRoot = path.join(repoRoot, 'data', 'sources');
const laneOrder = ['incidents', 'context', 'sanctions', 'oversight', 'border', 'prevention'];
const regionOrder = ['london', 'uk', 'eu', 'europe', 'international', 'us'];

function stripBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF/, '') : text;
}

function normaliseRegion(value) {
  return String(value || '').trim().toLowerCase() || 'unknown';
}

function regionSortKey(region) {
  const idx = regionOrder.indexOf(region);
  return idx >= 0 ? idx : Number.MAX_SAFE_INTEGER;
}

function laneSortKey(lane) {
  const idx = laneOrder.indexOf(String(lane || '').trim().toLowerCase());
  return idx >= 0 ? idx : Number.MAX_SAFE_INTEGER;
}

function bySourceOrder(left, right) {
  const leftRegion = normaliseRegion(left?.region);
  const rightRegion = normaliseRegion(right?.region);
  if (leftRegion !== rightRegion) {
    const regionDelta = regionSortKey(leftRegion) - regionSortKey(rightRegion);
    if (regionDelta !== 0) return regionDelta;
    return leftRegion.localeCompare(rightRegion);
  }
  const laneDelta = laneSortKey(left?.lane) - laneSortKey(right?.lane);
  if (laneDelta !== 0) return laneDelta;
  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

async function main() {
  const raw = stripBom(await fs.readFile(sourcesPath, 'utf8'));
  const parsed = JSON.parse(raw);
  const sources = Array.isArray(parsed?.sources) ? parsed.sources : Array.isArray(parsed) ? parsed : null;
  if (!sources) {
    throw new Error('Expected data/sources.json to be an array or { sources: [] }');
  }

  const grouped = new Map();
  for (const source of sources) {
    const region = normaliseRegion(source?.region);
    const lane = String(source?.lane || 'unknown').trim().toLowerCase() || 'unknown';
    const key = `${region}/${lane}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(source);
  }

  await fs.rm(shardsRoot, { recursive: true, force: true });
  const keys = [...grouped.keys()].sort((left, right) => {
    const [leftRegion, leftLane] = left.split('/');
    const [rightRegion, rightLane] = right.split('/');
    const regionDelta = regionSortKey(leftRegion) - regionSortKey(rightRegion);
    if (regionDelta !== 0) return regionDelta;
    if (leftRegion !== rightRegion) return leftRegion.localeCompare(rightRegion);
    const laneDelta = laneSortKey(leftLane) - laneSortKey(rightLane);
    if (laneDelta !== 0) return laneDelta;
    return left.localeCompare(right);
  });

  for (const key of keys) {
    const [region, lane] = key.split('/');
    const targetDir = path.join(shardsRoot, region);
    await fs.mkdir(targetDir, { recursive: true });
    const shardPath = path.join(targetDir, `${lane}.json`);
    const sortedSources = [...grouped.get(key)].sort(bySourceOrder);
    await fs.writeFile(shardPath, JSON.stringify({ sources: sortedSources }, null, 2) + '\n', 'utf8');
  }

  console.log(`Wrote ${keys.length} source shard file(s) in data/sources.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
