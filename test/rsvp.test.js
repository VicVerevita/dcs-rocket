const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN ||= 'test';
process.env.CLIENT_ID ||= 'test';
process.env.GUILD_IDS ||= '123';

const { parseDriverResponse } = require('../src/domain/rsvp');
const { buildRsvpForm } = require('../src/ui/rsvpForm');
const { buildReminderMessage } = require('../src/reminders/messages');

function fields(values) {
  return {
    getCheckboxGroup: (key) => values[key],
    getTextInputValue: (key) => values[key],
  };
}

test('LMU form and submission retain multiple days and classes', () => {
  const event = { id: 1, game: 'lmu', car_class: 'GT3, Hypercar' };
  const form = buildRsvpForm(event, null).toJSON();
  assert.equal(form.components[0].component.max_values, 3);
  assert.equal(form.components[1].component.max_values, 2);
  const result = parseDriverResponse(event, fields({
    days: ['Sunday', 'Friday'], carClass: ['Hypercar', 'GT3'],
  }));
  assert.deepEqual(result.response, {
    attending: 1, days: 'Friday, Sunday', carClass: 'Hypercar, GT3', availabilityHours: null,
  });
});

test('iRacing form asks for Saturday hours and shows them in the overview', () => {
  const event = {
    id: 2, game: 'iracing', event_type: 'special_event', title: 'Race',
    starts_at: 2000000000, date_only_until: null, created_at: 1900000000,
    track: 'Spa', car_class: 'GT3, GTP', details: null,
  };
  const form = buildRsvpForm(event, null).toJSON();
  assert.equal(form.components[0].component.custom_id, 'availabilityHours');
  assert.equal(form.components[1].component.max_values, 2);
  const result = parseDriverResponse(event, fields({
    availabilityHours: '10:00 or 14:00', carClass: ['GT3', 'GTP'],
  }));
  assert.equal(result.response.days, 'Saturday');
  const message = buildReminderMessage(event, 3, [{
    user_id: '123', attending: 1, days: result.response.days,
    car_class: result.response.carClass, availability_hours: result.response.availabilityHours,
  }]);
  const overview = message.embeds[0].toJSON().fields;
  assert.equal(overview[0].name, '────── SATURDAY ──────');
  assert.match(overview[0].value, /\*\*GT3\*\*[\s\S]*<@123> \(10:00 or 14:00\)/);
  assert.match(overview[0].value, /\*\*GTP\*\*/);
});

test('invalid classes cannot be submitted', () => {
  const result = parseDriverResponse({ game: 'lmu', car_class: 'GT3' }, fields({
    days: ['Saturday'], carClass: ['Not in event'],
  }));
  assert.equal(result.ok, false);
});
