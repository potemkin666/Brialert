import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  responderCardMarkup,
  supportingCardMarkup,
} from "../app/components/cards.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const snapshotsRoot = path.join(__dirname, "__snapshots__");
const shouldUpdateSnapshots =
  String(process.env.BRIALERT_UPDATE_SNAPSHOTS || "").toLowerCase() === "true";

function makeAlert(overrides = {}) {
  return {
    id: "snapshot-alert-1",
    title: "US and French officials investigate Brussels incident",
    summary:
      "The United States and France coordinated after security alerts in Belgium.",
    sourceExtract:
      "Officials in the us confirmed additional screening in Belgium.",
    location: "Brussels",
    source: "Reuters",
    severity: "high",
    status: "Threat update",
    corroborationCount: 2,
    confidenceScore: 0.88,
    queueReason: "Trigger-tier terrorism incident candidate",
    lane: "incidents",
    region: "europe",
    time: "31 Mar 2026, 11:30",
    ...overrides,
  };
}

function assertSnapshot(snapshotRelativePath, actual) {
  const snapshotPath = path.join(snapshotsRoot, snapshotRelativePath);
  const normalisedActual = `${String(actual || "").trim()}\n`;
  if (shouldUpdateSnapshots || !fs.existsSync(snapshotPath)) {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, normalisedActual, "utf8");
  }
  const expected = fs.readFileSync(snapshotPath, "utf8");
  assert.equal(normalisedActual, expected);
}

test("responderCardMarkup snapshot", () => {
  const markup = responderCardMarkup(makeAlert(), true);
  assertSnapshot("cards/responder-card.html", markup);
});

test("supportingCardMarkup snapshot", () => {
  const markup = supportingCardMarkup(
    makeAlert({
      id: "snapshot-alert-2",
      lane: "context",
      status: "Update",
      time: "31 Mar 2026, 12:45",
      needsHumanReview: false,
    }),
  );
  assertSnapshot("cards/supporting-card.html", markup);
});
