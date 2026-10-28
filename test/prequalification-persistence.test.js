const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-prequal-state-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');
const moduleNames = [
  '../src/db/database', '../src/db/eventRepository', '../src/db/leagueRepository',
  '../src/reminders/repository', '../src/reminders/prequalification/repository',
];
function load() {
  return {
    db: require(moduleNames[0]), events: require(moduleNames[1]),
    responses: require(moduleNames[3]), reminders: require(moduleNames[4]),
  };
}
let modules = load();
const now = Math.floor(Date.now() / 1000);
const threeDays = 3 * 86400;

beforeEach(() => modules.db.exec('DELETE FROM events'));
after(() => {
  modules.db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

function league(values = {}) {
  return modules.events.createEvent({
    guildId: '123', game: 'iracing', eventType: 'league', title: 'Season',
    createdBy: 'staff', createdAt: now,
    prequalification: { kind: 'signup', startsAt: now - 86400, dateOnlyUntil: now + 10 * 86400, details: 'Sign up' },
    ...values,
  });
}
function respond(eventId, attending = 1, userId = 'driver', team = 'academy') {
  modules.responses.saveResponse({ eventId, userId, attending, team,
    days: attending ? 'Saturday' : null, carClass: attending ? 'GT3' : null,
    availabilityHours: attending ? '14:00' : null });
}
function state(eventId, userId = 'driver') {
  return modules.reminders.getPrequalificationReminder({ eventId, userId });
}
function ensure(eventId, userId = 'driver') {
  return modules.reminders.ensurePrequalificationReminder({ eventId, userId, now });
}
function stop(eventId, action, userId = 'driver', guildId = '123') {
  return modules.reminders.stopPrequalificationReminder({ eventId, guildId, userId, action, now: now + 1 });
}

test('candidates require an interested member and scheduled league with a known prequalification start', () => {
  const eligible = league();
  respond(eligible);
  const declined = league();
  respond(declined, 0);
  const cancelled = league();
  respond(cancelled);
  modules.db.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").run(cancelled);
  const completed = league();
  respond(completed);
  modules.db.prepare("UPDATE events SET status = 'completed' WHERE id = ?").run(completed);
  const unconfigured = league({ prequalification: undefined });
  respond(unconfigured);
  const undated = league({ prequalification: { kind: 'race' } });
  respond(undated);
  const noResponse = league();
  const special = modules.events.createEvent({ guildId: '123', game: 'iracing', eventType: 'special_event',
    title: 'Special event', startsAt: now + 86400, track: 'Spa', carClass: 'GT3', createdBy: 'staff', createdAt: now });
  respond(special);
  const candidates = modules.reminders.getPrequalificationCandidates(now);
  assert.deepEqual(candidates.map(({ id, event_id, user_id, team, reminder_status }) => ({ id, event_id, user_id, team, reminder_status })), [
    { id: eligible, event_id: eligible, user_id: 'driver', team: 'academy', reminder_status: null },
  ]);
  assert.equal(candidates[0].status, 'scheduled');
  assert.equal(candidates[0].prequal_kind, 'signup');
  assert.equal(ensure(eligible).status, 'active');
  for (const id of [declined, cancelled, completed, unconfigured, undated, noResponse, special]) {
    assert.equal(ensure(id), null);
  }
});

test('delivery cadence is durable and due at the exact next reminder time', () => {
  const eventId = league();
  respond(eventId);
  assert.equal(ensure(eventId).next_remind_at, null);
  assert.equal(modules.reminders.recordPrequalificationReminderSent({ eventId, userId: 'missing', sentAt: now, nextRemindAt: now + threeDays }), false);
  assert.equal(modules.reminders.recordPrequalificationReminderSent({ eventId, userId: 'driver', sentAt: now, nextRemindAt: now + threeDays }), true);
  assert.equal(state(eventId).last_sent_at, now);
  assert.equal(state(eventId).next_remind_at, now + threeDays);
  assert.deepEqual(modules.reminders.getPrequalificationCandidates(now + threeDays - 1), []);
  assert.equal(modules.reminders.getPrequalificationCandidates(now + threeDays)[0].id, eventId);
  assert.equal(ensure(eventId).next_remind_at, now + threeDays);
  assert.equal(modules.reminders.recordPrequalificationReminderSent({ eventId, userId: 'driver', sentAt: now - 1, nextRemindAt: now + 1 }), false);
  assert.equal(state(eventId).next_remind_at, now + threeDays);
});

test('completion keeps league interest and one-shot reminders and cannot be undone by another button or RSVP update', () => {
  const eventId = league();
  respond(eventId);
  ensure(eventId);
  modules.responses.schedulePrivateReminder({ eventId, userId: 'driver', remindAt: now + 86400, requestedAt: now, team: 'academy' });
  const before = modules.db.prepare('SELECT * FROM special_event_responses WHERE event_id = ?').get(eventId);
  const result = stop(eventId, 'done');
  assert.equal(result.ok, true);
  assert.equal(result.status, 'completed');
  assert.equal(result.changed, true);
  assert.deepEqual(modules.db.prepare('SELECT * FROM special_event_responses WHERE event_id = ?').get(eventId), before);
  assert.equal(modules.db.prepare('SELECT COUNT(*) AS count FROM special_event_private_reminders WHERE event_id = ?').get(eventId).count, 1);
  assert.equal(stop(eventId, 'withdraw').alreadyStopped, true);
  assert.equal(stop(eventId, 'withdraw').status, 'completed');
  assert.equal(modules.responses.getResponse(eventId, 'driver').attending, 1);
  respond(eventId, 1, 'driver', 'main');
  respond(eventId, 0, 'driver', 'main');
  respond(eventId, 1, 'driver', 'main');
  assert.equal(state(eventId).status, 'completed');
  assert.equal(ensure(eventId).status, 'completed');
  assert.deepEqual(modules.reminders.getPrequalificationCandidates(now + 20 * 86400), []);
  assert.equal(modules.reminders.recordPrequalificationReminderSent({ eventId, userId: 'driver', sentAt: now + 2, nextRemindAt: now + threeDays }), false);
  assert.equal(state(eventId).next_remind_at, null);
});

test('withdrawal declines league interest, preserves the team, and rearms only on a later explicit return to interested', () => {
  const eventId = league();
  respond(eventId);
  ensure(eventId);
  const result = stop(eventId, 'withdraw');
  assert.equal(result.ok, true);
  assert.equal(result.status, 'withdrawn');
  assert.deepEqual(modules.responses.getResponse(eventId, 'driver'), {
    attending: 0, team: 'academy', days: null, car_class: null, availability_hours: null,
  });
  const replay = stop(eventId, 'done');
  assert.equal(replay.alreadyStopped, true);
  assert.equal(replay.status, 'withdrawn');
  assert.equal(modules.responses.getResponse(eventId, 'driver').attending, 0);
  respond(eventId, 0);
  assert.equal(state(eventId).status, 'withdrawn');
  assert.equal(modules.reminders.recordPrequalificationReminderSent({ eventId, userId: 'driver', sentAt: now + 2, nextRemindAt: now + threeDays }), false);
  respond(eventId, 1);
  assert.equal(state(eventId), null);
  assert.equal(modules.reminders.getPrequalificationCandidates(now)[0].id, eventId);
  assert.equal(ensure(eventId).status, 'active');
});

test('stop actions enforce guild/current interest and roll back state changes if declining the RSVP fails', () => {
  const eventId = league();
  respond(eventId);
  ensure(eventId);
  assert.equal(stop(eventId, 'withdraw', 'driver', '456').ok, false);
  assert.equal(state(eventId).status, 'active');
  assert.equal(stop(eventId, 'unknown').ok, false);
  assert.equal(stop(eventId, 'done', 'missing').ok, false);
  modules.db.exec(`
    CREATE TRIGGER test_decline_failure BEFORE UPDATE ON special_event_responses
    WHEN NEW.attending = 0 BEGIN SELECT RAISE(ABORT, 'simulated RSVP failure'); END;
  `);
  try {
    assert.throws(() => stop(eventId, 'withdraw'), /simulated RSVP failure/);
    assert.equal(state(eventId).status, 'active');
    assert.equal(modules.responses.getResponse(eventId, 'driver').attending, 1);
  } finally {
    modules.db.exec('DROP TRIGGER test_decline_failure');
  }
  respond(eventId, 0);
  assert.equal(stop(eventId, 'done').ok, false);
  assert.equal(state(eventId).status, 'active');
});

test('state and cadence survive database reopening and disappear only when their league is deleted', () => {
  const eventId = league();
  for (const userId of ['active', 'done', 'withdrawn']) {
    respond(eventId, 1, userId);
    ensure(eventId, userId);
  }
  modules.reminders.recordPrequalificationReminderSent({ eventId, userId: 'active', sentAt: now, nextRemindAt: now + threeDays });
  stop(eventId, 'done', 'done');
  stop(eventId, 'withdraw', 'withdrawn');
  const before = modules.db.prepare('SELECT * FROM league_prequalification_reminders ORDER BY user_id').all();
  const responseBefore = modules.db.prepare('SELECT * FROM special_event_responses ORDER BY user_id').all();
  modules.db.close();
  for (const name of moduleNames) delete require.cache[require.resolve(name)];
  modules = load();
  assert.deepEqual(modules.db.prepare('SELECT * FROM league_prequalification_reminders ORDER BY user_id').all(), before);
  assert.deepEqual(modules.db.prepare('SELECT * FROM special_event_responses ORDER BY user_id').all(), responseBefore);
  assert.deepEqual(modules.reminders.getPrequalificationCandidates(now + threeDays).map(({ user_id }) => user_id), ['active']);
  assert.deepEqual(modules.db.pragma('foreign_key_check'), []);
  modules.events.deleteEvent({ eventId, guildId: '123' });
  assert.equal(modules.db.prepare('SELECT COUNT(*) AS count FROM league_prequalification_reminders').get().count, 0);
});
