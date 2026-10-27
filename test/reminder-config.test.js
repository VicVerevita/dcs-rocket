const { test, after, afterEach } = require('node:test');
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
const { getReminderChannels, setReminderChannel } = require('../src/db/reminderChannelRepository');
const { createEvent } = require('../src/db/eventRepository');
const { recordReminder, getReminderMessages } = require('../src/reminders/repository');
const { publishEditedReminder } = require('../src/reminders/scheduler');
const config = require('../src/commands/config');

const channelPermissions = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
]);

function makeInteraction(action, channelId = '789', game = 'lmu', permitted = true, canPost = true, team = null) {
  const replies = [];
  const posts = [];
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
    client: {
      user: { id: 'bot' },
      channels: { fetch: async (id) => ({
        guildId: '123',
        isTextBased: () => true,
        send: async (payload) => {
          const message = { id: `${id}-${posts.length + 1}`, author: { id: 'bot' } };
          posts.push({ channelId: id, payload, message });
          return message;
        },
        messages: { fetch: async () => ({ author: { id: 'bot' }, edit: async () => {}, delete: async () => {} }) },
      }) },
    },
    options: {
      getSubcommand: () => action,
      getChannel: () => channel,
      getString: (name) => name === 'team' ? team : game,
    },
    replies,
    posts,
    reply: async (reply) => { replies.push(reply); },
    deferReply: async (reply) => { replies.push(reply); },
    editReply: async (reply) => { replies.push(typeof reply === 'string' ? { content: reply } : reply); },
  };
}

afterEach(() => {
  db.exec('DELETE FROM events');
});

