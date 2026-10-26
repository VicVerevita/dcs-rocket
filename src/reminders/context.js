const { isTeam } = require('../domain/teams');

// Keep pre-upgrade IDs valid. Team IDs also carry context for replies in DMs.
function buildRsvpId(action, event, { team = '', fromTeam, privateMessage = false } = {}) {
  if (fromTeam !== undefined) {
    return `special-rsvp:${action}:change:${fromTeam || 'all'}:${team}:${event.guild_id}:${event.id}`;
  }
  if (team) return `special-rsvp:${action}:team:${team}:${event.guild_id}:${event.id}`;
  return privateMessage
    ? `special-rsvp:${action}:${event.guild_id}:${event.id}`
    : `special-rsvp:${action}:${event.id}`;
}

function parseRsvpId(customId, interactionGuildId) {
  const parts = customId.split(':');
  if (parts[0] !== 'special-rsvp') return null;
  let guildId;
  let team;
  let fromTeam;
  if (parts.length === 3) {
    guildId = interactionGuildId;
  } else if (parts.length === 4) {
    guildId = parts[2];
  } else if (parts.length === 6 && parts[2] === 'team' && isTeam(parts[3])) {
    team = parts[3];
    guildId = parts[4];
  } else if (parts.length === 7 && parts[2] === 'change'
    && (parts[3] === 'all' || isTeam(parts[3])) && isTeam(parts[4])) {
    fromTeam = parts[3] === 'all' ? '' : parts[3];
    team = parts[4];
    guildId = parts[5];
  } else {
    return null;
  }
  const eventId = Number(parts.at(-1));
  if (!guildId || (interactionGuildId && interactionGuildId !== guildId)
    || !Number.isSafeInteger(eventId) || eventId <= 0) return null;
  return { guildId, eventId, action: parts[1], team, fromTeam };
}

module.exports = { buildRsvpId, parseRsvpId };
