import { cleanTextBlock } from '../utils/text.mjs';

const WORD_BOUNDARY_MIN_RATIO = 0.7;

function truncateAtWordBoundary(value, maxChars) {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  const candidate = text.slice(0, maxChars);
  const boundary = candidate.lastIndexOf(' ');
  if (boundary > Math.floor(maxChars * WORD_BOUNDARY_MIN_RATIO)) {
    return candidate.slice(0, boundary).trim();
  }
  return text.slice(0, maxChars).trim();
}

const LONG_BRIEF_PROMPT = {
  id: 'pmpt_69e13dfd0ce48195866d2bf5a9c58ea9084af6b6d247fa7c',
  version: '1'
};

export function mapAlertToLongBriefPayload(alert, maxSourceExtractChars) {
  const sourceExtract = alert.sourceExtract ?? alert.extract ?? alert.summary ?? '';
  const trimmedSourceExtract = cleanTextBlock(truncateAtWordBoundary(sourceExtract, maxSourceExtractChars));
  return {
    prompt: LONG_BRIEF_PROMPT,
    sourceName: String(alert.sourceName ?? alert.source ?? ''),
    headline: String(alert.headline ?? alert.title ?? ''),
    sourceExtract: trimmedSourceExtract,
    originalUrl: String(alert.originalUrl ?? alert.url ?? alert.sourceUrl ?? ''),
    timestamp: String(alert.timestamp ?? alert.publishedAt ?? alert.time ?? ''),
    geography: String(alert.geography ?? alert.location ?? ''),
    lane: String(alert.lane ?? alert.track ?? ''),
    confidenceLabel: String(alert.confidenceLabel ?? alert.confidence ?? ''),
    corroborationStatus: String(alert.corroborationStatus ?? ''),
    recencyText: String(alert.recencyText ?? '')
  };
}
