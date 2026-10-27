const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DateTime } = require('luxon');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-channel-reminder-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123,999';
process.env.REMINDER_CHANNELS = '';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');
process.env.DEFAULT_TIMEZONE = 'Europe/Berlin';

const db = require('../src/db/database');
const { createEvent, editEvent } = require('../src/db/eventRepository');
const { setReminderChannel, removeReminderChannel } = require('../src/db/reminderChannelRepository');
const {
  getReminderMessages, getReminderRecord, recordReminder, removeReminderMessage, saveResponse,
} = require('../src/reminders/repository');
const { checkReminders, publishChannelReminders, publishEditedReminder } = require('../src/reminders/scheduler');
const { parseRsvpId } = require('../src/reminders/context');

const NOW = DateTime.fromISO('2030-05-01T08:00:00', { zone: 'Europe/Berlin' });

beforeEach(() => {
  db.exec('DELETE FROM events; DELETE FROM reminder_channels;');
  setReminderChannel('123', '456', 'iracing', 'main');
});

after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

function race(overrides = {}) {
  const startsAt = Math.floor(NOW.plus({ days: 14 }).set({ hour: 12 }).toSeconds());
  const fields = {
    guildId: '123', game: 'iracing', eventType: 'special_event', title: 'Race',
    startsAt, dateOnlyUntil: null, track: 'Spa', carClass: 'GT3', details: null,
    createdBy: 'staff', createdAt: Math.floor(NOW.minus({ days: 30 }).toSeconds()),
    ...overrides,
  };
  return { ...fields, eventId: createEvent(fields) };
}

function discord() {
  let sequence = 0;
  const posts = new Map();
  const attempts = [];
  const fetches = [];
  const deleted = [];
  const state = { beforeSend: null, sendErrors: new Map() };
  const client = {
    user: { id: 'bot' },
    channels: { fetch: async (channelId) => {
      fetches.push(channelId);
      return {
        guildId: channelId === '999-channel' ? '999' : '123',
        isTextBased: () => true,
        send: async (payload) => {
          attempts.push({ channelId, payload });
          if (state.beforeSend) await state.beforeSend(payload);
          const error = state.sendErrors.get(payload.embeds[0].toJSON().title);
          if (error) throw error;
          const id = `message-${++sequence}`;
          posts.set(id, { channelId, payload });
          return { id, author: { id: 'bot' } };
        },
        messages: { fetch: async (messageId) => {
          if (!posts.has(messageId)) {
            throw Object.assign(new Error('Unknown Message'), { code: 10008 });
          }
          return {
            author: { id: 'bot' },
            delete: async () => { posts.delete(messageId); deleted.push(messageId); },
          };
        } },
      };
    } },
  };
  return { client, posts, attempts, fetches, deleted, state };
}

test('a channel immediately receives all matching future special events before the scheduled send hour', async () => {
  const far = race({ title: 'Far race' });
  const near = race({
    title: 'Near race', startsAt: Math.floor(NOW.plus({ hours: 2 }).toSeconds()),
    createdAt: Math.floor(NOW.toSeconds()),
  });
  race({ game: 'lmu', title: 'Other game' });
  race({ guildId: '999', title: 'Other server' });
  race({ eventType: 'weekly', title: 'Weekly race' });
  race({ startsAt: Math.floor(NOW.minus({ hours: 1 }).toSeconds()), title: 'Past race' });
  race({ startsAt: Math.floor(NOW.toSeconds()), title: 'Already starting' });
  for (const status of ['cancelled', 'completed']) {
    const event = race({ title: status });
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run(status, event.eventId);
  }
  setReminderChannel('123', '789', 'iracing', 'academy');
  const d = discord();

  assert.deepEqual(await publishChannelReminders(d.client, '123', '456', NOW), { sent: 2, failures: 0 });
  assert.deepEqual(d.fetches, ['456', '456']);
  assert.deepEqual(d.attempts.map(({ payload }) => payload.embeds[0].toJSON().title), [
    '🏁 Near race', '🏁 Far race',
  ]);
  for (const event of [far, near]) {
    assert.ok(getReminderRecord(event.eventId, event.startsAt, 0, '456'));
    assert.equal(getReminderRecord(event.eventId, event.startsAt, 0, '789'), undefined);
  }
  assert.deepEqual(await publishChannelReminders(d.client, '123', 'missing', NOW), { sent: 0, failures: 0 });
});

