const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN ||= 'test';
process.env.CLIENT_ID ||= 'test';
process.env.GUILD_IDS ||= '123';

const { DateTime } = require('luxon');
const { defaultTimeZone } = require('../src/config');
const { buildEventForm } = require('../src/ui/eventForm');
const { parseEventFields } = require('../src/domain/eventInput');

function fields(values) {
  return { getTextInputValue: (key) => values[key] || '' };
}

test('date range remains editable as a date range', () => {
  const start = DateTime.fromISO('2030-10-03', { zone: defaultTimeZone });
  const end = DateTime.fromISO('2030-10-05', { zone: defaultTimeZone }).endOf('day');
  const form = buildEventForm({ event: {
    id: 7, title: 'Endurance', starts_at: Math.floor(start.toSeconds()),
    date_only_until: Math.floor(end.toSeconds()), track: 'Spa', car_class: 'GT3', details: '',
  } }).toJSON();
  assert.equal(form.components[1].components[0].value, '03.10.2030 to 05.10.2030');
});

test('special events require a selectable class and reject too many', () => {
  const base = { title: 'Race', start: '03.10.2030', track: 'Spa', details: '' };
  assert.equal(parseEventFields(fields({ ...base, carClass: '' }), 'special_event').ok, false);
  assert.equal(parseEventFields(fields({
    ...base, carClass: 'A,B,C,D,E,F,G,H,I,J,K',
  }), 'special_event').ok, false);
  assert.equal(parseEventFields(fields({ ...base, carClass: 'GT3, GTP' }), 'special_event').ok, true);
});
