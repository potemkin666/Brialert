/**
 * CI pre-flight step: reads production health data from live-alerts.json
 * and patches data/sources.json to mark chronically failing sources as
 * quarantined.  The existing eligibility filter in build-live-feed.mjs
 * (`source?.quarantined`) then skips them automatically — no changes to
 * the build pipeline required.
 *
 * Usage:
 *   node scripts/ci/seed-quarantine-from-health.mjs [live-alerts.json] [sources.json]
 *
 * The script is idempotent: running it twice produces the same output.
 */

import fs from 'node:fs';
import path from 'node:path';

// ── Thresholds (mirror build-live-feed/config defaults) ──────────────
const HEALTH_SCORE_REVIEW_THRESHOLD = Number(
  process.env.ALBERTALERT_HEALTH_SCORE_REVIEW_THRESHOLD || 25
);
const AUTO_QUARANTINE_FAILURE_THRESHOLD = Number(
  process.env.ALBERTALERT_AUTO_QUARANTINE_FAILURE_THRESHOLD || 6
);

// ── Paths ────────────────────────────────────────────────────────────
const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..'
);
const alertsPath = process.argv[2] || path.join(repoRoot, 'live-alerts.json');
const sourcesPath = process.argv[3] || path.join(repoRoot, 'data', 'sources.json');

// ── Core logic (exported for testing) ────────────────────────────────

/**
 * Given a sourceHealth map (from live-alerts.json → health.sourceHealth),
 * return a Set of source IDs that should be pre-quarantined.
 */
export function deriveQuarantineIds(sourceHealth, options = {}) {
  const threshold = options.healthScoreThreshold ?? HEALTH_SCORE_REVIEW_THRESHOLD;
  const failureThreshold = options.failureThreshold ?? AUTO_QUARANTINE_FAILURE_THRESHOLD;

  const ids = new Set();
  if (!sourceHealth || typeof sourceHealth !== 'object') return ids;

  for (const [id, entry] of Object.entries(sourceHealth)) {
    if (!entry || typeof entry !== 'object') continue;

    const healthScore = Number.isFinite(Number(entry.healthScore))
      ? Number(entry.healthScore)
      : null;
    const alreadyQuarantined = Boolean(entry.quarantined);
    const consecutiveFailures = Number(entry.consecutiveFailures || 0);

    if (
      alreadyQuarantined ||
      (healthScore !== null && healthScore < threshold) ||
      consecutiveFailures >= failureThreshold
    ) {
      ids.add(id);
    }
  }

  return ids;
}

/**
 * Patch a sources array: for every source whose ID is in quarantineIds,
 * set `quarantined: true`.  Returns the patched array (does not mutate input).
 */
export function patchSources(sources, quarantineIds) {
  if (!Array.isArray(sources) || !quarantineIds?.size) return sources || [];
  return sources.map((source) => {
    if (quarantineIds.has(source?.id)) {
      return { ...source, quarantined: true };
    }
    return source;
  });
}

// ── CLI entry point ──────────────────────────────────────────────────
export async function run(alertsFile = alertsPath, sourcesFile = sourcesPath) {
  // 1. Read health data
  if (!fs.existsSync(alertsFile)) {
    console.log(`No ${path.basename(alertsFile)} found — skipping quarantine seeding.`);
    return { seeded: 0, total: 0 };
  }

  const alerts = JSON.parse(fs.readFileSync(alertsFile, 'utf8'));
  const sourceHealth = alerts?.health?.sourceHealth;

  if (!sourceHealth || typeof sourceHealth !== 'object' || Object.keys(sourceHealth).length === 0) {
    console.log('No sourceHealth data in health block — skipping quarantine seeding.');
    return { seeded: 0, total: 0 };
  }

  // 2. Read sources catalog
  if (!fs.existsSync(sourcesFile)) {
    console.log(`No ${path.basename(sourcesFile)} found — skipping quarantine seeding.`);
    return { seeded: 0, total: 0 };
  }

  const catalog = JSON.parse(fs.readFileSync(sourcesFile, 'utf8'));
  const sources = catalog?.sources;
  if (!Array.isArray(sources)) {
    console.log('sources.json has no sources array — skipping quarantine seeding.');
    return { seeded: 0, total: 0 };
  }

  // 3. Derive quarantine set and patch
  const quarantineIds = deriveQuarantineIds(sourceHealth);
  const patched = patchSources(sources, quarantineIds);
  const seeded = patched.filter((s) => s.quarantined).length;

  // 4. Write back
  const updatedCatalog = { ...catalog, sources: patched };
  fs.writeFileSync(sourcesFile, JSON.stringify(updatedCatalog, null, 2) + '\n', 'utf8');

  console.log(`Pre-quarantined ${seeded} source(s) based on production health data (of ${sources.length} total).`);
  return { seeded, total: sources.length };
}

// Run when invoked directly (not imported for testing).
import { fileURLToPath } from 'node:url';
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