test('both-game channels retain their signup team and show the current combined driver roster', async () => {
  setReminderChannel('123', '456', null, 'academy');
  const iracing = race();
  race({ game: 'lmu', title: 'LMU race' });
  for (const [userId, team] of [['main-driver', 'main'], ['community-driver', 'community']]) {
    saveResponse({
      eventId: iracing.eventId, userId, team, attending: 1, days: 'Saturday',
      carClass: 'GT3', availabilityHours: '14:00',
    });
  }
  const d = discord();

  assert.deepEqual(await publishChannelReminders(d.client, '123', '456', NOW), { sent: 2, failures: 0 });
  const payload = d.attempts.find(({ payload: message }) => message.embeds[0].toJSON().title === '🏁 Race').payload;
  const embed = payload.embeds[0].toJSON();
  assert.match(embed.description, /Special event available - sign up now/i);
  assert.match(embed.description, /\*\*Signup team:\*\* Academy team/);
  assert.doesNotMatch(embed.description, /0 days away|Event updated|7 days away/);
  assert.match(embed.fields[0].value, /<@main-driver>/);
  assert.match(embed.fields[0].value, /<@community-driver>/);
  for (const button of payload.components[0].toJSON().components) {
    const context = parseRsvpId(button.custom_id, '123');
    assert.equal(context.team, 'academy');
    assert.equal(context.eventId, iracing.eventId);
  }
  const record = getReminderMessages(iracing.eventId)[0];
  assert.equal(record.team, 'academy');
  assert.equal(record.author_id, 'bot');
  assert.equal(getReminderRecord(iracing.eventId, iracing.startsAt, 0, '456').sent_at,
    Math.floor(NOW.toSeconds()));
});

test('repeat calls and removing then re-adding a channel preserve all existing delivery history', async () => {
  const events = [0, 7, 3, 1, -1].map((leadDays) => {
    const event = race({ title: `Previously delivered ${leadDays}` });
    const record = {
      eventId: event.eventId, startsAt: event.startsAt, leadDays, channelId: '456',
      messageId: `old-${leadDays}`, authorId: 'bot', sentAt: Math.floor(NOW.minus({ days: 1 }).toSeconds()),
    };
    recordReminder(record);
    removeReminderMessage(record);
    return event;
  });
  const fresh = race({ title: 'Fresh race' });
  const d = discord();

  assert.deepEqual(await publishChannelReminders(d.client, '123', '456', NOW), { sent: 1, failures: 0 });
  assert.deepEqual(await publishChannelReminders(d.client, '123', '456', NOW), { sent: 0, failures: 0 });
  assert.equal(removeReminderChannel('123', '456'), true);
  setReminderChannel('123', '456', 'iracing', 'academy');
  assert.deepEqual(await publishChannelReminders(d.client, '123', '456', NOW), { sent: 0, failures: 0 });
  assert.equal(d.attempts.length, 1);
  assert.ok(getReminderRecord(fresh.eventId, fresh.startsAt, 0, '456'));
  for (const event of events) assert.equal(getReminderMessages(event.eventId).length, 0);
});

test('delivery history for an old start time does not block announcing a rescheduled event', async () => {
  const event = race();
  const d = discord();
  await publishChannelReminders(d.client, '123', '456', NOW);
  const newStart = event.startsAt + 86400;
  assert.equal(editEvent({
    eventId: event.eventId, guildId: '123', title: 'Rescheduled race', startsAt: newStart,
    dateOnlyUntil: null, track: 'Spa', carClass: 'GT3', details: null,
  }), true);

  assert.deepEqual(await publishChannelReminders(d.client, '123', '456', NOW), { sent: 1, failures: 0 });
  assert.equal(d.posts.size, 1);
  assert.deepEqual(d.deleted, ['message-1']);
  assert.ok(getReminderRecord(event.eventId, event.startsAt, 0, '456'));
  assert.ok(getReminderRecord(event.eventId, newStart, 0, '456'));
});

test('failed sends remain retryable while other matching events are announced', async () => {
  const failing = race({ title: 'Retry race' });
  const successful = race({ title: 'Successful race' });
  const d = discord();
  d.state.sendErrors.set('🏁 Retry race', new Error('Send failed'));
  const previousError = console.error;
  const errors = [];
  console.error = (...args) => { errors.push(args); };
  try {
    assert.deepEqual(await publishChannelReminders(d.client, '123', '456', NOW), { sent: 1, failures: 1 });
  } finally {
    console.error = previousError;
  }
  assert.equal(errors.length, 1);
  assert.equal(getReminderRecord(failing.eventId, failing.startsAt, 0, '456'), undefined);
  assert.ok(getReminderRecord(successful.eventId, successful.startsAt, 0, '456'));
  d.state.sendErrors.clear();

  assert.deepEqual(await publishChannelReminders(d.client, '123', '456', NOW), { sent: 1, failures: 0 });
  assert.equal(d.attempts.length, 3);
  assert.equal(d.posts.size, 2);
  assert.ok(getReminderRecord(failing.eventId, failing.startsAt, 0, '456'));
});

test('concurrent publication does not duplicate a channel announcement', async () => {
  race();
  const d = discord();
  let started;
  const enteredSend = new Promise((resolve) => { started = resolve; });
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  d.state.beforeSend = async () => { started(); await blocked; };
  const first = publishChannelReminders(d.client, '123', '456', NOW);
  await enteredSend;
  try {
    assert.deepEqual(await publishChannelReminders(d.client, '123', '456', NOW), { sent: 0, failures: 0 });
  } finally {
    release();
  }
  assert.deepEqual(await first, { sent: 1, failures: 0 });
  assert.equal(d.attempts.length, 1);
  assert.equal(d.posts.size, 1);
});

