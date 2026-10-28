const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-event-modal-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '123:456';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');

const { DateTime } = require('luxon');
const { defaultTimeZone } = require('../src/config');
const db = require('../src/db/database');
const { createEvent, getEvent } = require('../src/db/eventRepository');
const { saveResponse, getEventResponses, getReminderMessages } = require('../src/reminders/repository');
const { handleEventModal } = require('../src/interactions/eventModal');

after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

function discordClient() {
  const sent = [];
  const deleted = [];
  const channel = {
    guildId: '123', isTextBased: () => true,
    send: async (message) => {
      sent.push(message);
      return { id: String(sent.length), author: { id: 'bot' } };
    },
    messages: { fetch: async (messageId) => ({
      author: { id: 'bot' }, delete: async () => deleted.push(messageId),
    }) },
  };
  return { sent, deleted, user: { id: 'bot' }, channels: { fetch: async () => channel } };
}

function interaction(customId, values, client, guildId = '123') {
  const replies = [];
  return {
    customId, client, guildId, user: { id: 'staff' }, replies,
    fields: { getTextInputValue: (key) => {
      assert.ok(Object.hasOwn(values, key), `Unexpected input access: ${key}`);
      return values[key];
    } },
    reply: async (reply) => replies.push(reply),
  };
}

function futureInput() {
  return DateTime.now().setZone(defaultTimeZone).plus({ days: 2 })
    .set({ hour: 14, minute: 0, second: 0, millisecond: 0 }).toFormat('dd.MM.yyyy HH:mm');
}

test('one event modal handler adds and edits special events while preserving responses and reminder replacement', async () => {
  const client = discordClient();
  const values = { title: 'Handler special event', start: futureInput(), track: 'Spa', carClass: 'GT3', details: 'Original details' };
  const add = interaction('add-event:iracing:special_event', values, client);
  await handleEventModal(add);
  assert.equal(add.replies[0].embeds[0].toJSON().title, '✅ Event added');
  const row = db.prepare("SELECT * FROM events WHERE title = 'Handler special event'").get();
  assert.equal(row.game, 'iracing');
  assert.equal(row.event_type, 'special_event');
  assert.equal(row.created_by, 'staff');
  assert.equal(row.status, 'scheduled');
  assert.equal(client.sent.length, 1);
  saveResponse({ eventId: row.id, userId: 'driver', attending: 1, days: null, carClass: '["GT3"]', availabilityHours: '10:00–14:00', team: 'community' });
  const response = getEventResponses(row.id);
  const edit = interaction(`edit-event:${row.id}`, {
    ...values, title: 'Handler special revised', track: 'Monza', carClass: 'GT3, GTP', details: 'Revised details',
  }, client);
  await handleEventModal(edit);
  const updated = getEvent({ eventId: row.id, guildId: '123' });
  assert.equal(updated.title, 'Handler special revised');
  assert.equal(updated.track, 'Monza');
  assert.equal(updated.starts_at, row.starts_at);
  assert.equal(updated.game, row.game);
  assert.equal(updated.event_type, row.event_type);
  assert.equal(updated.created_by, row.created_by);
  assert.equal(updated.status, row.status);
  assert.deepEqual(getEventResponses(row.id), response);
  assert.equal(edit.replies[0].embeds[0].toJSON().title, '✅ Event updated');
  assert.equal(client.sent.length, 2);
  assert.deepEqual(client.deleted, ['1']);
  assert.match(client.sent[1].embeds[0].toJSON().description, /Event updated/);
  assert.deepEqual(getReminderMessages(row.id).map(({ message_id }) => message_id), ['2']);
});

test('invalid forms and missing or foreign-server edits do not change data or post reminders', async () => {
  const client = discordClient();
  const eventId = createEvent({
    guildId: '123', game: 'iracing', eventType: 'special_event', title: 'Protected event',
    startsAt: 2000000000, track: 'Spa', carClass: 'GT3', createdBy: 'staff', createdAt: 1,
  });
  const rows = db.prepare('SELECT * FROM events ORDER BY id').all();
  const reminders = db.prepare('SELECT * FROM special_event_reminders ORDER BY event_id, lead_days').all();
  const values = { title: 'Should not save', start: futureInput(), track: 'Spa', carClass: 'GT3', details: '' };
  const invalidAdds = [
    interaction('add-event:iracing:special_event', { ...values, carClass: '' }, client),
    interaction('add-event:unknown:special_event', {}, client),
    interaction('add-event:iracing:invalid', {}, client),
  ];
  const invalidEdits = [
    interaction(`edit-event:${eventId}`, { ...values, start: 'invalid date' }, client),
    interaction('edit-event:not-an-id', {}, client),
    interaction('edit-event:999999', {}, client),
    interaction(`edit-event:${eventId}`, {}, client, '456'),
  ];
  for (const request of [...invalidAdds, ...invalidEdits]) {
    await handleEventModal(request);
    assert.equal(request.replies.length, 1);
    assert.equal(request.replies[0].embeds, undefined);
    assert.ok(request.replies[0].content);
  }
  assert.deepEqual(db.prepare('SELECT * FROM events ORDER BY id').all(), rows);
  assert.deepEqual(db.prepare('SELECT * FROM special_event_reminders ORDER BY event_id, lead_days').all(), reminders);
  assert.equal(client.sent.length, 0);
});

test('legacy public and private event types remain editable through the combined handler', async () => {
  const client = discordClient();
  for (const eventType of ['public', 'private']) {
    const id = createEvent({
      guildId: '123', game: 'lmu', eventType, title: `Legacy ${eventType}`, startsAt: 2000000000,
      track: 'Spa', createdBy: 'original-staff', createdAt: 1,
    });
    const request = interaction(`edit-event:${id}`, {
      title: `Updated ${eventType}`, start: futureInput(), track: 'Monza', carClass: '', details: 'Legacy details',
    }, client);
    await handleEventModal(request);
    const updated = getEvent({ eventId: id, guildId: '123' });
    assert.equal(updated.title, `Updated ${eventType}`);
    assert.equal(updated.event_type, eventType);
    assert.equal(updated.created_by, 'original-staff');
    assert.equal(request.replies[0].embeds[0].toJSON().title, '✅ Event updated');
  }
  assert.equal(client.sent.length, 0);
});
