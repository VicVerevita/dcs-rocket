const { discordTimestamp } = require('../utils/time');
const { gameLabel } = require('../utils/eventLabels');
const { teamLabel } = require('../domain/teams');

function prequalificationLabel(kind) {
  return kind === 'race' ? 'Pre-qualification race' : 'Pre-qualification signup';
}

function leagueDescription(league, team = '') {
  return [
    `**${gameLabel(league.game)} league**`,
    team ? `**Signup team:** ${teamLabel(team)}` : null,
    `**Season:** ${discordTimestamp(league.starts_at, league.date_only_until)}`,
    league.prequal_kind
      ? `**${prequalificationLabel(league.prequal_kind)}:** ${discordTimestamp(league.prequal_starts_at, league.prequal_date_only_until)}`
      : null,
    league.prequal_kind && league.prequal_details ? league.prequal_details : null,
    league.track ? `**Tracks:** ${league.track}` : null,
    league.car_class ? `**Classes:** ${league.car_class}` : null,
    league.details ? `**Details:** ${league.details}` : null,
  ].filter(Boolean).join('\n');
}

module.exports = { leagueDescription, prequalificationLabel };
