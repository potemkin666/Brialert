import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'data', 'sources.json');
const outputPath = path.join(repoRoot, 'live-alerts.json');
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
const now = new Date();

const incidentKeywords = [
  'terror', 'terrorism', 'attack', 'attacks', 'bomb', 'bombing', 'explosion', 'explosive', 'device',
  'ramming', 'stabbing', 'shooting', 'hostage', 'plot', 'suspect', 'arrest', 'arrested', 'charged',
  'parcel', 'extremist', 'isis', 'islamic state', 'al-qaeda', 'threat', 'jihadist', 'radicalised'
];
const criticalKeywords = ['attack', 'bomb', 'bombing', 'explosion', 'explosive', 'ramming', 'shooting', 'stabbing', 'hostage'];
const highKeywords = ['plot', 'charged', 'arrest', 'arrested', 'parcel', 'raid', 'disrupt', 'suspect'];
const laneWords = {
  sanctions: ['sanction', 'designation', 'designations', 'listing', 'listed', 'delisting', 'alias'],
  oversight: ['review', 'report', 'response', 'inspection', 'oversight', 'legislation'],
  border: ['border', 'document', 'fraud', 'etias', 'travel', 'screening', 'migration'],
  prevention: ['radicalisation', 'prevention', 'extremism', 'newsletter', 'research']
};
const severityRank = { critical: 4, high: 3, elevated: 2, moderate: 1 };
const englishFriendlyPatterns = [
  '/en/', '/english', 'english.', '/eng', 'dw.com/en', 'ansa.it/english', 'nzz.ch/english',
  'apnews.com', 'reuters.com', 'theguardian.com', 'bbc.', 'france24.com/en', 'swissinfo.ch/eng',
  'spectator.sme.sk', 'telex.hu/english', 'pap.pl/en', 'err.ee/en', 'eng.lsm.lv', 'lrt.lt/en',
  'hurriyetdailynews.com', 'duvarenglish.com', 'kallxo.com/english', 'english.radio.cz',
  '/EN/', 'sgdsn-english', 'pet.dk/en', 'pst.no/en', 'english.nctv.nl'
];
const nonEnglishEndpointPatterns = [
  'abc.es', 'aftonbladet.se', 'aktuality.sk', 'corriere.it', 'dn.se', 'telegraaf.nl', 'volkskrant.nl',
  'derstandard.at', 'diepresse.com', 'welt.de', 'elmundo.es', 'faz.net', 'info.gouv.fr/risques/le-plan-vigipirate',
  'vigipirate.gouv.fr', 'handelsblatt.com', 'lavanguardia.com', 'lefigaro.fr', 'lemonde.fr', 'leparisien.fr',
  'liberation.fr', 'repubblica.it', 'lastampa.it', 'ilsole24ore.com', 'nrc.nl', 'standard.be', 'lesoir.be',
  'dewereldmorgen.be', 'svd.se', 'pravda.sk', 'polisen.se/', 'cathimerini.gr', 'pst.no/kunnskapsbank/'
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value) => (value || '')
  .replace(/([a-z0-9])([A-Z][a-z])/g, '$1. $2')
  .replace(/\s+/g, ' ')
  .trim();
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

function matchesKeywords(text, words = incidentKeywords) {
  const haystack = (text || '').toLowerCase();
  return words.filter((word) => haystack.includes(word));
}

