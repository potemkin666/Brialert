import * as cheerio from 'cheerio';
import { clean, plainText } from '../../shared/taxonomy.mjs';
import {
  HTML_HYDRATION_CONCURRENCY,
  MAX_FEED_CANDIDATES_PER_SOURCE,
  MAX_HTML_CANDIDATES_PER_SOURCE,
  MAX_HTML_PARSING_THRESHOLD,
  parser
} from './config.mjs';
import {
  absoluteUrl,
  arrayify,
  fetchText,
  mapWithConcurrency,
  normaliseLanguageTag,
  parseSourceDate,
  sleep
} from './io.mjs';

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

function chooseArticleDetail(metaDescription, articleParagraphs) {
  if (articleParagraphs.length >= Math.max(320, metaDescription.length + 120)) return articleParagraphs;
  if (metaDescription.length >= 220) return metaDescription;
  return articleParagraphs || metaDescription;
}

function titleCaseWords(value) {
  return clean(value)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildSyntheticPoliceLink(endpoint, suffix) {
  return `${endpoint}${endpoint.includes('#') ? '-' : '#'}${encodeURIComponent(clean(suffix) || 'item')}`;
}

function policeApiItem(source, endpoint, title, summary, published, suffix) {
  return {
    title: plainText(title),
    link: buildSyntheticPoliceLink(endpoint, suffix),
    summary: plainText(summary),
    published: clean(published)
  };
}

function parsePoliceDataUkItems(source, doc) {
  const endpoint = clean(source?.endpoint);
  if (!endpoint || !endpoint.includes('data.police.uk/api/')) return null;

  const makeSummary = (...parts) => clean(parts.filter(Boolean).join(' '));
  const items = [];

  if (endpoint.includes('/crimes-street-dates')) {
    for (const entry of arrayify(doc)) {
      const date = clean(entry?.date);
      if (!date) continue;
      items.push(policeApiItem(
        source,
        endpoint,
        `Police.uk street crime data month available: ${date}`,
        `Official Police.uk API listing of available street crime dataset month ${date}.`,
        `${date}-01`,
        date
      ));
    }
    return items;
  }

  if (endpoint.includes('/crime-categories')) {
    const date = clean(new URL(endpoint).searchParams.get('date'));
    for (const entry of arrayify(doc)) {
      const category = clean(entry?.name || entry?.url);
      if (!category) continue;
      items.push(policeApiItem(
        source,
        endpoint,
        `Police.uk crime category: ${category}${date ? ` (${date})` : ''}`,
        `Official Police.uk API category listing${date ? ` for ${date}` : ''}. Category slug: ${clean(entry?.url)}.`,
        date ? `${date}-01` : '',
        entry?.url || category
      ));
    }
    return items;
  }

  if (endpoint.includes('/crimes-street/all-crime')) {
    for (const entry of arrayify(doc)) {
      const category = titleCaseWords(entry?.category || 'crime');
      const month = clean(entry?.month);
      const street = clean(entry?.location?.street?.name);
      items.push(policeApiItem(
        source,
        endpoint,
        `Police.uk street crime: ${category}${street ? ` near ${street}` : ''}`,
        makeSummary(
          `Official Police.uk street crime API record${month ? ` for ${month}.` : '.'}`,
          street ? `Street: ${street}.` : '',
          clean(entry?.outcome_status?.category) ? `Outcome: ${clean(entry.outcome_status.category)}.` : ''
        ),
        month ? `${month}-01` : '',
        clean(entry?.persistent_id || `${entry?.category}-${entry?.id || month || street}`)
      ));
    }
    return items;
  }

  if (endpoint.includes('/stops-street')) {
    for (const entry of arrayify(doc)) {
      const type = titleCaseWords(entry?.type || 'stop');
      const date = clean(entry?.datetime || entry?.date || entry?.month);
      const officerDefinedEthnicity = clean(entry?.officer_defined_ethnicity);
      items.push(policeApiItem(
        source,
        endpoint,
        `Police.uk stop and search: ${type}`,
        makeSummary(
          'Official Police.uk stop-and-search API record.',
          officerDefinedEthnicity ? `Officer-defined ethnicity: ${officerDefinedEthnicity}.` : '',
          clean(entry?.object_of_search) ? `Object of search: ${clean(entry.object_of_search)}.` : '',
          clean(entry?.outcome) ? `Outcome: ${clean(entry.outcome)}.` : ''
        ),
        date,
        clean(`${entry?.type}-${entry?.datetime || entry?.date || entry?.month || items.length}`)
      ));
    }
    return items;
  }

  if (endpoint.includes('/stops-force')) {
    const force = clean(new URL(endpoint).searchParams.get('force'));
    for (const entry of arrayify(doc)) {
      const type = titleCaseWords(entry?.type || 'stop');
      const date = clean(entry?.datetime || entry?.date || entry?.month);
      items.push(policeApiItem(
        source,
        endpoint,
        `Police.uk force stop and search: ${type}${force ? ` (${force})` : ''}`,
        makeSummary(
          'Official Police.uk force stop-and-search API record.',
          clean(entry?.object_of_search) ? `Object of search: ${clean(entry.object_of_search)}.` : '',
          clean(entry?.outcome) ? `Outcome: ${clean(entry.outcome)}.` : ''
        ),
        date,
        clean(`${force}-${entry?.type}-${entry?.datetime || entry?.date || entry?.month || items.length}`)
      ));
    }
    return items;
  }

  if (endpoint.includes('/outcomes-at-location')) {
    const date = clean(new URL(endpoint).searchParams.get('date'));
    for (const entry of arrayify(doc)) {
      const category = titleCaseWords(entry?.category?.name || entry?.category);
      items.push(policeApiItem(
        source,
        endpoint,
        `Police.uk outcome at location${category ? `: ${category}` : ''}`,
        makeSummary(
          'Official Police.uk outcomes-at-location API record.',
          clean(entry?.person_id) ? `Person ID: ${clean(entry.person_id)}.` : '',
          clean(entry?.crime?.category) ? `Crime category: ${titleCaseWords(entry.crime.category)}.` : ''
        ),
        clean(entry?.date || date),
        clean(entry?.person_id || entry?.category?.code || entry?.category?.name || items.length)
      ));
    }
    return items;
  }

  if (endpoint.includes('/outcomes-for-crime/')) {
    const crimeId = endpoint.split('/outcomes-for-crime/')[1] || '';
    for (const entry of arrayify(doc)) {
      const category = titleCaseWords(entry?.category?.name || entry?.category?.code || 'outcome');
      items.push(policeApiItem(
        source,
        endpoint,
        `Police.uk crime outcome: ${category}`,
        makeSummary(
          'Official Police.uk outcomes-for-crime API record.',
          clean(entry?.date) ? `Outcome date: ${clean(entry.date)}.` : '',
          clean(entry?.person_id) ? `Person ID: ${clean(entry.person_id)}.` : ''
        ),
        clean(entry?.date),
        clean(entry?.person_id || `${crimeId}-${entry?.date || items.length}`)
      ));
    }
    return items;
  }

  return [];
}

export function parseFeedItems(source, xml) {
  if (source?.kind === 'json') {
    let doc;
    try {
      doc = JSON.parse(xml);
    } catch {
      return [];
    }
    const policeApiItems = parsePoliceDataUkItems(source, doc);
    if (policeApiItems) {
      return policeApiItems
        .filter((item) => item.title && item.link)
        .slice(0, MAX_FEED_CANDIDATES_PER_SOURCE);
    }
    const jsonItems = arrayify(doc?.items).map((item) => ({
      title: plainText(item?.title || item?.summary || item?.content_text || item?.content_html),
      link: clean(item?.url || item?.external_url),
      summary: plainText(item?.summary || item?.content_text || item?.content_html),
      published: clean(item?.date_published || item?.date_modified)
    }));
    return jsonItems
      .filter((item) => item.title && item.link)
      .slice(0, MAX_FEED_CANDIDATES_PER_SOURCE);
  }

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
  return [...rssItems, ...atomItems]
    .filter((item) => item.title && item.link)
    .slice(0, MAX_FEED_CANDIDATES_PER_SOURCE);
}

export function parseHtmlItems(source, html) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const candidates = [];
  const configuredSelectors = Array.isArray(source?.selectors)
    ? source.selectors.map((selector) => clean(selector)).filter(Boolean)
    : [];
  const selectors = [
    ...configuredSelectors,
    'article a[href]',
    '[data-testid*="article"] a[href]',
    '[class*="article"] a[href]',
    '[class*="story"] a[href]',
    '[class*="post"] a[href]',
    '[class*="card"] a[href]',
    'main a[href]',
    'h2 a[href]',
    'h3 a[href]',
    'a[href]'
  ];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      if (candidates.length >= MAX_HTML_PARSING_THRESHOLD) return false;
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
    if (candidates.length >= MAX_HTML_CANDIDATES_PER_SOURCE) break;
  }

  return candidates.slice(0, MAX_HTML_CANDIDATES_PER_SOURCE);
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
  const twitterDescription = plainText(
    $('meta[name="twitter:description"]').attr('content')
  );
  const metaTitle = plainText(
    $('meta[property="og:title"]').attr('content') ||
    $('meta[name="twitter:title"]').attr('content') ||
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

  const detailText = chooseArticleDetail(jsonLdDescription || metaDescription || twitterDescription, articleParagraphs);
  return {
    title: jsonLdHeadline || metaTitle || plainText($('h1').first().text()),
    summary: detailText || jsonLdDescription || metaDescription || twitterDescription || articleParagraphs,
    sourceExtract: detailText,
    peopleInvolved: extractPeopleFromText(detailText),
    language: normaliseLanguageTag(htmlLang || metaLanguage),
    published: jsonLdDate || metaDate,
    link: url
  };
}

export async function enrichHtmlItems(source, items) {
  return mapWithConcurrency(items, HTML_HYDRATION_CONCURRENCY, async (item, index) => {
    const shouldHydrate =
      !parseSourceDate(item.published) ||
      clean(item.summary).length < 380 ||
      (source.lane === 'incidents' && index < 2);
    if (!shouldHydrate) return item;

    try {
      await sleep(index * 40);
      const articleHtml = await fetchText(item.link, 1, { source });
      const meta = extractArticleMeta(articleHtml, item.link);
      return {
        ...item,
        title: meta.title || item.title,
        summary: meta.summary || item.summary,
        sourceExtract: meta.sourceExtract || item.sourceExtract || item.summary,
        peopleInvolved: meta.peopleInvolved || item.peopleInvolved || [],
        language: meta.language || item.language || '',
        published: meta.published || item.published
      };
    } catch {
      return item;
    }
  });
}
