const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DateTime } = require('luxon');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-reminder-replacement-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');
process.env.DEFAULT_TIMEZONE = 'Europe/Berlin';

const db = require('../src/db/database');
const { createEvent, editEvent } = require('../src/db/eventRepository');
const { setReminderChannel } = require('../src/db/reminderChannelRepository');
const {
  getEventResponses, getReminderMessages, getReminderRecord, recordReminder, saveResponse,
} = require('../src/reminders/repository');
const { checkReminders, publishEditedReminder, publishLateReminder } = require('../src/reminders/scheduler');
const { refreshChannelReminderMessages } = require('../src/reminders/interactions');

beforeEach(() => {
  db.exec('DELETE FROM events; DELETE FROM reminder_channels;');
  setReminderChannel('123', '456', 'iracing', 'main');
});

after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

function event(late = false) {
  const start = DateTime.now().setZone('Europe/Berlin').plus({ days: late ? 2 : 14 }).set({
    hour: 12, minute: 0, second: 0, millisecond: 0,
  });
  const startsAt = Math.floor(start.toSeconds());
  const eventId = createEvent({
    guildId: '123', game: 'iracing', eventType: 'special_event', title: 'Race',
    startsAt, dateOnlyUntil: null, track: 'Spa', carClass: 'GT3', details: null,
    createdBy: 'staff', createdAt: Math.floor(start.minus({ days: late ? 2 : 14 }).toSeconds()),
  });
  return { eventId, start, startsAt };
}

function discord() {
  let sequence = 0;
  const posts = new Map();
  const actions = [];
  const sendErrors = new Map();
  const deleteErrors = new Map();
  const client = {
    user: { id: 'bot' },
    channels: { fetch: async (channelId) => ({
      guildId: '123', isTextBased: () => true,
      send: async (payload) => {
        if (sendErrors.has(channelId)) throw sendErrors.get(channelId);
        const id = `new-${++sequence}`;
        posts.set(id, { channelId, payload, authorId: 'bot' });
        actions.push(['send', channelId, id]);
        return { id, author: { id: 'bot' } };
      },
      messages: { fetch: async (id) => {
        actions.push(['fetch', channelId, id]);
        const post = posts.get(id);
        if (!post || post.channelId !== channelId) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
        return {
          author: { id: post.authorId },
          delete: async () => {
            if (deleteErrors.has(id)) throw deleteErrors.get(id);
            posts.delete(id);
            actions.push(['delete', channelId, id]);
          },
          edit: async (payload) => {
            post.payload = payload;
            actions.push(['edit', channelId, id]);
          },
        };
      } },
    }) },
  };
  function seed(race, messageId, { channelId = '456', leadDays = 7, authorId = 'bot', known = true } = {}) {
    posts.set(messageId, { channelId, authorId });
    recordReminder({
      eventId: race.eventId, startsAt: race.startsAt, leadDays, channelId, messageId,
      sentAt: Math.floor(Date.now() / 1000), authorId: known ? authorId : null,
    });
  }
  return { client, posts, actions, sendErrors, deleteErrors, seed };
}

async function captureErrors(run) {
  const errors = [];
  const previous = console.error;
  console.error = (...args) => { errors.push(args); };
  try {
    await run();
  } finally {
    console.error = previous;
  }
  return errors;
}

test('scheduled stages replace the previous post, preserve responses, and stay deduplicated after restart', async () => {
  const race = event();
  const d = discord();
  saveResponse({
    eventId: race.eventId, userId: 'driver', attending: 1, days: 'Saturday', carClass: 'GT3',
    availabilityHours: '14:00', team: 'main',
  });
  const responses = getEventResponses(race.eventId);
  for (const leadDays of [7, 3, 1]) {
    const tick = race.start.minus({ days: leadDays }).set({ hour: 9 });
    await checkReminders(d.client, tick);
    await checkReminders(d.client, tick.plus({ minutes: 5 }));
    assert.equal(d.posts.size, 1);
    const [messageId, post] = [...d.posts][0];
    assert.deepEqual(getReminderMessages(race.eventId).map(({ message_id }) => message_id), [messageId]);
    assert.ok(getReminderRecord(race.eventId, race.startsAt, leadDays, '456'));
    assert.match(post.payload.embeds[0].toJSON().fields[0].value, /<@driver> \(14:00\)/);
  }
  assert.deepEqual(d.actions.filter(([action]) => action !== 'fetch'), [
    ['send', '456', 'new-1'], ['send', '456', 'new-2'], ['delete', '456', 'new-1'],
    ['send', '456', 'new-3'], ['delete', '456', 'new-2'],
  ]);
  assert.deepEqual(getEventResponses(race.eventId), responses);

  const restarted = spawnSync(process.execPath, ['-e', `
    const { DateTime } = require('luxon');
    const db = require('./src/db/database');
    const { checkReminders } = require('./src/reminders/scheduler');
    const { getReminderMessages } = require('./src/reminders/repository');
    let fetches = 0;
    checkReminders({ channels: { fetch: async () => { fetches++; } } },
      DateTime.fromSeconds(${race.start.minus({ days: 1 }).set({ hour: 10 }).toSeconds()}, { zone: 'Europe/Berlin' }))
      .then(() => {
        console.log(JSON.stringify({ fetches, messages: getReminderMessages(${race.eventId}).map(r => r.message_id) }));
        db.close();
      });
  `], { cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8' });
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout.trim().split('\n').at(-1)), {
    fetches: 0, messages: ['new-3'],
  });

  d.actions.length = 0;
  assert.deepEqual(await refreshChannelReminderMessages(d.client, '123', '456'), { failures: 0, skippedForeign: 0 });
  assert.deepEqual(d.actions, [['fetch', '456', 'new-3'], ['edit', '456', 'new-3']]);
});

