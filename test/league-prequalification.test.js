const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-league-prequalification-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');

const db = require('../src/db/database');
const { createEvent, getEvent } = require('../src/db/eventRepository');
const { getLeagueTiers, setLeaguePrequalification } = require('../src/db/leagueRepository');
const { parsePrequalificationFields, tierNamesForCount } = require('../src/domain/leagueInput');
const { parseEventFields } = require('../src/domain/eventInput');
const { buildEventForm } = require('../src/ui/eventForm');
const { buildLeaguePrequalificationForm } = require('../src/ui/leaguePrequalificationForm');
const { handleEventModal } = require('../src/interactions/eventModal');
const { handleLeaguePrequalificationModal } = require('../src/interactions/leaguePrequalificationModal');
const { handleLeagueTierNamesModal, handleLeagueCreationButton } = require('../src/interactions/leagueCreation');
const addEventCommand = require('../src/commands/add-event');
const prequalCommand = require('../src/commands/league-prequal');

after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

function fields(values) {
  return { getTextInputValue: (key) => {
    assert.ok(Object.hasOwn(values, key), `Unexpected form input: ${key}`);
    return values[key];
  } };
}

function interaction(customId, values, guildId = '123') {
  const replies = [];
  return {
    customId, guildId, fields: fields(values), user: { id: 'staff' }, replies,
    reply: async (value) => replies.push(value), client: {},
  };
}

function league(overrides = {}) {
  return createEvent({
    guildId: '123', game: 'lmu', eventType: 'league', title: 'League',
    startsAt: null, dateOnlyUntil: null, track: 'Spa', carClass: 'GT3', details: null,
    createdBy: 'staff', createdAt: Math.floor(Date.now() / 1000), ...overrides,
  });
}

test('creation options select a five-input pre-qualification form and retain default tiers', async () => {
  const forms = [];
  await addEventCommand.execute({
    guildId: '123', user: { id: 'staff' },
    options: {
      getString: (key) => ({ game: 'iracing', type: 'league', 'pre-qualification': 'signup' })[key],
      getInteger: () => 3,
    },
    showModal: async (form) => forms.push(form.toJSON()),
  });
  assert.match(forms[0].custom_id, /^league-tier-names:[a-f0-9]{24}$/);
  assert.equal(forms[0].components[0].components[0].value, 'Tier 1\nTier 2\nTier 3');
  const naming = interaction(forms[0].custom_id, { tierNames: 'Gold\nSilver\nBronze' });
  await handleLeagueTierNamesModal(naming);
  await handleLeagueCreationButton({
    guildId: '123', user: { id: 'staff' },
    customId: naming.replies[0].components[0].components[0].data.custom_id,
    showModal: async (form) => forms.push(form.toJSON()),
  });
  assert.match(forms[1].custom_id, /^add-event:draft:[a-f0-9]{24}$/);
  assert.deepEqual(forms[1].components.map(({ components }) => components[0].custom_id),
    ['title', 'start', 'prequalPeriod', 'prequalDetails', 'details']);
  assert.equal(forms[1].components.length, 5);
  assert.equal(buildEventForm({ game: 'lmu', eventType: 'league' }).toJSON().custom_id, 'add-event:lmu:league:1:none');
  assert.deepEqual(tierNamesForCount(3), ['Tier 1', 'Tier 2', 'Tier 3']);
  assert.equal(tierNamesForCount(0), null);
  assert.equal(tierNamesForCount(21), null);
  assert.equal(tierNamesForCount(1.5), null);
  // The optional integer getter was absent from older command test fixtures.
  await addEventCommand.execute({
    guildId: '123', user: { id: 'staff' },
    options: { getString: (key) => ({ game: 'lmu', type: 'league' })[key] },
    showModal: async (form) => forms.push(form.toJSON()),
  });
  assert.equal(forms[2].components[0].components[0].value, 'Tier 1');
});

