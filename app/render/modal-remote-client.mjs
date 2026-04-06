const LONG_BRIEF_API_URLS = [
  'https://brialertbackend.vercel.app/api/generate-brief'
];
const LONG_BRIEF_TIMEOUT_MS = 25_000;
const TERMINAL_HTTP_STATUSES = new Set([400, 401, 403, 404, 405, 410, 501]);

function resolveLongBriefApiUrls() {
  return [...LONG_BRIEF_API_URLS];
}

function extractRemoteBrief(responseData) {
  if (typeof responseData === 'string') return responseData.trim();

  const directBrief = String(
    responseData?.brief
    ?? responseData?.longBrief
    ?? responseData?.text
    ?? responseData?.output_text
    ?? responseData?.content
    ?? responseData?.output?.[0]?.content?.[0]?.text
    ?? responseData?.response?.output_text
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

async function readRemoteBriefPayload(response) {
  if (typeof response?.text === 'function') {
    const responseText = await response.text();
    if (!responseText) return '';
    try {
      return JSON.parse(responseText);
    } catch {
      return responseText;
    }
  }
  if (typeof response?.json === 'function') {
    return response.json();
  }
  return '';
}

export async function requestRemoteLongBrief(payloadAttempts) {
  const apiUrls = resolveLongBriefApiUrls();
  const allErrors = [];

  for (const payload of payloadAttempts) {
    let currentPayloadHasTerminalError = false;
    const payloadErrors = [];
    for (let index = 0; index < apiUrls.length; index += 1) {
      const apiUrl = apiUrls[index];
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
        const brief = extractRemoteBrief(await readRemoteBriefPayload(response));
        if (!brief) throw new Error('Invalid brief response');
        return brief;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const formattedError = `${apiUrl}: ${detail}`;
        payloadErrors.push(formattedError);
        allErrors.push(formattedError);
        if (error?.retryable === false) {
          currentPayloadHasTerminalError = true;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    if (currentPayloadHasTerminalError) {
      throw new Error(`Long brief generation failed with terminal error: ${payloadErrors.join(' | ')}`);
    }
  }

  throw new Error(`Long brief generation failed after ${apiUrls.length * payloadAttempts.length} attempts: ${allErrors.join(' | ')}`);
}
