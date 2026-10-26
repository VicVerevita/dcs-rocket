const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DateTime } = require('luxon');
const { MessageFlags } = require('discord.js');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-teams-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');

const db = require('../src/db/database');
const { createEvent, getEvent } = require('../src/db/eventRepository');
const { setReminderChannel, removeReminderChannel } = require('../src/db/reminderChannelRepository');
const { getResponse, getEventResponses, saveResponse } = require('../src/reminders/repository');
const { publishEditedReminder, publishLateReminder, checkReminders } = require('../src/reminders/scheduler');
const { checkPrivateReminders } = require('../src/reminders/private');
const { buildRsvpId } = require('../src/reminders/context');
const {
  handleReminderButton, handleReminderModal, refreshChannelReminderMessages,
} = require('../src/reminders/interactions');

beforeEach(() => {
  db.exec('DELETE FROM events; DELETE FROM reminder_channels;');
  for (const [channel, team] of [['101', 'main'], ['102', 'academy'], ['103', 'community'], ['104', ''], ['105', 'main']]) {
    setReminderChannel('123', channel, 'iracing', team);
  }
  setReminderChannel('123', '106', 'lmu', 'main');
});

after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

function scenario(game = 'iracing') {
  const now = Math.floor(Date.now() / 1000);
  const eventId = createEvent({
    guildId: '123', game, eventType: 'special_event', title: 'Team race',
    startsAt: now + 2 * 86400, dateOnlyUntil: null,
    track: 'Spa', carClass: 'GT3, GTP', details: null, createdBy: 'staff', createdAt: now,
  });
  const event = getEvent({ eventId, guildId: '123' });
  const posts = new Map();
  const dms = [];
  const client = {
    users: { fetch: async () => ({ send: async (message) => { dms.push(message); } }) },
    channels: { fetch: async (channelId) => ({
      guildId: '123', isTextBased: () => true,
      send: async (message) => {
        const id = `${channelId}-${posts.size}`;
        posts.set(id, { channelId, message });
        return { id };
      },
      messages: { fetch: async (id) => ({
        edit: async (message) => { posts.get(id).message = message; },
      }) },
    }) },
  };
  function interaction(customId, channelId = '101', userId = 'driver') {
    return {
      customId, channelId, guildId: channelId ? '123' : null,
      client, user: { id: userId }, replies: [], updates: [], modals: [],
      fields: {
        getTextInputValue: () => '10:00 or 14:00',
        getCheckboxGroup: (key) => key === 'days' ? ['Friday', 'Sunday'] : ['GT3', 'GTP'],
      },
      reply: async function (reply) { this.replies.push(reply); },
      update: async function (update) { this.updates.push(update); },
      showModal: async function (modal) { this.modals.push(modal.toJSON()); },
    };
  }
  function response(userId, team) {
    saveResponse({
      eventId, userId, team, attending: 1, days: game === 'iracing' ? 'Saturday' : 'Friday, Sunday',
      carClass: 'GT3', availabilityHours: game === 'iracing' ? '14:00' : null,
    });
  }
  function post(channelId) {
    return [...posts.values()].find((post) => post.channelId === channelId).message.embeds[0].toJSON();
  }
  return { event, eventId, posts, dms, client, interaction, response, post };
}

function buttonId(reply, index = 0) {
  return reply.components[0].components[index].data.custom_id;
}

function teamRoster(embed, name, day = 'Saturday') {
  const value = embed.fields.find((field) => field.name.includes(day.toUpperCase())).value;
  const heading = `**${name} team**\n`;
  assert.ok(value.includes(heading), `Missing ${name} team heading`);
  return value.split(heading)[1].split(/\n\n(?=\*\*(?:Main|Academy|Community|Unassigned) team\*\*)/)[0];
}

test('every reminder channel shows the same event roster grouped by team', async () => {
  const s = scenario();
  for (const [user, team] of [['main-driver', 'main'], ['academy-driver', 'academy'], ['community-driver', 'community'], ['legacy-driver', '']]) {
    s.response(user, team);
  }
  // Scheduled and late posts share every team's roster while keeping game filters.
  await checkReminders(s.client);
  await publishLateReminder(s.client, s.eventId, '123');
  assert.equal(s.posts.size, 5);
  for (const [channelId, team] of [['101', 'main'], ['102', 'academy'], ['103', 'community'], ['105', 'main']]) {
    const embed = s.post(channelId);
    assert.ok(embed.description.includes(`**Signup team:** ${team[0].toUpperCase() + team.slice(1)} team`));
    assert.deepEqual(embed.fields, s.post('104').fields);
    for (const [name, user] of [['Main', 'main-driver'], ['Academy', 'academy-driver'], ['Community', 'community-driver'], ['Unassigned', 'legacy-driver']]) {
      assert.match(teamRoster(embed, name), new RegExp(`<@${user}>`));
      assert.equal((teamRoster(embed, name).match(/<@/g) || []).length, 1);
    }
  }
  assert.equal((s.post('104').fields[0].value.match(/<@/g) || []).length, 4);
  assert.equal(getEventResponses(s.eventId).length, 4);
  assert.equal(getEventResponses(s.eventId, 'main').length, 1);
});

