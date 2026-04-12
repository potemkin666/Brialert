import {
  clean,
  plainText,
  terrorismKeywords,
  matchesKeywords,
  inferSourceTier,
  inferReliabilityProfile,
  inferIncidentTrack,
  isTerrorRelevantIncident,
  inferSeverity,
  inferConfidenceScore,
  inferStatus,
  inferEventType,
  inferGeoPrecision
} from '../../shared/taxonomy.mjs';
import {
  sameStoryKey,
  fusedIncidentIdFor,
  mergeCorroboratingSources
} from '../../shared/fusion.mjs';
import { severityRank, SOURCE_TIMEZONE, titleCase } from './config.mjs';
import { geoFor, inferLocation } from './geo.mjs';
import { isEnglishLanguage, parseSourceDate } from './io.mjs';

function currentTimeMs() {
  return Date.now();
}

function sourceTierRankValue(sourceTier) {
  if (sourceTier === 'trigger') return 4;
  if (sourceTier === 'corroboration') return 3;
  if (sourceTier === 'context') return 2;
  if (sourceTier === 'research') return 1;
  return 0;
}

function incidentTrackRankValue(incidentTrack) {
  if (incidentTrack === 'live') return 2;
  if (incidentTrack === 'case') return 1;
  return 0;
}

function ageHoursForAlert(alert) {
  const published = parseSourceDate(alert?.publishedAt);
  if (!published) return Infinity;
  return Math.max(0, (currentTimeMs() - published.getTime()) / 3600000);
}

function reliabilityWeight(profile) {
  if (profile === 'official_ct') return 2.6;
  if (profile === 'official_general') return 2.1;
  if (profile === 'official_context') return 1.6;
  if (profile === 'major_media') return 1.2;
  if (profile === 'specialist_research') return 0.7;
  if (profile === 'general_media') return 0.35;
  if (profile === 'tabloid') return -0.4;
  return 0;
}

function inferConfidence(reliabilityProfile) {
  if (reliabilityProfile === 'official_ct') return 'Verified CT source update';
  if (reliabilityProfile === 'official_general' || reliabilityProfile === 'official_context') return 'Verified official source update';
  if (reliabilityProfile === 'major_media') return 'Major media source signal';
  if (reliabilityProfile === 'specialist_research') return 'Research or analytical source';
  if (reliabilityProfile === 'tabloid') return 'Low-confidence media signal';
  return 'Secondary source signal';
}

function formatWhen(rawDate) {
  const parsed = parseSourceDate(rawDate);
  if (!parsed) return null;
  return parsed.toISOString();
}

function formatDisplayDate(rawDate) {
  const parsed = parseSourceDate(rawDate);
  if (!parsed) return 'Source date unconfirmed';
  return parsed.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: SOURCE_TIMEZONE
  });
}

function freshUntilFor(source, publishedIso, severity, incidentTrack) {
  const published = parseSourceDate(publishedIso) || new Date(currentTimeMs());
  const hoursByLane = {
    incidents: incidentTrack === 'live' ? (severity === 'critical' ? 24 : severity === 'high' ? 48 : 84) : 24 * 14,
    context: 24 * 4,
    sanctions: 24 * 10,
    oversight: 24 * 8,
    border: 24 * 5,
    prevention: 24 * 8
  };
  const hours = hoursByLane[source.lane] || 72;
  return new Date(published.getTime() + hours * 3600000).toISOString();
}

function olderContextPenalty(ageHours, reliabilityProfile, lane, severity) {
  if (ageHours <= 72) return 0;

  let penalty = 0;
  if (reliabilityProfile === 'general_media') penalty += ageHours <= 168 ? 2.25 : 3.5;
  else if (reliabilityProfile === 'specialist_research') penalty += ageHours <= 168 ? 1.5 : 2.5;
  else if (reliabilityProfile === 'official_context') penalty += ageHours <= 168 ? 0.75 : 1.5;
  else if (reliabilityProfile === 'tabloid') penalty += ageHours <= 168 ? 3 : 4.5;

  if (['context', 'oversight', 'prevention'].includes(lane) && ageHours > 168) penalty += 1;
  if (severity === 'moderate' && ageHours > 168) penalty += 0.5;
  if (severity === 'low' && ageHours > 96) penalty += 0.75;
  return penalty;
}

