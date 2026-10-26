const db = require('./database');
const { isTeam } = require('../domain/teams');

const listChannels = db.prepare(`
  SELECT channel_id AS key, game, team
  FROM reminder_channels
  WHERE guild_id = ?
  ORDER BY channel_id
`);
const listAllChannels = db.prepare('SELECT 1 FROM reminder_channels LIMIT 1');
const upsertChannel = db.prepare(`
  INSERT INTO reminder_channels (guild_id, channel_id, game, team)
  VALUES (@guildId, @channelId, @game, @team)
  ON CONFLICT(guild_id, channel_id) DO UPDATE SET
    game = excluded.game, team = excluded.team
`);
const deleteChannel = db.prepare(`
  DELETE FROM reminder_channels WHERE guild_id = ? AND channel_id = ?
`);
const updateMessageTeams = db.prepare(`
  UPDATE special_event_reminders SET team = @team
  WHERE channel_id = @channelId
    AND event_id IN (SELECT id FROM events WHERE guild_id = @guildId)
`);
const saveChannel = db.transaction((channel) => {
  upsertChannel.run(channel);
  updateMessageTeams.run({ guildId: channel.guildId, channelId: channel.channelId, team: channel.team });
});

function getReminderChannels(guildId) {
  return listChannels.all(guildId);
}

function hasReminderChannels() {
  return Boolean(listAllChannels.get());
}

function setReminderChannel(guildId, channelId, game, team) {
  // Omitting the team while changing a game's settings keeps its assignment.
  const selectedTeam = team ?? getReminderChannels(guildId).find(({ key }) => key === channelId)?.team ?? '';
  if (selectedTeam !== '' && !isTeam(selectedTeam)) throw new Error('Invalid channel team');
  saveChannel({ guildId, channelId, game, team: selectedTeam });
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