test('switching teams asks first, cancel preserves the signup, and accepting moves one record', async () => {
  const s = scenario();
  s.response('driver', 'main');
  await publishEditedReminder(s.client, s.eventId, '123');
  const click = s.interaction(buildRsvpId('yes', s.event, { team: 'academy' }), '102');
  await handleReminderButton(click);
  assert.equal(click.modals.length, 0);
  assert.equal(click.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(click.replies[0].content, /already signed up for team: Main.*change to Academy/);
  assert.equal(getResponse(s.eventId, 'driver').team, 'main');

  const cancel = s.interaction(buttonId(click.replies[0], 1), '102');
  await handleReminderButton(cancel);
  assert.equal(cancel.updates[0].components.length, 0);
  assert.equal(getResponse(s.eventId, 'driver').team, 'main');

  const confirm = s.interaction(buttonId(click.replies[0]), '102');
  await handleReminderButton(confirm);
  assert.equal(confirm.modals.length, 1);
  assert.equal(confirm.modals[0].components[0].component.value, '14:00');
  assert.equal(getResponse(s.eventId, 'driver').team, 'main');
  const submit = s.interaction(confirm.modals[0].custom_id, '102');
  await handleReminderModal(submit);
  assert.equal(getEventResponses(s.eventId).length, 1);
  assert.equal(getResponse(s.eventId, 'driver').team, 'academy');
  for (const channelId of ['101', '102', '103', '104', '105']) {
    assert.equal(teamRoster(s.post(channelId), 'Main'), 'No drivers yet.');
    assert.match(teamRoster(s.post(channelId), 'Academy'), /<@driver>/);
    assert.deepEqual(s.post(channelId).fields, s.post('104').fields);
  }

  // A confirmation cannot be reused to switch the record a second time.
  const reused = s.interaction(confirm.customId, '102');
  await handleReminderButton(reused);
  assert.match(reused.replies[0].content, /signup changed/);

  const decline = s.interaction(buildRsvpId('no', s.event, { team: 'main' }));
  await handleReminderButton(decline);
  assert.equal(getResponse(s.eventId, 'driver').attending, 1);
  const confirmDecline = s.interaction(buttonId(decline.replies[0]));
  await handleReminderButton(confirmDecline);
  assert.equal(getResponse(s.eventId, 'driver').team, 'main');
  assert.equal(getResponse(s.eventId, 'driver').attending, 0);
  assert.equal(getEventResponses(s.eventId).length, 1);
  assert.equal(s.post('101').fields.at(-1).value, '1\n||<@driver>||');
  assert.equal(s.post('102').fields.at(-1).value, '1\n||<@driver>||');
});

test('new and legacy server buttons select the channel team for both games', async () => {
  for (const game of ['iracing', 'lmu']) {
    const s = scenario(game);
    const channelId = game === 'iracing' ? '101' : '106';
    const click = s.interaction(`special-rsvp:yes:${s.eventId}`, channelId);
    await handleReminderButton(click);
    const submit = s.interaction(click.modals[0].custom_id, channelId);
    await handleReminderModal(submit);
    assert.equal(getResponse(s.eventId, 'driver').team, 'main');
    assert.equal(getResponse(s.eventId, 'driver').car_class, 'GT3, GTP');
    assert.equal(getResponse(s.eventId, 'driver').days, game === 'iracing' ? 'Saturday' : 'Friday, Sunday');
  }
});

test('stale forms and prompts cannot silently overwrite a newer team assignment', async () => {
  const s = scenario();
  const click = s.interaction(buildRsvpId('yes', s.event, { team: 'academy' }), '102');
  await handleReminderButton(click);
  s.response('driver', 'main');
  const staleSubmit = s.interaction(click.modals[0].custom_id, '102');
  await handleReminderModal(staleSubmit);
  assert.match(staleSubmit.replies[0].content, /signup changed/);
  assert.equal(getResponse(s.eventId, 'driver').team, 'main');

  const prompt = s.interaction(click.customId, '102');
  await handleReminderButton(prompt);
  s.response('driver', 'community');
  const staleConfirm = s.interaction(buttonId(prompt.replies[0]), '102');
  await handleReminderButton(staleConfirm);
  assert.match(staleConfirm.replies[0].content, /signup changed/);
  assert.equal(getResponse(s.eventId, 'driver').team, 'community');

  setReminderChannel('123', '102', 'iracing', 'main');
  const reassigned = s.interaction(click.customId, '102');
  await handleReminderButton(reassigned);
  assert.match(reassigned.replies[0].content, /no longer available/);
  assert.equal(getResponse(s.eventId, 'driver').team, 'community');
});

test('DM signups retain their originating team and old DMs follow the single signup after a switch', async () => {
  const s = scenario();
  await publishEditedReminder(s.client, s.eventId, '123');
  const request = s.interaction(buildRsvpId('remind_me_again', s.event, { team: 'academy' }), '102');
  await handleReminderButton(request);
  const pending = db.prepare('SELECT * FROM special_event_private_reminders').all();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].team, 'academy');
  await checkPrivateReminders(s.client, DateTime.fromSeconds(pending[0].remind_at + 1));
  assert.equal(s.dms.length, 1);
  const oldDmId = buttonId(s.dms[0], 1);
  const yes = s.interaction(buttonId(s.dms[0]), null);
  await handleReminderButton(yes);
  const submit = s.interaction(yes.modals[0].custom_id, null);
  await handleReminderModal(submit);
  assert.equal(getResponse(s.eventId, 'driver').team, 'academy');
  assert.match(s.post('102').fields[0].value, /<@driver>/);

  const move = s.interaction(buildRsvpId('yes', s.event, { team: 'main' }));
  await handleReminderButton(move);
  const confirm = s.interaction(buttonId(move.replies[0]));
  await handleReminderButton(confirm);
  await handleReminderModal(s.interaction(confirm.modals[0].custom_id));
  const no = s.interaction(oldDmId, null);
  await handleReminderButton(no);
  assert.equal(getResponse(s.eventId, 'driver').team, 'main');
  assert.equal(getResponse(s.eventId, 'driver').attending, 0);
  assert.equal(getEventResponses(s.eventId).length, 1);
  assert.equal(s.post('101').fields.at(-1).value, '1\n||<@driver>||');
  assert.equal(s.post('102').fields.at(-1).value, '1\n||<@driver>||');

  // Changing back to driving removes the driver from every channel's spoiler list.
  const drivingAgain = s.interaction(buildRsvpId('yes', s.event, { team: 'main' }));
  await handleReminderButton(drivingAgain);
  await handleReminderModal(s.interaction(drivingAgain.modals[0].custom_id));
  assert.equal(s.post('101').fields.at(-1).value, '0');
  assert.equal(s.post('102').fields.at(-1).value, '0');
  assert.match(teamRoster(s.post('101'), 'Main'), /<@driver>/);
});

