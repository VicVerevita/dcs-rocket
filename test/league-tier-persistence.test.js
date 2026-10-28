const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-league-tiers-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');

const db = require('../src/db/database');
const { createEvent, getEvent, editEvent, getUpcomingEvents, deleteEvent } = require('../src/db/eventRepository');
const { getLeague, getLeagues, getLeagueTiers, createTier, renameTier, deleteTier, setLeaguePrequalification } = require('../src/db/leagueRepository');
const { createRace, getRace } = require('../src/db/raceRepository');
const now = Math.floor(Date.now() / 1000);
const makeLeague = (values = {}) => createEvent({
  guildId: '123', game: 'iracing', eventType: 'league', title: 'Season',
  createdBy: 'staff', createdAt: now, ...values,
});

after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('league creation initializes tiers and prequalification atomically', () => {
  const simple = makeLeague();
  assert.deepEqual(getLeagueTiers({ leagueId: simple, guildId: '123' }).map(({ name }) => name), ['Tier 1']);
  const leagueId = makeLeague({
    tierNames: ['Tier 1', 'Tier 2', 'Tier 3'],
    prequalification: { kind: 'race', startsAt: now + 86400, dateOnlyUntil: null, details: '20 minute qualifier' },
  });
  assert.deepEqual(getLeagueTiers({ leagueId, guildId: '123' }).map(({ name, position }) => ({ name, position })), [
    { name: 'Tier 1', position: 0 }, { name: 'Tier 2', position: 1 }, { name: 'Tier 3', position: 2 },
  ]);
  const league = getEvent({ eventId: leagueId, guildId: '123' });
  assert.equal(league.prequal_kind, 'race');
  assert.equal(league.prequal_starts_at, now + 86400);
  assert.equal(league.prequal_details, '20 minute qualifier');
  assert.equal(getUpcomingEvents({ guildId: '123', eventType: 'league' }).find(({ id }) => id === leagueId).prequal_kind, 'race');
  const before = db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
  assert.throws(() => makeLeague({ tierNames: ['Gold', 'gold'] }), /already has a tier/);
  assert.throws(() => makeLeague({ tierNames: [] }), /at least one tier/);
  assert.throws(() => makeLeague({ prequalification: { kind: 'invalid' } }), /prequalification race or signup period/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM events').get().count, before);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('event edits preserve tiers and settings; explicit prequalification edits and clearing are atomic', () => {
  const leagueId = makeLeague({ tierNames: ['Pro', 'Am'], prequalification: { kind: 'signup', startsAt: now + 86400, dateOnlyUntil: now + 2 * 86400, details: 'Signup link' } });
  const tiers = getLeagueTiers({ leagueId, guildId: '123' });
  editEvent({ eventId: leagueId, guildId: '123', title: 'Revised season' });
  assert.equal(getLeague({ leagueId, guildId: '123' }).prequal_kind, 'signup');
  assert.deepEqual(getLeagueTiers({ leagueId, guildId: '123' }), tiers);
  assert.throws(() => editEvent({ eventId: leagueId, guildId: '123', title: 'Should roll back', prequalification: { kind: 'race', startsAt: now + 86400, dateOnlyUntil: now } }), /end must be on or after/);
  assert.equal(getLeague({ leagueId, guildId: '123' }).title, 'Revised season');
  assert.equal(editEvent({ eventId: leagueId, guildId: '123', title: 'Qualifier changed', prequalification: { kind: 'race', startsAt: now + 4 * 86400, details: 'New format' } }), true);
  assert.equal(getLeague({ leagueId, guildId: '123' }).prequal_kind, 'race');
  assert.equal(setLeaguePrequalification({ leagueId, guildId: '123', kind: null }), true);
  const cleared = getLeague({ leagueId, guildId: '123' });
  assert.equal(cleared.prequal_kind, null);
  assert.equal(cleared.prequal_starts_at, null);
  assert.equal(cleared.prequal_date_only_until, null);
  assert.equal(cleared.prequal_details, null);
  assert.equal(setLeaguePrequalification({ leagueId, guildId: '456', kind: 'signup' }), false);
});

test('tier operations enforce guild access, unique names, and safe removal', () => {
  const leagueId = makeLeague();
  const first = getLeagueTiers({ leagueId, guildId: '123' })[0].id;
  assert.throws(() => deleteTier({ tierId: first, guildId: '123' }), /at least one tier/);
  const second = createTier({ leagueId, guildId: '123', name: 'Gold' });
  assert.equal(renameTier({ tierId: second, guildId: '123', name: 'Silver' }), true);
  assert.throws(() => createTier({ leagueId, guildId: '123', name: 'silver' }), /already has a tier/);
  const elite = createTier({ leagueId, guildId: '123', name: 'ÉLITE' });
  assert.throws(() => createTier({ leagueId, guildId: '123', name: 'e\u0301lite' }), /already has a tier/);
  assert.throws(() => renameTier({ tierId: second, guildId: '123', name: 'élite' }), /already has a tier/);
  assert.equal(deleteTier({ tierId: elite, guildId: '123' }), true);
  assert.throws(() => renameTier({ tierId: second, guildId: '123', name: 'tier 1' }), /already has a tier/);
  assert.throws(() => createTier({ leagueId, guildId: '123', name: 'x'.repeat(101) }), /1–100/);
  assert.throws(() => createTier({ leagueId, guildId: '456', name: 'Foreign' }), /No league/);
  assert.equal(renameTier({ tierId: second, guildId: '456', name: 'Foreign' }), false);
  assert.equal(deleteTier({ tierId: second, guildId: '456' }), false);
  const raceId = createRace({ leagueId, guildId: '123', tierId: second, title: 'Round', startsAt: now + 86400, track: 'Spa', createdBy: 'staff', createdAt: now });
  assert.equal(getRace({ raceId, guildId: '123' }).tier_id, second);
  assert.throws(() => deleteTier({ tierId: second, guildId: '123' }), /Move or delete/);
  assert.equal(deleteTier({ tierId: first, guildId: '123' }), true);
  const foreignLeague = makeLeague({ guildId: '456' });
  const foreignTier = getLeagueTiers({ leagueId: foreignLeague, guildId: '456' })[0].id;
  assert.throws(() => db.prepare('UPDATE league_races SET tier_id = ? WHERE id = ?').run(foreignTier, raceId), /FOREIGN KEY/);
  assert.equal(deleteEvent({ eventId: leagueId, guildId: '123' }), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM league_tiers WHERE league_id = ?').get(leagueId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM league_settings WHERE league_id = ?').get(leagueId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM league_races WHERE league_id = ?').get(leagueId).count, 0);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('league overview query has no five-league limit, filters by game, and can retrieve an archived league explicitly', () => {
  const ids = Array.from({ length: 8 }, (_, index) => makeLeague({ title: `Active ${index}`, game: 'lmu' }));
  const ended = makeLeague({ startsAt: now - 2 * 86400, dateOnlyUntil: now - 86400, game: 'lmu' });
  assert.ok(ids.every((id) => getLeagues({ guildId: '123', game: 'lmu' }).some((league) => league.id === id)));
  assert.equal(getLeagues({ guildId: '123', game: 'lmu' }).some(({ id }) => id === ended), false);
  assert.equal(getLeagues({ guildId: '123', leagueId: ended })[0].id, ended);
  assert.deepEqual(getLeagues({ guildId: '456', leagueId: ended }), []);
});