after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('staff configures game-specific channels and scheduler uses changes immediately', async () => {
  assert.deepEqual(getReminderChannels('123'), [{ key: '456', game: 'iracing', team: '' }]);
  assert.equal(config.data.toJSON().default_member_permissions, String(PermissionFlagsBits.ManageGuild));

  const denied = makeInteraction('set', '789', 'lmu', false);
  await config.execute(denied);
  assert.match(denied.replies.at(-1).content, /Manage Server/);
  assert.deepEqual(getReminderChannels('123'), [{ key: '456', game: 'iracing', team: '' }]);

  const noBotPermission = makeInteraction('set', '789', 'lmu', true, false);
  await config.execute(noBotPermission);
  assert.match(noBotPermission.replies.at(-1).content, /View Channel/);
  assert.deepEqual(getReminderChannels('123'), [{ key: '456', game: 'iracing', team: '' }]);

  const set = makeInteraction('set');
  await config.execute(set);
  assert.equal(set.replies[0].flags, MessageFlags.Ephemeral);
  assert.deepEqual(getReminderChannels('123'), [
    { key: '456', game: 'iracing', team: '' },
    { key: '789', game: 'lmu', team: '' },
  ]);

  const list = makeInteraction('list');
  await config.execute(list);
  assert.match(list.replies.at(-1).content, /<#456> - iRacing/);
  assert.match(list.replies.at(-1).content, /<#789> - Le Mans Ultimate/);

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
  assert.match(remove.replies.at(-1).content, /Removed/);
  assert.deepEqual(getReminderChannels('123'), [{ key: '456', game: 'iracing', team: '' }]);
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

test('team assignments are optional, validated, listed, and preserved on game changes', async () => {
  const invalid = makeInteraction('set', '789', 'lmu', true, true, 'unknown');
  await config.execute(invalid);
  assert.match(invalid.replies.at(-1).content, /Choose Main team/);
  assert.deepEqual(getReminderChannels('123'), []);

  await config.execute(makeInteraction('set', '789', 'lmu', true, true, 'academy'));
  assert.deepEqual(getReminderChannels('123'), [{ key: '789', game: 'lmu', team: 'academy' }]);
  await config.execute(makeInteraction('set', '789', 'both'));
  assert.deepEqual(getReminderChannels('123'), [{ key: '789', game: null, team: 'academy' }]);

  const list = makeInteraction('list');
  await config.execute(list);
  assert.match(list.replies.at(-1).content, /<#789> - Both games - Academy team/);

  await config.execute(makeInteraction('set', '789', 'both', true, true, 'all'));
  assert.deepEqual(getReminderChannels('123'), [{ key: '789', game: null, team: '' }]);
});

test('every config action acknowledges before reading options or permissions', async () => {
  for (const action of ['set', 'list', 'remove']) {
    const interaction = makeInteraction(action);
    let acknowledged = false;
    const defer = interaction.deferReply;
    interaction.deferReply = async (reply) => {
      assert.equal(reply.flags, MessageFlags.Ephemeral);
      acknowledged = true;
      await defer(reply);
    };
    const permissions = interaction.memberPermissions;
    Object.defineProperty(interaction, 'memberPermissions', {
      get: () => { assert.equal(acknowledged, true); return permissions; },
    });
    interaction.reply = async () => { assert.fail('Config must edit the deferred response'); };
    await config.execute(interaction);
    assert.equal(acknowledged, true);
  }
});

test('a rejected acknowledgement does not read options or modify channel settings', async () => {
  const interaction = makeInteraction('set');
  const before = getReminderChannels('123');
  const expired = Object.assign(new Error('Unknown interaction'), { code: 10062 });
  interaction.deferReply = async () => { throw expired; };
  interaction.options.getSubcommand = () => { assert.fail('Must stop after failed acknowledgement'); };
  await assert.rejects(config.execute(interaction), (error) => error === expired);
  assert.deepEqual(getReminderChannels('123'), before);
});

test('editing All teams to Main confirms the saved setting and skips original-bot posts', async () => {
  const now = Math.floor(Date.now() / 1000);
  const startsAt = now + 2 * 86400;
  const eventId = createEvent({
    guildId: '123', game: 'lmu', eventType: 'special_event', title: 'Existing race',
    startsAt, dateOnlyUntil: null, track: 'Spa', carClass: 'GT3',
    details: null, createdBy: 'staff', createdAt: now,
  });
  setReminderChannel('123', '987', 'lmu', '');
  for (const [messageId, authorId, leadDays] of [['foreign', 'original-bot', 7], ['own', 'bot', 3]]) {
    recordReminder({
      eventId, startsAt, leadDays, channelId: '987', messageId, authorId, sentAt: now,
    });
  }
  const set = makeInteraction('set', '987', 'lmu', true, true, 'main');
  const edited = [];
  const fetched = [];
  set.client.channels.fetch = async () => ({ messages: { fetch: async (messageId) => {
    fetched.push(messageId);
    assert.equal(messageId, 'own');
    return { author: { id: 'bot' }, edit: async (message) => { edited.push(message); } };
  } } });
  await config.execute(set);
  assert.equal(getReminderChannels('123').find(({ key }) => key === '987').team, 'main');
  assert.match(set.replies.at(-1).content, /Main team/);
  assert.match(set.replies.at(-1).content, /Skipped 1 existing reminder post created by another bot/);
  assert.doesNotMatch(set.replies.at(-1).content, /could not be refreshed/);
  assert.deepEqual(fetched, ['own']);
  assert.equal(edited.length, 1);
  assert.match(edited[0].embeds[0].toJSON().description, /\*\*Signup team:\*\* Main team/);
  assert.equal(getReminderMessages(eventId).length, 2);
});

test('saving a channel announces matching existing events only there and adds new game matches without duplicates', async () => {
  const now = Math.floor(Date.now() / 1000);
  const races = ['iracing', 'lmu'].map((game) => createEvent({
    guildId: '123', game, eventType: 'special_event', title: `${game} race`,
    startsAt: now + 30 * 86400, dateOnlyUntil: null, track: 'Spa', carClass: 'GT3',
    details: null, createdBy: 'staff', createdAt: now - 86400,
  }));
  setReminderChannel('123', '902', null, 'main');
  const interaction = makeInteraction('set', '901', 'lmu', true, true, 'academy');

  await config.execute(interaction);
  assert.match(interaction.replies.at(-1).content, /Posted 1 reminder for upcoming special events/);
  assert.deepEqual(interaction.posts.map(({ channelId }) => channelId), ['901']);
  assert.equal(getReminderMessages(races[0]).length, 0);
  assert.deepEqual(getReminderMessages(races[1]).map(({ lead_days, channel_id, team }) => ({ lead_days, channel_id, team })), [
    { lead_days: 0, channel_id: '901', team: 'academy' },
  ]);
  assert.match(interaction.posts[0].payload.embeds[0].toJSON().description, /Signup team:\*\* Academy team/);
  assert.match(interaction.posts[0].payload.components[0].toJSON().components[0].custom_id,
    new RegExp(`:team:academy:123:${races[1]}$`));

  await config.execute(interaction);
  assert.equal(interaction.posts.length, 1);
  assert.doesNotMatch(interaction.replies.at(-1).content, /Posted/);

  interaction.options.getString = (name) => name === 'team' ? null : 'both';
  await config.execute(interaction);
  assert.equal(interaction.posts.length, 2);
  assert.deepEqual(interaction.posts.map(({ channelId }) => channelId), ['901', '901']);
  assert.match(interaction.posts[1].payload.embeds[0].toJSON().title, /iracing race/);
  assert.equal(getReminderMessages(races[0])[0].team, 'academy');
  assert.match(interaction.replies.at(-1).content, /Posted 1 reminder/);

  interaction.options.getSubcommand = () => 'remove';
  await config.execute(interaction);
  interaction.options.getSubcommand = () => 'set';
  await config.execute(interaction);
  assert.equal(interaction.posts.length, 2);
});

test('a failed initial announcement saves channel settings and repeating the command retries it', async () => {
  const now = Math.floor(Date.now() / 1000);
  const eventId = createEvent({
    guildId: '123', game: 'lmu', eventType: 'special_event', title: 'Retry race',
    startsAt: now + 30 * 86400, dateOnlyUntil: null, track: 'Spa', carClass: 'GT3',
    details: null, createdBy: 'staff', createdAt: now,
  });
  const interaction = makeInteraction('set', '903', 'lmu', true, true, 'community');
  const fetch = interaction.client.channels.fetch;
  interaction.client.channels.fetch = async () => ({
    guildId: '123', isTextBased: () => true,
    send: async () => { throw new Error('Send failed'); },
  });
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => { errors.push(args); };
  try {
    await config.execute(interaction);
  } finally {
    console.error = originalError;
  }
  assert.equal(errors.length, 1);
  assert.deepEqual(getReminderChannels('123').find(({ key }) => key === '903'), {
    key: '903', game: 'lmu', team: 'community',
  });
  assert.equal(getReminderMessages(eventId).length, 0);
  assert.match(interaction.replies.at(-1).content, /Settings were saved, but some upcoming event reminders could not be sent/);
  assert.match(interaction.replies.at(-1).content, /Run this command again to retry/);

  interaction.client.channels.fetch = fetch;
  await config.execute(interaction);
  assert.equal(interaction.posts.length, 1);
  assert.equal(getReminderMessages(eventId)[0].team, 'community');
  assert.match(interaction.replies.at(-1).content, /Posted 1 reminder/);
  assert.doesNotMatch(interaction.replies.at(-1).content, /could not be sent/);
});
