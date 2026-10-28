const { getLeagueTiers } = require('../db/leagueRepository');

function getReminderEvent(event) {
  if (event.event_type !== 'league') return event;
  return { ...event, tiers: getLeagueTiers({ leagueId: event.id, guildId: event.guild_id }) };
}

module.exports = { getReminderEvent };
