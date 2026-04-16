import { effectiveSummary, formatAgeFrom } from '../../shared/alert-view-model.mjs';
import { cleanTextBlock, splitLongBriefSentences } from '../utils/text.mjs';

export function buildLocalLongBrief(alert) {
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
    'This long brief was generated locally from the captured source text and alert metadata only. It does not include internet research — for a research-backed brief, retry when the remote agent is available.'
  ].join('\n\n');
}