function parseSourceDate(rawDate) {
  if (!rawDate) return null;
  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function inferSeverity(source, text) {
  if (source.lane === 'incidents') {
    if (matchesKeywords(text, criticalKeywords).length) return 'critical';
    if (matchesKeywords(text, highKeywords).length) return 'high';
    return 'elevated';
  }
  if (source.lane === 'sanctions' || source.lane === 'border') return 'elevated';
  return 'moderate';
}

function inferConfidence(source) {
  if (source.isTrustedOfficial) return 'Verified official source update';
  if (['Reuters', 'The Guardian', 'The Independent'].includes(source.provider)) return 'Reputable media source';
  return 'Secondary source signal';
}

function normaliseLanguageTag(value) {
  return clean(value).toLowerCase().replace('_', '-');
}

function isEnglishLanguage(value) {
  const lang = normaliseLanguageTag(value);
  return !lang || lang === 'en' || lang.startsWith('en-');
}

function sourceLooksEnglish(source) {
  const endpoint = clean(source.endpoint).toLowerCase();
  if (englishFriendlyPatterns.some((pattern) => endpoint.includes(pattern.toLowerCase()))) return true;
  if (nonEnglishEndpointPatterns.some((pattern) => endpoint.includes(pattern.toLowerCase()))) return false;
  return true;
}

function inferConfidenceScore(source, text, publishedIso) {
  let score = source.isTrustedOfficial ? 0.92 : 0.62;
  if (['Reuters', 'The Guardian', 'The Independent', 'Associated Press', 'BBC News'].includes(source.provider)) score = Math.max(score, 0.78);
  if (matchesKeywords(text).length >= 4) score += 0.04;
  if (!publishedIso) score -= 0.08;
  return Math.max(0.25, Math.min(0.99, Number(score.toFixed(2))));
}

function inferStatus(source, itemText) {
  if (source.lane !== 'incidents') return 'Update';
  const text = itemText.toLowerCase();
  if (text.includes('charged')) return 'Charged';
  if (text.includes('arrest')) return 'Arrest';
  if (text.includes('sentenced')) return 'Sentenced';
  if (text.includes('threat')) return 'Threat update';
  return 'New source item';
}

function inferLocation(source, title) {
  const text = title || '';
  const patterns = ['Leeds', 'London', 'Manchester', 'Birmingham', 'Liverpool', 'Glasgow', 'Belfast', 'Northumberland', 'Paris', 'Brussels', 'Berlin', 'Madrid', 'Rome', 'Amsterdam', 'Stockholm', 'Copenhagen', 'Dublin', 'Athens', 'Vienna', 'Vilnius', 'Warsaw', 'Kyiv', 'Tehran', 'Beirut', 'Jerusalem', 'Tel Aviv', 'Yemen', 'Iraq', 'Iran', 'Israel', 'Lebanon', 'Nigeria', 'Pakistan', 'California', 'Yosemite'];
  const hit = patterns.find((name) => text.includes(name));
  if (hit) return hit;
  return source.region === 'uk' ? 'United Kingdom' : 'Europe';
}

function inferEventType(source, text) {
  const lower = text.toLowerCase();
  if (source.lane === 'sanctions') return 'sanctions_update';
  if (source.lane === 'oversight') return 'oversight_update';
  if (source.lane === 'border') return 'border_security_update';
  if (source.lane === 'prevention') return 'prevention_update';
  if (lower.includes('sentenced') || lower.includes('convicted')) return 'sentencing';
  if (lower.includes('charged')) return 'charge';
  if (lower.includes('arrest') || lower.includes('arrested') || lower.includes('raid')) return 'arrest';
  if (lower.includes('foiled') || lower.includes('disrupt') || lower.includes('disrupted')) return 'disrupted_plot';
  if (lower.includes('threat level') || lower.includes('threat')) return 'threat_update';
  if (matchesKeywords(lower, criticalKeywords).length) return 'active_attack';
  return 'incident_update';
}

function inferGeoPrecision(location) {
  if (!location) return 'unknown';
  const cityLike = [
    'Leeds', 'London', 'Manchester', 'Birmingham', 'Liverpool', 'Glasgow', 'Belfast', 'Northumberland',
    'Paris', 'Brussels', 'Berlin', 'Madrid', 'Rome', 'Amsterdam', 'Stockholm', 'Copenhagen', 'Dublin',
    'Athens', 'Vienna', 'Vilnius', 'Warsaw', 'Kyiv', 'Tehran', 'Beirut', 'Jerusalem', 'Tel Aviv'
  ];
  if (cityLike.includes(location)) return 'city';
  if (['United Kingdom', 'Europe', 'Iran', 'Israel', 'Lebanon', 'Iraq', 'Yemen', 'Nigeria', 'Pakistan', 'California', 'Yosemite'].includes(location)) return 'country';
  return 'region';
}

const geoLookup = [
  { terms: ['leeds'], x: 47, y: 27 },
  { terms: ['london', 'golders green'], x: 46, y: 28 },
  { terms: ['manchester'], x: 45, y: 26 },
  { terms: ['birmingham'], x: 46, y: 27 },
  { terms: ['liverpool'], x: 44, y: 26 },
  { terms: ['glasgow'], x: 43, y: 23 },
  { terms: ['belfast'], x: 41, y: 25 },
  { terms: ['northumberland'], x: 47, y: 24 },
  { terms: ['paris', 'france'], x: 48, y: 31 },
  { terms: ['brussels', 'belgium'], x: 49, y: 29 },
  { terms: ['amsterdam', 'netherlands'], x: 49, y: 27 },
  { terms: ['berlin', 'germany'], x: 53, y: 27 },
  { terms: ['madrid', 'spain'], x: 45, y: 38 },
  { terms: ['rome', 'italy'], x: 52, y: 37 },
  { terms: ['athens', 'greece'], x: 58, y: 39 },
  { terms: ['stockholm', 'sweden'], x: 55, y: 19 },
  { terms: ['copenhagen', 'denmark'], x: 52, y: 22 },
  { terms: ['dublin', 'ireland'], x: 40, y: 27 },
  { terms: ['vilnius', 'lithuania'], x: 58, y: 23 },
  { terms: ['warsaw', 'poland'], x: 56, y: 26 },
  { terms: ['kyiv', 'ukraine'], x: 61, y: 29 },
  { terms: ['tehran', 'iran'], x: 68, y: 33 },
  { terms: ['israel', 'tel aviv', 'jerusalem'], x: 61, y: 38 },
  { terms: ['lebanon', 'beirut'], x: 60, y: 37 },
  { terms: ['iraq'], x: 63, y: 35 },
  { terms: ['yemen'], x: 62, y: 42 },
  { terms: ['nigeria'], x: 49, y: 51 },
  { terms: ['pakistan'], x: 68, y: 35 },
  { terms: ['austria', 'vienna'], x: 54, y: 30 },
  { terms: ['switzerland'], x: 50, y: 31 },
  { terms: ['united states', 'usa', 'california', 'yosemite'], x: 18, y: 31 },
  { terms: ['canada'], x: 18, y: 18 },
  { terms: ['australia'], x: 84, y: 68 },
  { terms: ['europe'], x: 52, y: 29 },
  { terms: ['united kingdom', 'uk'], x: 45, y: 27 }
];

function summariseTextBlock(text, maxParts = 8) {
  return clean(text)
    .split(/(?<=[.!?])\s+|\s{2,}/)
    .map((part) => clean(part))
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .slice(0, maxParts);
}

function extractPeopleFromText(text) {
  const blockedTerms = new Set([
    'France', 'Iranian', 'Proxies', 'Foiled', 'Paris', 'Terror', 'Attack', 'Bank', 'America', 'United Kingdom',
    'Europe', 'Middle East', 'The Guardian', 'The Telegraph', 'Daily Mail', 'The Sun', 'Reuters', 'Europol',
    'Eurojust', 'GOV UK', 'Counter Terrorism', 'Crown Prosecution', 'Police'
  ]);
  const matches = [...clean(text).matchAll(/\b([A-Z][a-z'’.-]+(?:\s+[A-Z][a-z'’.-]+){1,2})\b/g)]
    .map((match) => clean(match[1]))
    .filter((name, index, all) => all.indexOf(name) === index)
    .filter((name) => name.split(' ').every((word) => !blockedTerms.has(word)));
  return matches.slice(0, 6);
}

