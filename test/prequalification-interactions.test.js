const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MessageFlags } = require('discord.js');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-prequalification-interactions-'));
Object.assign(process.env, {
  DISCORD_TOKEN: 'test', CLIENT_ID: 'test', GUILD_IDS: '123', REMINDER_CHANNELS: '',
  DATABASE_PATH: path.join(directory, 'events.sqlite'),
});

const db = require('../src/db/database');
const { createEvent, getEvent, deleteEvent } = require('../src/db/eventRepository');
const { setLeaguePrequalification } = require('../src/db/leagueRepository');
const { saveResponse, getResponse, recordReminder, schedulePrivateReminder } = require('../src/reminders/repository');
const {
  ensurePrequalificationReminder, getPrequalificationReminder, getPrequalificationCandidates,
} = require('../src/reminders/prequalification/repository');
const { buildPrequalificationReminderId, parsePrequalificationReminderId } = require('../src/reminders/prequalification/context');
const { handlePrequalificationReminderButton } = require('../src/reminders/prequalification/interactions');
const { buildPrequalificationReminder } = require('../src/reminders/prequalification/messages');

after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => db.exec('DELETE FROM events; DELETE FROM reminder_channels;'));

function response(eventId, attending = 1, userId = '789', team = 'academy') {
  saveResponse({ eventId, userId, attending, team, days: 'Friday', carClass: 'GT3', availabilityHours: '14:00' });
}

function scenario({ guildId = '123', kind = 'signup', initialize = true } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const eventId = createEvent({
    guildId, game: 'iracing', eventType: 'league', title: 'Pre-qualification league',
    createdBy: 'staff', createdAt: now,
    prequalification: { kind, startsAt: now - 86400, dateOnlyUntil: now + 10 * 86400, details: 'Complete the signup' },
  });
  response(eventId);
  if (initialize) assert.ok(ensurePrequalificationReminder({ eventId, userId: '789', now }));
  const event = getEvent({ eventId, guildId });
  const serverEdits = [];
  const sends = [];
  const client = {
    user: { id: 'bot' },
    users: { fetch: async () => ({ send: async (message) => sends.push(message) }) },
    channels: { fetch: async (channelId) => ({
      guildId, isTextBased: () => true, send: async (message) => sends.push(message),
      messages: { fetch: async (messageId) => ({
        author: { id: 'bot' }, edit: async (message) => serverEdits.push({ channelId, messageId, message }),
      }) },
    }) },
  };
  function interaction(action, { userId = '789', guildId: interactionGuildId = null, customId } = {}) {
    const replies = [];
    const updates = [];
    return {
      client, user: { id: userId }, guildId: interactionGuildId, replies, updates,
      customId: customId ?? buildPrequalificationReminderId(action, event, '789'),
      reply: async (value) => replies.push(value), update: async (value) => updates.push(value),
    };
  }
  function serverPosts() {
    for (const [channelId, team] of [['456', 'main'], ['457', 'academy']]) {
      recordReminder({ eventId, startsAt: event.starts_at, leadDays: 0, channelId,
        messageId: `${channelId}-post`, sentAt: now, team, authorId: 'bot' });
    }
  }
  function manualReminder() {
    schedulePrivateReminder({ eventId, userId: '789', remindAt: now + 86400, requestedAt: now, team: 'academy' });
    return db.prepare('SELECT * FROM special_event_private_reminders WHERE event_id = ?').all(eventId);
  }
  function eligible() {
    return getPrequalificationCandidates(now).some((candidate) => candidate.event_id === eventId && candidate.user_id === '789');
  }
  return { now, event, eventId, serverEdits, sends, client, interaction, serverPosts, manualReminder, eligible };
}

function assertStoppedMessage(request) {
  assert.equal(request.replies.length, 0);
  assert.equal(request.updates.length, 1);
  assert.ok(request.updates[0].content);
  assert.deepEqual(request.updates[0].components, []);
  assert.deepEqual(request.updates[0].embeds, []);
  assert.deepEqual(request.updates[0].allowedMentions, { parse: [] });
}

test('pre-qualification control IDs retain the recipient and source server', () => {
  const event = { id: 12, guild_id: '123' };
  for (const action of ['done', 'withdraw']) {
    const id = buildPrequalificationReminderId(action, event, '789');
    assert.equal(id, `prequal-reminder:${action}:123:12:789`);
    assert.deepEqual(parsePrequalificationReminderId(id), { guildId: '123', eventId: 12, userId: '789', action });
    assert.equal(parsePrequalificationReminderId(id, '456'), null);
  }
  for (const id of ['prequal-reminder:other:123:12:789', 'prequal-reminder:done:123:0:789', 'prequal-reminder:done:12:789']) {
    assert.equal(parsePrequalificationReminderId(id), null);
  }
});

