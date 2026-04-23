const sourceTopicTerms = [
  'counterterrorism.police.uk',
  'actioncounters',
  'terrorism-threat-levels',
  '/terrorism',
  '/counter-terrorism',
  '/counterterrorism',
  '/terrorist',
  'counter-terrorism-register',
  'terrorism-convictions-monitor',
  'proscribed-terror',
  'sanctions-against-terrorism',
  'terrorist-list',
  'terror offences',
  'terrorism offences'
];

export const englishFriendlyPatterns = [
  '/en/', '/english', 'english.', '/eng', 'dw.com/en', 'ansa.it/english', 'nzz.ch/english',
  'apnews.com', 'reuters.com', 'theguardian.com', 'bbc.', 'france24.com/en', 'swissinfo.ch/eng',
  'spectator.sme.sk', 'telex.hu/english', 'pap.pl/en', 'err.ee/en', 'eng.lsm.lv', 'lrt.lt/en',
  'hurriyetdailynews.com', 'duvarenglish.com', 'kallxo.com/english', 'english.radio.cz',
  '/EN/', 'sgdsn-english', 'pet.dk/en', 'pst.no/en', 'english.nctv.nl',
  // Nordic & Baltic
  'yle.fi/en', 'hs.fi/en', 'delfi.lt/en', 'delfi.ee/en', 'delfi.lv/en', 'bns.lt/en',
  'icelandreview.com', 'mbl.is/english', 'thelocal.se', 'thelocal.no', 'thelocal.dk', 'thelocal.fi',
  // Eastern Europe & Balkans
  'n1info.com/english', 'balkaninsight.com', 'intellinews.com', 'seetv-exchanges.com/en',
  'novinite.com', 'romania-insider.com', 'kafkadesk.org', 'polandin.com', 'visegradinsight.eu',
  'total-croatia-news.com', 'sloveniatimes.com', 'trtworld.com', 'dailysabah.com/en',
  // Southern & Western Europe
  'theportugalnews.com', 'portugalnews.com/en', 'ekathimerini.com', 'thenationalherald.com',
  'irishtimes.com', 'rte.ie/news', 'thelocal.es', 'thelocal.it', 'thelocal.fr', 'thelocal.de', 'thelocal.at',
  'schengenvisainfo.com', 'euractiv.com', 'politico.eu'
];

export const nonEnglishEndpointPatterns = [
  // Spanish
  'abc.es', 'elmundo.es', 'lavanguardia.com', 'elpais.com', 'elperiodico.com', 'publico.es',
  // Swedish
  'aftonbladet.se', 'dn.se', 'svd.se', 'expressen.se', 'polisen.se/',
  // German & Austrian
  'derstandard.at', 'diepresse.com', 'welt.de', 'faz.net', 'handelsblatt.com', 'sueddeutsche.de',
  'tagesschau.de', 'spiegel.de', 'zeit.de', 'kurier.at', 'krone.at',
  // French & Belgian French
  'lefigaro.fr', 'lemonde.fr', 'leparisien.fr', 'liberation.fr', 'lesoir.be', 'rtbf.be',
  'info.gouv.fr/risques/le-plan-vigipirate', 'vigipirate.gouv.fr', 'francetvinfo.fr', 'bfmtv.com',
  // Italian
  'corriere.it', 'repubblica.it', 'lastampa.it', 'ilsole24ore.com', 'ansa.it/italian', 'ilgiornale.it',
  // Dutch & Belgian Dutch
  'telegraaf.nl', 'volkskrant.nl', 'nrc.nl', 'standard.be', 'dewereldmorgen.be', 'nu.nl', 'rtv.nl',
  // Portuguese
  'publico.pt', 'dn.pt', 'jn.pt', 'cmjornal.pt', 'observador.pt', 'rtp.pt',
  // Polish
  'onet.pl', 'wp.pl', 'gazeta.pl', 'wyborcza.pl', 'tvn24.pl',
  // Czech & Slovak
  'aktuality.sk', 'pravda.sk', 'idnes.cz', 'novinky.cz', 'irozhlas.cz',
  // Romanian
  'digi24.ro', 'hotnews.ro', 'mediafax.ro', 'stiripesurse.ro',
  // Hungarian
  'index.hu', 'hvg.hu', '444.hu', 'origo.hu',
  // Greek
  'cathimerini.gr', 'protothema.gr', 'in.gr', 'tovima.gr',
  // Bulgarian & Croatian
  'dnevnik.bg', '24chasa.bg', 'jutarnji.hr', 'vecernji.hr', 'index.hr',
  // Finnish & Baltic native
  'yle.fi', 'hs.fi', 'iltalehti.fi', 'delfi.lt', 'delfi.lv', 'postimees.ee',
  // Danish & Norwegian
  'dr.dk', 'politiken.dk', 'berlingske.dk', 'vg.no', 'nrk.no', 'dagbladet.no',
  'pst.no/kunnskapsbank/'
];

