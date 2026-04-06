import { reportBackgroundError } from '../../shared/logger.mjs';

const LONG_BRIEF_API_URLS = [
  'https://brialertbackend.vercel.app/api/generate-brief'
];
const LONG_BRIEF_TIMEOUT_MS = 25_000;

function isSafeAbsoluteHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (!/^https?:$/.test(parsed.protocol)) return false;
    return Boolean(parsed.hostname);
  } catch (error) {
    reportBackgroundError('modal', 'isSafeAbsoluteHttpUrl failed to parse candidate URL', error, {
      operation: 'isSafeAbsoluteHttpUrl',
      value: String(value || '')
    });
    return false;
  }
}

function resolveLongBriefApiUrls() {
  const runtimeUrls = Array.isArray(globalThis?.BRIALERT_LONG_BRIEF_API_URLS)
    ? globalThis.BRIALERT_LONG_BRIEF_API_URLS
    : [];
  const runtimeUrl = String(globalThis?.BRIALERT_LONG_BRIEF_API_URL || '').trim();
  const allCandidates = [
    ...runtimeUrls.map((value) => String(value || '').trim()).filter(Boolean),
    runtimeUrl,
    ...LONG_BRIEF_API_URLS
  ].filter(Boolean);
  return [...new Set(allCandidates.filter(isSafeAbsoluteHttpUrl))];
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
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const brief = extractRemoteBrief(await response.json());
        if (!brief) throw new Error('Invalid brief response');
        return brief;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        errors.push(`${apiUrl}: ${detail}`);
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  throw new Error(`Long brief generation failed after ${apiUrls.length * payloadAttempts.length} attempts: ${errors.join(' | ')}`);
}
