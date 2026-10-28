const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-prequalification-scheduler-'));
Object.assign(process.env, {
  DISCORD_TOKEN: 'test', CLIENT_ID: 'test', GUILD_IDS: '123', REMINDER_CHANNELS: '',
  DEFAULT_TIMEZONE: 'Europe/Berlin', DATABASE_PATH: path.join(directory, 'events.sqlite'),
});
const { DateTime } = require('luxon');
const db = require('../src/db/database');
const { createEvent, getEvent } = require('../src/db/eventRepository');
const { setLeaguePrequalification } = require('../src/db/leagueRepository');
const { saveResponse } = require('../src/reminders/repository');
const { getPrequalificationReminder, stopPrequalificationReminder } = require('../src/reminders/prequalification/repository');
const schedulerPath = require.resolve('../src/reminders/prequalification/scheduler');
const { checkPrequalificationReminders } = require(schedulerPath);

const now = DateTime.fromISO('2030-10-25T10:00:00', { zone: 'Europe/Berlin' });
const unix = (date) => Math.floor(date.toSeconds());

after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => db.exec('DELETE FROM events'));

function league({ guildId = '123', start = now.minus({ days: 1 }), end = now.plus({ days: 100 }),
  seasonStart = null, seasonEnd = null, kind = 'signup' } = {}) {
  return createEvent({ guildId, game: 'iracing', eventType: 'league', title: 'League',
    startsAt: seasonStart ? unix(seasonStart) : null, dateOnlyUntil: seasonEnd ? unix(seasonEnd) : null,
    createdBy: 'staff', createdAt: unix(now),
    prequalification: kind ? { kind, startsAt: start ? unix(start) : null,
      dateOnlyUntil: end ? unix(end) : null, details: 'https://example.org/prequal' } : undefined,
  });
}

function respond(eventId, userId = 'driver', attending = 1) {
  saveResponse({ eventId, userId, attending, days: null, carClass: null, availabilityHours: null, team: 'main' });
}

function client({ fetch, send } = {}) {
  const fetched = [];
  const sent = [];
  return { fetched, sent, users: { fetch: async (userId) => {
    fetched.push(userId);
    if (fetch) await fetch(userId);
    return { send: async (message) => {
      if (send) await send(userId, message);
      sent.push({ userId, message });
      return { id: String(sent.length) };
    } };
  } } };
}

function state(eventId, userId = 'driver') {
  return getPrequalificationReminder({ eventId, userId });
}

test('first DM waits for the opening boundary, then repeats every three calendar days without channel configuration', async () => {
  const eventId = league({ start: now });
  respond(eventId);
  const fx = client();
  await checkPrequalificationReminders(fx, now.minus({ seconds: 1 }));
  assert.equal(fx.fetched.length, 0);
  assert.equal(state(eventId), null);
  await checkPrequalificationReminders(fx, now);
  assert.equal(fx.sent.length, 1);
  assert.equal(state(eventId).last_sent_at, unix(now));
  assert.equal(state(eventId).next_remind_at, unix(now.plus({ days: 3 })));
  const next = DateTime.fromSeconds(state(eventId).next_remind_at, { zone: 'Europe/Berlin' });
  assert.equal(next.hour, 10);
  assert.equal(state(eventId).next_remind_at - state(eventId).last_sent_at, 73 * 3600, 'DST preserves local time across the autumn transition');
  await checkPrequalificationReminders(fx, now.plus({ days: 3 }).minus({ seconds: 1 }));
  assert.equal(fx.sent.length, 1);
  await checkPrequalificationReminders(fx, now.plus({ days: 3 }));
  assert.equal(fx.sent.length, 2);
  assert.equal(state(eventId).next_remind_at, unix(now.plus({ days: 6 })));
});