export const incidentKeywords = [
  // English
  'terror', 'terrorism', 'attack', 'attacks', 'bomb', 'bombing', 'explosion', 'explosive', 'device',
  'ramming', 'stabbing', 'shooting', 'hostage', 'plot', 'suspect', 'arrest', 'arrested', 'charged',
  'charged with', 'parcel', 'radicalised', 'extremist', 'isis', 'islamic state', 'al-qaeda', 'threat',
  // French
  'attentat', 'attaque', 'bombe', 'explosif', 'fusillade', 'poignardage', 'prise d\'otage',
  // German
  'anschlag', 'bombe', 'sprengstoff', 'messerangriff', 'geiselnahme',
  // Spanish
  'atentado', 'ataque', 'bomba', 'explosivo', 'apunalamiento', 'tiroteo',
  // Italian
  'attentato', 'bomba', 'esplosivo', 'accoltellamento', 'sparatoria', 'ostaggio'
];

export const terrorismKeywords = [
  // English
  'terror', 'terrorism', 'counter-terror', 'counter terrorism', 'terrorist', 'extremist', 'extremism',
  'radicalised', 'radicalized', 'radicalisation', 'radicalization', 'jihadist', 'jihad', 'isis',
  'islamic state', 'al-qaeda', 'far-right extremist', 'far right extremist', 'neo-nazi',
  'proscribed organisation', 'proscribed organization', 'bomb hoax', 'ira', 'dissident republican',
  'loyalist paramilitary', 'terror offences', 'terrorism offences', 'terrorist propaganda',
  'lone wolf', 'lone actor', 'self-radicalised', 'self-radicalized',
  // French
  'terrorisme', 'terroriste', 'antiterrorisme', 'extremisme', 'radicalisation',
  'djihadiste', 'djihad', 'etat islamique', 'attentat terroriste',
  // German
  'terrorismus', 'terroristen', 'extremismus', 'radikalisierung', 'islamistisch',
  'rechtsextremismus', 'linksextremismus', 'islamischer staat', 'terroranschlag',
  // Spanish
  'terrorismo', 'terrorista', 'extremismo', 'radicalizacion', 'yihadista',
  'estado islamico', 'atentado terrorista', 'antiterrorismo',
  // Italian
  'terrorismo', 'terrorista', 'estremismo', 'radicalizzazione', 'jihadista',
  'stato islamico', 'attentato terroristico', 'antiterrorismo',
  // Dutch
  'terrorisme', 'extremisme', 'radicalisering', 'jihadisme',
  // Portuguese
  'terrorismo', 'extremismo', 'radicalizacao'
];

export const criticalKeywords = ['attack', 'bomb', 'bombing', 'explosion', 'explosive', 'ramming', 'shooting', 'stabbing', 'hostage'];
export const highKeywords = ['plot', 'charged', 'arrest', 'arrested', 'parcel', 'raid', 'disrupt', 'suspect'];

