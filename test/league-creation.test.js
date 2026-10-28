const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-league-creation-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');

const db = require('../src/db/database');
const { getEvent } = require('../src/db/eventRepository');
const { getLeagueTiers } = require('../src/db/leagueRepository');
const { parseTierNames, tierNameKey } = require('../src/domain/leagueInput');
const { createDraftStore, leagueCreationDrafts } = require('../src/interactions/leagueCreationDrafts');
const { handleLeagueTierNamesModal, handleLeagueCreationButton } = require('../src/interactions/leagueCreation');
const { handleEventModal } = require('../src/interactions/eventModal');
const addEventCommand = require('../src/commands/add-event');

after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

function interaction(customId, values = {}, { userId = 'staff', guildId = '123' } = {}) {
  const replies = [];
  const forms = [];
  return {
    customId, guildId, user: { id: userId }, replies, forms, client: {},
    fields: { getTextInputValue: (key) => {
      assert.ok(Object.hasOwn(values, key), `Unexpected form input: ${key}`);
      return values[key];
    } },
    reply: async (value) => replies.push(value),
    showModal: async (form) => forms.push(form.toJSON()),
  };
}

async function begin({ count = 2, kind = null, userId = 'staff', guildId = '123', game = 'lmu' } = {}) {
  const request = interaction('', {}, { userId, guildId });
  request.options = {
    getInteger: () => count,
    getString: (key) => ({ game, type: 'league', 'pre-qualification': kind })[key],
  };
  await addEventCommand.execute(request);
  return { id: request.forms[0].custom_id.split(':')[1], request };
}

function context(id, userId = 'staff', guildId = '123') {
  return { id, userId, guildId };
}

test('tier names require the chosen count, nonempty values, reasonable lengths, and Unicode-aware uniqueness', () => {
  assert.deepEqual(parseTierNames('  Gold  \r\nSilver\nBronze\n', 3), { ok: true, tierNames: ['Gold', 'Silver', 'Bronze'] });
  for (const input of ['Gold', 'Gold\nSilver\nBronze', 'Gold\n\nSilver', 'Gold\ngOLD', 'Élite\nE\u0301LITE', `${'x'.repeat(101)}\nSilver`]) {
    assert.equal(parseTierNames(input, 2).ok, false, input);
  }
  assert.equal(tierNameKey(' ÉLITE '), tierNameKey('E\u0301lite'));
});

test('draft storage isolates owners and servers, expires entries, and keeps bounded capacity', () => {
  let now = 0;
  const store = createDraftStore({ ttlMs: 100, maxDrafts: 2, now: () => now });
  const first = store.create({ userId: 'one', guildId: '123', data: {} });
  assert.match(first.id, /^[a-f0-9]{24}$/);
  assert.equal(store.get(context(first.id, 'two')), null);
  assert.equal(store.get(context(first.id, 'one', '456')), null);
  assert.equal(store.remove(context(first.id, 'two')), false);
  const second = store.create({ userId: 'one', guildId: '123', data: {} });
  const third = store.create({ userId: 'one', guildId: '123', data: {} });
  assert.notEqual(second.id, third.id);
  assert.equal(store.get(context(first.id, 'one')), null);
  assert.ok(store.get(context(second.id, 'one')));
  now = 101;
  assert.equal(store.get(context(second.id, 'one')), null);
  assert.equal(store.get(context(third.id, 'one')), null);
});

test('naming creates no league and can be corrected before opening full details', async () => {
  const before = db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
  const { id, request } = await begin({ count: 3, kind: 'race' });
  assert.equal(request.forms[0].components[0].components[0].value, 'Tier 1\nTier 2\nTier 3');
  const tooFew = interaction(`league-tier-names:${id}`, { tierNames: 'Gold\nSilver' });
  await handleLeagueTierNamesModal(tooFew);
  assert.match(tooFew.replies[0].content, /exactly 3/);
  assert.equal(leagueCreationDrafts.get(context(id)).data.tierNames, null);
  const tooEarly = interaction(`league-create:details:${id}`);
  await handleLeagueCreationButton(tooEarly);
  assert.match(tooEarly.replies[0].content, /Name the league tiers/);
  const names = interaction(`league-tier-names:${id}`, { tierNames: 'Gold\nSilver\nBronze' });
  await handleLeagueTierNamesModal(names);
  assert.equal(names.replies[0].components[0].components[0].data.label, 'Continue league details');
  const editNames = interaction(`league-create:names:${id}`);
  await handleLeagueCreationButton(editNames);
  assert.equal(editNames.forms[0].components[0].components[0].value, 'Gold\nSilver\nBronze');
  const details = interaction(`league-create:details:${id}`);
  await handleLeagueCreationButton(details);
  assert.equal(details.forms[0].custom_id, `add-event:draft:${id}`);
  assert.deepEqual(details.forms[0].components.map(({ components }) => components[0].custom_id),
    ['title', 'start', 'prequalPeriod', 'prequalDetails', 'details']);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM events').get().count, before);
});