function chooseArticleDetail(metaDescription, articleParagraphs) {
  if (articleParagraphs.length >= Math.max(320, metaDescription.length + 120)) return articleParagraphs;
  if (metaDescription.length >= 220) return metaDescription;
  return articleParagraphs || metaDescription;
}

function coordFor(location, title, summary, region) {
  const haystack = clean(`${location} ${title} ${summary}`).toLowerCase();
  const match = geoLookup.find((entry) => entry.terms.some((term) => haystack.includes(term)));
  if (match) return { x: match.x, y: match.y };
  return region === 'uk' ? { x: 45, y: 27 } : { x: 52, y: 29 };
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

function freshUntilFor(source, publishedIso, severity) {
  const published = parseSourceDate(publishedIso) || now;
  const hoursByLane = {
    incidents: severity === 'critical' ? 18 : severity === 'high' ? 36 : 72,
    sanctions: 24 * 14,
    oversight: 24 * 21,
    border: 24 * 10,
    prevention: 24 * 21
  };
  const hours = hoursByLane[source.lane] || 72;
  return new Date(published.getTime() + hours * 3600000).toISOString();
}

function priorityScoreFor(source, severity, keywordHits, publishedIso) {
  let score = severityRank[severity] || 1;
  if (source.lane === 'incidents') score += 4;
  if (source.isTrustedOfficial) score += 2;
  score += Math.min(keywordHits.length, 5) * 0.6;
  if (publishedIso) {
    const ageHours = Math.max(0, (now.getTime() - new Date(publishedIso).getTime()) / 3600000);
    if (ageHours <= 6) score += 2;
    else if (ageHours <= 24) score += 1;
    else if (ageHours > 168) score -= 2;
  } else {
    score -= 0.5;
  }
  return Number(score.toFixed(2));
}

function needsHumanReviewFor(source, severity, keywordHits, publishedIso) {
  if (source.lane !== 'incidents') return false;
  if (!source.isTrustedOfficial && severity === 'critical') return true;
  if (!publishedIso) return true;
  return keywordHits.length < 2;
}

function sameStoryKey(item) {
  return clean(item.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|and|of|to|in|for|on|with|from)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function recencyOkay(source, rawDate) {
  if (!rawDate) return true;
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return true;
  const ageDays = (now.getTime() - parsed.getTime()) / 86400000;
  if (source.lane === 'incidents') return ageDays <= 45;
  return ageDays <= 180;
}

function makeSummary(source, item) {
  const title = clean(item.title);
  const summary = clean(item.summary && item.summary !== item.title ? item.summary : '');
  const when = formatDisplayDate(item.published);
  const where = inferLocation(source, title);
  const text = `${title} ${summary}`.toLowerCase();
  if (source.lane === 'incidents') {
      const factualBits = summariseTextBlock(summary);
      return factualBits.length ? factualBits.join(' ') : title;
    }
  if (source.lane === 'sanctions') {
    return `${source.provider} has published a sanctions-related update. The value here is legal and entity-resolution context, including designations, aliases, listing changes, and notice-level movement.`;
  }
  if (source.lane === 'border') {
    return `${source.provider} has published a border or screening update. The main use is travel, document, screening, or movement risk context that may support later incident interpretation.`;
  }
  if (source.lane === 'oversight') {
    return `${source.provider} has published an oversight or review update. This is useful for legal, custody, supervision, or institutional risk context rather than immediate public warning.`;
  }
  return `${source.provider} has published a prevention or radicalisation update. The value is horizon scanning, theme detection, and context for later operational or analytical work.`;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'BrialertFeedBot/1.0 (+https://potemkin666.github.io/Brialert/)'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseFeedItems(source, xml) {
  const doc = parser.parse(xml);
  const rssItems = arrayify(doc?.rss?.channel?.item).map((item) => ({
    title: clean(item.title),
    link: clean(typeof item.link === 'string' ? item.link : item.link?.href),
    summary: clean(item.description || item['content:encoded'] || item.summary),
    published: clean(item.pubDate || item.isoDate)
  }));
  const atomItems = arrayify(doc?.feed?.entry).map((item) => ({
    title: clean(item.title?.['#text'] || item.title),
    link: clean(item.link?.href || arrayify(item.link).find((x) => x.rel === 'alternate')?.href || ''),
    summary: clean(item.summary?.['#text'] || item.summary || item.content?.['#text'] || item.content),
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
      const title = clean($(el).text() || $(el).closest('article,li,section').find('h1,h2,h3').first().text());
      if (!href || !title || title.length < 18) return;
      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
      const url = absoluteUrl(href, source.endpoint);
      const key = `${title}|${url}`;
      if (seen.has(key)) return;
      seen.add(key);
      const container = $(el).closest('article,li,section,div');
      const summary = clean(container.text()).slice(0, 420);
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
  const metaDescription = clean(
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content')
  );
  const metaTitle = clean(
    $('meta[property="og:title"]').attr('content') ||
    $('title').first().text()
  );
  const articleParagraphs = clean(
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
        if (!jsonLdDescription) jsonLdDescription = clean(obj.description);
        if (!jsonLdHeadline) jsonLdHeadline = clean(obj.headline || obj.name);
      }
    } catch {
      return;
    }
  });

  const detailText = chooseArticleDetail(jsonLdDescription || metaDescription, articleParagraphs);
  return {
    title: jsonLdHeadline || metaTitle || clean($('h1').first().text()),
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
  const text = `${item.title} ${item.summary}`;
  if (item.language && !isEnglishLanguage(item.language)) return false;
  if (!recencyOkay(source, item.published)) return false;
  if (source.requiresKeywordMatch) {
    return matchesKeywords(text).length > 0;
  }
  return true;
}

function buildAlert(source, item, idx) {
  const text = `${item.title} ${item.summary}`;
  const location = inferLocation(source, item.title);
  const coords = coordFor(location, item.title, item.summary, source.region);
  const publishedIso = formatWhen(item.published);
  const displayWhen = formatDisplayDate(item.published);
  const keywordHits = matchesKeywords(text);
  const severity = inferSeverity(source, text);
  const eventType = inferEventType(source, text);
  const confidenceScore = inferConfidenceScore(source, text, publishedIso);
  const priorityScore = priorityScoreFor(source, severity, keywordHits, publishedIso);
  return {
    id: `${source.id}-${idx}`,
    title: titleCase(item.title),
    location,
    region: source.region,
    lane: source.lane,
    severity,
    status: inferStatus(source, text),
    actor: source.provider,
    subject: source.provider,
    happenedWhen: displayWhen,
    confidence: inferConfidence(source),
    confidenceScore,
    summary: clean(item.summary || item.title).slice(0, 260),
    aiSummary: makeSummary(source, item),
    sourceExtract: clean(item.sourceExtract || item.summary || item.title).slice(0, 1800),
    peopleInvolved: Array.isArray(item.peopleInvolved) ? item.peopleInvolved.slice(0, 6) : [],
    source: source.provider,
    sourceUrl: item.link,
    time: displayWhen,
    x: coords.x,
    y: coords.y,
    major: source.lane === 'incidents' && ['critical', 'high'].includes(severity),
    publishedAt: publishedIso,
    keywordHits,
    eventType,
    geoPrecision: inferGeoPrecision(location),
    isOfficial: !!source.isTrustedOfficial,
    priorityScore,
    freshUntil: freshUntilFor(source, publishedIso, severity),
    needsHumanReview: needsHumanReviewFor(source, severity, keywordHits, publishedIso),
    isDuplicateOf: null
  };
}

async function readExisting() {
  try {
    const raw = await fs.readFile(outputPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const sources = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const items = [];
  let checked = 0;

  for (const source of sources) {
    if (!sourceLooksEnglish(source)) {
      continue;
    }
    try {
      const body = await fetchText(source.endpoint);
      const parsed = source.kind === 'rss' || source.kind === 'atom' ? parseFeedItems(source, body) : parseHtmlItems(source, body);
      const filtered = parsed.filter((item) => shouldKeepItem(source, item)).slice(0, source.lane === 'incidents' ? 4 : 2);
      const kept = source.kind === 'html' ? await enrichHtmlItems(source, filtered) : filtered;
      kept.forEach((item, idx) => items.push(buildAlert(source, item, idx)));
      checked += 1;
      await sleep(250);
    } catch (error) {
      console.error(`Source failed: ${source.id} - ${error.message}`);
    }
  }

  const deduped = [];
  const seen = new Map();
  for (const item of items) {
    const key = `${sameStoryKey(item)}|${item.location}|${item.eventType}`;
    if (seen.has(key)) {
      const existingIndex = seen.get(key);
      const incumbent = deduped[existingIndex];
      if ((item.priorityScore || 0) > (incumbent.priorityScore || 0)) {
        item.isDuplicateOf = incumbent.id;
        deduped[existingIndex] = item;
        seen.set(key, existingIndex);
      } else {
        incumbent.isDuplicateOf = incumbent.isDuplicateOf || item.id;
      }
      continue;
    }
    seen.set(key, deduped.length);
    deduped.push(item);
  }

  deduped.sort((a, b) => {
    const timeA = parseSourceDate(a.publishedAt)?.getTime() || 0;
    const timeB = parseSourceDate(b.publishedAt)?.getTime() || 0;
    if ((b.priorityScore || 0) !== (a.priorityScore || 0)) return (b.priorityScore || 0) - (a.priorityScore || 0);
    if ((b.confidenceScore || 0) !== (a.confidenceScore || 0)) return (b.confidenceScore || 0) - (a.confidenceScore || 0);
    if (severityRank[b.severity] !== severityRank[a.severity]) return severityRank[b.severity] - severityRank[a.severity];
    return timeB - timeA;
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceCount: checked,
    alertCount: deduped.length,
    alerts: deduped.slice(0, 80)
  };

  const existing = await readExisting();
  const currentComparable = JSON.stringify(existing?.alerts || []);
  const nextComparable = JSON.stringify(payload.alerts);
  if (currentComparable === nextComparable) {
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
