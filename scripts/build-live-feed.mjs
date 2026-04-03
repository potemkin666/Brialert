import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
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
  inferGeoPrecision,
  sourceLooksEnglish
} from '../shared/taxonomy.mjs';
import {
  sameStoryKey,
  fusedIncidentIdFor,
  mergeCorroboratingSources
} from '../shared/fusion.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'data', 'sources.json');
const geoLookupPath = path.join(repoRoot, 'data', 'geo-lookup.json');
const outputPath = path.join(repoRoot, 'live-alerts.json');
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  processEntities: false,
  htmlEntities: false,
  trimValues: true
});
const now = new Date();
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_SOURCE_ERRORS_TO_REPORT = 25;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const HARD_SKIP_SOURCE_IDS = new Set([
  'globalsecurity-terror-news',
  'un-ctitf-news',
  'statewatch-europol',
  'besa-terrorism',
  'icct-main',
  'jamestown-militant-leadership-monitor',
  'jamestown-terrorism-monitor',
  'washington-institute-countering-terrorism',
  'cps-terrorism-news',
  'cps-terrorism-search',
  'kallxo-english-home'
]);
const severityRank = { critical: 4, high: 3, elevated: 2, moderate: 1 };

function stripBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF/, '') : text;
}

async function readJsonFile(jsonPath) {
  const raw = stripBom(await fs.readFile(jsonPath, 'utf8'));
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON at ${path.relative(repoRoot, jsonPath)}: ${message}`);
  }
}

let geoLookup = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const titleCase = (value) => clean(value).replace(/\b\w/g, (m) => m.toUpperCase());
const SOURCE_TIMEZONE = 'Europe/London';

function arrayify(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function absoluteUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return base;
  }
}

function parseSourceDate(rawDate) {
  if (!rawDate) return null;
  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normaliseLanguageTag(value) {
  return clean(value).toLowerCase().replace('_', '-');
}

function isEnglishLanguage(value) {
  const lang = normaliseLanguageTag(value);
  return !lang || lang === 'en' || lang.startsWith('en-');
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

function inferConfidence(source, reliabilityProfile) {
  if (reliabilityProfile === 'official_ct') return 'Verified CT source update';
  if (reliabilityProfile === 'official_general' || reliabilityProfile === 'official_context') return 'Verified official source update';
  if (reliabilityProfile === 'major_media') return 'Major media source signal';
  if (reliabilityProfile === 'specialist_research') return 'Research or analytical source';
  if (reliabilityProfile === 'tabloid') return 'Low-confidence media signal';
  return 'Secondary source signal';
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normaliseGeoText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[_/]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function geoTermRegex(term) {
  const escaped = escapeRegex(normaliseGeoText(term));
  return new RegExp(`(^|\\W)${escaped}(?=$|\\W)`, 'i');
}

function scoreGeoEntryMatch(entry, haystack) {
  let best = 0;

  for (const rawTerm of entry.terms || []) {
    const term = normaliseGeoText(rawTerm);
    if (!term) continue;

    const regex = geoTermRegex(term);
    if (!regex.test(haystack)) continue;

    let score = term.length;

    if ((entry.precision || '') === 'high') score += 40;
    else if ((entry.precision || '') === 'medium') score += 20;
    else if ((entry.precision || '') === 'low') score += 5;

    if ((entry.kind || '') === 'neighbourhood') score += 18;
    else if ((entry.kind || '') === 'borough') score += 16;
    else if ((entry.kind || '') === 'city') score += 14;
    else if ((entry.kind || '') === 'town') score += 12;
    else if ((entry.kind || '') === 'airport_area') score += 11;
    else if ((entry.kind || '') === 'county' || (entry.kind || '') === 'region' || (entry.kind || '') === 'state') score += 8;
    else if ((entry.kind || '') === 'country') score += 3;
    else if ((entry.kind || '') === 'continent') score += 1;

    best = Math.max(best, score);
  }

  return best;
}

function fallbackGeoEntryFor(region) {
  return geoLookup.find((entry) =>
    region === 'uk'
      ? (entry.terms || []).includes('united kingdom')
      : (entry.terms || []).includes('europe')
  ) || null;
}

function bestGeoEntryFor(text, region) {
  const haystack = normaliseGeoText(text);
  if (!haystack) return fallbackGeoEntryFor(region);

  const scored = geoLookup
    .map((entry) => ({ entry, score: scoreGeoEntryMatch(entry, haystack) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length) return scored[0].entry;

  return fallbackGeoEntryFor(region);
}

function inferLocation(source, title, summary = '') {
  const text = `${title || ''} ${summary || ''}`;
  const match = bestGeoEntryFor(text, source.region);
  if (match?.label) return match.label;
  return source.region === 'uk' ? 'United Kingdom' : 'Europe';
}

function summariseTextBlock(text, maxParts = 8) {
  return clean(text)
    .split(/(?<=[.!?])\s+|\s{2,}/)
    .map((part) => clean(part))
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .slice(0, maxParts);
}

function extractPeopleFromText(text) {
  const sourceText = clean(text);
  if (!sourceText) return [];

  const blockedNames = new Set([
    'The Guardian', 'The Telegraph', 'Daily Mail', 'The Sun', 'Reuters', 'Europol', 'Eurojust',
    'Counter Terrorism Policing', 'Crown Prosecution Service', 'Bank Of America',
    'United Kingdom', 'Europe', 'Middle East', 'Paris', 'Leeds', 'France', 'Iran', 'Israel', 'Lebanon'
  ]);
  const rolePatterns = [
    { role: 'Official', regex: /\b(?:Mr|Mrs|Ms|Dr|Sir|Dame)\s+([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){0,2})\b/g },
    { role: 'Official', regex: /\b(?:Prime Minister|Security Minister|Ambassador|Commissioner|Prosecutor|Judge|Chief Constable|Commander|Minister|President)\s+([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){0,2})\b/g },
    { role: 'Suspect', regex: /\b([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){1,2}),?\s+(?:was|is)\s+(?:charged|accused|arrested|jailed|sentenced)\b/g },
    { role: 'Victim', regex: /\b([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){1,2}),?\s+(?:who\s+)?(?:was|were)\s+(?:killed|injured|wounded|targeted)\b/g },
    { role: 'Witness', regex: /\b([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){1,2})\s+(?:said|told|described|reported)\b/g }
  ];

  const sentences = sourceText
    .split(/(?<=[.!?])\s+/)
    .map((part) => clean(part))
    .filter(Boolean);

  const results = [];
  const seen = new Set();

  for (const sentence of sentences) {
    for (const { role, regex } of rolePatterns) {
      const matches = sentence.matchAll(regex);
      for (const match of matches) {
        const name = clean(match[1]);
        if (!name || seen.has(name) || blockedNames.has(name)) continue;
        if (name.split(' ').length < 2) continue;
        seen.add(name);
        results.push(`${name}: ${role}. ${sentence}`);
        if (results.length >= 6) return results;
      }
    }
  }

  return results;
}

function shouldKeepPeopleInvolved(reliabilityProfile, confidenceScore, needsHumanReview, peopleInvolved) {
  if (!Array.isArray(peopleInvolved) || !peopleInvolved.length) return false;
  if (needsHumanReview) return false;
  if (!Number.isFinite(confidenceScore) || confidenceScore <= 0) return false;

  if (['official_ct', 'official_general'].includes(reliabilityProfile)) {
    return confidenceScore >= 0.7;
  }

  if (reliabilityProfile === 'major_media') {
    return confidenceScore >= 0.9;
  }

  return false;
}

function chooseArticleDetail(metaDescription, articleParagraphs) {
  if (articleParagraphs.length >= Math.max(320, metaDescription.length + 120)) return articleParagraphs;
  if (metaDescription.length >= 220) return metaDescription;
  return articleParagraphs || metaDescription;
}

function geoFor(location, title, summary, region) {
  const text = `${location || ''} ${title || ''} ${summary || ''}`;
  const match = bestGeoEntryFor(text, region);
  if (match) return { lat: match.lat, lng: match.lng };
  return region === 'uk' ? { lat: 54.5, lng: -2.5 } : { lat: 54, lng: 15 };
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
  const published = parseSourceDate(publishedIso) || now;
  const hoursByLane = {
    incidents: incidentTrack === 'live' ? (severity === 'critical' ? 18 : severity === 'high' ? 36 : 72) : 24 * 14,
    context: 24 * 7,
    sanctions: 24 * 14,
    oversight: 24 * 21,
    border: 24 * 10,
    prevention: 24 * 21
  };
  const hours = hoursByLane[source.lane] || 72;
  return new Date(published.getTime() + hours * 3600000).toISOString();
}

function priorityScoreFor(source, severity, keywordHits, publishedIso, incidentTrack, reliabilityProfile) {
  let score = severityRank[severity] || 1;
  if (source.lane === 'incidents') score += 4;
  if (incidentTrack === 'live') score += 3.5;
  if (incidentTrack === 'case') score -= 1.5;
  score += reliabilityWeight(reliabilityProfile);
  score += Math.min(keywordHits.length, 5) * 0.6;
  if (publishedIso) {
    const ageHours = Math.max(0, (now.getTime() - new Date(publishedIso).getTime()) / 3600000);
    if (source.lane === 'incidents') {
      if (incidentTrack === 'live') {
        if (ageHours <= 2) score += 6;
        else if (ageHours <= 6) score += 5;
        else if (ageHours <= 12) score += 4;
        else if (ageHours <= 24) score += 3;
        else if (ageHours <= 48) score += 1.5;
        else if (ageHours <= 72) score += 0.5;
        else if (ageHours <= 96) score -= 2;
        else if (ageHours <= 168) score -= 5;
        else score -= 9;
      } else {
        if (ageHours <= 24) score += 1.25;
        else if (ageHours <= 72) score += 0.5;
        else if (ageHours > 336) score -= 2;
      }
    } else {
      if (ageHours <= 24) score += 1.5;
      else if (ageHours <= 72) score += 0.75;
      else if (ageHours > 720) score -= 2;
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
  const ageHours = Math.max(0, (now.getTime() - new Date(publishedIso).getTime()) / 3600000);
  if (source.lane === 'incidents') {
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

function recencyOkay(source, rawDate) {
  if (!rawDate) return true;
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return true;
  const ageDays = (now.getTime() - parsed.getTime()) / 86400000;
  if (source.lane === 'incidents') return ageDays <= 7;
  if (source.lane === 'context') return ageDays <= 21;
  if (source.lane === 'border' || source.lane === 'sanctions') return ageDays <= 30;
  return ageDays <= 120;
}

function makeSummary(source, item) {
  const title = clean(item.title);
  const summary = clean(item.summary && item.summary !== item.title ? item.summary : '');
  if (source.lane === 'incidents') {
    const factualBits = summariseTextBlock(summary);
    return factualBits.length ? factualBits.join(' ') : title;
  }
  if (source.lane === 'sanctions') {
    return `${source.provider} has published a sanctions-related update. The value here is legal and entity-resolution context, including designations, aliases, listing changes, and notice-level movement.`;
  }
  if (source.lane === 'context') {
    return `${source.provider} has published corroborating or adjacent reporting. The value here is supporting detail, follow-on facts, and wider situation context rather than a primary live trigger.`;
  }
  if (source.lane === 'border') {
    return `${source.provider} has published a border or screening update. The main use is travel, document, screening, or movement risk context that may support later incident interpretation.`;
  }
  if (source.lane === 'oversight') {
    return `${source.provider} has published an oversight or review update. This is useful for legal, custody, supervision, or institutional risk context rather than immediate public warning.`;
  }
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

function queueReasonFor(source, {
  sourceTier,
  reliabilityProfile,
  incidentTrack,
  keywordHits,
  terrorismHits,
  confidenceScore,
  needsHumanReview,
  isTerrorRelevant
}) {
  if (source.lane !== 'incidents') {
    return laneReasonFor(source, incidentTrack);
  }
  if (needsHumanReview) return 'Needs human review';
  if (!isTerrorRelevant && keywordHits.length) return 'Incident wording without clear terrorism signal';
  if (!terrorismHits.length && keywordHits.length >= 2) return 'Keyword-led match from a broad source';
  if (sourceTier !== 'trigger') return 'Non-trigger source awaiting corroboration';
  if (!source.isTrustedOfficial && confidenceScore > 0 && confidenceScore < 0.8) {
    return reliabilityProfile === 'tabloid'
      ? 'Tabloid source requires corroboration'
      : 'Secondary source with weak confidence';
  }
  if (incidentTrack === 'case') return 'Case or prosecution update kept out of the live trigger lane';
  return 'Trigger-tier terrorism incident candidate';
}

async function fetchText(url, attempt = 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; BrialertFeedBot/1.0; +https://potemkin666.github.io/Brialert/)',
        'accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
        'accept-language': 'en-GB,en;q=0.9',
        'cache-control': 'no-cache'
      },
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) {
      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < 3) {
        const retryAfterHeader = Number(response.headers.get('retry-after'));
        const retryDelay = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : 1000 * Math.pow(2, attempt - 1);

        await sleep(retryDelay);
        return fetchText(url, attempt + 1);
      }

      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable =
      message.includes('fetch failed') ||
      message.includes('aborted') ||
      message.includes('AbortError') ||
      message.includes('ECONNRESET') ||
      message.includes('ETIMEDOUT');

    if (retryable && attempt < 3) {
      await sleep(1000 * Math.pow(2, attempt - 1));
      return fetchText(url, attempt + 1);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseFeedItems(source, xml) {
  const doc = parser.parse(xml);
  const rssItems = arrayify(doc?.rss?.channel?.item).map((item) => ({
    title: plainText(item.title),
    link: clean(typeof item.link === 'string' ? item.link : item.link?.href),
    summary: plainText(item.description || item['content:encoded'] || item.summary),
    published: clean(item.pubDate || item.isoDate)
  }));
  const atomItems = arrayify(doc?.feed?.entry).map((item) => ({
    title: plainText(item.title?.['#text'] || item.title),
    link: clean(item.link?.href || arrayify(item.link).find((x) => x.rel === 'alternate')?.href || ''),
    summary: plainText(item.summary?.['#text'] || item.summary || item.content?.['#text'] || item.content),
    published: clean(item.updated || item.published)
  }));
  return [...rssItems, ...atomItems].filter((item) => item.title && item.link);
}

function parseHtmlItems(source, html) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const candidates = [];
  const selectors = ['article a[href]', 'main a[href]', 'h2 a[href]', 'h3 a[href]', 'a[href]'];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      if (candidates.length >= 40) return false;
      const href = $(el).attr('href');
      const title = plainText($(el).text() || $(el).closest('article,li,section').find('h1,h2,h3').first().text());
      if (!href || !title || title.length < 18) return;
      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
      const url = absoluteUrl(href, source.endpoint);
      const key = `${title}|${url}`;
      if (seen.has(key)) return;
      seen.add(key);
      const container = $(el).closest('article,li,section,div');
      const summary = plainText(container.text()).slice(0, 420);
      const published = clean(container.find('time').attr('datetime') || container.find('time').text());
      candidates.push({ title, link: url, summary, published });
    });
    if (candidates.length >= 15) break;
  }

  return candidates.slice(0, 15);
}

function collectJsonLd(node, collected = []) {
  if (!node) return collected;
  if (Array.isArray(node)) {
    node.forEach((item) => collectJsonLd(item, collected));
    return collected;
  }
  if (typeof node === 'object') {
    collected.push(node);
    Object.values(node).forEach((value) => collectJsonLd(value, collected));
  }
  return collected;
}

function extractArticleMeta(html, url) {
  const $ = cheerio.load(html);
  const htmlLang = clean($('html').attr('lang'));
  const metaLanguage = clean(
    $('meta[http-equiv="content-language"]').attr('content') ||
    $('meta[name="language"]').attr('content') ||
    $('meta[property="og:locale"]').attr('content')
  );
  const metaDate = clean(
    $('meta[property="article:published_time"]').attr('content') ||
    $('meta[name="article:published_time"]').attr('content') ||
    $('meta[name="publish-date"]').attr('content') ||
    $('meta[name="pubdate"]').attr('content') ||
    $('meta[property="og:published_time"]').attr('content') ||
    $('time[datetime]').first().attr('datetime') ||
    $('time').first().text()
  );
  const metaDescription = plainText(
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content')
  );
  const metaTitle = plainText(
    $('meta[property="og:title"]').attr('content') ||
    $('title').first().text()
  );
  const articleParagraphs = plainText(
    $('article p').slice(0, 12).map((_, el) => $(el).text()).get().join(' ') ||
    $('main p').slice(0, 12).map((_, el) => $(el).text()).get().join(' ') ||
    $('[itemprop="articleBody"] p').slice(0, 12).map((_, el) => $(el).text()).get().join(' ')
  ).slice(0, 2200);

  let jsonLdDate = '';
  let jsonLdDescription = '';
  let jsonLdHeadline = '';

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).contents().text();
      const parsed = JSON.parse(raw);
      const objects = collectJsonLd(parsed);
      for (const obj of objects) {
        if (!jsonLdDate) jsonLdDate = clean(obj.datePublished || obj.dateCreated || obj.uploadDate || obj.dateModified);
        if (!jsonLdDescription) jsonLdDescription = plainText(obj.description);
        if (!jsonLdHeadline) jsonLdHeadline = plainText(obj.headline || obj.name);
      }
    } catch {
      return;
    }
  });

  const detailText = chooseArticleDetail(jsonLdDescription || metaDescription, articleParagraphs);
  return {
    title: jsonLdHeadline || metaTitle || plainText($('h1').first().text()),
    summary: detailText || jsonLdDescription || metaDescription || articleParagraphs,
    sourceExtract: detailText,
    peopleInvolved: extractPeopleFromText(detailText),
    language: normaliseLanguageTag(htmlLang || metaLanguage),
    published: jsonLdDate || metaDate,
    link: url
  };
}

async function enrichHtmlItems(source, items) {
  const enriched = [];
  for (const [index, item] of items.entries()) {
    const shouldHydrate =
      !parseSourceDate(item.published) ||
      clean(item.summary).length < 380 ||
      (source.lane === 'incidents' && index < 2);
    if (!shouldHydrate) {
      enriched.push(item);
      continue;
    }
    try {
      const articleHtml = await fetchText(item.link);
      const meta = extractArticleMeta(articleHtml, item.link);
      enriched.push({
        ...item,
        title: meta.title || item.title,
        summary: meta.summary || item.summary,
        sourceExtract: meta.sourceExtract || item.sourceExtract || item.summary,
        peopleInvolved: meta.peopleInvolved || item.peopleInvolved || [],
        language: meta.language || item.language || '',
        published: meta.published || item.published
      });
      await sleep(150);
    } catch {
      enriched.push(item);
    }
  }
  return enriched;
}

function shouldKeepItem(source, item) {
  const sourceTier = inferSourceTier(source);
  const reliabilityProfile = inferReliabilityProfile(source, sourceTier);
  const text = `${item.title} ${item.summary} ${item.sourceExtract || ''}`;
  const incidentHits = matchesKeywords(text);
  const terrorHits = matchesKeywords(text, terrorismKeywords);
  const terrorRelevant = isTerrorRelevantIncident(source, item);

  if (item.language && !isEnglishLanguage(item.language)) return false;
  if (!item.published && source.lane === 'incidents' && !source.isTrustedOfficial) return false;
  if (!recencyOkay(source, item.published)) return false;
  if (source.lane === 'incidents' && !terrorRelevant) return false;

  if (source.lane === 'context' && !source.isTrustedOfficial) {
    const requiredTerrorHits = reliabilityProfile === 'tabloid' ? 2 : 1;
    if (terrorHits.length < requiredTerrorHits) return false;
  }

  if (reliabilityProfile === 'tabloid') {
    const titleTerrorHits = matchesKeywords(item.title || '', terrorismKeywords);
    if (titleTerrorHits.length < 1) return false;
    if (terrorHits.length < 2) return false;
    if (incidentHits.length < 3) return false;
  }

  if (source.requiresKeywordMatch) {
    return incidentHits.length > 0;
  }

  return true;
}

function buildAlert(source, item, idx) {
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
  const peopleInvolved = shouldKeepPeopleInvolved(
    reliabilityProfile,
    confidenceScore,
    needsHumanReview,
    item.peopleInvolved
  )
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
    confidence: inferConfidence(source, reliabilityProfile),
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

async function readExisting() {
  try {
    return await readJsonFile(outputPath);
  } catch {
    return null;
  }
}

function summariseSourceError(source, error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: clean(source?.id) || 'unknown-source',
    provider: clean(source?.provider) || 'Unknown provider',
    endpoint: clean(source?.endpoint) || '',
    message
  };
}

async function safeLoadGeoLookup(existing) {
  try {
    geoLookup = await readJsonFile(geoLookupPath);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Geo lookup load failed: ${message}`);
    if (Array.isArray(existing?.geoLookupSnapshot) && existing.geoLookupSnapshot.length) {
      geoLookup = existing.geoLookupSnapshot;
      console.warn('Falling back to geo lookup snapshot from previous output.');
      return `Geo lookup load failed; reused previous snapshot. ${message}`;
    }
    geoLookup = [];
    return `Geo lookup load failed with no prior snapshot available. ${message}`;
  }
}

