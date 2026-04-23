import path from "node:path";
import { fileURLToPath } from "node:url";

export const PAGES_WORKFLOW_NAME = "pages build and deployment";
export const PAGES_WORKFLOW_PATH = "dynamic/pages/pages-build-deployment";

function normaliseRunId(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

export function isPagesDeploymentRun(run) {
  const name = String(run?.name ?? "")
    .trim()
    .toLowerCase();
  const workflowPath = String(run?.path ?? "")
    .trim()
    .toLowerCase();

  return name === PAGES_WORKFLOW_NAME || workflowPath === PAGES_WORKFLOW_PATH;
}

export function collectBlockingPagesRuns(runs, { excludeRunId } = {}) {
  const excludedId = normaliseRunId(excludeRunId);

  return (Array.isArray(runs) ? runs : [])
    .filter((run) => isPagesDeploymentRun(run))
    .filter((run) => normaliseRunId(run?.id) !== excludedId)
    .map((run) => ({
      id: run.id,
      status: String(run?.status ?? "").trim() || "unknown",
      headSha: String(run?.head_sha ?? "").trim(),
      createdAt: String(run?.created_at ?? "").trim(),
    }));
}

export async function fetchWorkflowRunsByStatus({
  owner,
  repo,
  token,
  status,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = process.env.GITHUB_API_URL || "https://api.github.com",
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetchImpl must be a function.");
  }
  if (!owner || !repo) {
    throw new Error("owner and repo are required.");
  }
  if (!token) {
    throw new Error("GITHUB_TOKEN is required.");
  }
  if (!status) {
    throw new Error("status is required.");
  }

  const url = new URL(
    `${apiBaseUrl.replace(/\/+$/, "")}/repos/${owner}/${repo}/actions/runs`,
  );
  url.searchParams.set("status", status);
  url.searchParams.set("per_page", "100");

  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "AlbertAlert-pages-deployment-slot-waiter",
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub Actions run lookup failed for status=${status}: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  return Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
}

export async function waitForPagesDeploymentSlot({
  owner,
  repo,
  token,
  excludeRunId,
  statuses = ["queued", "in_progress"],
  pollIntervalMs = Number.parseInt(
    process.env.ALBERTALERT_PAGES_DEPLOYMENT_WAIT_POLL_MS ?? "15000",
    10,
  ),
  timeoutMs = Number.parseInt(
    process.env.ALBERTALERT_PAGES_DEPLOYMENT_WAIT_TIMEOUT_MS ?? "600000",
    10,
  ),
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  listRunsForStatus = (status) =>
    fetchWorkflowRunsByStatus({ owner, repo, token, status }),
} = {}) {
  if (!owner || !repo) {
    throw new Error("owner and repo are required.");
  }
  if (!token) {
    throw new Error("GITHUB_TOKEN is required.");
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error(
      `pollIntervalMs must be a positive number, got: ${pollIntervalMs}`,
    );
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`timeoutMs must be a positive number, got: ${timeoutMs}`);
  }

  const deadline = now() + timeoutMs;

  while (true) {
    const runsByStatus = await Promise.all(
      statuses.map((status) => listRunsForStatus(status)),
    );
    const blockingRuns = collectBlockingPagesRuns(runsByStatus.flat(), {
      excludeRunId,
    });

    if (blockingRuns.length === 0) {
      console.log(
        "No queued or in-progress GitHub Pages deployments detected.",
      );
      return;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      const runSummary = blockingRuns
        .map((run) => `${run.id}:${run.status}:${run.headSha || "unknown-sha"}`)
        .join(", ");
      throw new Error(
        `Timed out waiting for GitHub Pages deployment slot. Blocking runs: ${runSummary}`,
      );
    }

    const runSummary = blockingRuns
      .map((run) => `${run.id}:${run.status}:${run.headSha || "unknown-sha"}`)
      .join(", ");
    console.log(
      `GitHub Pages deployment still active; waiting before push. Blocking runs: ${runSummary}`,
    );
    await sleep(Math.min(pollIntervalMs, remainingMs));
  }
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const [owner, repo] = String(process.env.GITHUB_REPOSITORY ?? "").split("/");

  waitForPagesDeploymentSlot({
    owner,
    repo,
    token: process.env.GITHUB_TOKEN,
    excludeRunId: process.env.GITHUB_RUN_ID,
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