test('private pre-qualification reminders show the two recipient-bound actions without mentions', () => {
  const s = scenario();
  const message = buildPrequalificationReminder(s.event, '789');
  const buttons = message.components.flatMap((row) => row.toJSON().components);
  assert.deepEqual(buttons.map(({ label }) => label), ['I did', "I'm not doing it anymore"]);
  assert.deepEqual(buttons.map(({ custom_id }) => parsePrequalificationReminderId(custom_id)), [
    { guildId: '123', eventId: s.eventId, userId: '789', action: 'done' },
    { guildId: '123', eventId: s.eventId, userId: '789', action: 'withdraw' },
  ]);
  assert.deepEqual(message.allowedMentions, { parse: [] });
  assert.match(message.embeds[0].toJSON().description, /signup form/);
});

test('I did stops future pre-qualification reminders without changing interest, team, or a pending one-shot DM', async () => {
  const s = scenario({ kind: 'race' });
  s.serverPosts();
  const pending = s.manualReminder();
  const original = getResponse(s.eventId, '789');
  assert.equal(s.eligible(), true);
  const request = s.interaction('done');
  await handlePrequalificationReminderButton(request);
  assertStoppedMessage(request);
  assert.equal(getPrequalificationReminder({ eventId: s.eventId, userId: '789' }).status, 'completed');
  assert.deepEqual(getResponse(s.eventId, '789'), original);
  assert.deepEqual(db.prepare('SELECT * FROM special_event_private_reminders WHERE event_id = ?').all(s.eventId), pending);
  assert.equal(s.eligible(), false);
  assert.deepEqual(s.serverEdits, []);
  assert.deepEqual(s.sends, []);
  // Completion belongs to this league, including after an explicit interest change.
  response(s.eventId, 0);
  response(s.eventId, 1);
  assert.equal(getPrequalificationReminder({ eventId: s.eventId, userId: '789' }).status, 'completed');
  assert.equal(s.eligible(), false);
});

test('withdrawal preserves the signup team, clears attendance details, and silently refreshes every server post', async () => {
  const s = scenario();
  s.serverPosts();
  const pending = s.manualReminder();
  response(s.eventId, 1, '888', 'main');
  const request = s.interaction('withdraw');
  await handlePrequalificationReminderButton(request);
  assertStoppedMessage(request);
  assert.deepEqual(getResponse(s.eventId, '789'), { attending: 0, days: null, car_class: null, availability_hours: null, team: 'academy' });
  assert.equal(getResponse(s.eventId, '888').attending, 1);
  assert.equal(getPrequalificationReminder({ eventId: s.eventId, userId: '789' }).status, 'withdrawn');
  assert.equal(s.eligible(), false);
  assert.equal(s.serverEdits.length, 2);
  assert.deepEqual(new Set(s.serverEdits.map(({ channelId }) => channelId)), new Set(['456', '457']));
  for (const { message } of s.serverEdits) {
    const embed = message.embeds[0].toJSON();
    assert.equal(embed.fields.find(({ name }) => name === 'Not interested').value, '1\n||<@789>||');
    assert.match(embed.fields.find(({ name }) => name.includes('Main team')).value, /<@888>/);
    assert.doesNotMatch(embed.fields.find(({ name }) => name.includes('Academy team')).value, /<@789>/);
    assert.deepEqual(message.allowedMentions, { parse: [] });
    assert.equal(Object.hasOwn(message, 'content'), false);
  }
  assert.deepEqual(s.sends, []);
  assert.deepEqual(db.prepare('SELECT * FROM special_event_private_reminders WHERE event_id = ?').all(s.eventId), pending);
});

test('repeated and competing terminal buttons cannot withdraw a completed league signup', async () => {
  const s = scenario();
  await handlePrequalificationReminderButton(s.interaction('done'));
  const originalResponse = getResponse(s.eventId, '789');
  const originalState = getPrequalificationReminder({ eventId: s.eventId, userId: '789' });
  for (const action of ['done', 'withdraw', 'withdraw']) {
    const repeated = s.interaction(action);
    await handlePrequalificationReminderButton(repeated);
    assertStoppedMessage(repeated);
    assert.deepEqual(getResponse(s.eventId, '789'), originalResponse);
    assert.deepEqual(getPrequalificationReminder({ eventId: s.eventId, userId: '789' }), originalState);
  }
  assert.deepEqual(s.serverEdits, []);
});