function normaliseSourcesPayload(rawSources) {
  if (Array.isArray(rawSources)) return rawSources;
  if (Array.isArray(rawSources?.sources)) return rawSources.sources;
  throw new Error('Expected sources.json to contain an array or { sources: [] }.');
}

async function main() {
  const existing = await readExisting();
  const geoLookupFallbackNote = await safeLoadGeoLookup(existing);

  let sources;
  try {
    sources = normaliseSourcesPayload(await readJsonFile(sourcePath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Source catalog load failed: ${message}`);
    if (existing) {
      const fallbackPayload = {
        ...existing,
        generatedAt: new Date().toISOString(),
        buildWarning: `Source catalog load failed; preserved previous alerts. ${message}`,
        sourceErrors: [
          {
            id: 'sources-json',
            provider: 'Brialert builder',
            endpoint: sourcePath,
            message
          }
        ]
      };
      await fs.writeFile(outputPath, JSON.stringify(fallbackPayload, null, 2) + '\n', 'utf8');
      console.log('Preserved previous live-alerts.json because sources.json could not be loaded.');
      return;
    }
    throw error;
  }

  const items = [];
  let checked = 0;
  const sourceErrors = [];

  for (const source of sources) {
    if (!sourceLooksEnglish(source)) {
      continue;
    }

    if (HARD_SKIP_SOURCE_IDS.has(source.id)) {
      console.warn(`Skipping disabled source: ${source.id}`);
      continue;
    }

    try {
      const body = await fetchText(source.endpoint);
      const parsed = source.kind === 'rss' || source.kind === 'atom' ? parseFeedItems(source, body) : parseHtmlItems(source, body);
      const preLimited = parsed.slice(0, source.kind === 'html' ? 8 : 6);
      const hydrated = source.kind === 'html' ? await enrichHtmlItems(source, preLimited) : preLimited;
      const reliabilityProfile = inferReliabilityProfile(source, inferSourceTier(source));
      const itemLimit = reliabilityProfile === 'tabloid' ? 1 : source.lane === 'incidents' ? 4 : 2;
      const kept = hydrated.filter((item) => {
        try {
          return shouldKeepItem(source, item);
        } catch (error) {
          sourceErrors.push(summariseSourceError(source, error));
          console.error(`Source item filter failed: ${source.id} - ${error instanceof Error ? error.message : String(error)}`);
          return false;
        }
      }).slice(0, itemLimit);
      kept.forEach((item, idx) => {
        try {
          items.push(buildAlert(source, item, idx));
        } catch (error) {
          sourceErrors.push(summariseSourceError(source, error));
          console.error(`Alert build failed: ${source.id} - ${error instanceof Error ? error.message : String(error)}`);
        }
      });
      checked += 1;
      await sleep(source.kind === 'html' ? 500 : 250);
    } catch (error) {
      const summary = summariseSourceError(source, error);
      sourceErrors.push(summary);
      console.error(`Source failed: ${summary.id} [${source.kind}/${source.lane}] - ${summary.message}`);
    }
  }

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

    if ((b.freshnessBucket || 0) !== (a.freshnessBucket || 0)) {
      return (b.freshnessBucket || 0) - (a.freshnessBucket || 0);
    }
    if (incidentTrackRankValue(b.incidentTrack) !== incidentTrackRankValue(a.incidentTrack)) {
      return incidentTrackRankValue(b.incidentTrack) - incidentTrackRankValue(a.incidentTrack);
    }
    if ((b.priorityScore || 0) !== (a.priorityScore || 0)) {
      return (b.priorityScore || 0) - (a.priorityScore || 0);
    }
    if (sourceTierRankValue(b.sourceTier) !== sourceTierRankValue(a.sourceTier)) {
      return sourceTierRankValue(b.sourceTier) - sourceTierRankValue(a.sourceTier);
    }
    if ((b.confidenceScore || 0) !== (a.confidenceScore || 0)) {
      return (b.confidenceScore || 0) - (a.confidenceScore || 0);
    }
    if (severityRank[b.severity] !== severityRank[a.severity]) {
      return severityRank[b.severity] - severityRank[a.severity];
    }
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return 0;
  });

  const preservedAlerts = !deduped.length && sourceErrors.length && Array.isArray(existing?.alerts) && existing.alerts.length;
  const finalAlerts = preservedAlerts ? existing.alerts : deduped.slice(0, 80);
  const buildWarning = [
    geoLookupFallbackNote,
    preservedAlerts ? 'Build produced no fresh alerts; preserved previous alert set.' : null
  ].filter(Boolean).join(' | ') || null;

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceCount: checked,
    alertCount: finalAlerts.length,
    alerts: finalAlerts,
    sourceErrors: sourceErrors.slice(0, MAX_SOURCE_ERRORS_TO_REPORT),
    geoLookupSnapshot: geoLookup,
    buildWarning
  };

  const currentComparable = JSON.stringify(existing?.alerts || []);
  const nextComparable = JSON.stringify(payload.alerts);

  if (currentComparable === nextComparable && !sourceErrors.length && !geoLookupFallbackNote) {
    console.log('No alert changes detected.');
    return;
  }

  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${payload.alertCount} alerts from ${payload.sourceCount} sources.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
