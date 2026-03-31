export const watchLayerLabels = {
  transport: 'Transport hubs',
  embassy: 'Diplomatic sites',
  hospital: 'Hospitals',
  worship: 'Places of worship',
  government: 'Government sites'
};

export const laneLabels = {
  all: 'All lanes',
  incidents: 'Incidents',
  context: 'Context',
  sanctions: 'Sanctions',
  oversight: 'Oversight',
  border: 'Border',
  prevention: 'Prevention'
};

const albertQuoteOpeners = [
  'Stay steady',
  'Hold your nerve',
  'Keep your footing',
  'Move with intent',
  'Trust your training',
  'Lead with calm',
  'Read the room',
  'Think before you surge',
  'Stand tall',
  'Keep the signal clean',
  'Anchor the team',
  'Breathe and reset',
  'Protect the tempo',
  'Let discipline speak',
  'Be harder to shake',
  'Keep your edge',
  'Stay sharp',
  'Hold the line'
];

const albertQuoteClosers = [
  'clear heads make better decisions.',
  'calm beats noise every time.',
  'clarity is faster than panic.',
  'quiet confidence travels further than fear.',
  'steady people steady everyone else.',
  'good judgement starts with one slow breath.',
  'speed matters most after the picture is clear.',
  'strong teams borrow calm from each other.',
  'discipline turns pressure into structure.',
  'presence matters when the room feels thin.',
  'the best brief is the one people can trust.',
  'facts first, ego never.',
  'you do not need chaos to move quickly.',
  'the next right decision is enough.',
  'clean thinking is operational strength.',
  'composure is part of the toolkit.',
  'being grounded helps everyone think straighter.',
  'the room takes its cue from the calmest person.',
  'patience can save minutes that panic would waste.',
  'the strongest posture is controlled, not loud.',
  'small acts of calm change whole situations.',
  'a steady voice can lower the temperature fast.',
  'good work starts with good footing.',
  'confidence lands best when it is quiet.',
  'pressure reveals habits, so keep yours clean.',
  'the mission gets clearer when the mind does too.',
  'control the pace and the pace stops controlling you.',
  'focus is a force multiplier.',
  'one measured pause can beat ten rushed moves.',
  'clarity gives courage somewhere useful to stand.',
  'there is strength in being unhurried on purpose.',
  'order starts with the person who refuses the wobble.',
  'trust grows where calm and competence meet.',
  'restraint is not weakness; it is control.',
  'solid thinking keeps the rest of the machine honest.',
  'good teams feel safer around calm people.',
  'you are allowed to be steady and formidable at once.'
];

export const albertQuotes = Array.from({ length: 666 }, (_, index) => {
  const opener = albertQuoteOpeners[Math.floor(index / albertQuoteClosers.length)];
  const closer = albertQuoteClosers[index % albertQuoteClosers.length];
  return `${opener}. ${closer.charAt(0).toUpperCase()}${closer.slice(1)}`;
});

export const defaultNotes = [
  { title: 'Morning posture', body: 'Maintain focus on transport hubs, symbolic sites, and fast-moving public order environments with terrorism indicators.' },
  { title: 'Cross-border watch', body: 'Track whether any developing European incidents show common method, travel pathway, or propaganda overlap with UK activity.' }
];