function priorityScoreFor(source, severity, keywordHits, publishedIso, incidentTrack, reliabilityProfile) {
  let score = severityRank[severity] || 1;
  if (source.lane === 'incidents') score += 4;
  if (incidentTrack === 'live') score += 3.5;
  if (incidentTrack === 'case') score -= 1.5;
  score += reliabilityWeight(reliabilityProfile);
  score += Math.min(keywordHits.length, 5) * 0.6;
  if (publishedIso) {
    const ageHours = Math.max(0, (currentTimeMs() - new Date(publishedIso).getTime()) / 3600000);
    if (source.lane === 'incidents') {
      if (incidentTrack === 'live') {
        if (ageHours <= 2) score += 6;
        else if (ageHours <= 6) score += 5;
        else if (ageHours <= 12) score += 4.25;
        else if (ageHours <= 24) score += 3.5;
        else if (ageHours <= 48) score += 2.5;
        else if (ageHours <= 72) score += 1.5;
        else if (ageHours <= 96) score += 0.5;
        else if (ageHours <= 168) score -= 1.5;
        else score -= 5;
      } else {
        if (ageHours <= 24) score += 1.25;
        else if (ageHours <= 72) score += 0.5;
        else if (ageHours > 336) score -= 2;
        else if (ageHours > 168) score -= 1;
      }
    } else {
      if (ageHours <= 12) score += 1.5;
      else if (ageHours <= 24) score += 1;
      else if (ageHours <= 48) score += 0.35;
      else if (ageHours <= 72) score += 0;
      else if (ageHours <= 96) score -= 1;
      else if (ageHours <= 168) score -= 2.5;
      else if (ageHours <= 336) score -= 4;
      else score -= 6;
      score -= olderContextPenalty(ageHours, reliabilityProfile, source.lane, severity);
    }
  } else {
    score -= source.lane === 'incidents' ? 3 : 1;
  }
  return Number(score.toFixed(2));
}

function needsHumanReviewFor(source, severity, keywordHits, publishedIso, reliabilityProfile, incidentTrack) {
  if (source.lane !== 'incidents') return false;
  if (reliabilityProfile === 'tabloid') return true;
  if (reliabilityProfile === 'general_media' && incidentTrack === 'live') return true;
  if (severity === 'critical' && !['official_ct', 'official_general', 'major_media'].includes(reliabilityProfile)) return true;
  if (!publishedIso) return true;
  return keywordHits.length < 2;
}

function freshnessBucket(source, publishedIso) {
  if (!publishedIso) return source.lane === 'incidents' ? 0 : 1;
  const ageHours = Math.max(0, (currentTimeMs() - new Date(publishedIso).getTime()) / 3600000);
  if (source.lane === 'incidents') {
    if (ageHours <= 2) return 5;
    if (ageHours <= 6) return 4;
    if (ageHours <= 12) return 3;
    if (ageHours <= 24) return 2;
    if (ageHours <= 72) return 1;
    return 0;
  }
  if (ageHours <= 12) return 3;
  if (ageHours <= 36) return 2;
  if (ageHours <= 72) return 1;
  return 0;
}

export function recencyOkay(source, rawDate) {
  if (!rawDate) return false;
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return false;
  const ageDays = (currentTimeMs() - parsed.getTime()) / 86400000;
  if (source.lane === 'incidents') return ageDays <= 7;
  if (source.lane === 'context') return ageDays <= 1;
  if (source.lane === 'border') return ageDays <= 14;
  if (source.lane === 'sanctions') return ageDays <= 21;
  if (source.lane === 'oversight' || source.lane === 'prevention') return ageDays <= 30;
  return ageDays <= 45;
}

function hasReliableSourceDate(rawDate) {
  if (!rawDate) return false;
  const parsed = new Date(rawDate);
  return !Number.isNaN(parsed.getTime());
}

function providerHeadlineTokens(value) {
  const stopwords = new Set([
    'news', 'latest', 'update', 'updates', 'press', 'release', 'releases',
    'rss', 'feed', 'feeds', 'official', 'service'
  ]);
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length >= 4 && !stopwords.has(token));
}

function looksLikeProviderHeadline(source, item) {
  const title = clean(item?.title);
  if (!title) return true;

  const titleLower = title.toLowerCase();
  const providerLower = clean(source?.provider).toLowerCase();
  if (titleLower === providerLower) return true;

  const titleTokens = providerHeadlineTokens(title);
  const providerTokens = new Set(providerHeadlineTokens(source?.provider));
  if (!titleTokens.length) return true;

  const overlapCount = titleTokens.filter((token) => providerTokens.has(token)).length;
  return titleTokens.length <= 6 && overlapCount / titleTokens.length >= 0.8;
}

