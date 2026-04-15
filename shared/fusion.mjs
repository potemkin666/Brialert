import crypto from 'node:crypto';
import { clean } from './taxonomy.mjs';

const fusionStopwords = new Set([
  // English
  'the', 'a', 'an', 'and', 'of', 'to', 'in', 'for', 'on', 'with', 'from', 'at', 'by', 'over', 'under',
  'after', 'before', 'into', 'outside', 'inside', 'near', 'amid', 'during', 'update', 'updates', 'live',
  'breaking', 'latest', 'terror', 'terrorism', 'attack', 'attacks', 'incident', 'incidents', 'plot', 'plots',
  'threat', 'threats', 'suspect', 'suspects', 'arrest', 'arrested', 'charges', 'charged', 'case', 'court',
  'police', 'officials', 'official', 'man', 'woman', 'group',
  // French
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'en', 'est', 'sur', 'par', 'pour', 'dans',
  'avec', 'sont', 'qui', 'que', 'aux', 'cette', 'ces',
  // German
  'der', 'die', 'das', 'ein', 'eine', 'und', 'ist', 'von', 'mit', 'auf', 'den', 'dem', 'des', 'aus',
  'als', 'bei', 'nach', 'sich', 'auch', 'oder', 'aber', 'wie', 'noch', 'nur', 'bis', 'wird', 'hat',
  // Spanish
  'el', 'los', 'del', 'con', 'por', 'como', 'mas', 'pero', 'sus', 'fue', 'ser', 'han', 'son',
  // Arabic transliterations
  'min', 'ila', 'ala', 'fil', 'wal'
]);

const fusionTokenAliases = new Map([
  // English location/discovery verbs
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
  // English disruption verbs
  ['disrupted', 'disrupt'],
  ['disrupting', 'disrupt'],
  ['disrupts', 'disrupt'],
  ['disruption', 'disrupt'],
  // Plurals for common CT terms
  ['explosives', 'explosive'],
  ['devices', 'device'],
  // French CT terms
  ['attentat', 'attack_ct'],
  ['attentats', 'attack_ct'],
  ['attaque', 'attack_ct'],
  ['attaques', 'attack_ct'],
  ['terrorisme', 'terrorism_ct'],
  ['terroriste', 'terrorist_ct'],
  ['terroristes', 'terrorist_ct'],
  ['extremisme', 'extremism_ct'],
  ['extremiste', 'extremist_ct'],
  ['extremistes', 'extremist_ct'],
  ['radicalisation', 'radicaliz_ct'],
  ['radicalise', 'radicaliz_ct'],
  ['radicalises', 'radicaliz_ct'],
  ['menace', 'threat_ct'],
  ['menaces', 'threat_ct'],
  // German CT terms
  ['anschlag', 'attack_ct'],
  ['anschlaege', 'attack_ct'],
  ['anschlage', 'attack_ct'],
  ['terrorismus', 'terrorism_ct'],
  ['terrorist', 'terrorist_ct'],
  ['terroristen', 'terrorist_ct'],
  ['extremismus', 'extremism_ct'],
  ['extremist', 'extremist_ct'],
  ['extremisten', 'extremist_ct'],
  ['radikalisierung', 'radicaliz_ct'],
  ['bedrohung', 'threat_ct'],
  ['bedrohungen', 'threat_ct'],
  // Spanish CT terms
  ['atentado', 'attack_ct'],
  ['atentados', 'attack_ct'],
  ['ataque', 'attack_ct'],
  ['ataques', 'attack_ct'],
  ['terrorismo', 'terrorism_ct'],
  ['terrorista', 'terrorist_ct'],
  ['terroristas', 'terrorist_ct'],
  ['extremismo', 'extremism_ct'],
  ['extremista', 'extremist_ct'],
  ['extremistas', 'extremist_ct'],
  ['radicalizacion', 'radicaliz_ct'],
  ['amenaza', 'threat_ct'],
  ['amenazas', 'threat_ct'],
  // English stemming aliases
  ['radicalized', 'radicaliz_ct'],
  ['radicalised', 'radicaliz_ct'],
  ['radicalization', 'radicaliz_ct']
]);

