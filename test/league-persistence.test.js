const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-league-persistence-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');

// Reproduce the deployed parent schema and live dependent data before upgrading.
const legacy = new Database(process.env.DATABASE_PATH);
legacy.pragma('foreign_keys = ON');
legacy.exec(`
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
    game TEXT NOT NULL, event_type TEXT NOT NULL, title TEXT NOT NULL,
    starts_at INTEGER NOT NULL, date_only_until INTEGER, track TEXT NOT NULL,
    car_class TEXT, details TEXT, status TEXT NOT NULL DEFAULT 'scheduled',
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE special_event_reminders (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    starts_at INTEGER NOT NULL, lead_days INTEGER NOT NULL,
    channel_id TEXT NOT NULL, message_id TEXT NOT NULL, sent_at INTEGER NOT NULL,
    team TEXT NOT NULL DEFAULT '', author_id TEXT, deleted_at INTEGER,
    PRIMARY KEY (event_id, starts_at, lead_days, channel_id)
  );
  CREATE TABLE special_event_private_reminders (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL, remind_at INTEGER NOT NULL, requested_at INTEGER NOT NULL,
    sent_at INTEGER, team TEXT NOT NULL DEFAULT '', PRIMARY KEY (event_id, user_id)
  );
  CREATE TABLE special_event_responses (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL, attending INTEGER NOT NULL, days TEXT,
    car_class TEXT, availability_hours TEXT, updated_at INTEGER NOT NULL,
    team TEXT NOT NULL DEFAULT '', PRIMARY KEY (event_id, user_id)
  );
  CREATE TABLE reminder_channels (
    guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, game TEXT,
    team TEXT NOT NULL DEFAULT '', PRIMARY KEY (guild_id, channel_id)
  );
  CREATE TABLE league_races (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title TEXT NOT NULL, starts_at INTEGER NOT NULL, track TEXT NOT NULL,
    qualifying TEXT, details TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  INSERT INTO events
    (id, guild_id, game, event_type, title, starts_at, track, car_class, created_by, created_at)
  VALUES
    (1, '123', 'iracing', 'special_event', 'Existing special', 2000000000, 'Spa', 'GT3', 'staff', 1900000000),
    (2, '123', 'lmu', 'league', 'Existing league', 2000000000, 'Various', NULL, 'staff', 1900000000),
    (100, '123', 'lmu', 'other', 'Removed event', 2000000000, 'Spa', NULL, 'staff', 1900000000);
  DELETE FROM events WHERE id = 100;
  INSERT INTO special_event_reminders VALUES
    (1, 2000000000, 7, '456', 'message', 1900000000, 'main', 'bot', NULL);
  INSERT INTO special_event_private_reminders VALUES
    (1, 'driver', 1999990000, 1900000000, NULL, 'main');
  INSERT INTO special_event_responses VALUES
    (1, 'driver', 1, 'Saturday', 'GT3', '14:00', 1900000000, 'main');
  INSERT INTO reminder_channels VALUES ('123', '456', 'iracing', 'main');
  INSERT INTO league_races VALUES
    (1, 2, 'Existing round', 2000000000, 'Spa', '15 minutes', 'Rolling start', 'staff', 1900000000),
    (50, 2, 'Removed round', 2000000000, 'Spa', NULL, NULL, 'staff', 1900000000);
  DELETE FROM league_races WHERE id = 50;
`);
const tables = ['events', 'special_event_reminders', 'special_event_private_reminders', 'special_event_responses', 'reminder_channels', 'league_races'];
const before = new Map(tables.map((table) => [table, legacy.prepare(`SELECT * FROM ${table}`).all()]));
legacy.close();

const databaseModule = require.resolve('../src/db/database');
let db = require(databaseModule);
function originalRows(table) {
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  return table === 'league_races' ? rows.map(({ tier_id, ...row }) => row) : rows;
}

