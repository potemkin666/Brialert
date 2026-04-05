import {
  buildAuditBlock,
  buildBriefing,
  effectiveSummary,
  formatAgeFrom,
  renderCorroboratingSources,
  renderSceneClock,
  severityLabel
} from '../../shared/alert-view-model.mjs';
import { createModalController } from '../../shared/modal-briefing.mjs';
import { cleanTextBlock, splitLongBriefSentences } from '../utils/text.mjs';

const LONG_BRIEF_API_URLS = [
  'https://brialertbackend.vercel.app/api/generate-brief',
  'https://brialertbackend.vercel.app/api/generateBrief'
];
const LONG_BRIEF_TIMEOUT_MS = 25_000;
const LONG_BRIEF_MAX_SOURCE_EXTRACT_CHARS = 8_000;
const LONG_BRIEF_FALLBACK_SOURCE_EXTRACT_CHARS = 3_500;
// Require a boundary near the end so truncation does not collapse into an overly short fragment.
const WORD_BOUNDARY_MIN_RATIO = 0.7;

function buildLocalLongBrief(alert) {
  const summary = cleanTextBlock(effectiveSummary(alert));
  const sourceSentences = splitLongBriefSentences(alert.sourceExtract || alert.summary || '');
  const chosenSentences = sourceSentences.filter((sentence) => sentence.length > 35).slice(0, 10);
  const corroborating = Array.isArray(alert.corroboratingSources) ? alert.corroboratingSources : [];
  const people = Array.isArray(alert.peopleInvolved) ? alert.peopleInvolved.filter(Boolean).slice(0, 6) : [];
  const bits = [
    `${alert.source} reported this ${alert.lane} item under the headline "${alert.title}"${alert.location ? `, linked to ${alert.location}` : ''}${alert.time ? `, with the item timestamped ${alert.time}` : ''}. ${summary || 'The captured feed text provides only a thin summary, so the long brief below is built from the extracted source material and the alert metadata.'}`,
    chosenSentences.length
      ? `The source extract gives the following substantive detail: ${chosenSentences.join(' ')}`
      : 'The captured source extract is limited, so this long brief is relying more heavily on the alert metadata, queue classification, and source context than on a rich article body.',
    alert.eventType
      ? `The item is currently classified in the app as ${String(alert.eventType).replace(/_/g, ' ')}, with the alert sitting in the ${alert.lane} lane and carrying a confidence label of ${alert.confidence}.`
      : `The item currently sits in the ${alert.lane} lane with a confidence label of ${alert.confidence}.`,
    people.length ? `Named people or entities carried through the alert payload include: ${people.join('; ')}.` : '',
    corroborating.length
      ? `There ${corroborating.length === 1 ? 'is' : 'are'} ${corroborating.length} corroborating source${corroborating.length === 1 ? '' : 's'} attached to this fused incident, which should help separate the core facts from outlet-specific wording or emphasis.`
      : 'No corroborating source has been attached to this item yet, so the picture still depends heavily on the primary source currently shown in the incident detail.',
    alert.publishedAt ? `From a recency point of view, the app is treating the item as published ${formatAgeFrom(alert.publishedAt)}, which matters for judging whether this is a live operational development, a disrupted plot, or a later-stage prosecution or context update.` : '',
    `Original source link: ${alert.sourceUrl || 'Unavailable'}.`
  ].filter(Boolean);

  return [
    'LONG FACTUAL BRIEF',
    '',
    ...bits.map((paragraph) => paragraph.trim()),
    '',
    'NOTE',
    'This long brief was generated from the captured source text and alert metadata available in this alert.'
  ].join('\n\n');
}