test('repeated withdrawal is idempotent and later explicit interest can resume unfinished pre-qualification', async () => {
  const s = scenario();
  s.serverPosts();
  await handlePrequalificationReminderButton(s.interaction('withdraw'));
  const stopped = getPrequalificationReminder({ eventId: s.eventId, userId: '789' });
  const repeated = s.interaction('withdraw');
  await handlePrequalificationReminderButton(repeated);
  assertStoppedMessage(repeated);
  assert.deepEqual(getPrequalificationReminder({ eventId: s.eventId, userId: '789' }), stopped);
  assert.equal(s.serverEdits.length, 2);
  response(s.eventId, 1);
  assert.equal(getPrequalificationReminder({ eventId: s.eventId, userId: '789' }), null);
  assert.ok(ensurePrequalificationReminder({ eventId: s.eventId, userId: '789', now: s.now }));
  assert.equal(getPrequalificationReminder({ eventId: s.eventId, userId: '789' }).status, 'active');
  assert.equal(s.eligible(), true);
});

test('malformed, copied, wrong-recipient, and server-context controls never change reminder or response state', async () => {
  const s = scenario();
  const originalResponse = getResponse(s.eventId, '789');
  const originalState = getPrequalificationReminder({ eventId: s.eventId, userId: '789' });
  for (const request of [
    s.interaction('withdraw', { userId: '888' }),
    s.interaction('withdraw', { guildId: '123' }),
    s.interaction('withdraw', { customId: `prequal-reminder:withdraw:456:${s.eventId}:789` }),
    s.interaction('withdraw', { customId: `prequal-reminder:other:123:${s.eventId}:789` }),
    s.interaction('withdraw', { customId: 'prequal-reminder:done:123:999999:789' }),
  ]) {
    await handlePrequalificationReminderButton(request);
    assert.equal(request.updates.length, 0);
    assert.equal(request.replies.length, 1);
    if (request.guildId) assert.equal(request.replies[0].flags, MessageFlags.Ephemeral);
    assert.deepEqual(getResponse(s.eventId, '789'), originalResponse);
    assert.deepEqual(getPrequalificationReminder({ eventId: s.eventId, userId: '789' }), originalState);
  }
  assert.deepEqual(s.serverEdits, []);
  assert.deepEqual(s.sends, []);
});

test('a complete reminder enrollment in an unconfigured source server cannot be changed by its DM controls', async () => {
  const foreign = scenario({ guildId: '456' });
  const before = getPrequalificationReminder({ eventId: foreign.eventId, userId: '789' });
  const request = foreign.interaction('withdraw');
  await handlePrequalificationReminderButton(request);
  assert.equal(request.updates.length, 0);
  assert.equal(request.replies.length, 1);
  assert.equal(getResponse(foreign.eventId, '789').attending, 1);
  assert.deepEqual(getPrequalificationReminder({ eventId: foreign.eventId, userId: '789' }), before);
});

test('cleared phases, deleted leagues, non-league records, and absent reminder enrollments refuse old controls', async () => {
  const cleared = scenario();
  setLeaguePrequalification({ leagueId: cleared.eventId, guildId: '123', kind: null });
  const deleted = scenario();
  deleteEvent({ eventId: deleted.eventId, guildId: '123' });
  const absent = scenario({ initialize: false });
  const nonLeague = createEvent({ guildId: '123', game: 'iracing', eventType: 'other', title: 'Other event',
    startsAt: 2000000000, track: 'Spa', createdBy: 'staff', createdAt: 1 });
  const original = getResponse(cleared.eventId, '789');
  for (const request of [
    cleared.interaction('done'), deleted.interaction('done'), absent.interaction('done'),
    absent.interaction('done', { customId: `prequal-reminder:done:123:${nonLeague}:789` }),
  ]) {
    await handlePrequalificationReminderButton(request);
    assert.equal(request.updates.length, 0);
    assert.equal(request.replies.length, 1);
  }
  assert.deepEqual(getResponse(cleared.eventId, '789'), original);
  assert.equal(getPrequalificationReminder({ eventId: cleared.eventId, userId: '789' }).status, 'active');
  assert.equal(getPrequalificationReminder({ eventId: absent.eventId, userId: '789' }), null);
});

test('an already-delivered reminder can be completed after the dated phase closes', async () => {
  const s = scenario();
  setLeaguePrequalification({ leagueId: s.eventId, guildId: '123', kind: 'signup',
    startsAt: s.now - 10 * 86400, dateOnlyUntil: s.now - 86400, details: 'Closed signup' });
  const request = s.interaction('done');
  await handlePrequalificationReminderButton(request);
  assertStoppedMessage(request);
  assert.equal(getPrequalificationReminder({ eventId: s.eventId, userId: '789' }).status, 'completed');
  assert.equal(getResponse(s.eventId, '789').attending, 1);
});
