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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
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
  const patterns = ['Leeds', 'London', 'Manchester', 'Birmingham', 'Liverpool', 'Glasgow', 'Belfast', 'Paris', 'Brussels', 'Berlin', 'Madrid', 'Rome', 'Amsterdam', 'Stockholm', 'Copenhagen', 'Dublin'];
  const hit = patterns.find((name) => text.includes(name));
  if (hit) return hit;
  return source.region === 'uk' ? 'United Kingdom' : 'Europe';
}

function summariseTextBlock(text, maxParts = 4) {
  return clean(text)
    .split(/(?<=[.!?])\s+|\s{2,}/)
    .map((part) => clean(part))
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .slice(0, maxParts);
}

function coordFor(region, seed) {
  let hash = 0;
  for (const char of seed) hash = ((hash << 5) - hash) + char.charCodeAt(0);
  hash = Math.abs(hash);
  if (region === 'uk') {
    return { x: 18 + (hash % 18), y: 28 + (hash % 22) };
  }
  return { x: 50 + (hash % 24), y: 30 + (hash % 28) };
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
    const type = text.includes('charged') || text.includes('sentenced') || text.includes('convicted')
      ? 'a prosecution-stage development'
      : text.includes('arrest') || text.includes('raid') || text.includes('foiled') || text.includes('disrupt')
        ? 'a disrupted plot or enforcement action'
        : text.includes('attack') || text.includes('bomb') || text.includes('explosion') || text.includes('shooting') || text.includes('stabbing') || text.includes('ramming') || text.includes('hostage')
          ? 'an attack-related development'
          : text.includes('threat')
            ? 'a threat-related development'
            : 'a terrorism-related update';
    const factualBits = summariseTextBlock(summary);
    return [
      `${source.provider} published ${type} linked to ${where} on ${when}.`,
      `The headline is: ${title}.`,
      factualBits.length
        ? factualBits.join(' ')
        : 'The source page did not expose a fuller body extract in this pull, so the available facts are currently limited to the headline and source metadata.'
    ].join(' ');
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
    $('article p').slice(0, 6).map((_, el) => $(el).text()).get().join(' ') ||
    $('main p').slice(0, 6).map((_, el) => $(el).text()).get().join(' ')
  ).slice(0, 1200);

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

  return {
    title: jsonLdHeadline || metaTitle || clean($('h1').first().text()),
    summary: jsonLdDescription || metaDescription || articleParagraphs,
    published: jsonLdDate || metaDate,
    link: url
  };
}

async function enrichHtmlItems(items) {
  const enriched = [];
  for (const item of items) {
    if (parseSourceDate(item.published)) {
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
  if (!recencyOkay(source, item.published)) return false;
  if (source.requiresKeywordMatch) {
    return matchesKeywords(text).length > 0;
  }
  return true;
}

function buildAlert(source, item, idx) {
  const text = `${item.title} ${item.summary}`;
  const coords = coordFor(source.region, `${source.id}-${item.title}-${idx}`);
  const publishedIso = formatWhen(item.published);
  const displayWhen = formatDisplayDate(item.published);
  return {
    id: `${source.id}-${idx}`,
    title: titleCase(item.title),
    location: inferLocation(source, item.title),
    region: source.region,
    lane: source.lane,
    severity: inferSeverity(source, text),
    status: inferStatus(source, text),
    actor: source.provider,
    subject: source.provider,
    happenedWhen: displayWhen,
    confidence: inferConfidence(source),
    summary: clean(item.summary || item.title).slice(0, 260),
    aiSummary: makeSummary(source, item),
    source: source.provider,
    sourceUrl: item.link,
    time: displayWhen,
    x: coords.x,
    y: coords.y,
    major: source.lane === 'incidents' && ['critical', 'high'].includes(inferSeverity(source, text)),
    publishedAt: publishedIso,
    keywordHits: matchesKeywords(text)
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
    try {
      const body = await fetchText(source.endpoint);
      const parsed = source.kind === 'rss' || source.kind === 'atom' ? parseFeedItems(source, body) : parseHtmlItems(source, body);
      const filtered = parsed.filter((item) => shouldKeepItem(source, item)).slice(0, source.lane === 'incidents' ? 4 : 2);
      const kept = source.kind === 'html' ? await enrichHtmlItems(filtered) : filtered;
      kept.forEach((item, idx) => items.push(buildAlert(source, item, idx)));
      checked += 1;
      await sleep(250);
    } catch (error) {
      console.error(`Source failed: ${source.id} - ${error.message}`);
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const item of items) {
    const key = `${item.title}|${item.sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  deduped.sort((a, b) => {
    const rank = { critical: 4, high: 3, elevated: 2, moderate: 1 };
    const timeA = parseSourceDate(a.publishedAt)?.getTime() || 0;
    const timeB = parseSourceDate(b.publishedAt)?.getTime() || 0;
    const timeGap = timeB - timeA;
    if (rank[b.severity] !== rank[a.severity]) return rank[b.severity] - rank[a.severity];
    return timeGap;
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
