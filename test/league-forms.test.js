const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN ||= 'test';
process.env.CLIENT_ID ||= 'test';
process.env.GUILD_IDS ||= '123';

const { DateTime } = require('luxon');
const { defaultTimeZone } = require('../src/config');
const { parseEventFields } = require('../src/domain/eventInput');
const { buildEventForm, eventDateValue } = require('../src/ui/eventForm');
const { buildEventConfirmation, buildEventsOverview } = require('../src/ui/eventMessages');
const { discordTimestamp } = require('../src/utils/time');

function fields(values) {
  return { getTextInputValue: (key) => values[key] ?? '' };
}

test('an undated league needs only a title and remains editable without dates', () => {
  const parsed = parseEventFields(fields({ title: 'Winter league' }), 'league');
  assert.deepEqual(parsed, {
    ok: true,
    event: { title: 'Winter league', startsAt: null, dateOnlyUntil: null, track: '', carClass: null, details: null },
  });
  assert.equal(parseEventFields(fields({}), 'league').ok, false);
  const event = { id: 4, event_type: 'league', title: 'Winter league', starts_at: null, date_only_until: null };
  const form = buildEventForm({ event }).toJSON();
  assert.equal(form.title, 'Edit League #4');
  assert.equal(form.components[1].components[0].required, false);
  assert.equal(form.components[2].components[0].required, false);
  assert.equal(eventDateValue(event), '');
  assert.equal(form.components.length, 5);
});

test('league dates accept ongoing seasons, reject times, invalid dates, and reversed ranges', () => {
  const now = DateTime.now().setZone(defaultTimeZone);
  const start = now.minus({ days: 7 }).startOf('day');
  const end = now.plus({ months: 2 }).endOf('day');
  const date = `${start.toFormat('dd.MM.yyyy')} to ${end.toFormat('dd.MM.yyyy')}`;
  const parsed = parseEventFields(fields({ title: 'Season', start: date }), 'league');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.event.startsAt, Math.floor(start.toSeconds()));
  assert.equal(parsed.event.dateOnlyUntil, Math.floor(end.toSeconds()));
  assert.equal(eventDateValue({ starts_at: parsed.event.startsAt, date_only_until: parsed.event.dateOnlyUntil }), date);
  for (const invalid of ['03.10.2030 10:00', '31.02.2030 to 05.03.2030', '05.10.2030 to 03.10.2030', '01.01.2000 to 02.01.2000']) {
    assert.equal(parseEventFields(fields({ title: 'Season', start: invalid }), 'league').ok, false, invalid);
  }
});

test('editing unchanged past dates preserves the season while new past dates are rejected', () => {
  const input = { title: 'Archived season', start: '01.01.2000 to 31.12.2000' };
  const existing = {
    starts_at: Math.floor(DateTime.fromFormat('01.01.2000', 'dd.MM.yyyy', { zone: defaultTimeZone }).toSeconds()),
    date_only_until: Math.floor(DateTime.fromFormat('31.12.2000', 'dd.MM.yyyy', { zone: defaultTimeZone }).endOf('day').toSeconds()),
  };
  assert.equal(parseEventFields(fields(input), 'league', existing).ok, true);
  assert.equal(parseEventFields(fields({ ...input, start: '01.01.2001 to 31.12.2001' }), 'league', existing).ok, false);
});

test('a legacy league can retain its original exact start time when edited', () => {
  const existing = {
    starts_at: Math.floor(DateTime.fromFormat('01.01.2000 14:30', 'dd.MM.yyyy HH:mm', { zone: defaultTimeZone }).toSeconds()),
    date_only_until: null,
  };
  const parsed = parseEventFields(fields({ title: 'Legacy league', start: '01.01.2000 14:30' }), 'league', existing);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.event.startsAt, existing.starts_at);
  assert.equal(parseEventFields(fields({ title: 'Legacy league', start: '01.01.2030 15:30' }), 'league', existing).ok, false);
});

test('league confirmation and overview show undated seasons without empty required fields', () => {
  const event = { id: 4, title: 'League', game: 'lmu', eventType: 'league', startsAt: null, dateOnlyUntil: null, track: '' };
  const confirmation = buildEventConfirmation(event, 'added').toJSON();
  assert.equal(confirmation.title, '✅ League added');
  assert.equal(confirmation.fields.find(({ name }) => name === 'Season dates').value, 'Dates to be announced');
  assert.equal(confirmation.fields.some(({ name }) => name === 'Track'), false);
  assert.match(confirmation.footer.text, /add-race league-id:4/);
  const overview = buildEventsOverview([{ ...event, event_type: 'league', starts_at: null, date_only_until: null }]).toJSON();
  assert.match(overview.description, /Dates to be announced/);
  assert.match(overview.description, /races league-id:4/);
  assert.doesNotMatch(overview.description, /<t:null/);
  assert.equal(discordTimestamp(null), 'Dates to be announced');
});

test('special-event validation stays strict and event descriptions stay within Discord limits', () => {
  const input = { title: 'Special', start: '03.10.2030', track: 'Spa', carClass: 'GT3' };
  assert.equal(parseEventFields(fields(input), 'special_event').ok, true);
  assert.equal(parseEventFields(fields({ ...input, start: '' }), 'special_event').ok, false);
  assert.equal(parseEventFields(fields({ ...input, track: '' }), 'special_event').ok, false);
  assert.equal(parseEventFields(fields({ ...input, carClass: '' }), 'special_event').ok, false);
  const overview = buildEventsOverview(Array.from({ length: 10 }, (_, id) => ({
    id, title: 'x'.repeat(100), game: 'iracing', event_type: 'league', starts_at: null,
    track: 'x'.repeat(100), car_class: 'x'.repeat(100), details: 'x'.repeat(1000),
  }))).toJSON();
  assert.ok(overview.description.length <= 4096);
  assert.match(overview.footer.text, /of 10 events/);
});
