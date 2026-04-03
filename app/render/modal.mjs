import {
  buildAuditBlock,
  buildBriefing,
  effectiveSummary,
  formatAgeFrom,
  renderConfidenceLadder,
  renderCorroboratingSources,
  renderSceneClock,
  severityLabel
} from '../../shared/alert-view-model.mjs';
import { createModalController } from '../../shared/modal-briefing.mjs';
import { cleanTextBlock, splitLongBriefSentences } from '../utils/text.mjs';

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
    'This version was generated locally from the captured source text and alert metadata because no server-side AI endpoint is configured for the public site.'
  ].join('\n\n');
}

export function createModalRuntime(elements, longBriefApiUrl) {
  const modalController = createModalController({
    modal: elements.modal,
    modalTitle: elements.modalTitle,
    modalMeta: elements.modalMeta,
    modalAiSummary: elements.modalAiSummary,
    modalSummary: elements.modalSummary,
    modalSceneClock: elements.modalSceneClock,
    modalConfidenceLadder: elements.modalConfidenceLadder,
    sceneClockPanel: elements.sceneClockPanel,
    confidenceLadderPanel: elements.confidenceLadderPanel,
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
    renderConfidenceLadder,
    buildAuditBlock,
    renderCorroboratingSources,
    severityLabel
  });

  async function generateLongBrief() {
    const alert = modalController.getCurrentAlert();
    if (!alert || !elements.generateExpandedBrief || !elements.modalExpandedBrief || !elements.copyExpandedBrief) return;

    elements.generateExpandedBrief.disabled = true;
    elements.generateExpandedBrief.textContent = 'Generating...';

    if (!longBriefApiUrl) {
      modalController.setExpandedBrief(buildLocalLongBrief(alert));
      elements.generateExpandedBrief.disabled = false;
      return;
    }

    try {
      const response = await fetch(longBriefApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: alert.title,
          location: alert.location,
          region: alert.region,
          source: alert.source,
          sourceUrl: alert.sourceUrl,
          summary: effectiveSummary(alert),
          sourceExtract: alert.sourceExtract,
          confidence: alert.confidence,
          lane: alert.lane,
          eventType: alert.eventType,
          peopleInvolved: alert.peopleInvolved
        })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const brief = String(payload.brief || payload.longBrief || '').trim();
      modalController.setExpandedBrief(brief || 'Long brief generation returned no text.');
    } catch (error) {
      modalController.setExpandedBrief(`LONG BRIEF FAILED\n\n${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      elements.generateExpandedBrief.disabled = false;
    }
  }

  return { modalController, generateLongBrief };
}
