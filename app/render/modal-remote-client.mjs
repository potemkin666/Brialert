const LONG_BRIEF_API_URLS = [
  'https://albertalertbackend.vercel.app/api/generate-brief'
];
const LONG_BRIEF_TIMEOUT_MS = 25_000;
const LONG_BRIEF_STREAM_IDLE_TIMEOUT_MS = 30_000;
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

function isStreamingResponse(response) {
  const contentType = String(
    (typeof response?.headers?.get === 'function'
      ? response.headers.get('content-type')
      : response?.headers?.['content-type']) || ''
  );
  return contentType.includes('text/event-stream');
}

async function readStreamedBrief(response) {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    return readNonStreamingBrief(response);
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let idleTimer = null;
  let settled = false;

  const resetIdleTimer = (reject) => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { reader.cancel(); } catch { /* ignore */ }
      reject(new Error('Stream idle timeout'));
    }, LONG_BRIEF_STREAM_IDLE_TIMEOUT_MS);
  };

  try {
    accumulated = await new Promise((resolve, reject) => {
      let text = '';
      resetIdleTimer(reject);

      (async () => {
        try {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            resetIdleTimer(reject);
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;
              if (trimmedLine.startsWith('data: ')) {
                const payload = trimmedLine.slice(6).trim();
                try {
                  const parsed = JSON.parse(payload);
                  if (parsed?.error) {
                    settled = true;
                    reject(new Error(parsed.error));
                    return;
                  }
                  if (parsed?.delta) {
                    text += parsed.delta;
                  }
                } catch {
                  text += payload;
                }
              }
            }
          }
          if (buffer.trim()) {
            const trimmedLine = buffer.trim();
            if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
              const payload = trimmedLine.slice(6).trim();
              try {
                const parsed = JSON.parse(payload);
                if (parsed?.delta) text += parsed.delta;
              } catch {
                text += payload;
              }
            }
          }
          settled = true;
          resolve(text);
        } catch (error) {
          settled = true;
          reject(error);
        }
      })();
    });
  } finally {
    settled = true;
    if (idleTimer !== null) clearTimeout(idleTimer);
  }

  return accumulated.trim();
}

async function readNonStreamingBrief(response) {
  const data = await readRemoteBriefPayload(response);
  return extractRemoteBrief(data);
}

function createAbortController() {
  if (typeof globalThis.AbortController !== 'function') return null;
  return new globalThis.AbortController();
}

async function fetchWithTimeout(apiUrl, payload) {
  const controller = createAbortController();
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      if (controller) {
        try {
          controller.abort();
        } catch {
          // ignore abort errors
        }
      }
      reject(new Error('Request timeout'));
    }, LONG_BRIEF_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify(payload)
      }),
      timeoutPromise
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestRemoteLongBrief(payloadAttempts) {
  const apiUrls = resolveLongBriefApiUrls();
  const allErrors = [];

  for (const payload of payloadAttempts) {
    let currentPayloadHasTerminalError = false;
    const payloadErrors = [];
    for (let index = 0; index < apiUrls.length; index += 1) {
      const apiUrl = apiUrls[index];
      try {
        const response = await fetchWithTimeout(apiUrl, payload);
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          error.retryable = !TERMINAL_HTTP_STATUSES.has(response.status);
          throw error;
        }
        const brief = isStreamingResponse(response)
          ? await readStreamedBrief(response)
          : await readNonStreamingBrief(response);
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
      }
    }
    if (currentPayloadHasTerminalError) {
      throw new Error(`Long brief generation failed with terminal error: ${payloadErrors.join(' | ')}`);
    }
  }

  throw new Error(`Long brief generation failed after ${apiUrls.length * payloadAttempts.length} attempts: ${allErrors.join(' | ')}`);
}
