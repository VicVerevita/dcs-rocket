const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DateTime } = require('luxon');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-league-reminders-'));
Object.assign(process.env, {
  DISCORD_TOKEN: 'test', CLIENT_ID: 'test', GUILD_IDS: '123',
  REMINDER_CHANNELS: '', DEFAULT_TIMEZONE: 'Europe/Berlin',
  DATABASE_PATH: path.join(directory, 'events.sqlite'),
});
const db = require('../src/db/database');
const { createEvent, getEvent, editEvent } = require('../src/db/eventRepository');
const { getLeagueRaces } = require('../src/db/raceRepository');
const { handleRaceModal } = require('../src/interactions/raceModal');
const deleteRaceCommand = require('../src/commands/delete-race');
const tierCommand = require('../src/commands/league-tier');
const { getLeagueTiers } = require('../src/db/leagueRepository');
const { setReminderChannel } = require('../src/db/reminderChannelRepository');
const { getResponse, getReminderMessages } = require('../src/reminders/repository');
const { handleReminderButton, handleReminderModal } = require('../src/reminders/interactions');
const { publishLateReminder, publishEditedReminder, publishChannelReminders, checkReminders } = require('../src/reminders/scheduler');
const { checkPrivateReminders } = require('../src/reminders/private');
const { buildReminderMessage } = require('../src/reminders/messages');

after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => {
  db.exec('DELETE FROM events; DELETE FROM reminder_channels');
  setReminderChannel('123', 'main', null, 'main');
  setReminderChannel('123', 'academy', 'lmu', 'academy');
});

function league(overrides = {}) {
  const id = createEvent({
    guildId: '123', game: 'iracing', eventType: 'league', title: 'GT3 season',
    startsAt: null, dateOnlyUntil: null, track: '', carClass: null, details: null,
    createdBy: 'staff', createdAt: Math.floor(Date.now() / 1000), ...overrides,
  });
  return getEvent({ eventId: id, guildId: '123' });
}

function fixture() {
  const posts = [], edits = [], deleted = [], dms = [];
  const client = {
    user: { id: 'bot' },
    channels: { fetch: async (channelId) => ({
      guildId: '123', isTextBased: () => true,
      send: async (message) => {
        const id = `post-${posts.length + 1}`;
        posts.push({ channelId, message, id });
        return { id, author: { id: 'bot' } };
      },
      messages: { fetch: async (id) => ({
        author: { id: 'bot' }, delete: async () => deleted.push(id),
        edit: async (message) => edits.push({ id, message }),
      }) },
    }) },
    users: { fetch: async (userId) => ({ send: async (message) => dms.push({ userId, message }) }) },
  };
  return { client, posts, edits, deleted, dms };
}

async function press(event, action, fx, { userId = 'driver', channelId = 'main', customId, message } = {}) {
  const replies = [];
  await handleReminderButton({
    guildId: channelId ? '123' : null, channelId, customId: customId || `special-rsvp:${action}:${event.id}`,
    user: { id: userId }, client: fx.client, message,
    reply: async (value) => replies.push(value),
    showModal: async () => assert.fail('League interest should not open a driver form'),
  });
  return replies;
}

test('undated leagues announce once, use interest buttons and keep date-free reminders stable', async () => {
  const event = league();
  const fx = fixture();
  await publishLateReminder(fx.client, event.id, '123');
  await checkReminders(fx.client);
  await publishChannelReminders(fx.client, '123', 'main');
  assert.equal(fx.posts.length, 1);
  const message = fx.posts[0].message;
  assert.equal(message.content, '@here');
  assert.match(message.embeds[0].data.description, /Dates to be announced/);
  assert.deepEqual(message.components[0].components.map((button) => button.data.label),
    ['Interested', 'Not interested', 'Remind me again']);
  assert.equal(getReminderMessages(event.id)[0].starts_at, 0);
  await press(event, 'yes', fx);
  assert.equal(getResponse(event.id, 'driver').attending, 1);
  assert.equal(getResponse(event.id, 'driver').car_class, null);
  assert.equal(getResponse(event.id, 'driver').team, 'main');
  assert.match(fx.edits.at(-1).message.embeds[0].data.fields[0].value, /<@driver>/);
  await press(event, 'no', fx);
  assert.equal(getResponse(event.id, 'driver').attending, 0);
  assert.match(fx.edits.at(-1).message.embeds[0].data.fields.find((field) => field.name === 'Not interested').value, /\|\|<@driver>\|\|/);
  assert.deepEqual(fx.edits.at(-1).message.allowedMentions, { parse: [] });
});

