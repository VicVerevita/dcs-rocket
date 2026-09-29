const { guildIds } = require('../config');

function loadReminderChannels(value = process.env.REMINDER_CHANNELS || '') {
  const channels = new Map();
  for (const entry of value.split(',').map((part) => part.trim()).filter(Boolean)) {
    const match = /^(\d+):(\d+)(?::([12]))?$/.exec(entry);
    if (!match) throw new Error(`Invalid REMINDER_CHANNELS entry: ${entry}`);
    const [, guildId, channelId, game] = match;
    if (!guildIds.includes(guildId)) throw new Error(`Reminder guild ${guildId} is not in GUILD_IDS`);
    if (!channels.has(guildId)) channels.set(guildId, []);
    if (channels.get(guildId).some((channel) => channel.key === channelId)) {
      throw new Error(`Duplicate reminder channel ${channelId}`);
    }
    channels.get(guildId).push({ key: channelId, game: game === '1' ? 'iracing' : game === '2' ? 'lmu' : null });
  }
  return channels;
}

module.exports = { loadReminderChannels };