function summariseTextBlock(text, maxParts = 8) {
  return clean(text)
    .split(/(?<=[.!?])\s+|\s{2,}/)
    .map((part) => clean(part))
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .slice(0, maxParts);
}

function makeSummary(source, item) {
  const title = clean(item.title);
  const summary = clean(item.summary && item.summary !== item.title ? item.summary : '');
  if (source.lane === 'incidents') {
    const factualBits = summariseTextBlock(summary);
    return factualBits.length ? factualBits.join(' ') : title;
  }
  if (source.lane === 'sanctions') return `${source.provider} has published a sanctions-related update. The value here is legal and entity-resolution context, including designations, aliases, listing changes, and notice-level movement.`;
  if (source.lane === 'context') return `${source.provider} has published corroborating or adjacent reporting. The value here is supporting detail, follow-on facts, and wider situation context rather than a primary live trigger.`;
  if (source.lane === 'border') return `${source.provider} has published a border or screening update. The main use is travel, document, screening, or movement risk context that may support later incident interpretation.`;
  if (source.lane === 'oversight') return `${source.provider} has published an oversight or review update. This is useful for legal, custody, supervision, or institutional risk context rather than immediate public warning.`;
  return `${source.provider} has published a prevention or radicalisation update. The value is horizon scanning, theme detection, and context for later operational or analytical work.`;
}

function laneReasonFor(source, incidentTrack) {
  if (source.lane === 'incidents') {
    return incidentTrack === 'live'
      ? 'Terror-related live incident or disrupted plot candidate from an incident feed.'
      : 'Terror-related case, prosecution, or recognition update kept as incident context.';
  }
  if (source.lane === 'context') return 'Corroborating or adjacent source kept out of the live trigger lane.';
  if (source.lane === 'sanctions') return 'Sanctions change with terrorism relevance.';
  if (source.lane === 'oversight') return 'Oversight, legislation, or review signal relevant to counter-terror posture.';
  if (source.lane === 'border') return 'Border, document, or screening signal relevant to threat movement.';
  return 'Prevention, radicalisation, or analytical context source.';
}

function queueReasonFor(source, { sourceTier, reliabilityProfile, incidentTrack, keywordHits, terrorismHits, confidenceScore, needsHumanReview, isTerrorRelevant }) {
  if (source.lane !== 'incidents') return laneReasonFor(source, incidentTrack);
  if (needsHumanReview) return 'Needs human review';
  if (!isTerrorRelevant && keywordHits.length) return 'Incident wording without clear terrorism signal';
  if (!terrorismHits.length && keywordHits.length >= 2) return 'Keyword-led match from a broad source';
  if (sourceTier !== 'trigger') return 'Non-trigger source awaiting corroboration';
  if (!source.isTrustedOfficial && confidenceScore > 0 && confidenceScore < 0.8) {
    return reliabilityProfile === 'tabloid' ? 'Tabloid source requires corroboration' : 'Secondary source with weak confidence';
  }
  if (incidentTrack === 'case') return 'Case or prosecution update kept out of the live trigger lane';
  return 'Trigger-tier terrorism incident candidate';
}

function queueBucketFor(source, { queueReason }) {
  const reason = clean(queueReason).toLowerCase();
  if (source?.lane !== 'incidents') return source?.lane || 'context';
  if (reason.includes('needs human review')) return 'quarantine';
  if (reason.includes('non-trigger source awaiting corroboration')) return 'quarantine';
  if (reason.includes('weak confidence')) return 'quarantine';
  if (reason.includes('tabloid source requires corroboration')) return 'quarantine';
  if (reason.includes('incident wording without clear terrorism signal')) return 'quarantine';
  if (reason.includes('keyword-led match from a broad source')) return 'quarantine';
  if (reason.includes('case or prosecution update kept out of the live trigger lane')) return 'quarantine';
  return 'responder';
}