test('changing a channel team keeps the combined roster and updates its signup context', async () => {
  const s = scenario();
  s.response('main-driver', 'main');
  s.response('academy-driver', 'academy');
  await publishEditedReminder(s.client, s.eventId, '123');
  assert.match(s.post('104').fields[0].value, /academy-driver/);
  const previousFields = s.post('104').fields;
  setReminderChannel('123', '104', 'iracing', 'main');
  assert.deepEqual(await refreshChannelReminderMessages(s.client, '123', '104'), { failures: 0, skippedForeign: 0 });
  assert.deepEqual(s.post('104').fields, previousFields);
  assert.match(s.post('104').description, /\*\*Signup team:\*\* Main team/);

  removeReminderChannel('123', '104');
  await handleReminderButton(s.interaction(`special-rsvp:no:${s.eventId}`, '101', 'main-driver'));
  assert.equal(teamRoster(s.post('104'), 'Main'), 'No drivers yet.');
  assert.match(teamRoster(s.post('104'), 'Academy'), /<@academy-driver>/);
  assert.equal(s.post('104').fields.at(-1).value, '1\n||<@main-driver>||');
});

test('reminder delivery ignores copied events and channels outside the configured guilds', async () => {
  const now = Math.floor(Date.now() / 1000);
  const eventId = createEvent({
    guildId: '456', game: 'iracing', eventType: 'special_event', title: 'Other server race',
    startsAt: now + 2 * 86400, dateOnlyUntil: null,
    track: 'Spa', carClass: 'GT3', details: null, createdBy: 'staff', createdAt: now,
  });
  setReminderChannel('456', 'foreign-channel', 'iracing', 'main');
  const fetched = [];
  const client = { channels: { fetch: async (id) => {
    fetched.push(id);
    return { guildId: '456', isTextBased: () => true, send: async () => ({ id: 'unexpected' }) };
  } } };
  await checkReminders(client);
  await publishLateReminder(client, eventId, '456');
  await publishEditedReminder(client, eventId, '456');
  assert.deepEqual(fetched, []);
  assert.equal(getEvent({ eventId, guildId: '456' }).title, 'Other server race');
});
