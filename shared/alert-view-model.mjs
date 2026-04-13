import {
  clean,
  plainText,
  normaliseSourceTier,
  normaliseReliabilityProfile,
  normaliseIncidentTrack
} from './taxonomy.mjs';
import { laneLabels } from './ui-data.mjs';
import { formatAgeFromDate } from './time-format.mjs';
import { DEFAULT_LANE, LANE_KEYS, STATUS_LABELS } from './ui-constants.mjs';

export function formatAgeFrom(dateLike) {
  return formatAgeFromDate(dateLike);
}

export function severityLabel(severity) {
  return clean(severity).charAt(0).toUpperCase() + clean(severity).slice(1);
}

export function regionLabel(region) {
  if (region === 'london') return 'London';
  if (region === 'uk') return 'UK';
  if (region === 'eu' || region === 'europe') return 'Europe';
  if (region === 'us') return 'US';
  if (region === 'international') return 'International';
  return String(region || '').toUpperCase() || 'Unknown';
}

export function isLondonAlert(alert) {
  const lat = Number(alert?.lat);
  const lng = Number(alert?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    if (lat >= 51.28 && lat <= 51.70 && lng >= -0.52 && lng <= 0.24) {
      return true;
    }
  }

  const haystack = `${clean(alert?.location)} ${clean(alert?.title)} ${clean(alert?.summary)} ${clean(alert?.sourceExtract)}`.toLowerCase();
  return [
    'london',
    'westminster',
    "king's cross",
    'kings cross',
    'st pancras',
    'heathrow',
    'downing street',
    'scotland yard',
    'whitehall',
    'east london',
    'golders green'
  ].some((term) => haystack.includes(term));
}

export function inferGeoPoint(alert, geoLookup = []) {
  const haystack = `${clean(alert.location)} ${clean(alert.title)} ${clean(alert.summary)}`.toLowerCase();
  const match = geoLookup.find((entry) => entry.terms.some((term) => haystack.includes(term)));
  if (match) return { lat: match.lat, lng: match.lng };
  return null;
}

export function keywordMatches(alert) {
  return Array.isArray(alert.keywordHits) ? alert.keywordHits.filter(Boolean) : [];
}

export function terrorismMatches(alert) {
  return Array.isArray(alert.terrorismHits) ? alert.terrorismHits.filter(Boolean) : [];
}

export function isTerrorRelevant(alert) {
  if (typeof alert.isTerrorRelevant === 'boolean') return alert.isTerrorRelevant;
  return alert.lane === 'incidents' ? false : true;
}

function looksGenericSummary(text) {
  const summary = clean(text).toLowerCase();
  return !summary ||
    summary.includes('matched the incident watch logic') ||
    summary.includes('the immediate value is source validation') ||
    summary.includes('should be read as') ||
    summary.includes('contextual monitoring item') ||
    summary.includes('corroborating or adjacent reporting') ||
    summary.includes('sanctions-related update') ||
    summary.includes('oversight or review update') ||
    summary.includes('prevention or radicalisation update') ||
    summary.includes('border or screening update');
}

function articleBodyBits(alert) {
  const base = clean(alert.sourceExtract || (alert.summary && alert.summary !== alert.title ? alert.summary : ''));
  return base
    .split(/(?<=[.!?])\s+|\s{2,}/)
    .map((part) => clean(part))
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .slice(0, 14);
}

function buildIncidentSummary(alert) {
  const bodyBits = articleBodyBits(alert);
  if (bodyBits.length) {
    return bodyBits.join(' ');
  }
  return alert.title;
}

function extractPeopleInvolved(alert) {
  if (!Array.isArray(alert.peopleInvolved) || !alert.peopleInvolved.length) {
    return [];
  }

  const confidenceScore = Number(alert.confidenceScore || 0);
  const reliabilityProfile = resolvedReliabilityProfile(alert);
  if (alert.needsHumanReview) return [];
  if (!Number.isFinite(confidenceScore) || confidenceScore <= 0) return [];

  const strongOfficial =
    ['official_ct', 'official_general'].includes(reliabilityProfile) && confidenceScore >= 0.7;
  const strongMajorMedia = reliabilityProfile === 'major_media' && confidenceScore >= 0.9;
  if (!strongOfficial && !strongMajorMedia) return [];

  return alert.peopleInvolved
    .map((entry) => clean(entry))
    .filter(Boolean)
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .slice(0, 6);
}

