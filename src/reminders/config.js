const { guildIds } = require('../config');

function loadReminderChannels(value = process.env.REMINDER_CHANNELS || '') {
  const channels = new Map();
  for (const entry of value.split(',').map((part) => part.trim()).filter(Boolean)) {
    const match = /^(\d+):(\d+)$/.exec(entry);
    if (!match) throw new Error(`Invalid REMINDER_CHANNELS entry: ${entry}`);
    const [, guildId, channelId] = match;
    if (!guildIds.includes(guildId)) throw new Error(`Reminder guild ${guildId} is not in GUILD_IDS`);
    if (channels.has(guildId)) throw new Error(`Duplicate reminder guild ${guildId}`);
    channels.set(guildId, channelId);
  }
  return channels;
}

module.exports = { reminderChannels: loadReminderChannels(), loadReminderChannels };
