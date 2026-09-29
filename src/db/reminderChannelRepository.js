const db = require('./database');

const listChannels = db.prepare(`
  SELECT channel_id AS key, game
  FROM reminder_channels
  WHERE guild_id = ?
  ORDER BY channel_id
`);
const listAllChannels = db.prepare('SELECT 1 FROM reminder_channels LIMIT 1');
const upsertChannel = db.prepare(`
  INSERT INTO reminder_channels (guild_id, channel_id, game)
  VALUES (@guildId, @channelId, @game)
  ON CONFLICT(guild_id, channel_id) DO UPDATE SET game = excluded.game
`);
const deleteChannel = db.prepare(`
  DELETE FROM reminder_channels WHERE guild_id = ? AND channel_id = ?
`);

function getReminderChannels(guildId) {
  return listChannels.all(guildId);
}

function hasReminderChannels() {
  return Boolean(listAllChannels.get());
}

function setReminderChannel(guildId, channelId, game) {
  upsertChannel.run({ guildId, channelId, game });
}

function removeReminderChannel(guildId, channelId) {
  return deleteChannel.run(guildId, channelId).changes > 0;
}

module.exports = {
  getReminderChannels,
  hasReminderChannels,
  setReminderChannel,
  removeReminderChannel,
};
