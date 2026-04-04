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
  '/EN/', 'sgdsn-english', 'pet.dk/en', 'pst.no/en', 'english.nctv.nl'
];

export const nonEnglishEndpointPatterns = [
  'abc.es', 'aftonbladet.se', 'aktuality.sk', 'corriere.it', 'dn.se', 'telegraaf.nl', 'volkskrant.nl',
  'derstandard.at', 'diepresse.com', 'welt.de', 'elmundo.es', 'faz.net', 'info.gouv.fr/risques/le-plan-vigipirate',
  'vigipirate.gouv.fr', 'handelsblatt.com', 'lavanguardia.com', 'lefigaro.fr', 'lemonde.fr', 'leparisien.fr',
  'liberation.fr', 'repubblica.it', 'lastampa.it', 'ilsole24ore.com', 'nrc.nl', 'standard.be', 'lesoir.be',
  'dewereldmorgen.be', 'svd.se', 'pravda.sk', 'polisen.se/', 'cathimerini.gr', 'pst.no/kunnskapsbank/'
];

export const incidentKeywords = [
  'terror', 'terrorism', 'attack', 'attacks', 'bomb', 'bombing', 'explosion', 'explosive', 'device',
  'ramming', 'stabbing', 'shooting', 'hostage', 'plot', 'suspect', 'arrest', 'arrested', 'charged',
  'charged with', 'parcel', 'radicalised', 'extremist', 'isis', 'islamic state', 'al-qaeda', 'threat'
];

export const terrorismKeywords = [
  'terror', 'terrorism', 'counter-terror', 'counter terrorism', 'terrorist', 'extremist', 'extremism',
  'radicalised', 'radicalized', 'radicalisation', 'radicalization', 'jihadist', 'jihad', 'isis',
  'islamic state', 'al-qaeda', 'far-right extremist', 'far right extremist', 'neo-nazi',
  'proscribed organisation', 'proscribed organization', 'bomb hoax', 'ira', 'dissident republican',
  'loyalist paramilitary', 'terror offences', 'terrorism offences', 'terrorist propaganda'
];

export const criticalKeywords = ['attack', 'bomb', 'bombing', 'explosion', 'explosive', 'ramming', 'shooting', 'stabbing', 'hostage'];
export const highKeywords = ['plot', 'charged', 'arrest', 'arrested', 'parcel', 'raid', 'disrupt', 'suspect'];

export const majorMediaProviders = new Set([
  'Reuters', 'The Guardian', 'BBC News', 'Associated Press', 'AP News', 'The Telegraph',
  'Financial Times', 'France 24', 'DW', 'Politico Europe', 'Euronews', 'Brussels Times',
  'The Independent', 'Irish Times', 'Politico', 'Kyiv Post', 'RFE/RL'
]);

export const tabloidProviders = new Set([
  'The Sun', 'Daily Mail', 'Daily Record', 'Belfast Telegraph', 'iNews'
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

export function isTerrorRelevantIncident(metadata, item) {
  if (metadata.lane !== 'incidents') return true;
  const reliabilityProfile = inferReliabilityProfile(metadata);
  const rawText = clean(`${item?.title || ''} ${item?.summary || ''} ${item?.sourceExtract || ''}`).toLowerCase();
  const text = rawText;
  const filteredText = stripNegatedTerrorContext(rawText);
  const terrorHits = matchesKeywords(filteredText, terrorismKeywords);
  const incidentHits = matchesKeywords(text, incidentKeywords);
  const terrorTopic = sourceHasTerrorTopic(metadata);
  if (reliabilityProfile === 'official_ct') return terrorHits.length >= 1 || (terrorTopic && incidentHits.length >= 1);
  if (reliabilityProfile === 'official_general') return terrorHits.length >= 1 && incidentHits.length >= 1;
  if (reliabilityProfile === 'major_media') return terrorHits.length >= 1 && incidentHits.length >= 2;
  if (reliabilityProfile === 'general_media') return terrorHits.length >= 2 && incidentHits.length >= 2;
  if (reliabilityProfile === 'tabloid') return terrorHits.length >= 2 && incidentHits.length >= 3;
  if (reliabilityProfile === 'specialist_research') return terrorHits.length >= 2 || terrorTopic;
  return terrorHits.length > 0;
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
  if (matchesKeywords(text).length >= 4) score += 0.04;
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