function shouldKeepPeopleInvolved(reliabilityProfile, confidenceScore, needsHumanReview, peopleInvolved) {
  if (!Array.isArray(peopleInvolved) || !peopleInvolved.length) return false;
  if (needsHumanReview) return false;
  if (!Number.isFinite(confidenceScore) || confidenceScore <= 0) return false;
  if (['official_ct', 'official_general'].includes(reliabilityProfile)) return confidenceScore >= 0.7;
  if (reliabilityProfile === 'major_media') return confidenceScore >= 0.9;
  return false;
}

export function discardReasonForItem(source, item) {
  const sourceTier = inferSourceTier(source);
  const reliabilityProfile = inferReliabilityProfile(source, sourceTier);
  const text = `${item.title} ${item.summary} ${item.sourceExtract || ''}`;
  const eventType = inferEventType(source, text);
  const incidentHits = matchesKeywords(text);
  const terrorHits = matchesKeywords(text, terrorismKeywords);
  const terrorRelevant = isTerrorRelevantIncident(source, item);

  if (item.language && !isEnglishLanguage(item.language)) return 'non-english';
  if (looksLikeProviderHeadline(source, item)) return 'provider-headline';
  if (source.lane === 'incidents' && ['feature', 'recognition'].includes(eventType)) return 'non-incident-event';
  if (!recencyOkay(source, item.published)) {
    return hasReliableSourceDate(item.published) ? 'stale-date' : 'missing-or-invalid-date';
  }
  if (source.lane === 'incidents' && !terrorRelevant) return 'not-terror-relevant';
  if (source.lane === 'context' && !source.isTrustedOfficial) {
    const requiredTerrorHits = reliabilityProfile === 'tabloid' ? 2 : 1;
    if (terrorHits.length < requiredTerrorHits) return 'insufficient-terror-hits';
  }
  if (reliabilityProfile === 'tabloid') {
    const titleTerrorHits = matchesKeywords(item.title || '', terrorismKeywords);
    if (titleTerrorHits.length < 1) return 'tabloid-title-miss';
    if (terrorHits.length < 2) return 'tabloid-terror-hit-miss';
    if (incidentHits.length < 3) return 'tabloid-incident-hit-miss';
  }
  if (source.requiresKeywordMatch && incidentHits.length === 0) return 'keyword-match-required';
  return null;
}

export function shouldKeepItem(source, item) {
  return discardReasonForItem(source, item) === null;
}

export function buildAlert(source, item, idx) {
  const text = `${item.title} ${item.summary}`;
  const sourceTier = inferSourceTier(source);
  const reliabilityProfile = inferReliabilityProfile(source, sourceTier);
  const location = inferLocation(source, item.title, item.summary);
  const coords = geoFor(location, item.title, item.summary, source.region);
  const publishedIso = formatWhen(item.published);
  const displayWhen = formatDisplayDate(item.published);
  const keywordHits = matchesKeywords(text);
  const terrorismHits = matchesKeywords(text, terrorismKeywords);
  const severity = inferSeverity(source, text);
  const eventType = inferEventType(source, text);
  const incidentTrack = inferIncidentTrack({ ...source, eventType, text });
  const confidenceScore = inferConfidenceScore(source, text, publishedIso, reliabilityProfile);
  const priorityScore = priorityScoreFor(source, severity, keywordHits, publishedIso, incidentTrack, reliabilityProfile);
  const isTerrorRelevant = isTerrorRelevantIncident(source, item);
  const needsHumanReview = needsHumanReviewFor(source, severity, keywordHits, publishedIso, reliabilityProfile, incidentTrack);
  const peopleInvolved = shouldKeepPeopleInvolved(reliabilityProfile, confidenceScore, needsHumanReview, item.peopleInvolved)
    ? item.peopleInvolved.slice(0, 6)
    : [];
  const queueReason = queueReasonFor(source, {
    sourceTier,
    reliabilityProfile,
    incidentTrack,
    keywordHits,
    terrorismHits,
    confidenceScore,
    needsHumanReview,
    isTerrorRelevant
  });
  const queueBucket = queueBucketFor(source, { queueReason });
  const fusedIncidentId = fusedIncidentIdFor({
    title: item.title,
    summary: item.summary,
    sourceExtract: item.sourceExtract,
    location,
    eventType,
    incidentTrack
  });

  return {
    id: `${source.id}-${idx}`,
    fusedIncidentId,
    title: titleCase(item.title),
    location,
    region: source.region,
    lane: source.lane,
    severity,
    status: inferStatus(source, text),
    actor: source.provider,
    subject: source.provider,
    happenedWhen: displayWhen,
    confidence: inferConfidence(reliabilityProfile),
    confidenceScore,
    summary: plainText(item.summary || item.title).slice(0, 260),
    aiSummary: makeSummary(source, item),
    sourceExtract: plainText(item.sourceExtract || item.summary || item.title).slice(0, 1800),
    peopleInvolved,
    source: source.provider,
    sourceUrl: item.link,
    sourceTier,
    reliabilityProfile,
    incidentTrack,
    laneReason: laneReasonFor(source, incidentTrack),
    queueReason,
    queueBucket,
    time: displayWhen,
    lat: coords.lat,
    lng: coords.lng,
    major: source.lane === 'incidents' && incidentTrack === 'live' && ['critical', 'high'].includes(severity),
    publishedAt: publishedIso,
    keywordHits,
    terrorismHits,
    eventType,
    geoPrecision: inferGeoPrecision(location),
    isOfficial: !!source.isTrustedOfficial,
    priorityScore,
    freshnessBucket: freshnessBucket(source, publishedIso),
    freshUntil: freshUntilFor(source, publishedIso, severity, incidentTrack),
    needsHumanReview,
    isTerrorRelevant,
    corroboratingSources: [],
    corroborationCount: 0,
    isDuplicateOf: null
  };
}

