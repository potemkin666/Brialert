#!/usr/bin/env node
/**
 * scripts/merge-quarantined-sources.mjs
 *
 * 3-way JSON merge for data/quarantined-sources.json during CI conflict resolution.
 *
 * During the update-live-feed workflow, the build job generates updated quarantine
 * data.  If an admin restores a source on main while the workflow is running, there
 * can be a merge conflict on quarantined-sources.json.
 *
 * This script performs a source-level 3-way merge:
 *   - Admin removals (restored sources) are honoured
 *   - Admin edits to existing sources are preserved
 *   - Admin-added sources are included
 *   - Workflow-only changes (new quarantines, health updates) are kept for
 *     sources not touched by admin
 *
 * Usage: node scripts/merge-quarantined-sources.mjs
 * (Run while a git merge conflict is active.)
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const FILE = 'data/quarantined-sources.json';

/**
 * Read a JSON file from a git index stage.
 * Stages: 1 = common ancestor, 2 = ours, 3 = theirs.
 * Returns null if the stage does not exist.
 */
function readStage(stage) {
  try {
    const raw = execSync(`git show :${stage}:${FILE}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Build a Map of source ID → source object from a quarantine payload.
 */
function sourceMap(payload) {
  const map = new Map();
  if (Array.isArray(payload?.sources)) {
    for (const s of payload.sources) {
      if (s?.id) map.set(s.id, s);
    }
  }
  return map;
}

// Exported for testing.
export { sourceMap };

/**
 * Perform a 3-way merge of quarantined-sources payloads.
 *
 * @param {object|null} base   - common ancestor payload
 * @param {object}      ours   - workflow-generated payload
 * @param {object}      theirs - main branch payload (may contain admin changes)
 * @returns {{ result: object, stats: { adminRemoved: number, adminChanged: number, adminAdded: number } }}
 */
export function mergePayloads(base, ours, theirs) {
  const baseMap = sourceMap(base);
  const oursMap = sourceMap(ours);
  const theirsMap = sourceMap(theirs);

  // ── Detect admin changes (theirs vs base) ──
  const adminRemoved = new Set();
  const adminChanged = new Map();
  const adminAdded = new Map();

  for (const id of baseMap.keys()) {
    if (!theirsMap.has(id)) adminRemoved.add(id);
  }

  for (const [id, source] of theirsMap) {
    if (!baseMap.has(id)) {
      adminAdded.set(id, source);
    } else if (JSON.stringify(source) !== JSON.stringify(baseMap.get(id))) {
      adminChanged.set(id, source);
    }
  }

  // ── Build merged sources ──
  const merged = new Map();

  // Start with ours (workflow output).
  for (const [id, source] of oursMap) {
    if (adminRemoved.has(id)) continue;        // admin restored → honour removal
    if (adminChanged.has(id)) {
      merged.set(id, adminChanged.get(id));     // admin edited → prefer admin
    } else {
      merged.set(id, source);                   // workflow update → keep
    }
  }

  // Add admin-added sources not already present.
  for (const [id, source] of adminAdded) {
    if (!merged.has(id)) merged.set(id, source);
  }

  // ── Assemble output ──
  const result = {
    generatedAt: ours.generatedAt || theirs.generatedAt,
    count: merged.size,
    sources: [...merged.values()]
  };

  if (ours.schemaVersion != null) result.schemaVersion = ours.schemaVersion;
  if (ours.metrics) result.metrics = ours.metrics;

  return {
    result,
    stats: {
      adminRemoved: adminRemoved.size,
      adminChanged: adminChanged.size,
      adminAdded: adminAdded.size
    }
  };
}

// ── CLI entry point (skip when imported for tests) ──
const isDirectRun = process.argv[1]?.endsWith('merge-quarantined-sources.mjs');

if (isDirectRun) {
  // Check whether quarantined-sources.json is actually in conflict.
  const unmerged = execSync(`git ls-files -u -- "${FILE}"`, { encoding: 'utf8' }).trim();
  if (!unmerged) {
    console.log(`${FILE}: no conflict — skipping 3-way JSON merge.`);
    process.exit(0);
  }

  const base = readStage(1);
  const ours = readStage(2);
  const theirs = readStage(3);

  if (!ours && !theirs) {
    console.error(`${FILE}: both ours and theirs are missing; cannot merge.`);
    process.exit(1);
  }

  // If one side is missing entirely, take the other.
  if (!ours) {
    writeFileSync(FILE, JSON.stringify(theirs, null, 2) + '\n');
    console.log(`${FILE}: ours missing — using theirs.`);
    process.exit(0);
  }
  if (!theirs) {
    writeFileSync(FILE, JSON.stringify(ours, null, 2) + '\n');
    console.log(`${FILE}: theirs missing — using ours.`);
    process.exit(0);
  }

  const { result, stats } = mergePayloads(base, ours, theirs);
  writeFileSync(FILE, JSON.stringify(result, null, 2) + '\n');
  console.log(
    `${FILE}: 3-way merge complete — ` +
    `${result.count} sources ` +
    `(admin removed: ${stats.adminRemoved}, admin changed: ${stats.adminChanged}, admin added: ${stats.adminAdded}).`
  );
}