export function effectiveSummary(alert) {
  return looksGenericSummary(alert.aiSummary) ? buildIncidentSummary(alert) : alert.aiSummary;
}

function alertPublishedTime(alert) {
  const raw = clean(alert.publishedAt || alert.happenedWhen || alert.time);
  if (!raw) return 0;
  const stamp = new Date(raw);
  return Number.isNaN(stamp.getTime()) ? 0 : stamp.getTime();
}

function alertAgeHours(alert) {
  const publishedTime = alertPublishedTime(alert);
  if (!publishedTime) return Infinity;
  return Math.max(0, (Date.now() - publishedTime) / 3600000);
}

function freshnessBucketForAlert(alert) {
  if (Number.isFinite(alert.freshnessBucket)) return alert.freshnessBucket;
  const ageHours = alertAgeHours(alert);
  if (alert.lane === 'incidents') {
    if (ageHours <= 2) return 5;
    if (ageHours <= 6) return 4;
    if (ageHours <= 12) return 3;
    if (ageHours <= 24) return 2;
    if (ageHours <= 72) return 1;
    return 0;
  }
  if (ageHours <= 24) return 3;
  if (ageHours <= 72) return 2;
  if (ageHours <= 168) return 1;
  return 0;
}

function sourceTierRank(alert) {
  const tier = normaliseSourceTier(alert.sourceTier);
  if (tier === 'trigger') return 4;
  if (tier === 'corroboration') return 3;
  if (tier === 'context') return 2;
  if (tier === 'research') return 1;
  return 0;
}

export function resolvedIncidentTrack(alert) {
  return normaliseIncidentTrack(alert.incidentTrack);
}

export function resolvedReliabilityProfile(alert) {
  return normaliseReliabilityProfile(alert.reliabilityProfile);
}

function sourceEvidenceCount(alert) {
  const corroborating = Array.isArray(alert.corroboratingSources) ? alert.corroboratingSources.length : 0;
  return 1 + corroborating;
}

export function trustSignal(alert) {
  const score = Number(alert.confidenceScore || 0);
  const hasScore = Number.isFinite(score) && score > 0;
  const profile = resolvedReliabilityProfile(alert);
  const corroborating = Array.isArray(alert.corroboratingSources) ? alert.corroboratingSources : [];
  const officialCorroboration = corroborating.some((entry) => clean(normaliseReliabilityProfile(entry?.reliabilityProfile)).startsWith('official_'));
  const officialSignal = clean(profile).startsWith('official_') || !!alert.isOfficial || officialCorroboration;

  if (!hasScore) return { key: 'unverified', label: 'UNVERIFIED' };
  if (officialSignal) return { key: 'confirmed', label: 'CONFIRMED' };
  if (sourceEvidenceCount(alert) >= 2) return { key: 'multi-source', label: 'MULTI-SOURCE' };
  return { key: 'single-source', label: 'SINGLE-SOURCE' };
}

export function confidenceScoreLabel(alert) {
  const score = Number(alert.confidenceScore || 0);
  if (!Number.isFinite(score) || score <= 0) return 'CONFIDENCE: UNAVAILABLE';
  const clamped = Math.max(0, Math.min(1, score));
  const points = Math.round(clamped * 100);
  const band = points >= 90 ? 'VERY HIGH' : points >= 80 ? 'HIGH' : points >= 65 ? 'MEDIUM' : 'LOW';
  return `CONFIDENCE: ${points}/100 (${band})`;
}

function incidentScore(alert) {
  if (Number.isFinite(alert.priorityScore)) return alert.priorityScore;
  let score = 0;
  if (alert.lane === 'incidents') score += 3;
  if (alert.severity === 'critical') score += 3;
  if (alert.severity === 'high') score += 2;
  if (alert.major) score += 2;
  if (resolvedIncidentTrack(alert) === 'live') score += 2;
  else if (resolvedIncidentTrack(alert) === 'case') score -= 1;
  score += sourceTierRank(alert);
  const profile = resolvedReliabilityProfile(alert);
  if (profile === 'official_ct') score += 3;
  else if (profile === 'official_general') score += 2.5;
  else if (profile === 'major_media') score += 1.5;
  else if (profile === 'tabloid') score -= 1;
  if (typeof alert.isTerrorRelevant === 'boolean' && !alert.isTerrorRelevant) score -= 4;
  return score;
}

