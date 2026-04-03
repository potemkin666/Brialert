import crypto from 'node:crypto';
import { clean } from './taxonomy.mjs';

const fusionStopwords = new Set([
  'the', 'a', 'an', 'and', 'of', 'to', 'in', 'for', 'on', 'with', 'from', 'at', 'by', 'over', 'under',
  'after', 'before', 'into', 'outside', 'inside', 'near', 'amid', 'during', 'update', 'updates', 'live',
  'breaking', 'latest', 'terror', 'terrorism', 'attack', 'attacks', 'incident', 'incidents', 'plot', 'plots',
  'threat', 'threats', 'suspect', 'suspects', 'arrest', 'arrested', 'charges', 'charged', 'case', 'court',
  'police', 'officials', 'official', 'man', 'woman', 'group'
]);

const fusionTokenAliases = new Map([
  ['found', 'locate'],
  ['find', 'locate'],
  ['finding', 'locate'],
  ['located', 'locate'],
  ['locating', 'locate'],
  ['locate', 'locate'],
  ['discovers', 'locate'],
  ['discovered', 'locate'],
  ['discovering', 'locate'],
  ['discover', 'locate'],
  ['disrupted', 'disrupt'],
  ['disrupting', 'disrupt'],
  ['disrupts', 'disrupt'],
  ['disruption', 'disrupt'],
  ['explosives', 'explosive'],
  ['devices', 'device']
]);

export function sameStoryKey(item) {
  return clean(item.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|and|of|to|in|for|on|with|from)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseFusionToken(token) {
  const value = clean(token).toLowerCase();
  if (!value) return '';
  if (fusionTokenAliases.has(value)) return fusionTokenAliases.get(value);
  if (value.endsWith('ing') && value.length > 6) return value.slice(0, -3);
  if (value.endsWith('ed') && value.length > 5) return value.slice(0, -2);
  if (value.endsWith('es') && value.length > 5 && !value.endsWith('ses')) return value.slice(0, -2);
  if (value.endsWith('s') && value.length > 5 && !value.endsWith('is')) return value.slice(0, -1);
  return value;
}

function informativeTokens(text, minLength) {
  return clean(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map(normaliseFusionToken)
    .filter(Boolean)
    .filter((token) => token.length >= minLength && !fusionStopwords.has(token));
}

function uniqueTokens(tokens) {
  return [...new Set(tokens.filter(Boolean))];
}

function tokenFrequency(tokens) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
}

function sortedIntersection(aTokens, bTokens) {
  const bSet = new Set(bTokens);
  return uniqueTokens(aTokens.filter((token) => bSet.has(token))).sort();
}

function highSignalTokens(tokens, minimumOccurrences = 2) {
  return [...tokenFrequency(tokens).entries()]
    .filter(([, count]) => count >= minimumOccurrences)
    .map(([token]) => token)
    .sort();
}

function tokensPresentInMultipleFields(fieldTokenSets, minimumFields = 2) {
  const counts = new Map();
  for (const tokens of fieldTokenSets) {
    for (const token of new Set(tokens)) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= minimumFields)
    .map(([token]) => token)
    .sort();
}

export function stableFusionTerms(item) {
  const titleTokens = informativeTokens(item.title || '', 4);
  const summaryTokens = informativeTokens(item.summary || '', 4);
  const extractTokens = informativeTokens(item.sourceExtract || '', 4);

  const titleUnique = uniqueTokens(titleTokens);
  const summaryUnique = uniqueTokens(summaryTokens);
  const extractUnique = uniqueTokens(extractTokens);
  const allTokens = [...titleTokens, ...summaryTokens, ...extractTokens];

  const strongestShared = highSignalTokens(allTokens, 2);
  const multiFieldShared = tokensPresentInMultipleFields([titleTokens, summaryTokens, extractTokens], 2);
  const titleDetailShared = sortedIntersection(
    titleUnique,
    uniqueTokens([...summaryUnique, ...extractUnique])
  );
  const detailShared = sortedIntersection(summaryUnique, extractUnique);
  const stableCore = uniqueTokens([
    ...multiFieldShared,
    ...titleDetailShared,
    ...detailShared
  ]).sort();
  const fallbackInformative = uniqueTokens(allTokens).sort();

  if (stableCore.length >= 3) {
    return stableCore.slice(0, 6);
  }

  return uniqueTokens([
    ...stableCore,
    ...strongestShared,
    ...fallbackInformative
  ]).sort().slice(0, 6);
}

export function fusedIncidentIdFor(item) {
  const signature = [
    clean(item.location).toLowerCase(),
    clean(item.eventType).toLowerCase(),
    clean(item.incidentTrack).toLowerCase(),
    ...stableFusionTerms(item)
  ]
    .filter(Boolean)
    .join('|');

  const fallback = clean(`${item.title} ${item.location} ${item.eventType} ${item.incidentTrack}`).toLowerCase();
  const digest = crypto.createHash('sha1').update(signature || fallback).digest('hex').slice(0, 16);
  return `fusion-${digest}`;
}

export function sourceReferenceFor(alert) {
  return {
    fusedIncidentId: alert.fusedIncidentId,
    source: alert.source,
    sourceUrl: alert.sourceUrl,
    sourceTier: alert.sourceTier,
    reliabilityProfile: alert.reliabilityProfile,
    publishedAt: alert.publishedAt,
    confidence: alert.confidence
  };
}

export function mergeCorroboratingSources(primary, secondary) {
  const merged = [
    ...(Array.isArray(primary.corroboratingSources) ? primary.corroboratingSources : []),
    sourceReferenceFor(secondary)
  ];
  const seen = new Set();
  return merged
    .filter((entry) => clean(entry.source) && clean(entry.sourceUrl))
    .filter((entry) => {
      const key = `${clean(entry.source).toLowerCase()}|${clean(entry.sourceUrl).toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const timeA = new Date(a.publishedAt).getTime() || 0;
      const timeB = new Date(b.publishedAt).getTime() || 0;
      return timeB - timeA;
    });
}