test('league reminder DMs send next day without dates and update the same interest record', async () => {
  const event = league({ tierNames: ['Pro', 'Am'] });
  const fx = fixture();
  await publishLateReminder(fx.client, event.id, '123');
  await press(event, 'remind_me_again', fx);
  const pending = db.prepare('SELECT * FROM special_event_private_reminders WHERE event_id = ?').get(event.id);
  assert.equal(pending.team, 'main');
  await checkPrivateReminders(fx.client, DateTime.fromSeconds(pending.remind_at + 1));
  await checkPrivateReminders(fx.client, DateTime.fromSeconds(pending.remind_at + 2));
  assert.equal(fx.dms.length, 1);
  const dm = fx.dms[0].message;
  assert.equal(dm.embeds[0].data.fields.find((field) => field.name === 'Tiers (2)').value, 'Pro, Am');
  const privateEdits = [];
  await press(event, 'yes', fx, {
    channelId: null, customId: dm.components[0].components[0].data.custom_id,
    message: { edit: async (value) => privateEdits.push(value) },
  });
  assert.equal(getResponse(event.id, 'driver').team, 'main');
  assert.equal(getResponse(event.id, 'driver').attending, 1);
  assert.match(privateEdits[0].embeds[0].data.description, /Your response:\*\* Interested/);
  assert.equal(fx.edits.length, 1);
});

test('adding, renaming and removing tiers edits the existing reminder without publishing or pinging', async () => {
  const event = league({ tierNames: ['Pro'] });
  const fx = fixture();
  await publishLateReminder(fx.client, event.id, '123');
  assert.equal(fx.posts[0].message.embeds[0].data.fields.find((field) => field.name === 'Tiers (1)').value, 'Pro');
  await press(event, 'yes', fx);
  const manage = async (action, name, tierId) => {
    await tierCommand.execute({ guildId: '123', client: fx.client,
      options: { getInteger: (key) => key === 'league-id' ? event.id : tierId,
        getString: () => name, getSubcommand: () => action },
      reply: async () => {},
    });
    return fx.edits.at(-1).message.embeds[0].data.fields.find((field) => field.name.startsWith('Tiers (')).value;
  };
  assert.equal(await manage('add', 'Am'), 'Pro, Am');
  const tierId = getLeagueTiers({ leagueId: event.id, guildId: '123' }).at(-1).id;
  assert.equal(await manage('rename', 'Rookie', tierId), 'Pro, Rookie');
  assert.equal(await manage('remove', null, tierId), 'Pro');
  assert.equal(fx.posts.length, 1);
  assert.equal(getReminderMessages(event.id).length, 1);
  assert.equal(getResponse(event.id, 'driver').attending, 1);
  for (const edit of fx.edits) {
    assert.equal(Object.hasOwn(edit.message, 'content'), false);
    assert.deepEqual(edit.message.allowedMentions, { parse: [] });
  }
});

test('league team switches require confirmation and expired seasons reject responses and DMs', async () => {
  const event = league({ game: 'lmu' });
  const fx = fixture();
  await press(event, 'yes', fx);
  const replies = await press(event, 'no', fx, { channelId: 'academy' });
  assert.equal(getResponse(event.id, 'driver').team, 'main');
  const confirm = replies[0].components[0].components[0].data.custom_id;
  await press(event, 'no', fx, { channelId: 'academy', customId: confirm });
  assert.equal(getResponse(event.id, 'driver').team, 'academy');
  assert.equal(getResponse(event.id, 'driver').attending, 0);
  const ended = league({ startsAt: 1000, dateOnlyUntil: 2000 });
  const unavailable = await press(ended, 'yes', fx);
  assert.match(unavailable[0].content, /no longer available/);
  const noReminder = await press(ended, 'remind_me_again', fx);
  assert.match(noReminder[0].content, /no longer available/);
  assert.equal(getResponse(ended.id, 'driver'), undefined);
  const modalReplies = [];
  await handleReminderModal({ guildId: '123', customId: `special-rsvp:submit:${event.id}`,
    user: { id: 'driver' }, reply: async (value) => modalReplies.push(value) });
  assert.match(modalReplies[0].content, /no longer available/);
});

test('dated leagues announce immediately then send season reminders, with ongoing seasons kept active', async () => {
  const start = DateTime.now().setZone('Europe/Berlin').startOf('day').plus({ days: 20 });
  const event = league({ startsAt: start.toSeconds(), dateOnlyUntil: start.plus({ months: 2 }).toSeconds() });
  const fx = fixture();
  await publishLateReminder(fx.client, event.id, '123');
  assert.equal(fx.posts.length, 1);
  await checkReminders(fx.client, start.minus({ days: 7 }).set({ hour: 9 }));
  assert.equal(fx.posts.length, 2);
  assert.match(fx.posts[1].message.embeds[0].data.description, /Season starts in 7 days/);
  assert.deepEqual(fx.deleted, ['post-1']);
  const ongoing = league({ startsAt: Math.floor(Date.now() / 1000) - 86400,
    dateOnlyUntil: Math.floor(Date.now() / 1000) + 20 * 86400 });
  await publishLateReminder(fx.client, ongoing.id, '123');
  const response = await press(ongoing, 'yes', fx, { userId: 'ongoing-driver' });
  assert.match(response[0].content, /interested/);
});