test('a late announcement is replaced without recreating its deleted initial stage', async () => {
  const race = event(true);
  const d = discord();
  await publishLateReminder(d.client, race.eventId, '123');
  const tick = race.start.minus({ days: 1 }).set({ hour: 9 });
  await checkReminders(d.client, tick);
  await publishLateReminder(d.client, race.eventId, '123');
  await checkReminders(d.client, tick.plus({ minutes: 5 }));
  assert.deepEqual([...d.posts.keys()], ['new-2']);
  assert.equal(d.actions.filter(([action]) => action === 'send').length, 2);
  assert.ok(getReminderRecord(race.eventId, race.startsAt, 7, '456'));
});

test('date changes replace all older posts for that event in each configured channel', async () => {
  const race = event();
  const other = event();
  const d = discord();
  setReminderChannel('123', '789', 'iracing', 'academy');
  d.seed(race, 'old-7');
  d.seed(race, 'old-3', { leadDays: 3 });
  d.seed(race, 'other-channel', { channelId: '789' });
  d.seed(other, 'other-event');
  d.seed(race, 'removed-channel', { channelId: '987' });
  assert.equal(editEvent({
    eventId: race.eventId, guildId: '123', title: 'New date', startsAt: race.startsAt + 86400,
    dateOnlyUntil: null, track: 'Spa', carClass: 'GT3', details: null,
  }), true);
  await publishEditedReminder(d.client, race.eventId, '123');
  assert.deepEqual([...d.posts.keys()].sort(), ['new-1', 'new-2', 'other-event', 'removed-channel']);
  assert.deepEqual(getReminderMessages(race.eventId, race.startsAt + 86400)
    .map(({ channel_id }) => channel_id).sort(), ['456', '789']);
  assert.ok(getReminderRecord(race.eventId, race.startsAt, 7, '456'));
  assert.ok(getReminderRecord(race.eventId, race.startsAt, 3, '456'));
});

test('a failed send leaves the previous post and delivery state intact until retry succeeds', async () => {
  const race = event();
  const d = discord();
  d.seed(race, 'previous');
  d.sendErrors.set('456', new Error('Send failed'));
  const errors = await captureErrors(() => publishEditedReminder(d.client, race.eventId, '123'));
  assert.equal(errors.length, 1);
  assert.deepEqual(d.actions, []);
  assert.deepEqual([...d.posts.keys()], ['previous']);
  assert.equal(getReminderRecord(race.eventId, race.startsAt, -1, '456'), undefined);
  d.sendErrors.clear();
  await publishEditedReminder(d.client, race.eventId, '123');
  assert.deepEqual([...d.posts.keys()], ['new-1']);
  assert.ok(getReminderRecord(race.eventId, race.startsAt, -1, '456'));
});

test('missing old messages retain delivery history and do not block other deletions', async () => {
  const race = event();
  const d = discord();
  d.seed(race, 'missing');
  d.posts.delete('missing');
  d.seed(race, 'previous', { leadDays: 3 });
  const errors = await captureErrors(() => publishEditedReminder(d.client, race.eventId, '123'));
  assert.deepEqual(errors, []);
  assert.deepEqual([...d.posts.keys()], ['new-1']);
  assert.deepEqual(getReminderMessages(race.eventId).map(({ message_id }) => message_id), ['new-1']);
  assert.ok(getReminderRecord(race.eventId, race.startsAt, 7, '456'));
});

test('deletion failures keep the new post, allow other deletions, and retry with the next update', async () => {
  const race = event();
  const d = discord();
  d.seed(race, 'permission-failure');
  d.seed(race, 'previous', { leadDays: 3 });
  d.deleteErrors.set('permission-failure', Object.assign(new Error('Missing permissions'), {
    code: 50013, requestBody: { token: 'private-token' }, url: 'https://example.test/private-url',
  }));
  const errors = await captureErrors(() => publishEditedReminder(d.client, race.eventId, '123'));
  assert.equal(errors.length, 1);
  assert.deepEqual(errors[0][1], {
    eventId: race.eventId, channelId: '456', messageId: 'permission-failure', code: 50013,
    message: 'Missing permissions',
  });
  assert.doesNotMatch(JSON.stringify(errors), /private-token|private-url/);
  assert.deepEqual([...d.posts.keys()], ['permission-failure', 'new-1']);
  assert.ok(getReminderRecord(race.eventId, race.startsAt, -1, '456'));
  d.deleteErrors.clear();
  await publishEditedReminder(d.client, race.eventId, '123');
  assert.deepEqual([...d.posts.keys()], ['new-2']);
  assert.deepEqual(getReminderMessages(race.eventId).map(({ message_id }) => message_id), ['new-2']);
});

test('replacement skips foreign posts and remembers newly discovered authors', async () => {
  const race = event();
  const d = discord();
  d.seed(race, 'known-foreign', { authorId: 'original-bot' });
  d.seed(race, 'unknown-foreign', { authorId: 'original-bot', known: false, leadDays: 3 });
  d.seed(race, 'unknown-owned', { known: false, leadDays: 1 });
  await publishEditedReminder(d.client, race.eventId, '123');
  assert.deepEqual([...d.posts.keys()], ['known-foreign', 'unknown-foreign', 'new-1']);
  assert.equal(getReminderMessages(race.eventId).find(({ message_id }) => message_id === 'unknown-foreign').author_id,
    'original-bot');
  d.actions.length = 0;
  await publishEditedReminder(d.client, race.eventId, '123');
  assert.deepEqual(d.actions, [
    ['send', '456', 'new-2'], ['fetch', '456', 'new-1'], ['delete', '456', 'new-1'],
  ]);
});