test('late interest joins an open phase, downtime produces one reminder, and a restarted scheduler retains delivery state', async () => {
  const eventId = league();
  respond(eventId, 'early');
  const fx = client();
  await checkPrequalificationReminders(fx, now);
  respond(eventId, 'late');
  await checkPrequalificationReminders(fx, now.plus({ days: 1 }));
  assert.deepEqual(fx.sent.map(({ userId }) => userId), ['early', 'late']);
  await checkPrequalificationReminders(fx, now.plus({ days: 20 }));
  assert.equal(fx.sent.length, 4);
  assert.equal(state(eventId, 'late').next_remind_at, unix(now.plus({ days: 23 })));
  delete require.cache[schedulerPath];
  const restarted = require(schedulerPath);
  await restarted.checkPrequalificationReminders(fx, now.plus({ days: 20 }));
  assert.equal(fx.sent.length, 4);
});

test('unknown guilds, non-interest, unknown starts, cleared phases, completed leagues and closed windows do not send', async () => {
  const foreign = league({ guildId: '456' });
  const declined = league();
  const undated = league({ start: null, end: null });
  const cleared = league({ kind: null });
  const complete = league();
  const closed = league({ start: now.minus({ days: 2 }), end: now });
  for (const eventId of [foreign, undated, cleared, complete, closed]) respond(eventId);
  respond(declined, 'driver', 0);
  db.prepare("UPDATE events SET status = 'completed' WHERE id = ?").run(complete);
  const fx = client();
  await checkPrequalificationReminders(fx, now);
  assert.equal(fx.fetched.length, 0);
  assert.equal(fx.sent.length, 0);
});

test('concurrent checks share one in-flight delivery per league and user', async () => {
  const eventId = league();
  respond(eventId);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fx = client({ fetch: () => gate });
  const first = checkPrequalificationReminders(fx, now);
  await checkPrequalificationReminders(fx, now);
  assert.equal(fx.fetched.length, 1);
  release();
  await first;
  assert.equal(fx.sent.length, 1);
});

test('a failed recipient remains due while successful recipients continue and do not receive a retry', async () => {
  const eventId = league();
  respond(eventId, 'a-failing');
  respond(eventId, 'b-working');
  let fail = true;
  const fx = client({ send: (userId) => {
    if (fail && userId === 'a-failing') throw new Error('DMs temporarily unavailable');
  } });
  const previousError = console.error;
  const errors = [];
  console.error = (...error) => errors.push(error);
  try {
    await checkPrequalificationReminders(fx, now);
    assert.equal(errors.length, 1);
    assert.deepEqual(fx.sent.map(({ userId }) => userId), ['b-working']);
    assert.equal(state(eventId, 'a-failing').last_sent_at, null);
    assert.equal(state(eventId, 'a-failing').next_remind_at, null);
    fail = false;
    await checkPrequalificationReminders(fx, now.plus({ minutes: 5 }));
    assert.deepEqual(fx.sent.map(({ userId }) => userId), ['b-working', 'a-failing']);
    assert.equal(state(eventId, 'a-failing').next_remind_at, unix(now.plus({ days: 3, minutes: 5 })));
  } finally { console.error = previousError; }
});

test('interest, state, status and window changes during the user fetch stop delivery', async () => {
  const mutations = [
    (eventId) => respond(eventId, 'driver', 0),
    (eventId) => stopPrequalificationReminder({ eventId, guildId: '123', userId: 'driver', action: 'done', now: unix(now) }),
    (eventId) => db.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").run(eventId),
    (eventId) => setLeaguePrequalification({ leagueId: eventId, guildId: '123', kind: 'signup', startsAt: unix(now.plus({ days: 1 })) }),
    (eventId) => setLeaguePrequalification({ leagueId: eventId, guildId: '123', kind: null }),
    (eventId) => db.prepare('DELETE FROM events WHERE id = ?').run(eventId),
  ];
  for (const mutate of mutations) {
    db.exec('DELETE FROM events');
    const eventId = league();
    respond(eventId);
    const fx = client({ fetch: () => mutate(eventId) });
    await checkPrequalificationReminders(fx, now);
    assert.equal(fx.fetched.length, 1);
    assert.equal(fx.sent.length, 0);
  }
});