function incidentTrackRank(alert) {
  const track = resolvedIncidentTrack(alert);
  if (track === 'live') return 2;
  if (track === 'case') return 1;
  return 0;
}

export function isLiveIncidentCandidate(alert) {
  if (alert.lane !== 'incidents') return false;
  if (!isTerrorRelevant(alert)) return false;
  const tier = normaliseSourceTier(alert.sourceTier);
  if (tier === 'context' || tier === 'research') return false;
  const incidentTrack = resolvedIncidentTrack(alert);
  if (incidentTrack && incidentTrack !== 'live') return false;
  if (alertAgeHours(alert) > 72) return false;
  if (alert.freshUntil) {
    const freshUntil = new Date(alert.freshUntil);
    if (!Number.isNaN(freshUntil.getTime()) && freshUntil.getTime() < Date.now()) return false;
  }
  if (alert.eventType && ['sanctions_update', 'oversight_update', 'border_security_update', 'prevention_update', 'context_update'].includes(alert.eventType)) return false;
  if (alert.needsHumanReview && !alert.isOfficial && (alert.confidenceScore || 0) < 0.75) return false;
  return incidentScore(alert) >= 6;
}

export function quarantineReason(alert) {
  if (clean(alert.queueReason)) return clean(alert.queueReason);
  if (alert.needsHumanReview) return 'Needs human review';
  if (typeof alert.isTerrorRelevant === 'boolean' && !alert.isTerrorRelevant) return 'Incident kept out of trigger lane';
  if (!alert.isOfficial && Number(alert.confidenceScore || 0) > 0 && Number(alert.confidenceScore || 0) < 0.8) return 'Secondary source with weak confidence';
  if (normaliseSourceTier(alert.sourceTier) !== 'trigger' && alert.lane === 'incidents') return 'Non-trigger source awaiting corroboration';
  return 'Borderline incident relevance';
}

export function isQuarantineCandidate(alert) {
  if (alert.lane !== 'incidents') return false;
  if (isLiveIncidentCandidate(alert)) return false;
  const confidence = Number(alert.confidenceScore || 0);
  const tier = normaliseSourceTier(alert.sourceTier);
  const notClearlyTerror = typeof alert.isTerrorRelevant === 'boolean' ? !alert.isTerrorRelevant : false;
  const weakSecondarySignal = !alert.isOfficial && ((confidence > 0 && confidence < 0.8) || alert.needsHumanReview);
  const broadSourceSignal = tier !== 'trigger';
  const thinTerrorCase = Array.isArray(alert.terrorismHits) && alert.terrorismHits.length > 0 && incidentScore(alert) < 6;
  return notClearlyTerror || weakSecondarySignal || broadSourceSignal || thinTerrorCase;
}

export function sortAlertsByFreshness(alertList) {
  const ranking = { critical: 4, high: 3, elevated: 2, moderate: 1 };
  return [...alertList].sort((a, b) => {
    const freshnessGap = freshnessBucketForAlert(b) - freshnessBucketForAlert(a);
    if (freshnessGap !== 0) return freshnessGap;
    const trackGap = incidentTrackRank(b) - incidentTrackRank(a);
    if (trackGap !== 0) return trackGap;
    const tierGap = sourceTierRank(b) - sourceTierRank(a);
    if (tierGap !== 0) return tierGap;
    const londonGap = Number(isLondonAlert(b)) - Number(isLondonAlert(a));
    if (londonGap !== 0) return londonGap;
    const timeGap = alertPublishedTime(b) - alertPublishedTime(a);
    if (timeGap !== 0) return timeGap;
    const scoreGap = incidentScore(b) - incidentScore(a);
    if (scoreGap !== 0) return scoreGap;
    if (!!a.major !== !!b.major) return a.major ? -1 : 1;
    return ranking[b.severity] - ranking[a.severity];
  });
}

export function contextLabel(alert) {
  if (alert.lane === 'incidents' && resolvedIncidentTrack(alert) === 'case') return 'Case / Prosecution';
  if (alert.lane === 'context') return 'Context / Corroboration';
  return laneLabels[alert.lane] || alert.lane;
}

function reliabilityLabel(profile) {
  const labels = {
    official_ct: 'Official CT',
    official_general: 'Official',
    official_context: 'Official context',
    major_media: 'Major media',
    general_media: 'General media',
    tabloid: 'Tabloid',
    specialist_research: 'Specialist research'
  };
  return labels[profile] || 'Unknown';
}