for (const firstAction of ['channel', 'scheduler']) {
  test(`a due scheduled stage and channel announcement share duplicate protection when ${firstAction} starts first`, async () => {
    race({ startsAt: Math.floor(NOW.plus({ days: 7 }).set({ hour: 12 }).toSeconds()) });
    const tick = NOW.set({ hour: 9 });
    const d = discord();
    let started;
    const enteredSend = new Promise((resolve) => { started = resolve; });
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    d.state.beforeSend = async () => { started(); await blocked; };
    const publish = () => publishChannelReminders(d.client, '123', '456', tick);
    const scheduled = () => checkReminders(d.client, tick);
    const first = firstAction === 'channel' ? publish() : scheduled();
    await enteredSend;
    try {
      await (firstAction === 'channel' ? scheduled() : publish());
    } finally {
      release();
    }
    await first;
    await checkReminders(d.client, tick.plus({ minutes: 5 }));
    assert.deepEqual(await publishChannelReminders(d.client, '123', '456', tick), { sent: 0, failures: 0 });
    assert.equal(d.attempts.length, 1);
    assert.equal(d.posts.size, 1);
  });
}

for (const firstAction of ['channel', 'scheduler']) {
  test(`an event edit waits for an in-flight ${firstAction} reminder and replaces its stale post`, async () => {
    const event = race({ startsAt: Math.floor(NOW.plus({ days: 7 }).set({ hour: 12 }).toSeconds()) });
    const tick = NOW.set({ hour: 9 });
    const d = discord();
    let started;
    const enteredSend = new Promise((resolve) => { started = resolve; });
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    d.state.beforeSend = async () => {
      d.state.beforeSend = null;
      started();
      await blocked;
    };
    const first = firstAction === 'channel'
      ? publishChannelReminders(d.client, '123', '456', tick)
      : checkReminders(d.client, tick);
    await enteredSend;
    let edited;
    try {
      assert.equal(editEvent({
        eventId: event.eventId, guildId: '123', title: 'Updated race', startsAt: event.startsAt,
        dateOnlyUntil: null, track: 'Spa', carClass: 'GT3', details: 'Updated race instructions',
      }), true);
      edited = publishEditedReminder(d.client, event.eventId, '123');
      assert.equal(d.attempts.length, 1);
    } finally {
      release();
    }
    await Promise.all([first, edited]);

    assert.equal(d.attempts.length, 2);
    assert.equal(d.posts.size, 1);
    assert.deepEqual(d.deleted, ['message-1']);
    const latest = [...d.posts.values()][0].payload.embeds[0].toJSON();
    assert.equal(latest.title, '🏁 Updated race');
    assert.match(latest.description, /Event updated - please check your plans/);
    assert.match(latest.description, /Updated race instructions/);
    assert.ok(getReminderRecord(event.eventId, event.startsAt, firstAction === 'channel' ? 0 : 7, '456'));
    assert.ok(getReminderRecord(event.eventId, event.startsAt, -1, '456'));
    assert.deepEqual(getReminderMessages(event.eventId).map(({ lead_days }) => lead_days), [-1]);
  });
}

test('scheduled stages replace the initial channel announcement and retain their delivery history', async () => {
  const event = race();
  const d = discord();
  await publishChannelReminders(d.client, '123', '456', NOW);
  const start = DateTime.fromSeconds(event.startsAt, { zone: 'Europe/Berlin' });

  for (const leadDays of [7, 3, 1]) {
    const tick = start.minus({ days: leadDays }).set({ hour: 9 });
    await checkReminders(d.client, tick);
    await checkReminders(d.client, tick.plus({ minutes: 5 }));
    assert.equal(d.posts.size, 1);
    assert.equal(getReminderMessages(event.eventId).length, 1);
    assert.ok(getReminderRecord(event.eventId, event.startsAt, leadDays, '456'));
    assert.ok(getReminderRecord(event.eventId, event.startsAt, 0, '456'));
  }
  assert.equal(d.attempts.length, 4);
  assert.deepEqual(d.deleted, ['message-1', 'message-2', 'message-3']);
});

test('initial announcements suppress scheduled and late posts on the same local day', async () => {
  for (const days of [7, 3, 1]) {
    race({
      title: `${days}-day race`,
      startsAt: Math.floor(NOW.plus({ days }).set({ hour: 12 }).toSeconds()),
      createdAt: Math.floor(NOW.toSeconds()),
    });
  }
  const d = discord();
  assert.deepEqual(await publishChannelReminders(d.client, '123', '456', NOW), { sent: 3, failures: 0 });

  await checkReminders(d.client, NOW.set({ hour: 10 }));
  await checkReminders(d.client, NOW.set({ hour: 23 }));
  await checkReminders(d.client, NOW.plus({ days: 1 }).set({ hour: 9 }));
  assert.equal(d.attempts.length, 3);
  assert.equal(d.posts.size, 3);
});