/**
 * Entertainment / culture negative-signal terms.
 * If an article matches ≥ ENTERTAINMENT_THRESHOLD of these AND has no strong
 * terrorism signal, it is almost certainly off-topic content (film reviews,
 * TV recaps, book discussions, etc.).
 */
export const entertainmentSignals = [
  'film of the week', 'review', 'cinema', 'runtime', 'director', 'starring',
  'box office', 'sequel', 'franchise', 'screenplay', 'trailer', 'cast',
  'Oscar', 'Oscars', 'Emmy', 'Emmys', 'Bafta',
  'blockbuster', 'premiere', 'red carpet', 'tv series', 'tv show',
  'streaming', 'Netflix', 'Amazon Prime',
  'album', 'concert', 'tour dates', 'tracklist',
  'cookbook', 'recipe', 'bestseller', 'paperback',
  'game of the year', 'gameplay', 'console', 'esports'
];

export const ENTERTAINMENT_THRESHOLD = 3;

export const majorMediaProviders = new Set([
  'Reuters', 'The Guardian', 'BBC News', 'Associated Press', 'AP News', 'The Telegraph',
  'Financial Times', 'France 24', 'DW', 'Politico Europe', 'Euronews', 'Brussels Times',
  'The Independent', 'Irish Times', 'Politico', 'Kyiv Post', 'RFE/RL',
  // European quality press
  'Le Monde', 'El País', 'Der Spiegel', 'Corriere della Sera', 'NRC Handelsblad', 'Süddeutsche Zeitung',
  'La Repubblica', 'Frankfurter Allgemeine', 'De Volkskrant', 'Le Figaro', 'Die Zeit',
  'TRT World', 'Agence France-Presse', 'AFP', 'EFE', 'ANSA',
  // Nordic & Baltic quality
  'SVT Nyheter', 'DR Nyheder', 'NRK', 'YLE News', 'ERR News', 'LRT English',
  // Eastern & Southern European
  'Kathimerini', 'Público', 'TVN24', 'Digi24'
]);

export const tabloidProviders = new Set([
  'The Sun', 'Daily Mail', 'Daily Record', 'Belfast Telegraph', 'iNews',
  // Additional UK tabloids
  'Daily Express', 'Daily Mirror', 'Daily Star', 'Metro UK',
  // European tabloids / sensational outlets
  'Bild', 'Kronen Zeitung', 'Aftonbladet', 'Iltalehti', 'De Telegraaf',
  'Correio da Manhã', 'Il Giornale', 'Dagbladet'
]);

export function clean(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z][a-z])/g, '$1. $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function plainText(value) {
  return clean(
    String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
  );
}

