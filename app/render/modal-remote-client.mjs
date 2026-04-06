const LONG_BRIEF_API_URLS = [
  '/api/generate-brief'
];
const LONG_BRIEF_TIMEOUT_MS = 25_000;
const TERMINAL_HTTP_STATUSES = new Set([400, 401, 403, 404, 405, 410, 501]);

function resolveLongBriefApiUrls() {
  return [...LONG_BRIEF_API_URLS];
}

function extractRemoteBrief(responseData) {
  const directBrief = String(
    responseData?.brief
    ?? responseData?.longBrief
    ?? responseData?.text
    ?? responseData?.output_text
    ?? responseData?.content
    ?? responseData?.data?.brief
    ?? ''
  ).trim();
  if (directBrief) return directBrief;

  return String(
    responseData?.choices?.[0]?.message?.content
    ?? responseData?.choices?.[0]?.text
    ?? ''
  ).trim();
}

export async function requestRemoteLongBrief(payloadAttempts) {
  const apiUrls = resolveLongBriefApiUrls();
  const errors = [];

  for (const payload of payloadAttempts) {
    for (const apiUrl of apiUrls) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LONG_BRIEF_TIMEOUT_MS);
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          error.retryable = !TERMINAL_HTTP_STATUSES.has(response.status);
          throw error;
        }
        const brief = extractRemoteBrief(await response.json());
        if (!brief) throw new Error('Invalid brief response');
        return brief;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        errors.push(`${apiUrl}: ${detail}`);
        if (error?.retryable === false) {
          throw new Error(`Long brief generation failed with terminal error: ${errors.join(' | ')}`);
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  throw new Error(`Long brief generation failed after ${apiUrls.length * payloadAttempts.length} attempts: ${errors.join(' | ')}`);
}
