const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-reminder-ownership-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');

const db = require('../src/db/database');
const { createEvent } = require('../src/db/eventRepository');
const { getReminderChannels, setReminderChannel } = require('../src/db/reminderChannelRepository');
const {
  getEventResponses, getReminderMessages, getReminderRecord, recordReminder, saveResponse,
} = require('../src/reminders/repository');
const { publishEditedReminder, publishLateReminder } = require('../src/reminders/scheduler');
const { refreshChannelReminderMessages } = require('../src/reminders/interactions');

beforeEach(() => {
  db.exec('DELETE FROM events; DELETE FROM reminder_channels;');
  setReminderChannel('123', '456', 'iracing', '');
});

after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const now = Math.floor(Date.now() / 1000);
  const startsAt = now + 2 * 86400;
  const eventId = createEvent({
    guildId: '123', game: 'iracing', eventType: 'special_event', title: 'Existing race',
    startsAt, dateOnlyUntil: null, track: 'Spa', carClass: 'GT3', details: null,
    createdBy: 'staff', createdAt: now,
  });
  saveResponse({
    eventId, userId: 'driver', attending: 1, days: 'Saturday', carClass: 'GT3',
    availabilityHours: '14:00', team: 'main',
  });
  function reminder(messageId, leadDays, authorId) {
    const record = { eventId, startsAt, leadDays, channelId: '456', messageId, sentAt: now };
    if (authorId !== undefined) record.authorId = authorId;
    recordReminder(record);
  }
  function client(botId, authors, editErrors = {}) {
    const fetched = [];
    const edited = [];
    return {
      fetched, edited,
      user: { id: botId },
      channels: { fetch: async () => ({
        guildId: '123', isTextBased: () => true,
        send: async () => { assert.fail('Refreshing a channel must not send replacement messages'); },
        messages: { fetch: async (messageId) => {
          fetched.push(messageId);
          return {
            author: authors[messageId] ? { id: authors[messageId] } : undefined,
            edit: async (message) => {
              if (editErrors[messageId]) throw editErrors[messageId];
              edited.push({ messageId, message });
            },
          };
        } },
      }) },
    };
  }
  return { eventId, startsAt, reminder, client };
}

test('changing a shared channel to Main skips posts by another bot and refreshes owned posts', async () => {
  const s = fixture();
  s.reminder('foreign-message', 7);
  s.reminder('own-message', 3);
  const beforeResponses = getEventResponses(s.eventId);
  const client = s.client('test-bot', {
    'foreign-message': 'original-bot', 'own-message': 'test-bot',
  });

  setReminderChannel('123', '456', 'iracing', 'main');
  const result = await refreshChannelReminderMessages(client, '123', '456');
  assert.deepEqual(result, { failures: 0, skippedForeign: 1 });
  assert.equal(getReminderChannels('123')[0].team, 'main');
  assert.deepEqual(client.edited.map(({ messageId }) => messageId), ['own-message']);
  assert.match(client.edited[0].message.embeds[0].toJSON().description, /\*\*Signup team:\*\* Main team/);
  assert.deepEqual(getEventResponses(s.eventId), beforeResponses);
  assert.equal(getReminderMessages(s.eventId).length, 2);
  assert.ok(getReminderRecord(s.eventId, s.startsAt, 7, '456'));
  assert.ok(getReminderRecord(s.eventId, s.startsAt, 3, '456'));

  // Retaining delivery history prevents another signup post for the same event/channel.
  await publishLateReminder(client, s.eventId, '123');
});

test('learned message owners persist and foreign messages are not fetched on later refreshes', async () => {
  const s = fixture();
  s.reminder('foreign-message', 7);
  s.reminder('own-message', 3);
  const authors = { 'foreign-message': 'original-bot', 'own-message': 'test-bot' };
  const first = s.client('test-bot', authors);
  await refreshChannelReminderMessages(first, '123', '456');
  assert.deepEqual(first.fetched.sort(), ['foreign-message', 'own-message']);

  const second = s.client('test-bot', authors);
  assert.deepEqual(await refreshChannelReminderMessages(second, '123', '456'), {
    failures: 0, skippedForeign: 1,
  });
  assert.deepEqual(second.fetched, ['own-message']);

  const restarted = spawnSync(process.execPath, ['-e', `
    const db = require('./src/db/database');
    console.log(JSON.stringify(db.prepare('SELECT message_id, author_id FROM special_event_reminders ORDER BY message_id').all()));
    db.close();
  `], { cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8' });
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout.trim().split('\n').at(-1)), [
    { message_id: 'foreign-message', author_id: 'original-bot' },
    { message_id: 'own-message', author_id: 'test-bot' },
  ]);
});