test('league-only creation options do not apply to special events', async () => {
  const replies = [];
  await addEventCommand.execute({
    options: { getString: (key) => ({ type: 'special_event' })[key], getInteger: () => 2 },
    reply: async (reply) => replies.push(reply),
    showModal: async () => assert.fail('Should reject league options'),
  });
  assert.match(replies[0].content, /available for leagues/);
});

test('pre-qualification supports historical ranges, exact times, and pending dates', () => {
  const historical = parsePrequalificationFields(fields({ prequalPeriod: '01.01.2000 to 05.01.2000', prequalDetails: 'https://example.org/signup' }), 'signup');
  assert.equal(historical.ok, true);
  assert.equal(historical.prequalification.kind, 'signup');
  assert.ok(historical.prequalification.dateOnlyUntil > historical.prequalification.startsAt);
  const timed = parsePrequalificationFields(fields({ prequalPeriod: '03.10.2030 14:30', prequalDetails: 'Spa, 20 minutes' }), 'race');
  assert.equal(timed.ok, true);
  assert.equal(timed.prequalification.dateOnlyUntil, null);
  assert.deepEqual(parsePrequalificationFields(fields({ prequalPeriod: '', prequalDetails: '' }), 'race').prequalification,
    { kind: 'race', startsAt: null, dateOnlyUntil: null, details: null });
  for (const period of ['05.01.2030 to 01.01.2030', '31.02.2030', 'next Friday']) {
    assert.equal(parsePrequalificationFields(fields({ prequalPeriod: period, prequalDetails: '' }), 'signup').ok, false);
  }
});

test('creation stores all selected tiers and league-level pre-qualification in one submission', async () => {
  const request = interaction('add-event:lmu:league:3:signup', {
    title: 'Three-tier league', start: '', details: 'Season notes',
    prequalPeriod: '01.01.2000 to 05.01.2000', prequalDetails: 'Signup link',
  });
  await handleEventModal(request);
  const stored = db.prepare("SELECT id FROM events WHERE title = 'Three-tier league'").get();
  const event = getEvent({ eventId: stored.id, guildId: '123' });
  assert.equal(event.prequal_kind, 'signup');
  assert.equal(event.prequal_details, 'Signup link');
  assert.equal(event.track, '');
  assert.deepEqual(getLeagueTiers({ leagueId: stored.id, guildId: '123' }).map(({ name }) => name), ['Tier 1', 'Tier 2', 'Tier 3']);
  assert.equal(request.replies.length, 1);
});

test('legacy creation forms still create a league with one default tier', async () => {
  const request = interaction('add-event:iracing:league', {
    title: 'Legacy form league', start: '', track: '', carClass: '', details: '',
  });
  await handleEventModal(request);
  const stored = db.prepare("SELECT id FROM events WHERE title = 'Legacy form league'").get();
  assert.equal(getLeagueTiers({ leagueId: stored.id, guildId: '123' }).length, 1);
  for (const customId of ['add-event:lmu:league:0:none', 'add-event:lmu:league:21:race', 'add-event:lmu:league:2:unknown']) {
    const invalid = interaction(customId, {});
    await handleEventModal(invalid);
    assert.match(invalid.replies[0].content, /invalid or expired/);
  }
});

test('editing pre-qualification preserves hidden track, classes, and tier names', async () => {
  const leagueId = league({ tierNames: ['Pro', 'Am'], prequalification: { kind: 'race', startsAt: null, dateOnlyUntil: null, details: 'Old details' } });
  const existing = getEvent({ eventId: leagueId, guildId: '123' });
  const form = buildEventForm({ event: existing }).toJSON();
  assert.equal(form.custom_id, `edit-event:${leagueId}:race`);
  const values = { title: 'Edited league', start: '', details: 'Updated notes', prequalPeriod: '01.01.2000 10:00', prequalDetails: 'Updated race format' };
  const parsed = parseEventFields(fields(values), 'league', existing);
  assert.equal(parsed.event.track, 'Spa');
  assert.equal(parsed.event.carClass, 'GT3');
  const request = interaction(form.custom_id, values);
  await handleEventModal(request);
  const updated = getEvent({ eventId: leagueId, guildId: '123' });
  assert.equal(updated.track, 'Spa');
  assert.equal(updated.car_class, 'GT3');
  assert.equal(updated.prequal_details, 'Updated race format');
  assert.deepEqual(getLeagueTiers({ leagueId, guildId: '123' }).map(({ name }) => name), ['Pro', 'Am']);
  setLeaguePrequalification({ leagueId, guildId: '123', kind: null });
  const stale = interaction(form.custom_id, values);
  await handleEventModal(stale);
  assert.match(stale.replies[0].content, /setting changed/);
});