test('stopping while Discord sends the DM cannot reactivate completed or withdrawn reminders', async () => {
  for (const [action, status] of [['done', 'completed'], ['withdraw', 'withdrawn']]) {
    db.exec('DELETE FROM events');
    const eventId = league();
    respond(eventId);
    const fx = client({ send: () => {
      assert.equal(stopPrequalificationReminder({ eventId, guildId: '123', userId: 'driver', action, now: unix(now) }).ok, true);
    } });
    await checkPrequalificationReminders(fx, now);
    assert.equal(fx.sent.length, 1);
    assert.equal(state(eventId).status, status);
    assert.equal(state(eventId).next_remind_at, null);
    await checkPrequalificationReminders(fx, now.plus({ days: 3 }));
    assert.equal(fx.sent.length, 1);
  }
});

test('a window closing during the user fetch prevents a late DM', async () => {
  const eventId = league({ end: now.plus({ seconds: 1 }) });
  respond(eventId);
  const previousNow = Date.now;
  let wallClock = previousNow();
  Date.now = () => wallClock;
  const fx = client({ fetch: () => { wallClock += 2000; } });
  try {
    await checkPrequalificationReminders(fx, now);
    assert.equal(fx.fetched.length, 1);
    assert.equal(fx.sent.length, 0);
  } finally { Date.now = previousNow; }
});

test('deliberately rejoining resumes a withdrawal while completed prequalification remains stopped', async () => {
  for (const action of ['done', 'withdraw']) {
    db.exec('DELETE FROM events');
    const eventId = league();
    respond(eventId);
    const fx = client();
    await checkPrequalificationReminders(fx, now);
    stopPrequalificationReminder({ eventId, guildId: '123', userId: 'driver', action, now: unix(now) });
    if (action === 'done') respond(eventId, 'driver', 0);
    respond(eventId);
    await checkPrequalificationReminders(fx, now.plus({ minutes: 5 }));
    assert.equal(fx.sent.length, action === 'done' ? 1 : 2);
    assert.equal(state(eventId).status, action === 'done' ? 'completed' : 'active');
  }
});

test('editing a window postpones reminders without replaying missed intervals or sending after the new deadline', async () => {
  const eventId = league();
  respond(eventId);
  const fx = client();
  await checkPrequalificationReminders(fx, now);
  setLeaguePrequalification({ leagueId: eventId, guildId: '123', kind: 'signup', startsAt: unix(now.plus({ days: 5 })), dateOnlyUntil: unix(now.plus({ days: 10 })) });
  await checkPrequalificationReminders(fx, now.plus({ days: 3 }));
  assert.equal(fx.sent.length, 1);
  await checkPrequalificationReminders(fx, now.plus({ days: 5 }));
  assert.equal(fx.sent.length, 2);
  assert.equal(state(eventId).next_remind_at, unix(now.plus({ days: 8 })));
  setLeaguePrequalification({ leagueId: eventId, guildId: '123', kind: 'signup', startsAt: unix(now.plus({ days: 5 })), dateOnlyUntil: unix(now.plus({ days: 8 })) });
  await checkPrequalificationReminders(fx, now.plus({ days: 8 }));
  assert.equal(fx.sent.length, 2);
});

test('scoped checks only deliver to the selected league and driver', async () => {
  const selected = league();
  const other = league();
  respond(selected, 'selected');
  respond(selected, 'other-driver');
  respond(other, 'selected');
  const fx = client();
  await checkPrequalificationReminders(fx, now, { eventId: selected, userId: 'selected' });
  assert.equal(fx.sent.length, 1);
  assert.equal(fx.sent[0].userId, 'selected');
  assert.equal(state(selected, 'other-driver'), null);
  assert.equal(state(other, 'selected'), null);
  assert.equal(getEvent({ eventId: selected, guildId: '123' }).status, 'scheduled');
});
