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
  version: '2'
};

const LONG_BRIEF_INSTRUCTIONS = [
  'You are writing a long factual brief about a terrorism-related news story for an analyst dashboard.',
  'IMPORTANT: Before writing the brief, use your web search / browsing tools to research this story on the internet.',
  'Search for the headline, the source name, and any key details from the source extract to find the latest reporting, official statements, and corroborating coverage from other outlets.',
  'Cross-reference multiple sources to ensure accuracy, and include any new facts, context, or developments that the original source extract may have missed.',
  'The brief should be detailed, factual, and analyst-ready — covering what happened, where, when, who is involved, the current status, and why it matters from a counter-terrorism or public-safety perspective.',
  'Do not fabricate details. If web research does not surface additional information, say so and write the brief from the provided source extract and metadata only.'
].join(' ');

export function mapAlertToLongBriefPayload(alert, maxSourceExtractChars) {
  const sourceExtract = alert.sourceExtract ?? alert.extract ?? alert.summary ?? '';
  const trimmedSourceExtract = cleanTextBlock(truncateAtWordBoundary(sourceExtract, maxSourceExtractChars));
  return {
    prompt: LONG_BRIEF_PROMPT,
    instructions: LONG_BRIEF_INSTRUCTIONS,
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
