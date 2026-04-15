import { ApiError } from './_lib/github-persistence.js';
import { applyCorsHeaders } from './_lib/admin-session.js';

const GITHUB_API_BASE = 'https://api.github.com';
const WORKFLOW_FILENAME = 'update-live-feed.yml';
const MIN_TRIGGER_INTERVAL_MS = 60_000;

let lastTriggerTime = 0;

function getRepoConfig() {
  const token = process.env.GITHUB_TOKEN || '';
  const owner = process.env.GITHUB_OWNER || process.env.VERCEL_GIT_REPO_OWNER || '';
  const repo = process.env.GITHUB_REPO || process.env.VERCEL_GIT_REPO_SLUG || '';
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !owner || !repo) {
    throw new ApiError(
      'misconfigured-backend',
      'Backend is missing GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO configuration.',
      503
    );
  }
  return { token, owner, repo, branch };
}

function sendError(response, error) {
  const status = error instanceof ApiError ? error.status : 500;
  const code = error instanceof ApiError ? error.code : 'trigger-failed';
  const message = error instanceof Error ? error.message : String(error);
  response.status(status).json({
    ok: false,
    error: code,
    detail: message
  });
}

export default async function handler(request, response) {
  if (!applyCorsHeaders(request, response, 'POST,OPTIONS')) {
    return response.status(403).json({ ok: false, error: 'origin-not-allowed', detail: 'Cross-origin request from disallowed origin.' });
  }
  if (request.method === 'OPTIONS') {
    response.setHeader('Allow', 'POST,OPTIONS');
    return response.status(204).end();
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST,OPTIONS');
    return response.status(405).json({
      ok: false,
      error: 'method-not-allowed',
      detail: 'Only POST is supported.'
    });
  }

  try {
    const now = Date.now();
    if (now - lastTriggerTime < MIN_TRIGGER_INTERVAL_MS) {
      const waitSeconds = Math.ceil((MIN_TRIGGER_INTERVAL_MS - (now - lastTriggerTime)) / 1000);
      return response.status(429).json({
        ok: false,
        error: 'rate-limited',
        detail: `Workflow was recently triggered. Please wait ${waitSeconds} seconds before trying again.`,
        retryAfterSeconds: waitSeconds
      });
    }

    // Claim the slot before the async dispatch so concurrent requests see
    // the lock immediately (avoids check-then-act race).
    const previousTriggerTime = lastTriggerTime;
    lastTriggerTime = now;

    const config = getRepoConfig();

    const dispatchUrl = `${GITHUB_API_BASE}/repos/${config.owner}/${config.repo}/actions/workflows/${WORKFLOW_FILENAME}/dispatches`;

    const dispatchResponse = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: config.branch,
        inputs: {}
      })
    });

    if (!dispatchResponse.ok) {
      // Roll back so the next request can retry after a real failure.
      lastTriggerTime = previousTriggerTime;
      let errorMessage = 'Failed to trigger workflow dispatch.';

      if (dispatchResponse.status === 401 || dispatchResponse.status === 403) {
        throw new ApiError('unauthorized', 'GitHub API authentication failed.', 503);
      }
      if (dispatchResponse.status === 404) {
        throw new ApiError('workflow-not-found', 'Workflow not found.', 404);
      }
      throw new ApiError('trigger-failed', errorMessage, 500);
    }

    return response.status(200).json({
      ok: true,
      detail: 'Live feed workflow triggered successfully. New feed data should appear within 2-5 minutes.',
      triggeredAt: new Date().toISOString(),
      workflow: WORKFLOW_FILENAME,
      branch: config.branch
    });
  } catch (error) {
    return sendError(response, error);
  }
}