const SOCIAL_SHARE_NOISE = /\b(?:copy\s+link|share\s+(?:this|via|on)|tweet|facebook|whatsapp|telegram|email|twitter|linkedin|pinterest|reddit|subscribe|newsletter|sign\s+up)\b/i;
const AUTHOR_BIO_PATTERN = /\bis\s+(?:the\s+|an?\s+)?(?:[\w'’.-]+\s+){0,3}(?:correspondent|reporter|editor|journalist|writer|columnist|contributor|producer|presenter|analyst)\b/i;
const AUTHOR_BIO_CONTINUATION_PATTERN = /\b(?:he|she|they)\s+has\s+(?:covered|reported on|written for|worked as)\b/i;
const SOCIAL_SHARE_SEQUENCE_PATTERN = /\b(?:copy\s+link|share\s+(?:this|via|on)|tweet|facebook|whatsapp|telegram|email|twitter|linkedin|pinterest|reddit)(?:\s+(?:copy\s+link|share\s+(?:this|via|on)|tweet|facebook|whatsapp|telegram|email|twitter|linkedin|pinterest|reddit))+\b/gi;
const NEWSLETTER_INLINE_PATTERN = /\b(?:subscribe|sign\s+up)\s+(?:for|to)\s+(?:our\s+)?newsletter\b[^.!?]*/gi;
const INLINE_AUTHOR_BIO_PATTERN = /\b[A-Z][a-z'’.-]+(?:\s+[A-Z][a-z'’.-]+){0,3}\s+is\s+(?:the\s+|an?\s+)?(?:[\w'’.-]+\s+){0,3}(?:correspondent|reporter|editor|journalist|writer|columnist|contributor|producer|presenter|analyst)\b[^.!?]{0,160}(?:[.!?]|$)/gi;
const INLINE_AUTHOR_BIO_CONTINUATION_PATTERN = /\b(?:he|she|they)\s+has\s+(?:covered|reported on|written for|worked as)\b[^.!?]{0,160}(?:[.!?]|$)/gi;
export const SENTENCE_SPLIT_PATTERN = /(?<=[.!?])\s+|\s{2,}/;

export function isWebCruft(sentence) {
  const sample = clean(sentence);
  if (!sample) return false;
  const lower = sample.toLowerCase();
  if (SOCIAL_SHARE_NOISE.test(lower)) return true;
  if (AUTHOR_BIO_PATTERN.test(lower) || AUTHOR_BIO_CONTINUATION_PATTERN.test(lower)) return true;
  if (/^(?:read\s+more|related\s+(?:articles|stories|topics)|advertisement|sponsored|©)/i.test(sample)) return true;
  return false;
}

export function stripWebCruft(text) {
  const collapsed = clean(plainText(text))
    .replace(SOCIAL_SHARE_SEQUENCE_PATTERN, ' ')
    .replace(NEWSLETTER_INLINE_PATTERN, ' ')
    .replace(INLINE_AUTHOR_BIO_PATTERN, ' ')
    .replace(INLINE_AUTHOR_BIO_CONTINUATION_PATTERN, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!collapsed) return '';

  return Array.from(new Set(
    collapsed
    .split(SENTENCE_SPLIT_PATTERN)
    .map((part) => clean(part))
    .filter(Boolean)
    .filter((part) => !isWebCruft(part))
  )).join(' ');
}

export function matchesKeywords(text, words = incidentKeywords) {
  const haystack = clean(text).toLowerCase();
  return words.filter((word) => {
    let searchFrom = 0;
    while (searchFrom < haystack.length) {
      const idx = haystack.indexOf(word, searchFrom);
      if (idx === -1) return false;
      const charBefore = idx > 0 ? haystack[idx - 1] : ' ';
      const charAfter = idx + word.length < haystack.length ? haystack[idx + word.length] : ' ';
      if (!/[a-z0-9]/.test(charBefore) && !/[a-z0-9]/.test(charAfter)) return true;
      searchFrom = idx + 1;
    }
    return false;
  });
}

/**
 * Returns true when the article text looks like entertainment/culture content
 * (≥ ENTERTAINMENT_THRESHOLD signal terms) AND lacks a strong terrorism signal
 * (fewer than 2 terrorismKeywords hits).
 */
export function looksLikeEntertainment(text) {
  const hits = matchesKeywords(text, entertainmentSignals.map((s) => s.toLowerCase()));
  if (hits.length < ENTERTAINMENT_THRESHOLD) return false;
  const terrorHits = matchesKeywords(text, terrorismKeywords);
  return terrorHits.length < 2;
}

export function normaliseSourceTier(value) {
  const tier = clean(value).toLowerCase();
  return ['trigger', 'corroboration', 'context', 'research'].includes(tier) ? tier : '';
}

export function normaliseReliabilityProfile(value) {
  const profile = clean(value).toLowerCase();
  return ['official_ct', 'official_general', 'official_context', 'major_media', 'general_media', 'tabloid', 'specialist_research'].includes(profile) ? profile : '';
}

export function normaliseIncidentTrack(value) {
  const track = clean(value).toLowerCase();
  return ['live', 'case'].includes(track) ? track : '';
}

export function sourceHasTerrorTopic(input) {
  const text = typeof input === 'string'
    ? clean(input).toLowerCase()
    : clean(`${input?.name || ''} ${input?.endpoint || ''} ${input?.sourceUrl || ''} ${input?.title || ''}`).toLowerCase();
  return sourceTopicTerms.some((term) => text.includes(term));
}

export function sourceLooksEnglish(source) {
  const endpoint = clean(source?.endpoint).toLowerCase();
  if (englishFriendlyPatterns.some((pattern) => endpoint.includes(pattern.toLowerCase()))) return true;
  if (nonEnglishEndpointPatterns.some((pattern) => endpoint.includes(pattern.toLowerCase()))) return false;
  return true;
}

export function inferSourceTier(metadata) {
  const declaredTier = normaliseSourceTier(metadata.sourceTier);
  if (declaredTier) return declaredTier;
  if (metadata.lane === 'incidents') {
    if (sourceHasTerrorTopic(metadata)) return (metadata.isTrustedOfficial || metadata.isOfficial) ? 'trigger' : 'corroboration';
    return 'corroboration';
  }
  if (metadata.lane === 'sanctions' || metadata.lane === 'oversight' || metadata.lane === 'border') return 'context';
  return (metadata.isTrustedOfficial || metadata.isOfficial) ? 'context' : 'research';
}

export function inferReliabilityProfile(metadata, sourceTier = inferSourceTier(metadata)) {
  const declaredProfile = normaliseReliabilityProfile(metadata.reliabilityProfile);
  if (declaredProfile) return declaredProfile;
  const provider = clean(metadata.provider || metadata.source);
  if (sourceTier === 'trigger') return 'official_ct';
  if ((metadata.isTrustedOfficial || metadata.isOfficial) && metadata.lane === 'incidents') return 'official_general';
  if (metadata.isTrustedOfficial || metadata.isOfficial) return 'official_context';
  if (tabloidProviders.has(provider)) return 'tabloid';
  if (majorMediaProviders.has(provider)) return 'major_media';
  if (sourceTier === 'research' || metadata.lane === 'prevention') return 'specialist_research';
  return 'general_media';
}

export function inferIncidentTrack(metadata) {
  const declared = normaliseIncidentTrack(metadata.incidentTrack);
  if (declared) return declared;
  if (metadata.lane && metadata.lane !== 'incidents') return '';
  const eventType = clean(metadata.eventType).toLowerCase();
  if (['charge', 'arrest', 'sentencing', 'recognition', 'feature'].includes(eventType)) return 'case';
  if (['active_attack', 'disrupted_plot', 'threat_update'].includes(eventType)) return 'live';
  const lower = clean(metadata.text).toLowerCase();
  if (lower.includes('police cordon') || lower.includes('evacuated') || lower.includes('explosive device') || lower.includes('ongoing')) return 'live';
  return metadata.lane === 'incidents' ? 'case' : '';
}

function stripNegatedTerrorContext(text) {
  return text
    .replace(/\b(?:no|not|without|denies?|denied?)\s+(?:terrorism|terror|terrorist|extremism|extremist)\b[^.!?;]*/gi, ' ')
    .replace(/\bno\s+(?:\w+\s+)?(?:links?|connections?|ties?)\s+to\s+(?:terrorism|terror)\b[^.!?;]*/gi, ' ')
    .replace(/\bunrelated\s+to\s+(?:terrorism|terror)\b[^.!?;]*/gi, ' ');
}

/**
 * Calibrated false-positive rate thresholds per reliability tier.
 * Derived from observed precision on CT-tagged vs non-CT stories:
 *   official_ct:  ~2% FP rate  → lowest threshold (trust the source)
 *   official_general: ~5% FP   → moderate threshold
 *   major_media:  ~12% FP      → require terror + incident signals
 *   general_media: ~25% FP     → require diverse terror signals
 *   tabloid:      ~45% FP      → require strong multi-signal evidence
 *   specialist_research: ~8% FP → topic-aware, lower threshold
 */
const TERROR_RELEVANCE_THRESHOLDS = {
  official_ct:          { minTerror: 1, minIncident: 0, minDistinct: 1, titleBoost: false },
  official_general:     { minTerror: 1, minIncident: 1, minDistinct: 1, titleBoost: false },
  major_media:          { minTerror: 1, minIncident: 2, minDistinct: 1, titleBoost: false },
  general_media:        { minTerror: 2, minIncident: 2, minDistinct: 2, titleBoost: false },
  tabloid:              { minTerror: 2, minIncident: 3, minDistinct: 2, titleBoost: true },
  specialist_research:  { minTerror: 2, minIncident: 0, minDistinct: 1, titleBoost: false }
};

/**
 * Keyword-to-family classification rules for terror keyword diversity scoring.
 * Each entry maps a substring pattern to a semantic family name.
 * Checked via `includes()` on the lowercased keyword hit.
 */
const TERROR_FAMILY_RULES = [
  { family: 'isis', patterns: ['isis', 'islamic state', 'etat islamique', 'islamischer staat', 'estado islamico', 'stato islamico', 'islamistisch'] },
  { family: 'jihad', patterns: ['jihad', 'djiha', 'yihad'] },
  { family: 'extremism', patterns: ['extrem', 'radica', 'radika'] },
  { family: 'ira', patterns: ['ira', 'republican', 'paramilitary', 'loyalist'] },
  { family: 'farright', patterns: ['neo-nazi', 'far-right', 'far right', 'rechtsextrem', 'linksextrem'] },
  { family: 'proscribed', patterns: ['proscribed', 'propaganda', 'lone'] }
];

/** Set of exact-match keywords that belong to the 'terror' family. */
const TERROR_FAMILY_EXACT = new Set([
  'counter-terror', 'counter terrorism', 'antiterrorisme', 'antiterrorismo', 'terroranschlag'
]);

/**
 * Count distinct keyword root families among terror hits.
 * Groups variants like "terror/terrorism/terrorist" as a single family
 * so that a tabloid headline repeating "terror" five times scores as 1 distinct hit.
 * @param {string[]} hits — matched terrorism keyword strings
 * @returns {number} count of distinct semantic families
 */
function distinctTerrorFamilies(hits) {
  const roots = new Set();
  for (const hit of hits) {
    const h = hit.toLowerCase();
    if (h.startsWith('terror') || TERROR_FAMILY_EXACT.has(h)) {
      roots.add('terror');
      continue;
    }
    const rule = TERROR_FAMILY_RULES.find((r) => r.patterns.some((p) => h.includes(p)));
    roots.add(rule ? rule.family : h);
  }
  return roots.size;
}

export function isTerrorRelevantIncident(metadata, item) {
  if (metadata.lane !== 'incidents') return true;
  const reliabilityProfile = inferReliabilityProfile(metadata);
  const rawText = clean(`${item?.title || ''} ${item?.summary || ''} ${item?.sourceExtract || ''}`).toLowerCase();
  const text = rawText;
  const filteredText = stripNegatedTerrorContext(rawText);
  const terrorHits = matchesKeywords(filteredText, terrorismKeywords);
  const incidentHits = matchesKeywords(text, incidentKeywords);
  const terrorTopic = sourceHasTerrorTopic(metadata);

  // official_ct sources with dedicated terror topics get a fast path
  if (reliabilityProfile === 'official_ct') return terrorHits.length >= 1 || (terrorTopic && incidentHits.length >= 1);

  // specialist_research sources are topic-aware
  if (reliabilityProfile === 'specialist_research') return terrorHits.length >= 2 || terrorTopic;

  const thresholds = TERROR_RELEVANCE_THRESHOLDS[reliabilityProfile] || TERROR_RELEVANCE_THRESHOLDS.general_media;
  const passesBasic = terrorHits.length >= thresholds.minTerror && incidentHits.length >= thresholds.minIncident;
  if (!passesBasic) return false;

  // Distinct-family check: require diverse terror terminology (reduces tabloid FP from repeating "terror" alone)
  const distinct = distinctTerrorFamilies(terrorHits);
  if (distinct < thresholds.minDistinct) return false;

  // Title-boost check for tabloids: at least one terror keyword should appear in the title,
  // not just buried in body text (reduces FP from articles that mention terror tangentially)
  if (thresholds.titleBoost) {
    const titleText = stripNegatedTerrorContext(clean(item?.title || '').toLowerCase());
    const titleTerrorHits = matchesKeywords(titleText, terrorismKeywords);
    if (titleTerrorHits.length === 0) return false;
  }

  return true;
}

export function inferSeverity(source, text) {
  if (source.lane === 'incidents') {
    if (matchesKeywords(text, criticalKeywords).length) return 'critical';
    if (matchesKeywords(text, highKeywords).length) return 'high';
    return 'elevated';
  }
  if (source.lane === 'sanctions' || source.lane === 'border') return 'elevated';
  return 'moderate';
}

export function inferConfidenceScore(source, text, publishedIso, reliabilityProfile) {
  let score = 0.62;
  if (reliabilityProfile === 'official_ct') score = 0.94;
  else if (reliabilityProfile === 'official_general') score = 0.88;
  else if (reliabilityProfile === 'official_context') score = 0.84;
  else if (reliabilityProfile === 'major_media') score = 0.76;
  else if (reliabilityProfile === 'specialist_research') score = 0.68;
  else if (reliabilityProfile === 'general_media') score = 0.6;
  else if (reliabilityProfile === 'tabloid') score = 0.48;

  // Graduated keyword-density boost: more distinct matches → higher confidence
  const kwHits = matchesKeywords(text);
  if (kwHits.length >= 6) score += 0.06;
  else if (kwHits.length >= 4) score += 0.04;
  else if (kwHits.length >= 2) score += 0.02;

  // Multi-language terror term diversity bonus
  const terrorHits = matchesKeywords(text, terrorismKeywords);
  if (terrorHits.length > 0) {
    const diversity = distinctTerrorFamilies(terrorHits);
    if (diversity >= 3) score += 0.04;
    else if (diversity >= 2) score += 0.02;
  }

  // Penalty for tabloid sources with low keyword diversity (high FP rate)
  if (reliabilityProfile === 'tabloid' && terrorHits.length > 0 && distinctTerrorFamilies(terrorHits) < 2) {
    score -= 0.04;
  }

  if (!publishedIso) score -= 0.08;
  return Math.max(0.25, Math.min(0.99, Number(score.toFixed(2))));
}

export function inferStatus(source, itemText) {
  if (source.lane !== 'incidents') return 'Update';
  const text = clean(itemText).toLowerCase();
  if (text.includes('charged')) return 'Charged';
  if (text.includes('arrest')) return 'Arrest';
  if (text.includes('sentenced')) return 'Sentenced';
  if (text.includes('threat')) return 'Threat update';
  return 'New source item';
}

export function inferEventType(source, text) {
  const lower = clean(text).toLowerCase();
  if (source.lane === 'sanctions') return 'sanctions_update';
  if (source.lane === 'oversight') return 'oversight_update';
  if (source.lane === 'border') return 'border_security_update';
  if (source.lane === 'context') return 'context_update';
  if (source.lane === 'prevention') return 'prevention_update';
  if (lower.includes('medal') || lower.includes('award') || lower.includes('anniversary') || lower.includes('memorial') || lower.includes('commemoration')) return 'recognition';
  if (lower.includes('podcast') || lower.includes('inside counter terrorism') || lower.includes('about us')) return 'feature';
  if (lower.includes('sentenced') || lower.includes('convicted')) return 'sentencing';
  if (lower.includes('charged')) return 'charge';
  if (lower.includes('arrest') || lower.includes('arrested') || lower.includes('raid')) return 'arrest';
  if (lower.includes('foiled') || lower.includes('disrupt') || lower.includes('disrupted')) return 'disrupted_plot';
  if (lower.includes('threat level') || lower.includes('threat')) return 'threat_update';
  if (matchesKeywords(lower, criticalKeywords).length) return 'active_attack';
  return 'incident_update';
}

export function inferGeoPrecision(location) {
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