async function generateRemoteLongBrief(alert) {
  const apiUrls = resolveLongBriefApiUrls();
  const primaryPayload = mapAlertToLongBriefPayload(alert, LONG_BRIEF_MAX_SOURCE_EXTRACT_CHARS);
  const fallbackPayload = mapAlertToLongBriefPayload(alert, LONG_BRIEF_FALLBACK_SOURCE_EXTRACT_CHARS);
  const payloadAttempts = [primaryPayload, fallbackPayload];

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
        const responseData = await response.json();
        const brief = extractRemoteBrief(responseData);
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
  // We intentionally support multiple response shapes because the deployed endpoint may be:
  // - the direct Brialert API contract { brief }
  // - a compatibility/proxy contract { longBrief } / { text } / { output_text } / { content } / { data: { brief } }
  // - a pass-through LLM wrapper with OpenAI-style choices[].message.content or choices[].text
  // This prevents false local fallback when Vercel is up but a different response adapter is in front.
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

  const choiceContent = String(
    responseData?.choices?.[0]?.message?.content
    ?? responseData?.choices?.[0]?.text
    ?? ''
  ).trim();
  return choiceContent;
}

function isSafeAbsoluteHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (!/^https?:$/.test(parsed.protocol)) return false;
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function mapAlertToLongBriefPayload(alert, maxSourceExtractChars = LONG_BRIEF_MAX_SOURCE_EXTRACT_CHARS) {
  const sourceExtract = alert.sourceExtract ?? alert.extract ?? alert.summary ?? '';
  const trimmedSourceExtract = cleanTextBlock(truncateAtWordBoundary(sourceExtract, maxSourceExtractChars));
  return {
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

function truncateAtWordBoundary(value, maxChars) {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  const candidate = text.slice(0, maxChars);
  const boundary = candidate.lastIndexOf(' ');
  // Avoid chopping too aggressively when the nearest whitespace is far from the limit.
  if (boundary > Math.floor(maxChars * WORD_BOUNDARY_MIN_RATIO)) {
    return candidate.slice(0, boundary).trim();
  }
  return text.slice(0, maxChars).trim();
}

export function createModalRuntime(elements, options = {}) {
  const baseController = createModalController({
    modal: elements.modal,
    modalTitle: elements.modalTitle,
    modalMeta: elements.modalMeta,
    modalAiSummary: elements.modalAiSummary,
    modalSummary: elements.modalSummary,
    modalSceneClock: elements.modalSceneClock,
    sceneClockPanel: elements.sceneClockPanel,
    modalAudit: elements.modalAudit,
    modalCorroboration: elements.modalCorroboration,
    auditPanel: elements.auditPanel,
    corroborationPanel: elements.corroborationPanel,
    modalSeverity: elements.modalSeverity,
    modalStatus: elements.modalStatus,
    modalSource: elements.modalSource,
    modalRegion: elements.modalRegion,
    modalBriefing: elements.modalBriefing,
    modalLink: elements.modalLink,
    copyBriefing: elements.copyBriefing,
    expandedBriefPanel: elements.expandedBriefPanel,
    modalExpandedBrief: elements.modalExpandedBrief,
    generateExpandedBrief: elements.generateExpandedBrief,
    copyExpandedBrief: elements.copyExpandedBrief
  }, {
    effectiveSummary,
    buildBriefing,
    renderSceneClock,
    buildAuditBlock,
    renderCorroboratingSources,
    severityLabel
  });

  const modalController = {
    openDetail(alert) {
      baseController.openDetail(alert);
      options?.onAlertChange?.(baseController.getCurrentAlert());
    },
    closeDetailPanel() {
      baseController.closeDetailPanel();
      options?.onAlertChange?.(null);
    },
    copyTextToButton: baseController.copyTextToButton,
    getCurrentAlert: baseController.getCurrentAlert,
    setExpandedBrief: baseController.setExpandedBrief
  };

  async function generateLongBrief() {
    const alert = modalController.getCurrentAlert();
    if (!alert || !elements.generateExpandedBrief || !elements.modalExpandedBrief || !elements.copyExpandedBrief) return;

    elements.generateExpandedBrief.disabled = true;
    elements.generateExpandedBrief.textContent = 'Generating...';

    try {
      const brief = await generateRemoteLongBrief(alert);
      modalController.setExpandedBrief(brief);
    } catch (error) {
      console.error('Remote long brief generation failed, falling back to local generator:', error);
      modalController.setExpandedBrief(buildLocalLongBrief(alert));
    } finally {
      elements.generateExpandedBrief.disabled = false;
    }
  }

  return { modalController, generateLongBrief };
}
