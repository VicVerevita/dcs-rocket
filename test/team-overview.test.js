const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN ||= 'test';
process.env.CLIENT_ID ||= 'test';
process.env.GUILD_IDS ||= '123';

const { buildReminderMessage } = require('../src/reminders/messages');

const namedTeams = ['Main team', 'Academy team', 'Community team'];
const allTeams = [...namedTeams, 'Unassigned team'];

function event(game = 'iracing') {
  return {
    id: 1, guild_id: '123', game, event_type: 'special_event', title: 'Shared team race',
    starts_at: 2000000000, date_only_until: null, created_at: 1900000000,
    track: 'Spa', car_class: 'GT3, GTP, Hypercar', details: null,
  };
}

function driver(userId, team, overrides = {}) {
  const response = {
    user_id: userId, attending: 1, days: 'Saturday', car_class: 'GT3',
    availability_hours: '10:00 or 14:00', ...overrides,
  };
  if (team !== undefined) response.team = team;
  return response;
}

function embed(message) {
  return message.embeds[0].toJSON();
}

function dayField(message, day) {
  return embed(message).fields.find(({ name }) => name.includes(day.toUpperCase()));
}

function teamSection(value, label) {
  const marker = `**${label}**`;
  const start = value.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${label} heading`);
  let end = value.length;
  for (const team of allTeams) {
    const next = value.indexOf(`**${team}**`, start + marker.length);
    if (next !== -1) end = Math.min(end, next);
  }
  return value.slice(start + marker.length, end);
}

test('iRacing groups all team drivers under stable headings and keeps classes and availability', () => {
  const message = buildReminderMessage(event(), 3, [
    driver('main-driver', 'main', { car_class: 'GT3, GTP', availability_hours: '10:00' }),
    driver('academy-driver', 'academy', { availability_hours: '14:00' }),
    driver('community-driver', 'community', { car_class: 'GTP', availability_hours: '10:00 or 14:00' }),
    driver('not-driving', 'main', { attending: 0 }),
  ], 'main');
  const value = dayField(message, 'Saturday').value;
  const positions = namedTeams.map((team) => value.indexOf(`**${team}**`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  for (const [team, user] of [['Main team', 'main-driver'], ['Academy team', 'academy-driver'], ['Community team', 'community-driver']]) {
    const section = teamSection(value, team);
    assert.match(section, new RegExp(`<@${user}>`));
    for (const other of ['main-driver', 'academy-driver', 'community-driver'].filter((id) => id !== user)) {
      assert.doesNotMatch(section, new RegExp(`<@${other}>`));
    }
  }
  const main = teamSection(value, 'Main team');
  assert.match(main, /\*\*GT3\*\*/);
  assert.match(main, /\*\*GTP\*\*/);
  assert.match(main, /<@main-driver> \(10:00\)/);
  assert.match(teamSection(value, 'Academy team'), /<@academy-driver> \(14:00\)/);
  assert.doesNotMatch(value, /<@not-driving>/);
  assert.deepEqual(embed(message).fields.at(-1), { name: 'Not driving', value: '1\n||<@not-driving>||', inline: false });
});

test('LMU keeps day and multi-class selections inside each team section', () => {
  const message = buildReminderMessage(event('lmu'), 1, [
    driver('main-driver', 'main', { days: 'Friday, Sunday', car_class: 'GT3, Hypercar', availability_hours: null }),
    driver('academy-driver', 'academy', { days: 'Saturday', availability_hours: null }),
    driver('community-driver', 'community', { days: 'Sunday', car_class: 'Hypercar', availability_hours: null }),
  ], 'academy');
  const friday = dayField(message, 'Friday').value;
  const saturday = dayField(message, 'Saturday').value;
  const sunday = dayField(message, 'Sunday').value;
  assert.match(teamSection(friday, 'Main team'), /<@main-driver>/);
  assert.match(teamSection(friday, 'Main team'), /\*\*GT3\*\*/);
  assert.match(teamSection(friday, 'Main team'), /\*\*Hypercar\*\*/);
  assert.doesNotMatch(saturday, /<@main-driver>|<@community-driver>/);
  assert.match(teamSection(saturday, 'Academy team'), /<@academy-driver>/);
  assert.doesNotMatch(friday, /<@academy-driver>|<@community-driver>/);
  assert.match(teamSection(sunday, 'Main team'), /<@main-driver>/);
  assert.match(teamSection(sunday, 'Community team'), /<@community-driver>/);
  assert.doesNotMatch(sunday, /<@academy-driver>/);
});

test('legacy responses with blank or missing teams remain visible under Unassigned team', () => {
  const message = buildReminderMessage(event(), 7, [
    driver('blank-team', ''),
    driver('missing-team', undefined),
    driver('main-driver', 'main'),
  ], 'community');
  const value = dayField(message, 'Saturday').value;
  const unassigned = teamSection(value, 'Unassigned team');
  assert.match(unassigned, /<@blank-team>/);
  assert.match(unassigned, /<@missing-team>/);
  assert.doesNotMatch(unassigned, /<@main-driver>/);
  assert.doesNotMatch(teamSection(value, 'Main team'), /<@blank-team>|<@missing-team>/);
  assert.ok(value.indexOf('**Community team**') < value.indexOf('**Unassigned team**'));
});

test('empty rosters retain named team headings and count declines across all teams', () => {
  for (const game of ['iracing', 'lmu']) {
    const empty = buildReminderMessage(event(game), 3, []);
    for (const field of embed(empty).fields.filter(({ name }) => name !== 'Not driving')) {
      for (const team of namedTeams) teamSection(field.value, team);
      assert.doesNotMatch(field.value, /\*\*Unassigned team\*\*|<@/);
    }
    assert.equal(embed(empty).fields.at(-1).value, '0');

    const declined = buildReminderMessage(event(game), 3, [
      driver('main-no', 'main', { attending: 0 }),
      driver('academy-no', 'academy', { attending: 0 }),
      driver('unassigned-no', '', { attending: 0 }),
    ]);
    for (const field of embed(declined).fields.filter(({ name }) => name !== 'Not driving')) {
      for (const team of allTeams) teamSection(field.value, team);
      assert.doesNotMatch(field.value, /<@/);
    }
    assert.equal(embed(declined).fields.at(-1).value, '3\n||<@main-no>, <@academy-no>, <@unassigned-no>||');
  }
});

test('all channel teams render the same roster while signup labels and buttons keep their channel team', () => {
  const race = event();
  const responses = [driver('main-driver', 'main'), driver('academy-driver', 'academy'), driver('community-driver', 'community')];
  const shared = buildReminderMessage(race, 3, responses);
  for (const [team, label] of [['main', 'Main team'], ['academy', 'Academy team'], ['community', 'Community team']]) {
    const message = buildReminderMessage(race, 3, responses, team);
    assert.deepEqual(embed(message).fields, embed(shared).fields);
    assert.ok(embed(message).description.includes(`**Signup team:** ${label}`));
    for (const button of message.components[0].components) {
      assert.ok(button.data.custom_id.includes(`:team:${team}:123:1`));
    }
  }
});

test('large multi-team rosters retain every team heading within Discord embed limits for both games', () => {
  for (const game of ['iracing', 'lmu']) {
    const race = { ...event(game), title: 'T'.repeat(100), track: 'S'.repeat(100), details: 'D'.repeat(1000) };
    const responses = Array.from({ length: 240 }, (_, index) => driver(
      String(100000000000000000n + BigInt(index)),
      ['main', 'academy', 'community', ''][index % 4],
      { days: 'Friday, Saturday, Sunday', car_class: 'GT3, GTP, Hypercar', availability_hours: 'A'.repeat(60) },
    ));
    const message = buildReminderMessage(race, 3, responses, 'main');
    let combined = 0;
    for (const item of message.embeds.map((builder) => builder.toJSON())) {
      assert.ok(item.fields.length <= 25);
      combined += (item.title || '').length + (item.description || '').length
        + (item.footer?.text || '').length + (item.author?.name || '').length;
      for (const field of item.fields) {
        assert.ok(field.value.length <= 1024, `${game} ${field.name} exceeds field limit`);
        assert.ok(field.name.length <= 256);
        combined += field.name.length + field.value.length;
        if (field.name !== 'Not driving') {
          for (const team of allTeams) teamSection(field.value, team);
        }
      }
    }
    assert.ok(combined <= 6000, `${game} embeds exceed combined text limit: ${combined}`);
  }
});
