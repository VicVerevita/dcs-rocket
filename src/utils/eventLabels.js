const gameChoices = [
  { name: 'iRacing', value: 'iracing' },
  { name: 'Le Mans Ultimate', value: 'lmu' },
];

function gameLabel(game) {
  return gameChoices.find(({ value }) => value === game)?.name || 'Unknown game';
}

const eventTypeChoices = [
  { name: 'Weekly', value: 'weekly' },
  { name: 'Special Event', value: 'special_event' },
  { name: 'League', value: 'league' },
  { name: 'Other', value: 'other' },
];

const eventTypeLabels = Object.fromEntries(
  eventTypeChoices.map(({ name, value }) => [value, name]),
);

eventTypeLabels.public = 'Public';
eventTypeLabels.private = 'Hosted';

function eventTypeLabel(eventType) {
  return eventTypeLabels[eventType] || 'Other';
}

module.exports = {
  gameChoices,
  gameLabel,
  eventTypeChoices,
  eventTypeLabel,
};
