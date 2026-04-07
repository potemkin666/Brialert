const GITHUB_API_BASE = 'https://api.github.com';
const COMMIT_ATTEMPT_LIMIT = 3;
const COMMIT_RETRY_BASE_DELAY_MS = 120;

export class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function parseJsonResponse(response, fallbackMessage) {
  return response.json().catch(() => ({
    message: fallbackMessage
  }));
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

async function githubRequest(config, endpoint, init = {}) {
  const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const payload = await parseJsonResponse(response, 'GitHub API request failed.');
    if (response.status === 401 || response.status === 403) {
      throw new ApiError('unauthorized', payload.message || 'GitHub API authentication failed.', 503);
    }
    throw new ApiError('persistence-failure', payload.message || 'GitHub API request failed.', 500);
  }
  return response;
}

function decodeBase64(base64Value) {
  return Buffer.from(base64Value || '', 'base64').toString('utf8');
}

function encodeBase64(plainText) {
  return Buffer.from(plainText, 'utf8').toString('base64');
}

function parseJsonFile(raw, filePath) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ApiError(
      'persistence-failure',
      `Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      500
    );
  }
}

export function validateAbsoluteHttpUrl(value, code = 'invalid-url') {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new ApiError(code, 'Replacement URL is required.', 400);
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ApiError(code, 'Replacement URL must be a valid absolute URL.', 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError(code, 'Replacement URL must use http or https.', 400);
  }
  return parsed.toString();
}

export function normaliseEndpoint(endpoint) {
  const raw = String(endpoint || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return raw.replace(/\/$/, '').toLowerCase();
  }
}

export async function loadJsonFile(pathName) {
  const config = getRepoConfig();
  const encodedPath = pathName.split('/').map(encodeURIComponent).join('/');
  const response = await githubRequest(
    config,
    `/repos/${config.owner}/${config.repo}/contents/${encodedPath}?ref=${encodeURIComponent(config.branch)}`
  );
  const payload = await response.json();
  const content = decodeBase64(payload.content);
  return {
    config,
    path: pathName,
    sha: payload.sha,
    data: parseJsonFile(content, pathName)
  };
}

async function getBranchHead(config) {
  const response = await githubRequest(
    config,
    `/repos/${config.owner}/${config.repo}/git/ref/heads/${encodeURIComponent(config.branch)}`
  );
  const payload = await response.json();
  return payload.object.sha;
}

async function getCommit(config, commitSha) {
  const response = await githubRequest(
    config,
    `/repos/${config.owner}/${config.repo}/git/commits/${encodeURIComponent(commitSha)}`
  );
  return response.json();
}

async function createBlob(config, content) {
  const response = await githubRequest(
    config,
    `/repos/${config.owner}/${config.repo}/git/blobs`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: encodeBase64(content),
        encoding: 'base64'
      })
    }
  );
  const payload = await response.json();
  return payload.sha;
}

async function createTree(config, baseTreeSha, treeEntries) {
  const response = await githubRequest(
    config,
    `/repos/${config.owner}/${config.repo}/git/trees`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeEntries
      })
    }
  );
  const payload = await response.json();
  return payload.sha;
}

async function createCommit(config, message, treeSha, parentSha) {
  const response = await githubRequest(
    config,
    `/repos/${config.owner}/${config.repo}/git/commits`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        tree: treeSha,
        parents: [parentSha]
      })
    }
  );
  const payload = await response.json();
  return payload.sha;
}

async function updateBranchRef(config, commitSha) {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${config.owner}/${config.repo}/git/refs/heads/${encodeURIComponent(config.branch)}`,
    {
      method: 'PATCH',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sha: commitSha,
        force: false
      })
    }
  );
  if (!response.ok) {
    const payload = await parseJsonResponse(response, 'Failed to update branch reference.');
    if (response.status === 422) return false;
    if (response.status === 401 || response.status === 403) {
      throw new ApiError('unauthorized', payload.message || 'GitHub API authentication failed.', 503);
    }
    throw new ApiError('persistence-failure', payload.message || 'Failed to update branch reference.', 500);
  }
  return true;
}

export async function listSourceShardPaths(config) {
  const headSha = await getBranchHead(config);
  const headCommit = await getCommit(config, headSha);
  const treeSha = headCommit?.tree?.sha;
  if (!treeSha) {
    throw new ApiError('persistence-failure', 'Failed to resolve repository tree for source shards.', 500);
  }
  const response = await githubRequest(
    config,
    `/repos/${config.owner}/${config.repo}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`
  );
  const payload = await response.json();
  const entries = Array.isArray(payload?.tree) ? payload.tree : [];
  return entries
    .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('data/sources/') && entryPath.endsWith('.json'));
}

export async function commitJsonFilesAtomically(config, updatesByPath, message) {
  for (let attempt = 0; attempt < COMMIT_ATTEMPT_LIMIT; attempt++) {
    if (attempt > 0) {
      await wait(COMMIT_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
    }
    const headSha = await getBranchHead(config);
    const headCommit = await getCommit(config, headSha);
    const baseTreeSha = headCommit?.tree?.sha;
    if (!baseTreeSha) {
      throw new ApiError('persistence-failure', 'Failed to resolve base tree for persistence update.', 500);
    }

    const treeEntries = [];
    for (const [pathName, value] of Object.entries(updatesByPath)) {
      const blobSha = await createBlob(config, JSON.stringify(value, null, 2) + '\n');
      treeEntries.push({
        path: pathName,
        mode: '100644',
        type: 'blob',
        sha: blobSha
      });
    }

    const treeSha = await createTree(config, baseTreeSha, treeEntries);
    const commitSha = await createCommit(config, message, treeSha, headSha);
    const updated = await updateBranchRef(config, commitSha);
    if (updated) return commitSha;
  }
  throw new ApiError(
    'persistence-failure',
    'Failed to persist restore update due to concurrent repository updates. Please retry.',
    409
  );
}
