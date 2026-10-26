const teamChoices = [
  { name: 'Main team', value: 'main' },
  { name: 'Academy team', value: 'academy' },
  { name: 'Community team', value: 'community' },
];

function isTeam(team) {
  return teamChoices.some(({ value }) => value === team);
}

function teamLabel(team) {
  return teamChoices.find(({ value }) => value === team)?.name || 'All teams (shared)';
}

module.exports = { teamChoices, isTeam, teamLabel };