test('concurrent league drafts keep their options and reject other users or servers at every stage', async () => {
  const first = await begin({ count: 2, kind: 'signup' });
  const second = await begin({ count: 1, game: 'iracing', userId: 'other' });
  assert.notEqual(first.id, second.id);
  for (const unauthorized of [{ userId: 'other' }, { guildId: '456' }]) {
    const names = interaction(`league-tier-names:${first.id}`, { tierNames: 'Hacked\nOther' }, unauthorized);
    await handleLeagueTierNamesModal(names);
    assert.match(names.replies[0].content, /unavailable or expired/);
    const button = interaction(`league-create:details:${first.id}`, {}, unauthorized);
    await handleLeagueCreationButton(button);
    assert.match(button.replies[0].content, /unavailable or expired/);
    const final = interaction(`add-event:draft:${first.id}`, {}, unauthorized);
    await handleEventModal(final);
    assert.match(final.replies[0].content, /unavailable or expired/);
  }
  assert.equal(leagueCreationDrafts.get(context(first.id)).data.tierNames, null);
  await handleLeagueTierNamesModal(interaction(`league-tier-names:${first.id}`, { tierNames: 'Gold\nSilver' }));
  await handleLeagueTierNamesModal(interaction(`league-tier-names:${second.id}`, { tierNames: 'Pro' }, { userId: 'other' }));
  assert.deepEqual(leagueCreationDrafts.get(context(first.id)).data.tierNames, ['Gold', 'Silver']);
  assert.deepEqual(leagueCreationDrafts.get(context(second.id, 'other')).data.tierNames, ['Pro']);
  assert.equal(leagueCreationDrafts.get(context(first.id)).data.prequalificationKind, 'signup');
  assert.equal(leagueCreationDrafts.get(context(second.id, 'other')).data.game, 'iracing');
});

test('final validation retains the draft, then successful submission consumes it once and preserves names and pre-qualification', async () => {
  const before = db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
  const { id } = await begin({ count: 2, kind: 'signup' });
  await handleLeagueTierNamesModal(interaction(`league-tier-names:${id}`, { tierNames: 'Gold\nSilver' }));
  const values = { title: 'Custom tier league', start: 'invalid', details: 'Season notes', prequalPeriod: '01.01.2000 to 05.01.2000', prequalDetails: 'Signup link' };
  const invalid = interaction(`add-event:draft:${id}`, values);
  await handleEventModal(invalid);
  assert.match(invalid.replies[0].content, /Could not add/);
  assert.equal(invalid.replies[0].components[0].components[0].data.label, 'Continue league details');
  assert.ok(leagueCreationDrafts.get(context(id)));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM events').get().count, before);
  const valid = interaction(`add-event:draft:${id}`, { ...values, start: '' });
  const replay = interaction(`add-event:draft:${id}`, { ...values, start: '' });
  await Promise.all([handleEventModal(valid), handleEventModal(replay)]);
  assert.match(replay.replies[0].content, /unavailable or expired/);
  assert.equal(leagueCreationDrafts.get(context(id)), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM events').get().count, before + 1);
  const stored = db.prepare("SELECT id FROM events WHERE title = 'Custom tier league'").get();
  assert.deepEqual(getLeagueTiers({ leagueId: stored.id, guildId: '123' }).map(({ name }) => name), ['Gold', 'Silver']);
  assert.equal(getEvent({ eventId: stored.id, guildId: '123' }).prequal_kind, 'signup');
  const stale = interaction(`league-create:details:${id}`);
  await handleLeagueCreationButton(stale);
  assert.match(stale.replies[0].content, /unavailable or expired/);
});

test('twenty long custom tier names fit the creation flow and bounded confirmation', async () => {
  const { id } = await begin({ count: 20 });
  const names = Array.from({ length: 20 }, (_, index) => `${String(index + 1).padStart(2, '0')}${'x'.repeat(98)}`);
  await handleLeagueTierNamesModal(interaction(`league-tier-names:${id}`, { tierNames: names.join('\n') }));
  const final = interaction(`add-event:draft:${id}`, { title: 'Maximum tier names', start: '', track: '', carClass: '', details: '' });
  await handleEventModal(final);
  const stored = db.prepare("SELECT id FROM events WHERE title = 'Maximum tier names'").get();
  assert.deepEqual(getLeagueTiers({ leagueId: stored.id, guildId: '123' }).map(({ name }) => name), names);
  assert.equal(final.replies.length, 1);
  for (const field of final.replies[0].embeds[0].toJSON().fields) assert.ok(field.value.length <= 1024);
});
