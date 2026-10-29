const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DateTime } = require('luxon');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-private-reminder-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '123:456';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');
process.env.DEFAULT_TIMEZONE = 'Europe/Berlin';

const db = require('../src/db/database');
const { createEvent } = require('../src/db/eventRepository');
const { recordReminder, getReminderRecord, getResponse, saveResponse } = require('../src/reminders/repository');
const { handleReminderButton, handleReminderModal } = require('../src/reminders/interactions');
const { checkPrivateReminders, nextPrivateReminderAt } = require('../src/reminders/private');

after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('next-day DM RSVP updates the server overview', async () => {
  const now = Math.floor(Date.now() / 1000);
  const eventId = createEvent({
    guildId: '123', game: 'iracing', eventType: 'special_event', title: 'Race',
    startsAt: now + 3 * 24 * 60 * 60, dateOnlyUntil: null,
    track: 'Spa', carClass: 'GT3, GTP', details: null, createdBy: 'staff', createdAt: now,
  });
  recordReminder({
    eventId, startsAt: now + 3 * 24 * 60 * 60, leadDays: 7,
    channelId: '456', messageId: 'server-message', sentAt: now,
  });
  const dms = [];
  const serverEdits = [];
  const client = {
    users: { fetch: async () => ({ send: async (message) => { dms.push(message); } }) },
    channels: { fetch: async () => ({ messages: { fetch: async () => ({
      edit: async (message) => { serverEdits.push(message); },
    }) } }) },
  };
  const replies = [];
  await handleReminderButton({
    customId: `special-rsvp:remind_me_again:${eventId}`,
    guildId: '123', user: { id: 'driver' }, client,
    reply: async (message) => { replies.push(message); },
  });
  assert.match(replies[0].content, /tomorrow at or shortly after 09:00/);
  const scheduled = db.prepare('SELECT remind_at FROM special_event_private_reminders WHERE event_id = ? AND user_id = ?').get(eventId, 'driver');
  assert.equal(scheduled.remind_at, nextPrivateReminderAt());
  await checkPrivateReminders(client, DateTime.fromSeconds(scheduled.remind_at - 1));
  assert.equal(dms.length, 0);
  await checkPrivateReminders(client, DateTime.fromSeconds(scheduled.remind_at + 1));
  assert.equal(dms.length, 1);
  assert.equal(dms[0].components[0].components[0].data.custom_id, `special-rsvp:yes:123:${eventId}`);
  await checkPrivateReminders(client, DateTime.fromSeconds(scheduled.remind_at + 2));
  assert.equal(dms.length, 1);

  let modal;
  await handleReminderButton({
    customId: `special-rsvp:yes:123:${eventId}`,
    guildId: null, user: { id: 'driver' }, client,
    showModal: async (value) => { modal = value.toJSON(); },
  });
  assert.equal(modal.custom_id, `special-rsvp:submit:123:${eventId}`);
  const privateEdits = [];
  const privateMessage = { edit: async (message) => { privateEdits.push(message); } };
  await handleReminderModal({
    customId: modal.custom_id, guildId: null, user: { id: 'driver' }, client,
    message: privateMessage,
    fields: {
      getTextInputValue: () => '10:00 or 14:00',
      getCheckboxGroup: () => ['GT3', 'GTP'],
    },
    reply: async (message) => { replies.push(message); },
  });
  assert.equal(getResponse(eventId, 'driver').car_class, 'GT3, GTP');
  assert.equal(serverEdits.length, 1);
  assert.match(serverEdits[0].embeds[0].toJSON().fields[0].value, /<@driver> \(10:00 or 14:00\)/);
  assert.equal(privateEdits.length, 1);

  await handleReminderButton({
    customId: `special-rsvp:no:123:${eventId}`,
    guildId: null, user: { id: 'driver' }, client, message: privateMessage,
    reply: async (message) => { replies.push(message); },
  });
  assert.equal(getResponse(eventId, 'driver').attending, 0);
  assert.equal(serverEdits.length, 2);
  assert.equal(privateEdits.length, 2);
  for (const message of [...dms, ...serverEdits, ...privateEdits]) {
    assert.deepEqual(message.allowedMentions, { parse: [] });
    assert.equal(Object.hasOwn(message, 'content'), false);
  }
});


