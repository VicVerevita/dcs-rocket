const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-edit-reminder-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '123:456';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');

const db = require('../src/db/database');
const { createEvent, editEvent, getEvent } = require('../src/db/eventRepository');
const { publishEditedReminder, checkReminders } = require('../src/reminders/scheduler');

after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('editing a scheduled special event posts a fresh reminder each time', async () => {
  const now = Math.floor(Date.now() / 1000);
  const startsAt = now + 30 * 24 * 60 * 60;
  const eventId = createEvent({
    guildId: '123', game: 'iracing', eventType: 'special_event', title: 'Race',
    startsAt, dateOnlyUntil: null, track: 'Spa', carClass: 'GT3', details: null,
    createdBy: 'staff', createdAt: now,
  });
  const sent = [];
  const client = { channels: { fetch: async () => ({
    guildId: '123', isTextBased: () => true,
    send: async (message) => {
      sent.push(message);
      return { id: String(sent.length) };
    },
  }) } };

  for (const title of ['Race revised', 'Race revised again']) {
    assert.equal(editEvent({
      eventId, guildId: '123', title, startsAt, dateOnlyUntil: null,
      track: 'Spa', carClass: 'GT3', details: null,
    }), true);
    await publishEditedReminder(client, eventId, '123');
  }

  assert.equal(getEvent({ eventId, guildId: '123' }).status, 'scheduled');
  assert.equal(sent.length, 2);
  assert.match(sent[1].embeds[0].toJSON().description, /Event updated/);
  assert.deepEqual(db.prepare(`
    SELECT lead_days FROM special_event_reminders WHERE event_id = ? ORDER BY lead_days DESC
  `).all(eventId).map((row) => row.lead_days), [-1, -2]);
});


test('scheduler does not duplicate a recent edit announcement', async () => {
  const now = Math.floor(Date.now() / 1000);
  const eventId = createEvent({
    guildId: '123', game: 'iracing', eventType: 'special_event', title: 'Late race',
    startsAt: now + 2 * 24 * 60 * 60, dateOnlyUntil: null,
    track: 'Spa', carClass: 'GT3', details: null, createdBy: 'staff', createdAt: now,
  });
  let sends = 0;
  const client = { channels: { fetch: async () => ({
    guildId: '123', isTextBased: () => true,
    send: async () => ({ id: String(++sends) }),
  }) } };
  await publishEditedReminder(client, eventId, '123');
  await checkReminders(client);
  assert.equal(sends, 1);
});