function clockDisplay(dateLike) {
  if (!dateLike) return 'unconfirmed';
  const stamp = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(stamp.getTime())) return 'unconfirmed';
  const diffMinutes = Math.max(0, Math.round((Date.now() - stamp.getTime()) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h ago` : `${days}d ago`;
}

function sceneClockStamp(dateLike) {
  if (!dateLike) return 'Timestamp unconfirmed';
  const stamp = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(stamp.getTime())) return 'Timestamp unconfirmed';
  return stamp.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function isOfficialProfile(profile) {
  return clean(profile).startsWith('official_');
}

function sourceStack(alert) {
  const corroborating = Array.isArray(alert.corroboratingSources) ? alert.corroboratingSources : [];
  return [
    {
      source: alert.source,
      sourceUrl: alert.sourceUrl,
      publishedAt: alert.publishedAt,
      reliabilityProfile: resolvedReliabilityProfile(alert),
      sourceTier: normaliseSourceTier(alert.sourceTier),
      isPrimary: true
    },
    ...corroborating.map((entry) => ({
      ...entry,
      isPrimary: false
    }))
  ].filter((entry) => clean(entry.publishedAt));
}

function buildConfidenceLadder(alert) {
  const stack = sourceStack(alert);
  const officialEntries = stack.filter((entry) => isOfficialProfile(entry.reliabilityProfile));
  const officialCtEntries = officialEntries.filter((entry) => clean(entry.reliabilityProfile) === 'official_ct');
  const corroboratingEntries = stack.filter((entry) => !entry.isPrimary);

  const score = Math.max(
    officialCtEntries.length ? 4 : 0,
    officialEntries.length >= 2 ? 3 : 0,
    officialEntries.length >= 1 || corroboratingEntries.length >= 2 ? 2 : 0,
    stack.length ? 1 : 0
  );

  const steps = [
    {
      label: 'Initial signal',
      active: score >= 1,
      detail: stack.length ? `${stack[0].source || 'Primary source'} opened the incident.` : 'No incident signal yet.'
    },
    {
      label: 'Corroborated',
      active: score >= 2,
      detail: corroboratingEntries.length
        ? `${corroboratingEntries.length} corroborating source${corroboratingEntries.length === 1 ? '' : 's'} attached.`
        : 'Waiting for a second source or official corroboration.'
    },
    {
      label: 'Official confirmation',
      active: score >= 3,
      detail: officialEntries.length
        ? `${officialEntries.length} official source${officialEntries.length === 1 ? '' : 's'} in the source stack.`
        : 'No official source has landed yet.'
    },
    {
      label: 'CT-grade confidence',
      active: score >= 4,
      detail: officialCtEntries.length
        ? `${officialCtEntries.length} counter-terror source${officialCtEntries.length === 1 ? '' : 's'} attached.`
        : 'No official CT source attached yet.'
    }
  ];

  return { score, steps };
}

export function buildSceneClock(alert) {
  const stack = sourceStack(alert);
  const timed = stack
    .map((entry) => ({ ...entry, timeMs: new Date(entry.publishedAt).getTime() }))
    .filter((entry) => Number.isFinite(entry.timeMs));
  const firstReport = timed.length ? timed.reduce((min, entry) => (entry.timeMs < min.timeMs ? entry : min)) : null;
  const lastOfficial = timed.filter((entry) => isOfficialProfile(entry.reliabilityProfile)).sort((a, b) => b.timeMs - a.timeMs)[0] || null;
  const lastCorroboration = timed.filter((entry) => !entry.isPrimary).sort((a, b) => b.timeMs - a.timeMs)[0] || null;
  return { firstReport, lastOfficial, lastCorroboration };
}

export function renderConfidenceLadder(alert) {
  const ladder = buildConfidenceLadder(alert);
  return `<div class="confidence-ladder">
    <div class="confidence-ladder-bars" aria-label="Confidence ladder level ${ladder.score} of 4">
      ${ladder.steps.map((step, index) => `
        <span class="confidence-rung${step.active ? ' active' : ''}" aria-hidden="true">${index + 1}</span>`).join('')}
    </div>
    <div class="confidence-ladder-steps">
      ${ladder.steps.map((step, index) => `
        <article class="confidence-step${step.active ? ' active' : ''}">
          <strong>${index + 1}. ${step.label}</strong>
          <p>${step.detail}</p>
        </article>`).join('')}
    </div>
  </div>`;
}

export function renderSceneClock(alert) {
  const clock = buildSceneClock(alert);
  const items = [
    { label: 'Since first report', entry: clock.firstReport, fallback: 'No report timestamp confirmed yet.' }
  ];
  return `<div class="scene-clock-grid">${items.map(({ label, entry, fallback }) => `
    <article class="scene-clock-item">
      <strong>${label}</strong>
      <p>${entry ? `${clockDisplay(entry.publishedAt)} | ${sceneClockStamp(entry.publishedAt)}${entry.source ? ` | ${entry.source}` : ''}` : fallback}</p>
    </article>`).join('')}</div>`;
}

export function buildAuditBlock(alert) {
  const terrorTerms = terrorismMatches(alert);
  const age = alert.publishedAt ? formatAgeFrom(alert.publishedAt) : 'age unknown';
  const trust = trustSignal(alert);
  return [
    `TRUST SIGNAL: ${trust.label}`,
    confidenceScoreLabel(alert),
    `SOURCE TIER: ${normaliseSourceTier(alert.sourceTier) || 'unclassified'}`,
    `RELIABILITY PROFILE: ${reliabilityLabel(resolvedReliabilityProfile(alert))}`,
    `AGE: ${age}`,
    `LANE REASON: ${clean(alert.laneReason) || contextLabel(alert)}`,
    `QUEUE REASON: ${clean(alert.queueReason) || quarantineReason(alert)}`,
    terrorTerms.length ? `TERROR TERMS HIT: ${terrorTerms.join(', ')}` : 'TERROR TERMS HIT: none',
    `CORROBORATION COUNT: ${Number(alert.corroborationCount || 0)}`
  ].join('\n');
}

export function renderCorroboratingSources(alert) {
  const sources = Array.isArray(alert.corroboratingSources) ? alert.corroboratingSources : [];
  if (!sources.length) {
    return '';
  }
  return `<div class="corroboration-list">${sources.map((entry) => `
    <article class="corroboration-item">
      <a href="${entry.sourceUrl}" target="_blank" rel="noreferrer">${entry.source}</a>
      <p>${reliabilityLabel(normaliseReliabilityProfile(entry.reliabilityProfile))} | ${clean(entry.sourceTier) || 'source tier unknown'} | ${clean(entry.publishedAt) ? formatAgeFrom(entry.publishedAt) : 'age unknown'}</p>
    </article>`).join('')}</div>`;
}

export function buildBriefing(alert, summaryText) {
  const metaBits = [clean(alert.location), clean(alert.happenedWhen || alert.time)].filter(Boolean);
  const lead = metaBits.length ? `${alert.title} (${metaBits.join(', ')})` : alert.title;
  const trimmedSummary = clean(summaryText);
  const leadLower = clean(alert.title).toLowerCase();
  const summaryLower = trimmedSummary.toLowerCase();
  const sentences = [];

  sentences.push(lead.endsWith('.') ? lead : `${lead}.`);

  if (trimmedSummary && summaryLower !== leadLower) {
    sentences.push(trimmedSummary.endsWith('.') ? trimmedSummary : `${trimmedSummary}.`);
  }

  return sentences.join(' ');
}

const UNCONFIRMED_SOURCE_DATE = 'source date unconfirmed';
const ALLOWED_REGIONS = new Set(['uk', 'london', 'eu', 'europe', 'us', 'international']);

function isUnconfirmedSourceDate(value) {
  return clean(value).toLowerCase() === UNCONFIRMED_SOURCE_DATE;
}

function fallbackAbsoluteTime(publishedAt) {
  const stamp = new Date(clean(publishedAt));
  if (Number.isNaN(stamp.getTime())) return '';
  const day = String(stamp.getUTCDate());
  const month = stamp.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const year = stamp.getUTCFullYear();
  const hours = String(stamp.getUTCHours()).padStart(2, '0');
  const minutes = String(stamp.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

export function normaliseAlert(alert, index, geoLookup = []) {
  const geoPoint = inferGeoPoint(alert, geoLookup);
  const lane = LANE_KEYS.includes(alert.lane) ? alert.lane : DEFAULT_LANE;
  const sourceTier = normaliseSourceTier(alert.sourceTier);
  const reliabilityProfile = normaliseReliabilityProfile(alert.reliabilityProfile);
  const incidentTrack = normaliseIncidentTrack(alert.incidentTrack);
  const happenedWhenRaw = plainText(alert.happenedWhen);
  const timeRaw = plainText(alert.time);
  const happenedWhen = isUnconfirmedSourceDate(happenedWhenRaw) ? '' : happenedWhenRaw;
  const time = isUnconfirmedSourceDate(timeRaw) ? '' : timeRaw;
  const rawRegion = clean(alert.region).toLowerCase();
  if (rawRegion && !ALLOWED_REGIONS.has(rawRegion)) {
    console.warn(`Unknown alert region "${rawRegion}" normalized to "europe".`);
  }
  const region = ALLOWED_REGIONS.has(rawRegion) ? rawRegion : 'europe';
  return {
    id: clean(alert.id) || `live-${index}`,
    title: plainText(alert.title) || 'Untitled source item',
    location: plainText(alert.location) || (alert.region === 'uk' ? 'United Kingdom' : 'Europe'),
    region,
    lane,
    severity: ['critical', 'high', 'elevated', 'moderate'].includes(alert.severity) ? alert.severity : 'moderate',
    status: plainText(alert.status) || STATUS_LABELS.update,
    actor: plainText(alert.actor) || plainText(alert.source),
    subject: plainText(alert.subject) || plainText(alert.source),
    happenedWhen: happenedWhen || time,
    confidence: plainText(alert.confidence) || STATUS_LABELS.sourceUpdate,
    summary: plainText(alert.summary) || plainText(alert.title),
    aiSummary: plainText(alert.aiSummary) || plainText(alert.summary) || plainText(alert.title),
    sourceExtract: plainText(alert.sourceExtract),
    peopleInvolved: Array.isArray(alert.peopleInvolved) ? alert.peopleInvolved.map(plainText).filter(Boolean) : [],
    source: plainText(alert.source) || 'Unknown source',
    sourceUrl: clean(alert.sourceUrl) || '#',
    time: time || happenedWhen || fallbackAbsoluteTime(alert.publishedAt) || 'unknown',
    lat: Number.isFinite(alert.lat) ? alert.lat : (geoPoint?.lat ?? (alert.region === 'uk' ? 54.5 : 54)),
    lng: Number.isFinite(alert.lng) ? alert.lng : (geoPoint?.lng ?? (alert.region === 'uk' ? -2.5 : 15)),
    major: !!alert.major,
    eventType: clean(alert.eventType),
    geoPrecision: clean(alert.geoPrecision),
    isOfficial: !!alert.isOfficial,
    sourceTier,
    reliabilityProfile,
    incidentTrack,
    fusedIncidentId: clean(alert.fusedIncidentId),
    isDuplicateOf: clean(alert.isDuplicateOf),
    freshUntil: clean(alert.freshUntil),
    needsHumanReview: !!alert.needsHumanReview,
    priorityScore: Number.isFinite(alert.priorityScore) ? alert.priorityScore : null,
    confidenceScore: Number.isFinite(alert.confidenceScore) ? alert.confidenceScore : null,
    publishedAt: clean(alert.publishedAt),
    freshnessBucket: Number.isFinite(alert.freshnessBucket) ? alert.freshnessBucket : null,
    keywordHits: Array.isArray(alert.keywordHits) ? alert.keywordHits.filter(Boolean) : [],
    terrorismHits: Array.isArray(alert.terrorismHits) ? alert.terrorismHits.filter(Boolean) : [],
    isTerrorRelevant: typeof alert.isTerrorRelevant === 'boolean' ? alert.isTerrorRelevant : null,
    laneReason: plainText(alert.laneReason),
    queueReason: plainText(alert.queueReason),
    queueBucket: clean(alert.queueBucket).toLowerCase(),
    corroboratingSources: Array.isArray(alert.corroboratingSources) ? alert.corroboratingSources.filter(Boolean).map((entry) => ({
      fusedIncidentId: clean(entry.fusedIncidentId),
      source: plainText(entry.source),
      sourceUrl: clean(entry.sourceUrl),
      sourceTier: normaliseSourceTier(entry.sourceTier),
      reliabilityProfile: normaliseReliabilityProfile(entry.reliabilityProfile),
      publishedAt: clean(entry.publishedAt),
      confidence: plainText(entry.confidence)
    })) : [],
    corroborationCount: Number.isFinite(alert.corroborationCount) ? alert.corroborationCount : 0
  };
}