test('a standard edit form preserves pre-qualification configured after the form opened', async () => {
  const leagueId = league();
  setLeaguePrequalification({ leagueId, guildId: '123', kind: 'signup', details: 'Keep this signup link' });
  const request = interaction(`edit-event:${leagueId}`, {
    title: 'Updated metadata', start: '', track: 'Monza', carClass: 'Hypercar', details: 'Season notes',
  });
  await handleEventModal(request);
  const updated = getEvent({ eventId: leagueId, guildId: '123' });
  assert.equal(updated.track, 'Monza');
  assert.equal(updated.prequal_kind, 'signup');
  assert.equal(updated.prequal_details, 'Keep this signup link');
});

test('dedicated pre-qualification management validates server, parent, and submitted period', async () => {
  const leagueId = league();
  const opened = [];
  await prequalCommand.execute({
    guildId: '123', options: { getInteger: () => leagueId, getSubcommand: () => 'set', getString: () => 'signup' },
    showModal: async (form) => opened.push(form.toJSON()),
  });
  assert.equal(opened[0].custom_id, `league-prequal:${leagueId}:signup`);
  assert.equal(opened[0].components.length, 2);
  const openingReplies = [];
  await prequalCommand.execute({
    guildId: '456', options: { getInteger: () => leagueId, getSubcommand: () => 'set', getString: () => 'signup' },
    reply: async (reply) => openingReplies.push(reply), showModal: async () => assert.fail('Must not open another server’s league'),
  });
  assert.match(openingReplies[0].content, /No league found/);
  const request = interaction(opened[0].custom_id, { prequalPeriod: '01.01.2000 to 05.01.2000', prequalDetails: 'https://example.org' });
  await handleLeaguePrequalificationModal(request);
  const updated = getEvent({ eventId: leagueId, guildId: '123' });
  assert.equal(updated.prequal_kind, 'signup');
  const editForm = buildLeaguePrequalificationForm({ league: updated, kind: 'signup' }).toJSON();
  assert.equal(editForm.components[0].components[0].value, '01.01.2000 to 05.01.2000');
  const invalid = interaction(opened[0].custom_id, { prequalPeriod: '05.01.2030 to 01.01.2030', prequalDetails: '' });
  await handleLeaguePrequalificationModal(invalid);
  assert.match(invalid.replies[0].content, /Could not update/);
  const foreign = interaction(opened[0].custom_id, {}, '456');
  await handleLeaguePrequalificationModal(foreign);
  assert.match(foreign.replies[0].content, /No league found/);
  const nonLeagueId = createEvent({ guildId: '123', game: 'lmu', eventType: 'other', title: 'Not a league', startsAt: 2000000000, track: 'Spa', createdBy: 'staff', createdAt: 1 });
  const nonLeague = interaction(`league-prequal:${nonLeagueId}:race`, {});
  await handleLeaguePrequalificationModal(nonLeague);
  assert.match(nonLeague.replies[0].content, /No league found/);
  const replies = [];
  await prequalCommand.execute({ guildId: '123', client: {}, options: { getInteger: () => leagueId, getSubcommand: () => 'clear' }, reply: async (reply) => replies.push(reply) });
  assert.equal(getEvent({ eventId: leagueId, guildId: '123' }).prequal_kind, null);
  assert.match(replies[0].content, /removed/);
});