test('private reminder buttons schedule another next-day DM until the event deadline', async (t) => {
  let nowMillis = DateTime.now().setZone('Europe/Berlin').startOf('day').set({ hour: 12 }).toMillis();
  t.mock.method(Date, 'now', () => nowMillis);
  const now = Math.floor(nowMillis / 1000);
  const eventId = createEvent({
    guildId: '123', game: 'iracing', eventType: 'special_event', title: 'Race',
    startsAt: now + 4 * 24 * 60 * 60, dateOnlyUntil: null,
    track: 'Spa', carClass: 'GT3', details: null, createdBy: 'staff', createdAt: now,
  });
  saveResponse({
    eventId, userId: 'snoozing-driver', attending: 1, days: 'Saturday',
    carClass: 'GT3', availabilityHours: null,
  });
  const response = getResponse(eventId, 'snoozing-driver');
  const dms = [];
  const client = { users: { fetch: async () => ({ send: async (message) => dms.push(message) }) } };
  const replies = [];
  const press = (customId, guildId) => handleReminderButton({
    customId, guildId, user: { id: 'snoozing-driver' }, client,
    reply: async (message) => replies.push(message),
  });
  const reminder = () => db.prepare(`
    SELECT * FROM special_event_private_reminders WHERE event_id = ? AND user_id = ?
  `).get(eventId, 'snoozing-driver');
  const repeatButton = (message) => message.components[0].components
    .find((button) => button.data.label === 'Remind again tomorrow');

  await press(`special-rsvp:remind_me_again:${eventId}`, '123');
  const initial = reminder();
  await checkPrivateReminders(client, DateTime.fromSeconds(initial.remind_at + 1));
  assert.equal(dms.length, 1);
  const repeat = repeatButton(dms[0]);
  assert.ok(repeat);
  assert.equal(repeat.data.custom_id, `special-rsvp:remind_me_again:123:${eventId}`);

  nowMillis = (initial.remind_at + 60) * 1000;
  await press(repeat.data.custom_id, null);
  assert.match(replies.at(-1).content, /tomorrow at or shortly after 09:00/);
  assert.equal(Object.hasOwn(replies.at(-1), 'flags'), false);
  const next = reminder();
  assert.equal(next.remind_at, nextPrivateReminderAt());
  assert.ok(next.remind_at > initial.remind_at);
  assert.equal(next.sent_at, null);
  assert.deepEqual(getResponse(eventId, 'snoozing-driver'), response);
  await checkPrivateReminders(client, DateTime.fromSeconds(next.remind_at - 1));
  assert.equal(dms.length, 1);
  await checkPrivateReminders(client, DateTime.fromSeconds(next.remind_at + 1));
  await checkPrivateReminders(client, DateTime.fromSeconds(next.remind_at + 2));
  assert.equal(dms.length, 2);

  nowMillis = (next.remind_at + 60) * 1000;
  db.prepare('UPDATE events SET starts_at = ? WHERE id = ?').run(nowMillis / 1000 + 60, eventId);
  const sent = reminder();
  await press(repeatButton(dms[1]).data.custom_id, null);
  assert.match(replies.at(-1).content, /ends before tomorrow at 09:00/);
  assert.deepEqual(reminder(), sent);
  assert.deepEqual(getResponse(eventId, 'snoozing-driver'), response);
});

test('next-day 09:00 follows the configured timezone across daylight saving time', () => {
  const now = DateTime.fromISO('2026-03-28T20:00', { zone: 'Europe/Berlin' });
  const scheduled = DateTime.fromSeconds(nextPrivateReminderAt(now), { zone: 'Europe/Berlin' });
  assert.equal(scheduled.toISO(), '2026-03-29T09:00:00.000+02:00');
});

test('deleted server reminders are removed while other messages still refresh', async () => {
  const now = Math.floor(Date.now() / 1000);
  const startsAt = now + 3 * 24 * 60 * 60;
  const eventId = createEvent({
    guildId: '123', game: 'iracing', eventType: 'special_event', title: 'Race',
    startsAt, dateOnlyUntil: null, track: 'Spa', carClass: 'GT3',
    details: null, createdBy: 'staff', createdAt: now,
  });
  for (const [leadDays, messageId] of [[7, 'deleted'], [3, 'existing']]) {
    recordReminder({ eventId, startsAt, leadDays, channelId: '456', messageId, sentAt: now });
  }

  const fetched = [];
  const edited = [];
  const client = {
    channels: { fetch: async () => ({ messages: { fetch: async (messageId) => {
      fetched.push(messageId);
      if (messageId === 'deleted') throw { code: 10008 };
      return { edit: async (message) => { edited.push(message); } };
    } } }) },
  };
  const interaction = {
    customId: `special-rsvp:no:${eventId}`,
    guildId: '123', user: { id: 'driver' }, client,
    reply: async () => {},
  };

  await handleReminderButton(interaction);
  await handleReminderButton(interaction);

  assert.equal(fetched.filter((id) => id === 'deleted').length, 1);
  assert.equal(fetched.filter((id) => id === 'existing').length, 2);
  assert.equal(edited.length, 2);
  assert.deepEqual(db.prepare(`
    SELECT message_id FROM special_event_reminders WHERE event_id = ? AND deleted_at IS NULL
  `).all(eventId).map(({ message_id }) => message_id), ['existing']);
  assert.ok(getReminderRecord(eventId, startsAt, 7, '456'));
});
