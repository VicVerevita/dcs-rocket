const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN ||= 'test';
process.env.CLIENT_ID ||= 'test';
process.env.GUILD_IDS ||= '123';

const { buildReminderMessage } = require('../src/reminders/messages');

function event(game = 'iracing') {
  return {
    id: 1, guild_id: '123', game, event_type: 'special_event', title: 'Shared team race',
    starts_at: 2000000000, date_only_until: null, created_at: 1900000000,
    track: 'Spa', car_class: 'GT3, GTP', details: null,
  };
}

function response(userId, attending, team = 'main', overrides = {}) {
  return {
    user_id: userId, attending, team, days: 'Saturday', car_class: 'GT3',
    availability_hours: '14:00', ...overrides,
  };
}

function embed(message) {
  return message.embeds[0].toJSON();
}

function notDriving(message) {
  return embed(message).fields.find(({ name }) => name === 'Not driving');
}

test('Not driving combines every team into one spoiler list and excludes attending drivers', () => {
  for (const game of ['iracing', 'lmu']) {
    const message = buildReminderMessage(event(game), 3, [
      response('main-no', 0, 'main'),
      response('main-yes', 1, 'main'),
      response('academy-no', 0, 'academy'),
      response('community-no', 0, 'community'),
      response('unassigned-no', 0, ''),
    ], 'main');
    assert.deepEqual(notDriving(message), {
      name: 'Not driving',
      value: '4\n||<@main-no>, <@academy-no>, <@community-no>, <@unassigned-no>||',
      inline: false,
    });
    assert.doesNotMatch(notDriving(message).value, /team|<@main-yes>/);
    const driving = embed(message).fields.filter(({ name }) => name !== 'Not driving')
      .map(({ value }) => value).join('\n');
    assert.match(driving, /<@main-yes>/);
    assert.doesNotMatch(driving, /<@main-no>|<@academy-no>|<@community-no>|<@unassigned-no>/);
  }
});

test('the hidden decline list is identical across channel teams and never enables mention notifications', () => {
  const responses = [response('driver-a', 0, 'main'), response('driver-b', 0, 'community')];
  const expected = notDriving(buildReminderMessage(event(), 3, responses));
  for (const team of ['', 'main', 'academy', 'community']) {
    const message = buildReminderMessage(event(), 3, responses, team);
    assert.deepEqual(notDriving(message), expected);
    assert.deepEqual(message.allowedMentions, { parse: [] });
  }
});

test('an empty decline list keeps a compact visible zero without empty spoiler markup', () => {
  for (const responses of [[], [response('driving', 1)]]) {
    const field = notDriving(buildReminderMessage(event(), 3, responses));
    assert.equal(field.value, '0');
    assert.equal(field.inline, false);
    assert.doesNotMatch(field.value, /\|\|/);
  }
});

test('changing an answer back to driving removes the driver from the hidden decline list', () => {
  const responses = [response('changed', 0, 'academy'), response('still-no', 0, 'main')];
  const before = notDriving(buildReminderMessage(event(), 3, responses));
  assert.equal(before.value, '2\n||<@changed>, <@still-no>||');
  const after = buildReminderMessage(event(), 3, responses.map((entry) => entry.user_id === 'changed'
    ? { ...entry, attending: 1 } : entry));
  assert.equal(notDriving(after).value, '1\n||<@still-no>||');
  assert.match(embed(after).fields[0].value, /\*\*Academy team\*\*[\s\S]*<@changed>/);
});

test('large driving and decline lists retain whole mentions and balanced spoilers within message limits', () => {
  for (const game of ['iracing', 'lmu']) {
    const race = {
      ...event(game), title: 'T'.repeat(100), track: 'S'.repeat(100),
      car_class: 'C'.repeat(100), details: 'D'.repeat(1000),
    };
    const declined = Array.from({ length: 240 }, (_, index) => response(
      String(100000000000000000n + BigInt(index)), 0,
      ['main', 'academy', 'community', ''][index % 4],
    ));
    const driving = Array.from({ length: 240 }, (_, index) => response(
      String(200000000000000000n + BigInt(index)), 1,
      ['main', 'academy', 'community', ''][index % 4],
      { days: 'Friday, Saturday, Sunday', car_class: race.car_class, availability_hours: 'A'.repeat(60) },
    ));
    const message = buildReminderMessage(race, 3, [...driving, ...declined], 'main');
    const field = notDriving(message);
    assert.ok(field.value.length <= 1024);
    assert.ok(field.value.startsWith('240\n||'));
    assert.ok(field.value.endsWith('||'));
    assert.equal((field.value.match(/\|\|/g) || []).length, 2);
    const hidden = field.value.slice('240\n||'.length, -2);
    const mentions = [...hidden.matchAll(/<@(\d+)>/g)].map((match) => match[1]);
    assert.ok(mentions.length > 0 && mentions.length < declined.length);
    assert.equal(new Set(mentions).size, mentions.length);
    const declinedIds = new Set(declined.map(({ user_id }) => user_id));
    assert.ok(mentions.every((id) => declinedIds.has(id)));
    assert.doesNotMatch(hidden.replace(/<@\d+>/g, ''), /[<>]/);
    const omitted = hidden.match(/, …and (\d+) more$/);
    assert.ok(omitted, 'Expected an overflow count hidden inside the spoiler');
    assert.equal(Number(omitted[1]), declined.length - mentions.length);

    let totalLength = 0;
    for (const item of message.embeds.map((builder) => builder.toJSON())) {
      assert.ok(item.fields.length <= 25);
      totalLength += (item.title || '').length + (item.description || '').length
        + (item.footer?.text || '').length + (item.author?.name || '').length;
      for (const part of item.fields) {
        assert.ok(part.value.length <= 1024);
        assert.ok(part.name.length <= 256);
        totalLength += part.name.length + part.value.length;
      }
    }
    assert.ok(totalLength <= 6000, `${game} embed text is ${totalLength} characters`);
  }
});