test('race changes stay out of reminders while league edits preserve interest and replace the post', async () => {
  const event = league();
  const fx = fixture();
  await publishLateReminder(fx.client, event.id, '123');
  await press(event, 'yes', fx);
  const fields = { getTextInputValue: (key) => ({ title: 'Round 1', start: '03.10.2030 14:00',
    track: 'Spa', qualifying: '15 minutes, solo', details: 'Standing start' })[key] };
  const submission = { guildId: '123', client: fx.client, user: { id: 'staff' }, fields, reply: async () => {} };
  await handleRaceModal({ ...submission, customId: `add-race:${event.id}` });
  const [race] = getLeagueRaces({ leagueId: event.id, guildId: '123' });
  await handleRaceModal({ ...submission, customId: `edit-race:${race.id}` });
  await deleteRaceCommand.execute({ ...submission, options: { getInteger: () => race.id } });
  assert.equal(fx.posts.length, 1, 'Race mutations must not publish league reminders');
  const posted = fx.posts[0].message.embeds[0].toJSON();
  assert.doesNotMatch(JSON.stringify(posted), /Round 1|15 minutes/);
  assert.equal(posted.fields.some((field) => field.name === 'Race schedule'), false);
  editEvent({ eventId: event.id, guildId: '123', title: event.title,
    startsAt: Math.floor(Date.now() / 1000) + 86400, dateOnlyUntil: Math.floor(Date.now() / 1000) + 86400 * 60,
    track: '', carClass: null, details: null });
  await publishEditedReminder(fx.client, event.id, '123');
  assert.equal(fx.posts.length, 2);
  assert.equal(getReminderMessages(event.id).length, 1);
  assert.equal(getResponse(event.id, 'driver').attending, 1);
  assert.deepEqual(fx.deleted, ['post-1']);
});

test('large league rosters and prequalification details fit Discord limits without race schedules', () => {
  const event = { ...league(), title: 'T'.repeat(100), details: 'D'.repeat(1000),
    track: 'S'.repeat(100), car_class: 'C'.repeat(100),
    prequal_kind: 'race', prequal_starts_at: 2000000000, prequal_date_only_until: 2000086400,
    prequal_details: 'P'.repeat(1000),
    tiers: Array.from({ length: 30 }, (_, index) => ({ name: `${index} ${'N'.repeat(97)}` })) };
  const responses = Array.from({ length: 500 }, (_, index) => ({
    user_id: String(100000000000000000n + BigInt(index)),
    attending: index % 5 !== 0, team: ['main', 'academy', 'community', ''][index % 4],
  }));
  const races = Array.from({ length: 30 }, (_, index) => ({
    title: 'R'.repeat(100), starts_at: Math.floor(Date.now() / 1000) + 86400 * (index + 1),
    track: 'S'.repeat(100), qualifying: 'Q'.repeat(1000),
  }));
  const embed = buildReminderMessage(event, 0, responses, 'main', races).embeds[0].toJSON();
  let total = embed.title.length + embed.description.length + embed.footer.text.length;
  for (const field of embed.fields) {
    assert.ok(field.value.length <= 1024);
    total += field.name.length + field.value.length;
  }
  assert.ok(total <= 6000);
  const declined = embed.fields.find((field) => field.name === 'Not interested');
  assert.equal((declined.value.match(/\|\|/g) || []).length, 2);
  assert.match(embed.description, /Pre-qualification race/);
  assert.match(embed.footer.text, /leagues league-id:/);
  assert.match(embed.fields.find((field) => field.name === 'Tiers (30)').value, /…and \d+ more/);
  assert.doesNotMatch(JSON.stringify(embed), /RRRR|Race schedule.*value/);
});

test('prequalification is included in announcements, scheduled posts, silent refreshes and private reminders', async () => {
  const start = DateTime.now().setZone('Europe/Berlin').startOf('day').plus({ days: 20 });
  const event = league({ startsAt: start.toSeconds(), dateOnlyUntil: start.plus({ months: 2 }).toSeconds(),
    prequalification: { kind: 'signup', startsAt: null, dateOnlyUntil: null, details: 'https://example.com/league-signup' } });
  const fx = fixture();
  await publishChannelReminders(fx.client, '123', 'main');
  assert.match(fx.posts[0].message.embeds[0].data.description, /Pre-qualification signup[\s\S]*example.com\/league-signup/);
  await press(event, 'yes', fx);
  assert.match(fx.edits.at(-1).message.embeds[0].data.description, /example.com\/league-signup/);
  await checkReminders(fx.client, start.minus({ days: 7 }).set({ hour: 9 }));
  assert.match(fx.posts.at(-1).message.embeds[0].data.description, /example.com\/league-signup/);
  await press(event, 'remind_me_again', fx);
  const pending = db.prepare('SELECT remind_at FROM special_event_private_reminders WHERE event_id = ?').get(event.id);
  await checkPrivateReminders(fx.client, DateTime.fromSeconds(pending.remind_at + 1));
  assert.match(fx.dms[0].message.embeds[0].data.description, /Pre-qualification signup[\s\S]*example.com\/league-signup/);
});
