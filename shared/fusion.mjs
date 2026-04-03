import crypto from 'node:crypto';
import { clean } from './taxonomy.mjs';

const fusionStopwords = new Set([
  'the', 'a', 'an', 'and', 'of', 'to', 'in', 'for', 'on', 'with', 'from', 'at', 'by', 'over', 'under',
  'after', 'before', 'into', 'outside', 'inside', 'near', 'amid', 'during', 'update', 'updates', 'live',
  'breaking', 'latest', 'terror', 'terrorism', 'attack', 'attacks', 'incident', 'incidents', 'plot', 'plots',
  'threat', 'threats', 'suspect', 'suspects', 'arrest', 'arrested', 'charges', 'charged', 'case', 'court',
  'police', 'officials', 'official', 'man', 'woman', 'group'
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

export function stableFusionTerms(item) {
  const weightedCounts = new Map();
  const titleTokens = uniqueTokens(informativeTokens(item.title || '', 4));
  const summaryTokens = uniqueTokens(informativeTokens(item.summary || '', 4));
  const extractTokens = uniqueTokens(informativeTokens(item.sourceExtract || '', 4));
  const detailTokens = uniqueTokens([...summaryTokens, ...extractTokens]);
  const detailSet = new Set(detailTokens);
  const titleSet = new Set(titleTokens);
  const sharedTokens = uniqueTokens(titleTokens.filter((token) => detailSet.has(token)));
  const repeatedDetailTokens = uniqueTokens(
    summaryTokens.filter((token) => extractTokens.includes(token))
  );

  for (const token of titleTokens) {
    weightedCounts.set(token, (weightedCounts.get(token) || 0) + 3);
  }
  for (const token of detailTokens) {
    weightedCounts.set(token, (weightedCounts.get(token) || 0) + 1);
  }
  for (const token of sharedTokens) {
    weightedCounts.set(token, (weightedCounts.get(token) || 0) + 5);
  }
  for (const token of repeatedDetailTokens) {
    weightedCounts.set(token, (weightedCounts.get(token) || 0) + 2);
  }

  return [...weightedCounts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 6)
    .map(([token]) => token)
    .filter((token) => titleSet.has(token) || detailSet.has(token))
    .sort();
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
