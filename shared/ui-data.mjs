import philosopherQuotes from './philosopher-quotes.json' with { type: 'json' };

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

export const albertQuotes = Array.from(
  { length: 666 },
  (_, index) => philosopherQuotes[index % philosopherQuotes.length]
);

export const defaultNotes = [
  { title: 'Morning posture', body: 'Maintain focus on transport hubs, symbolic sites, and fast-moving public order environments with terrorism indicators.' },
  { title: 'Cross-border watch', body: 'Track whether any developing European incidents show common method, travel pathway, or propaganda overlap with UK activity.' }
];
