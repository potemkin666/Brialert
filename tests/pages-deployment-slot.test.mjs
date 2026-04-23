import test from "node:test";
import assert from "node:assert/strict";

import {
  collectBlockingPagesRuns,
  isPagesDeploymentRun,
  waitForPagesDeploymentSlot,
} from "../scripts/ci/wait-for-pages-deployment-slot.mjs";

test("isPagesDeploymentRun recognises the GitHub-managed Pages workflow", () => {
  assert.equal(
    isPagesDeploymentRun({
      name: "pages build and deployment",
      path: "dynamic/pages/pages-build-deployment",
    }),
    true,
  );

  assert.equal(
    isPagesDeploymentRun({
      name: "Feed validation",
      path: ".github/workflows/ci-feed-validation.yml",
    }),
    false,
  );
});

test("collectBlockingPagesRuns keeps only GitHub Pages runs and honours excludeRunId", () => {
  const blockingRuns = collectBlockingPagesRuns(
    [
      {
        id: 101,
        name: "pages build and deployment",
        path: "dynamic/pages/pages-build-deployment",
        status: "in_progress",
        head_sha: "abc123",
      },
      {
        id: 102,
        name: "Feed validation",
        path: ".github/workflows/ci-feed-validation.yml",
        status: "in_progress",
        head_sha: "def456",
      },
      {
        id: 103,
        name: "pages build and deployment",
        path: "dynamic/pages/pages-build-deployment",
        status: "queued",
        head_sha: "ghi789",
      },
    ],
    { excludeRunId: 103 },
  );

  assert.deepEqual(blockingRuns, [
    {
      id: 101,
      status: "in_progress",
      headSha: "abc123",
      createdAt: "",
    },
  ]);
});

test("waitForPagesDeploymentSlot polls until no blocking Pages deployments remain", async () => {
  let attempt = 0;
  let fakeNow = 0;
  const sleepCalls = [];

  await waitForPagesDeploymentSlot({
    owner: "potemkin666",
    repo: "AlbertAlert",
    token: "test-token",
    pollIntervalMs: 50,
    timeoutMs: 250,
    now: () => fakeNow,
    sleep: async (ms) => {
      sleepCalls.push(ms);
      fakeNow += ms;
    },
    listRunsForStatus: async (status) => {
      attempt += 1;
      if (attempt <= 2 && status === "in_progress") {
        return [
          {
            id: 555,
            name: "pages build and deployment",
            path: "dynamic/pages/pages-build-deployment",
            status: "in_progress",
            head_sha: "abc123",
          },
        ];
      }

      return [];
    },
  });

  assert.equal(attempt, 4);
  assert.deepEqual(sleepCalls, [50]);
});

test("waitForPagesDeploymentSlot times out when Pages deployments stay active", async () => {
  let fakeNow = 0;

  await assert.rejects(
    waitForPagesDeploymentSlot({
      owner: "potemkin666",
      repo: "AlbertAlert",
      token: "test-token",
      pollIntervalMs: 50,
      timeoutMs: 50,
      now: () => fakeNow,
      sleep: async (ms) => {
        fakeNow += ms;
      },
      listRunsForStatus: async () => [
        {
          id: 777,
          name: "pages build and deployment",
          path: "dynamic/pages/pages-build-deployment",
          status: "queued",
          head_sha: "deadbeef",
        },
      ],
    }),
    /Timed out waiting for GitHub Pages deployment slot/,
  );
});
