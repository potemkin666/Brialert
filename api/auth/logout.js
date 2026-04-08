import {
  applyCorsHeaders,
  clearAdminSessionCookie
} from '../_lib/admin-session.js';

export default async function handler(request, response) {
  applyCorsHeaders(request, response, 'POST,OPTIONS');
  if (request.method === 'OPTIONS') {
    return response.status(204).end();
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST,OPTIONS');
    return response.status(405).json({
      ok: false,
      error: 'method-not-allowed',
      message: 'Only POST is supported.'
    });
  }

  clearAdminSessionCookie(request, response);
  return response.status(200).json({ ok: true });
}