export function dedupeAndSortAlerts(items) {
  const deduped = [];
  const seen = new Map();

  for (const item of items) {
    const key = item.fusedIncidentId || `${sameStoryKey(item)}|${item.location}|${item.eventType}`;
    if (seen.has(key)) {
      const existingIndex = seen.get(key);
      const incumbent = deduped[existingIndex];
      const itemTier = sourceTierRankValue(item.sourceTier);
      const incumbentTier = sourceTierRankValue(incumbent.sourceTier);
      const itemTrack = incidentTrackRankValue(item.incidentTrack);
      const incumbentTrack = incidentTrackRankValue(incumbent.incidentTrack);

      if (
        itemTrack > incumbentTrack ||
        (itemTrack === incumbentTrack && itemTier > incumbentTier) ||
        (itemTrack === incumbentTrack && itemTier === incumbentTier && (item.priorityScore || 0) > (incumbent.priorityScore || 0))
      ) {
        item.isDuplicateOf = incumbent.fusedIncidentId || incumbent.id;
        item.fusedIncidentId = incumbent.fusedIncidentId || item.fusedIncidentId;
        item.corroboratingSources = mergeCorroboratingSources(item, incumbent);
        item.corroborationCount = item.corroboratingSources.length;
        deduped[existingIndex] = item;
        seen.set(key, existingIndex);
      } else {
        incumbent.corroboratingSources = mergeCorroboratingSources(incumbent, item);
        incumbent.corroborationCount = incumbent.corroboratingSources.length;
        incumbent.isDuplicateOf = incumbent.isDuplicateOf || item.fusedIncidentId || item.id;
      }
      continue;
    }

    seen.set(key, deduped.length);
    deduped.push(item);
  }

  deduped.sort((a, b) => {
    const timeA = parseSourceDate(a.publishedAt)?.getTime() || 0;
    const timeB = parseSourceDate(b.publishedAt)?.getTime() || 0;
    if ((b.freshnessBucket || 0) !== (a.freshnessBucket || 0)) return (b.freshnessBucket || 0) - (a.freshnessBucket || 0);
    if (incidentTrackRankValue(b.incidentTrack) !== incidentTrackRankValue(a.incidentTrack)) return incidentTrackRankValue(b.incidentTrack) - incidentTrackRankValue(a.incidentTrack);
    if ((b.priorityScore || 0) !== (a.priorityScore || 0)) return (b.priorityScore || 0) - (a.priorityScore || 0);
    if (sourceTierRankValue(b.sourceTier) !== sourceTierRankValue(a.sourceTier)) return sourceTierRankValue(b.sourceTier) - sourceTierRankValue(a.sourceTier);
    if ((b.confidenceScore || 0) !== (a.confidenceScore || 0)) return (b.confidenceScore || 0) - (a.confidenceScore || 0);
    if (severityRank[b.severity] !== severityRank[a.severity]) return severityRank[b.severity] - severityRank[a.severity];
    if (timeB !== timeA) return timeB - timeA;
    return 0;
  });

  return deduped;
}