after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('league migration preserves dependent data, sequences, foreign keys, and a restorable snapshot', () => {
  for (const table of tables) assert.deepEqual(originalRows(table), before.get(table), table);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.pragma('table_info(events)').find(({ name }) => name === 'starts_at').notnull, 0);
  assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'events'").get().seq, 100);
  assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'league_races'").get().seq, 50);
  const migratedTier = db.prepare('SELECT * FROM league_tiers WHERE league_id = 2').get();
  assert.equal(migratedTier.name, 'Tier 1');
  assert.equal(db.prepare('SELECT tier_id FROM league_races WHERE id = 1').get().tier_id, migratedTier.id);
  assert.equal(db.pragma('table_info(league_races)').find(({ name }) => name === 'tier_id').notnull, 1);
  assert.equal(fs.readdirSync(directory).filter((name) => name.includes('.pre-league-tiers-')).length, 1);
  const backups = fs.readdirSync(directory).filter((name) => name.includes('.pre-leagues-'));
  assert.equal(backups.length, 1);
  const snapshot = new Database(path.join(directory, backups[0]), { readonly: true });
  try {
    for (const table of tables) assert.deepEqual(snapshot.prepare(`SELECT * FROM ${table}`).all(), before.get(table), table);
    assert.equal(snapshot.pragma('table_info(events)').find(({ name }) => name === 'starts_at').notnull, 1);
  } finally {
    snapshot.close();
  }
  db.close();
  delete require.cache[databaseModule];
  db = require(databaseModule);
  for (const table of tables) assert.deepEqual(originalRows(table), before.get(table), table);
  assert.equal(fs.readdirSync(directory).filter((name) => name.includes('.pre-leagues-')).length, 1);
  assert.equal(fs.readdirSync(directory).filter((name) => name.includes('.pre-league-tiers-')).length, 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('undated and ongoing leagues stay listed; ended leagues and foreign guilds are excluded', () => {
  const { createEvent, editEvent, getEvent, getUpcomingEvents } = require('../src/db/eventRepository');
  const now = Math.floor(Date.now() / 1000);
  const make = (values) => createEvent({
    guildId: '123', game: 'iracing', eventType: 'league', title: 'Season',
    createdBy: 'staff', createdAt: now, ...values,
  });
  const undated = make({ title: 'No dates' });
  assert.ok(undated > 100);
  assert.equal(getEvent({ eventId: undated, guildId: '123' }).starts_at, null);
  const ongoing = make({ startsAt: now - 86400, dateOnlyUntil: now + 86400 });
  const ended = make({ startsAt: now - 2 * 86400, dateOnlyUntil: now - 86400 });
  const foreign = make({ guildId: '456' });
  const expiredLegacyLeague = make({ startsAt: now - 86400 });
  const listed = getUpcomingEvents({ guildId: '123', eventType: 'league' });
  assert.ok(listed.some(({ id }) => id === ongoing));
  assert.ok(!listed.some(({ id }) => id === expiredLegacyLeague));
  assert.ok(!listed.some(({ id }) => id === ended || id === foreign));
  assert.equal(listed.at(-1).id, undated);
  assert.equal(editEvent({ eventId: undated, guildId: '123', title: 'Dates added', startsAt: now + 86400, dateOnlyUntil: now + 2 * 86400 }), true);
  assert.equal(editEvent({ eventId: undated, guildId: '123', title: 'Dates removed' }), true);
  assert.equal(getEvent({ eventId: undated, guildId: '123' }).starts_at, null);
  assert.throws(() => make({ eventType: 'special_event' }), /CHECK constraint/);
});

test('race CRUD inherits guild access, rejects nonleagues, sorts races, and cascades on league deletion', () => {
  const { createEvent, deleteEvent } = require('../src/db/eventRepository');
  const { createRace, getRace, getLeagueRaces, editRace, deleteRace } = require('../src/db/raceRepository');
  const now = Math.floor(Date.now() / 1000);
  const leagueId = createEvent({ guildId: '123', game: 'lmu', eventType: 'league', title: 'New league', createdBy: 'staff', createdAt: now });
  const make = (values) => createRace({
    leagueId, guildId: '123', title: 'Round', startsAt: now + 86400,
    track: 'Spa', qualifying: '15 minutes', details: '60 minute race', createdBy: 'staff', createdAt: now, ...values,
  });
  const later = make({ startsAt: now + 2 * 86400 });
  const earlier = make({});
  assert.deepEqual(getLeagueRaces({ leagueId, guildId: '123' }).map(({ id }) => id), [earlier, later]);
  assert.equal(getRace({ raceId: earlier, guildId: '123' }).qualifying, '15 minutes');
  assert.equal(getRace({ raceId: earlier, guildId: '123' }).league_id, leagueId);
  assert.equal(getRace({ raceId: earlier, guildId: '456' }), undefined);
  assert.deepEqual(getLeagueRaces({ leagueId, guildId: '456' }), []);
  assert.throws(() => make({ guildId: '456' }), /No league/);
  assert.throws(() => make({ leagueId: 1 }), /No league/);
  assert.equal(editRace({ raceId: earlier, guildId: '456', title: 'Stolen', startsAt: now, track: 'Monza' }), false);
  assert.equal(editRace({ raceId: earlier, guildId: '123', title: 'Updated round', startsAt: now + 3 * 86400, track: 'Monza' }), true);
  assert.equal(getRace({ raceId: earlier, guildId: '123' }).qualifying, null);
  assert.deepEqual(getLeagueRaces({ leagueId, guildId: '123' }).map(({ id }) => id), [later, earlier]);
  assert.equal(deleteRace({ raceId: later, guildId: '456' }), false);
  assert.equal(deleteRace({ raceId: later, guildId: '123' }), true);
  assert.equal(deleteEvent({ eventId: leagueId, guildId: '456' }), false);
  assert.equal(deleteEvent({ eventId: leagueId, guildId: '123' }), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM league_races WHERE league_id = ?').get(leagueId).count, 0);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
