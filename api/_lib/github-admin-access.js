import { ApiError } from './github-persistence.js';

const GITHUB_API_BASE = 'https://api.github.com';

function parseAllowList(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

function parseTeamAllowList(value) {
  const teams = [];
  for (const entry of String(value || '').split(',')) {
    const trimmed = entry.trim().toLowerCase();
    if (!trimmed) continue;
    const [org, slug] = trimmed.split('/');
    if (!org || !slug) continue;
    teams.push({ org, slug });
  }
  return teams;
}

function getAccessConfig() {
  const allowedUsers = parseAllowList(process.env.ALBERTALERT_ADMIN_ALLOWED_USERS);
  const allowedOrgs = parseAllowList(process.env.ALBERTALERT_ADMIN_ALLOWED_ORGS);
  const allowedTeams = parseTeamAllowList(process.env.ALBERTALERT_ADMIN_ALLOWED_TEAMS);
  if (!allowedUsers.size && !allowedOrgs.size && !allowedTeams.length) {
    throw new ApiError(
      'misconfigured-backend',
      'Configure at least one of ALBERTALERT_ADMIN_ALLOWED_USERS/ORGS/TEAMS.',
      503
    );
  }
  return { allowedUsers, allowedOrgs, allowedTeams };
}

export function getOAuthClientConfig() {
  const clientId = String(process.env.GITHUB_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GITHUB_OAUTH_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new ApiError(
      'misconfigured-backend',
      'Backend is missing GITHUB_OAUTH_CLIENT_ID/GITHUB_OAUTH_CLIENT_SECRET configuration.',
      503
    );
  }
  return { clientId, clientSecret };
}

async function githubApi(accessToken, endpoint) {
  const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (response.status === 401) {
    throw new ApiError('unauthorized', 'GitHub OAuth token is not valid.', 401);
  }
  return response;
}

export async function exchangeOAuthCode(code, redirectUri) {
  const { clientId, clientSecret } = getOAuthClientConfig();
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    })
  });
  const payload = await response.json().catch(() => ({}));
  const token = String(payload?.access_token || '').trim();
  if (!response.ok || !token) {
    throw new ApiError('oauth-exchange-failed', payload?.error_description || 'GitHub OAuth exchange failed.', 401);
  }
  return token;
}

export async function fetchGithubUser(accessToken) {
  const response = await githubApi(accessToken, '/user');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError('oauth-user-fetch-failed', payload?.message || 'Failed to read GitHub user profile.', 401);
  }
  const login = String(payload?.login || '').trim().toLowerCase();
  if (!login) {
    throw new ApiError('oauth-user-fetch-failed', 'GitHub profile response did not include a login.', 401);
  }
  return {
    login,
    name: String(payload?.name || payload?.login || '').trim(),
    avatarUrl: String(payload?.avatar_url || '').trim()
  };
}

async function userOrgSet(accessToken) {
  const response = await githubApi(accessToken, '/user/orgs?per_page=100');
  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    throw new ApiError('oauth-org-check-failed', 'Failed to check GitHub organization membership.', 401);
  }
  return new Set(
    (Array.isArray(payload) ? payload : [])
      .map((entry) => String(entry?.login || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

async function isTeamMember(accessToken, login, team) {
  const path = `/orgs/${encodeURIComponent(team.org)}/teams/${encodeURIComponent(team.slug)}/memberships/${encodeURIComponent(login)}`;
  const response = await githubApi(accessToken, path);
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new ApiError('oauth-team-check-failed', `Failed to check GitHub team membership for ${team.org}/${team.slug}.`, 401);
  }
  const payload = await response.json().catch(() => ({}));
  return String(payload?.state || '').toLowerCase() === 'active';
}

export async function ensureGithubAdminAllowed(accessToken, userLogin) {
  const config = getAccessConfig();
  if (config.allowedUsers.has(userLogin)) return true;

  if (config.allowedOrgs.size) {
    const orgs = await userOrgSet(accessToken);
    for (const org of config.allowedOrgs) {
      if (orgs.has(org)) return true;
    }
  }

  if (config.allowedTeams.length) {
    for (const team of config.allowedTeams) {
      // eslint-disable-next-line no-await-in-loop
      if (await isTeamMember(accessToken, userLogin, team)) return true;
    }
  }

  throw new ApiError('forbidden', 'GitHub account is not authorized for quarantine admin access.', 403);
}
