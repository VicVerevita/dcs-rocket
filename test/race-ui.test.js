const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.DEFAULT_TIMEZONE = 'Europe/Berlin';

const { DateTime } = require('luxon');
const { parseRaceFields } = require('../src/domain/raceInput');
const { buildRaceForm } = require('../src/ui/raceForm');
const { buildRacesOverview } = require('../src/ui/raceMessages');

const fields = (values = {}) => ({ getTextInputValue: (key) => ({
  title: 'Round 1', track: 'Spa', start: '03.10.2030 14:00', qualifying: '', details: '', ...values,
})[key] });

test('race dates require a real date and explicit local start time', () => {
  for (const start of ['03.10.2030', '03.10.2030 to 04.10.2030', '31.02.2030 14:00', '03.10.2030 25:00', '31.03.2030 02:30']) {
    assert.equal(parseRaceFields(fields({ start })).ok, false, start);
  }
  const result = parseRaceFields(fields({ qualifying: '  20 minutes before race  ' }));
  assert.equal(result.ok, true);
  assert.equal(result.race.qualifying, '20 minutes before race');
  assert.equal(result.race.startsAt, Math.floor(DateTime.fromISO('2030-10-03T14:00', { zone: 'Europe/Berlin' }).toSeconds()));
});

test('race edits preserve past start times while new or changed past starts are rejected', () => {
  const oldStart = Math.floor(DateTime.fromISO('2020-10-03T14:00', { zone: 'Europe/Berlin' }).toSeconds());
  assert.equal(parseRaceFields(fields({ start: '03.10.2020 14:00' })).ok, false);
  assert.equal(parseRaceFields(fields({ start: '03.10.2020 14:00' }), { starts_at: oldStart }).ok, true);
  assert.equal(parseRaceFields(fields({ start: '03.10.2020 15:00' }), { starts_at: oldStart }).ok, false);
});

test('race edit forms round-trip start and independent qualifying details', () => {
  const start = Math.floor(DateTime.fromISO('2030-10-03T14:00', { zone: 'Europe/Berlin' }).toSeconds());
  const form = buildRaceForm({ race: {
    id: 12, title: 'Round 1', track: 'Spa', starts_at: start, qualifying: '13:30 - 20 minutes', details: '60 minutes',
  } }).toJSON();
  assert.equal(form.custom_id, 'edit-race:12');
  const values = Object.fromEntries(form.components.map(({ components: [input] }) => [input.custom_id, input.value]));
  assert.equal(values.start, '03.10.2030 14:00');
  assert.equal(values.qualifying, '13:30 - 20 minutes');
  assert.equal(parseRaceFields({ getTextInputValue: (key) => values[key] }).race.startsAt, start);
});

test('large race schedules retain every race across Discord-sized pages', () => {
  const races = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1, title: `ROUND ${i + 1} ${'a'.repeat(85)}`, starts_at: 2000000000 + i * 86400,
    track: 'Spa', qualifying: 'q'.repeat(1000), details: 'd'.repeat(1000),
  }));
  const pages = buildRacesOverview({ id: 2, title: 'My league' }, races).map((embed) => embed.toJSON());
  assert.ok(pages.length > 1);
  for (const page of pages) {
    assert.ok(page.description.length <= 4096);
    assert.ok(page.title.length + page.description.length + page.footer.text.length <= 6000);
  }
  const joined = pages.map((page) => page.description).join('\n');
  for (let id = 1; id <= 30; id++) assert.ok(joined.includes(`**Race ID:** ||${id}||`));
});

test('race schedules group independent tier calendars and show empty tiers', () => {
  const tiers = [{ id: 1, name: 'Tier 1', position: 0 }, { id: 2, name: 'Tier 2', position: 1 }, { id: 3, name: 'Rookies', position: 2 }];
  const base = { starts_at: 2000000000, track: 'Spa', qualifying: null, details: null };
  const pages = buildRacesOverview({ id: 7, title: 'League' }, [
    { ...base, id: 1, title: 'Tier 2 opening', tier_id: 2 },
    { ...base, id: 2, title: 'Tier 1 opening', tier_id: 1 },
  ], tiers).map((embed) => embed.toJSON());
  assert.equal(pages.length, 3);
  assert.match(pages[0].description, /Tier 1 opening/);
  assert.doesNotMatch(pages[0].description, /Tier 2 opening/);
  assert.match(pages[1].description, /Tier 2 opening/);
  assert.match(pages[2].description, /Rookies/);
  assert.match(pages[2].description, /No races have been added to this tier/);
});