/** Multi-word entities collapsed to a single canonical token before splitting. */
const multiWordEntities = [
  ['islamic state', 'islamic_state'],
  ['estado islamico', 'islamic_state'],
  ['etat islamique', 'islamic_state'],
  ['islamischer staat', 'islamic_state'],
  ['al qaeda', 'alqaeda'],
  ['al qaida', 'alqaeda'],
  ['boko haram', 'bokoharam'],
  ['hizb ut tahrir', 'hizbuttahrir'],
  ['hizb al tahrir', 'hizbuttahrir'],
  ['real ira', 'realira'],
  ['new ira', 'newira'],
  ['lone wolf', 'lonewolf'],
  ['loup solitaire', 'lonewolf'],
  ['far right', 'farright'],
  ['extreme droite', 'farright'],
  ['rechtsextremismus', 'farright'],
  ['far left', 'farleft'],
  ['extreme gauche', 'farleft']
];

/**
 * Strip diacritics / combining marks from a string and normalise
 * common transliteration variants (hyphens, curly quotes, etc.).
 */
function stripDiacritics(text) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // combining diacritical marks
    .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")  // curly quotes → apostrophe
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-'); // normalise dashes
}

/**
 * Replace multi-word entity phrases with their single-token canonical form.
 */
function collapseEntities(text) {
  let result = text;
  for (const [phrase, token] of multiWordEntities) {
    // Escape regex-special chars, then allow flexible separators (hyphens, spaces)
    const escaped = phrase
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '[\\s\\-]+');
    result = result.replace(new RegExp(escaped, 'gi'), ` ${token} `);
  }
  return result;
}

export function sameStoryKey(item) {
  return stripDiacritics(clean(item.title))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|and|of|to|in|for|on|with|from)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseFusionToken(token) {
  const value = stripDiacritics(clean(token)).toLowerCase();
  if (!value) return '';
  if (fusionTokenAliases.has(value)) return fusionTokenAliases.get(value);
  // English morphological stemming – applied in order of specificity
  if (value.endsWith('isation') && value.length > 9) return value.slice(0, -7);
  if (value.endsWith('ization') && value.length > 9) return value.slice(0, -7);
  if (value.endsWith('ement') && value.length > 7) return value.slice(0, -5);
  if (value.endsWith('ment') && value.length > 6) return value.slice(0, -4);
  if (value.endsWith('ness') && value.length > 6) return value.slice(0, -4);
  if (value.endsWith('ity') && value.length > 5) return value.slice(0, -3);
  if (value.endsWith('ous') && value.length > 5) return value.slice(0, -3);
  if (value.endsWith('ive') && value.length > 5) return value.slice(0, -3);
  if (value.endsWith('ful') && value.length > 5) return value.slice(0, -3);
  if (value.endsWith('ing') && value.length > 6) return value.slice(0, -3);
  if (value.endsWith('ied') && value.length > 5) return value.slice(0, -3) + 'y';
  if (value.endsWith('ed') && value.length > 5) return value.slice(0, -2);
  if (value.endsWith('ies') && value.length > 5) return value.slice(0, -3) + 'y';
  if (value.endsWith('es') && value.length > 5 && !value.endsWith('ses')) return value.slice(0, -2);
  if (value.endsWith('s') && value.length > 5 && !value.endsWith('is') && !value.endsWith('ss')) return value.slice(0, -1);
  return value;
}

function informativeTokens(text, minLength) {
  const normalised = stripDiacritics(clean(text)).toLowerCase();
  const collapsed = collapseEntities(normalised);
  // Underscores are preserved so collapsed entity tokens (e.g. islamic_state) survive splitting
  return collapsed
    .replace(/[^a-z0-9_\s]+/g, ' ')
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