export function retentionScoreFor(alert) {
  const ageHours = ageHoursForAlert(alert);
  let score = Number.isFinite(alert?.priorityScore) ? alert.priorityScore : 0;

  if (alert?.lane === 'incidents') {
    if (alert?.incidentTrack === 'live') {
      score += 10;
      if (ageHours <= 24) score += 5;
      else if (ageHours <= 72) score += 3;
      else if (ageHours <= 168) score += 1.5;
      else score -= 2;
    } else if (alert?.incidentTrack === 'case') {
      score += 2;
      if (ageHours <= 72) score += 1;
      else if (ageHours > 336) score -= 2;
    }

    if (alert?.major) score += 2;
    if (alert?.isOfficial) score += 2;
    return Number(score.toFixed(2));
  }

  const profile = clean(alert?.reliabilityProfile);
  const isFreshOfficialCorroboration =
    !!alert?.isOfficial &&
    ['corroboration', 'context'].includes(clean(alert?.sourceTier)) &&
    Number.isFinite(ageHours) &&
    ageHours <= 96;

  if (isFreshOfficialCorroboration) {
    if (ageHours <= 24) score += 4.5;
    else if (ageHours <= 48) score += 3;
    else score += 1.5;
  }

  if (!Number.isFinite(ageHours)) {
    score -= 4;
    return Number(score.toFixed(2));
  }

  const isWeakContext = ['general_media', 'specialist_research', 'tabloid'].includes(profile);
  const isMidContext = ['major_media', 'official_context'].includes(profile);

  if (isWeakContext) {
    if (ageHours > 336) score -= 12;
    else if (ageHours > 168) score -= 8;
    else if (ageHours > 72) score -= 5;
  } else if (isMidContext) {
    if (ageHours > 336) score -= 7;
    else if (ageHours > 168) score -= 4.5;
    else if (ageHours > 96) score -= 2;
  } else if (ageHours > 336) {
    score -= 4;
  }

  return Number(score.toFixed(2));
}

export function selectStoredAlerts(items, maxStored) {
  if (!Array.isArray(items) || maxStored <= 0) return [];
  if (items.length <= maxStored) return items.slice();

  const ranked = items
    .map((item, index) => ({
      index,
      item,
      retentionScore: retentionScoreFor(item)
    }))
    .sort((left, right) => {
      if (right.retentionScore !== left.retentionScore) return right.retentionScore - left.retentionScore;
      return left.index - right.index;
    });

  const retainedIndices = new Set();
  const fusedCounts = new Map();
  const sourceUrlCounts = new Map();

  function fusedKeyFor(item) {
    return clean(item?.fusedIncidentId || item?.sourceUrl || item?.id || '');
  }

  function sourceKeyFor(item) {
    return clean(item?.sourceUrl || item?.id || '');
  }

  function canTake(entry, maxPerFused, maxPerSource) {
    const fusedKey = fusedKeyFor(entry.item);
    const sourceKey = sourceKeyFor(entry.item);
    const fusedCount = fusedKey ? (fusedCounts.get(fusedKey) || 0) : 0;
    const sourceCount = sourceKey ? (sourceUrlCounts.get(sourceKey) || 0) : 0;
    if (fusedKey && fusedCount >= maxPerFused) return false;
    if (sourceKey && sourceCount >= maxPerSource) return false;
    return true;
  }

  function take(entry) {
    const fusedKey = fusedKeyFor(entry.item);
    const sourceKey = sourceKeyFor(entry.item);
    retainedIndices.add(entry.index);
    if (fusedKey) fusedCounts.set(fusedKey, (fusedCounts.get(fusedKey) || 0) + 1);
    if (sourceKey) sourceUrlCounts.set(sourceKey, (sourceUrlCounts.get(sourceKey) || 0) + 1);
  }

  for (const entry of ranked) {
    if (retainedIndices.size >= maxStored) break;
    if (canTake(entry, 1, 1)) take(entry);
  }

  for (const entry of ranked) {
    if (retainedIndices.size >= maxStored) break;
    if (retainedIndices.has(entry.index)) continue;
    if (canTake(entry, 2, 1)) take(entry);
  }

  for (const entry of ranked) {
    if (retainedIndices.size >= maxStored) break;
    if (retainedIndices.has(entry.index)) continue;
    if (canTake(entry, 2, 2)) take(entry);
  }

  return items.filter((_, index) => retainedIndices.has(index));
}