test('the original bot can refresh its retained historical messages after identities change back', async () => {
  const s = fixture();
  s.reminder('original-message', 7, 'original-bot');
  s.reminder('test-message', 3, 'test-bot');
  const client = s.client('original-bot', {
    'original-message': 'original-bot', 'test-message': 'test-bot',
  });
  assert.deepEqual(await refreshChannelReminderMessages(client, '123', '456'), {
    failures: 0, skippedForeign: 1,
  });
  assert.deepEqual(client.fetched, ['original-message']);
  assert.deepEqual(client.edited.map(({ messageId }) => messageId), ['original-message']);
  assert.equal(getReminderMessages(s.eventId).length, 2);
});

test('new reminder posts record the sending bot identity', async () => {
  const s = fixture();
  const sent = [];
  const client = {
    user: { id: 'test-bot' },
    channels: { fetch: async () => ({
      guildId: '123', isTextBased: () => true,
      send: async (message) => { sent.push(message); return { id: 'new-message' }; },
    }) },
  };
  await publishEditedReminder(client, s.eventId, '123');
  assert.equal(sent.length, 1);
  assert.equal(getReminderMessages(s.eventId)[0].author_id, 'test-bot');
});

test('a 50005 response is skipped without aborting updates or deleting delivery history', async () => {
  const s = fixture();
  s.reminder('rejected-message', 7);
  s.reminder('own-message', 3);
  const client = s.client('test-bot', { 'own-message': 'test-bot' }, {
    'rejected-message': Object.assign(new Error('Cannot edit a message authored by another user'), { code: 50005 }),
  });
  const errors = [];
  const previousError = console.error;
  console.error = (...args) => { errors.push(args); };
  try {
    assert.deepEqual(await refreshChannelReminderMessages(client, '123', '456'), {
      failures: 0, skippedForeign: 1,
    });
  } finally {
    console.error = previousError;
  }
  assert.deepEqual(client.edited.map(({ messageId }) => messageId), ['own-message']);
  assert.equal(errors.length, 0);
  assert.equal(getReminderMessages(s.eventId).length, 2);
  assert.ok(getReminderRecord(s.eventId, s.startsAt, 7, '456'));
});

test('unexpected edit failures remain visible and do not prevent other owned messages updating', async () => {
  const s = fixture();
  s.reminder('permission-failure', 7, 'test-bot');
  s.reminder('own-message', 3, 'test-bot');
  const client = s.client('test-bot', { 'permission-failure': 'test-bot', 'own-message': 'test-bot' }, {
    'permission-failure': Object.assign(new Error('Missing permissions'), {
      code: 50013, url: 'https://example.test/private-url', requestBody: { token: 'private-token' },
    }),
  });
  const errors = [];
  const previousError = console.error;
  console.error = (...args) => { errors.push(args); };
  try {
    assert.deepEqual(await refreshChannelReminderMessages(client, '123', '456'), {
      failures: 1, skippedForeign: 0,
    });
  } finally {
    console.error = previousError;
  }
  assert.deepEqual(client.edited.map(({ messageId }) => messageId), ['own-message']);
  assert.equal(errors.length, 1);
  const context = errors[0].find((value) => value && typeof value === 'object');
  assert.equal(context.eventId, s.eventId);
  assert.equal(context.channelId, '456');
  assert.equal(context.messageId, 'permission-failure');
  assert.equal(context.code, 50013);
  assert.equal(context.message, 'Missing permissions');
  assert.doesNotMatch(JSON.stringify(errors), /private-url|private-token|requestBody/);
  assert.equal(getReminderMessages(s.eventId).length, 2);
});
