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
  const parsed = rawDate ? new Date(rawDate) : now;
  if (Number.isNaN(parsed.getTime())) return now.toISOString();
  return parsed.toISOString();
}

function formatDisplayDate(rawDate) {
  const parsed = rawDate ? new Date(rawDate) : now;
  if (Number.isNaN(parsed.getTime())) return now.toISOString().slice(0, 10);
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
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
    return [
      `${source.provider} published ${type} linked to ${where} on ${when}.`,
      summary ? `The source text says: ${summary}` : `The source headline is: ${title}.`,
      'This should be assessed for whether it reflects an active scene, a recently disrupted plot, or a later judicial or recognition-stage development.'
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
    happenedWhen: formatDisplayDate(item.published),
    confidence: inferConfidence(source),
    summary: clean(item.summary || item.title).slice(0, 260),
    aiSummary: makeSummary(source, item),
    source: source.provider,
    sourceUrl: item.link,
    time: formatDisplayDate(item.published),
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
      const kept = parsed.filter((item) => shouldKeepItem(source, item)).slice(0, source.lane === 'incidents' ? 4 : 2);
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
    const timeGap = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
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
