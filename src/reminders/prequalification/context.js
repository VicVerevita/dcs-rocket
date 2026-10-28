function buildPrequalificationReminderId(action, event, userId) {
  return `prequal-reminder:${action}:${event.guild_id}:${event.id}:${userId}`;
}

function parsePrequalificationReminderId(customId, interactionGuildId) {
  const match = /^prequal-reminder:(done|withdraw):(\d{1,20}):([1-9]\d*):(\d{1,20})$/.exec(customId);
  if (!match) return null;
  const eventId = Number(match[3]);
  if (!Number.isSafeInteger(eventId) || (interactionGuildId && interactionGuildId !== match[2])) return null;
  return { action: match[1], guildId: match[2], eventId, userId: match[4] };
}

module.exports = { buildPrequalificationReminderId, parsePrequalificationReminderId };
