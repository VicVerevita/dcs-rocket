const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ChannelType, MessageFlags, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-reminder-config-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '123:456:1';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');

const db = require('../src/db/database');
const { getReminderChannels } = require('../src/db/reminderChannelRepository');
const { createEvent } = require('../src/db/eventRepository');
const { publishEditedReminder } = require('../src/reminders/scheduler');
const config = require('../src/commands/config');

const channelPermissions = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
]);

function makeInteraction(action, channelId = '789', game = 'lmu', permitted = true, canPost = true) {
  const replies = [];
  const channel = {
    id: channelId,
    guildId: '123',
    type: ChannelType.GuildText,
    permissionsFor: () => canPost ? channelPermissions : new PermissionsBitField(),
  };
  return {
    guildId: '123',
    guild: {
      channels: { fetch: async () => channel },
      members: { fetchMe: async () => ({ id: 'bot' }) },
    },
    memberPermissions: new PermissionsBitField(permitted ? PermissionFlagsBits.ManageGuild : 0n),
    client: { user: { id: 'bot' } },
    options: {
      getSubcommand: () => action,
      getChannel: () => channel,
      getString: () => game,
    },
    replies,
    reply: async (reply) => { replies.push(reply); },
    deferReply: async (reply) => { replies.push(reply); },
    editReply: async (content) => { replies.push({ content }); },
  };
}

after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('staff configures game-specific channels and scheduler uses changes immediately', async () => {
  assert.deepEqual(getReminderChannels('123'), [{ key: '456', game: 'iracing' }]);
  assert.equal(config.data.toJSON().default_member_permissions, String(PermissionFlagsBits.ManageGuild));

  const denied = makeInteraction('set', '789', 'lmu', false);
  await config.execute(denied);
  assert.match(denied.replies[0].content, /Manage Server/);
  assert.deepEqual(getReminderChannels('123'), [{ key: '456', game: 'iracing' }]);

  const noBotPermission = makeInteraction('set', '789', 'lmu', true, false);
  await config.execute(noBotPermission);
  assert.match(noBotPermission.replies.at(-1).content, /View Channel/);
  assert.deepEqual(getReminderChannels('123'), [{ key: '456', game: 'iracing' }]);

  const set = makeInteraction('set');
  await config.execute(set);
  assert.equal(set.replies[0].flags, MessageFlags.Ephemeral);
  assert.deepEqual(getReminderChannels('123'), [
    { key: '456', game: 'iracing' },
    { key: '789', game: 'lmu' },
  ]);

  const list = makeInteraction('list');
  await config.execute(list);
  assert.match(list.replies[0].content, /<#456> — iRacing/);
  assert.match(list.replies[0].content, /<#789> — Le Mans Ultimate/);

  const now = Math.floor(Date.now() / 1000);
  const startsAt = now + 30 * 86400;
  const sentTo = [];
  const client = { channels: { fetch: async (channelId) => ({
    guildId: '123', isTextBased: () => true,
    send: async () => { sentTo.push(channelId); return { id: String(sentTo.length) }; },
  }) } };
  for (const game of ['iracing', 'lmu']) {
    const eventId = createEvent({
      guildId: '123', game, eventType: 'special_event', title: 'Race',
      startsAt, dateOnlyUntil: null, track: 'Spa', carClass: 'GT3',
      details: null, createdBy: 'staff', createdAt: now,
    });
    await publishEditedReminder(client, eventId, '123');
  }
  assert.deepEqual(sentTo, ['456', '789']);

  const remove = makeInteraction('remove');
  await config.execute(remove);
  assert.match(remove.replies[0].content, /Removed/);
  assert.deepEqual(getReminderChannels('123'), [{ key: '456', game: 'iracing' }]);
  await config.execute(makeInteraction('remove', '456'));
  assert.deepEqual(getReminderChannels('123'), []);

  const restarted = spawnSync(process.execPath, ['-e', `
    const db = require('./src/db/database');
    console.log(JSON.stringify(db.prepare('SELECT channel_id, game FROM reminder_channels ORDER BY channel_id').all()));
    db.close();
  `], { cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8' });
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout.trim().split('\n').at(-1)), []);
});
