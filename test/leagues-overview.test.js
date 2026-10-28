const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-leagues-overview-'));
Object.assign(process.env, {
  DISCORD_TOKEN: 'test', CLIENT_ID: 'test', GUILD_IDS: '123', REMINDER_CHANNELS: '',
  DATABASE_PATH: path.join(directory, 'events.sqlite'),
});
const db = require('../src/db/database');
const { createEvent, deleteEvent } = require('../src/db/eventRepository');
const { getLeague, getLeagueTiers } = require('../src/db/leagueRepository');
const { createRace, getLeagueRaces } = require('../src/db/raceRepository');
const { buildLeagueOverview } = require('../src/ui/leaguesOverview');
const { getLeagueOverviewPages, handleLeaguesPageButton } = require('../src/interactions/leaguesPagination');
const command = require('../src/commands/leagues');

after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => db.exec('DELETE FROM events'));

function league(values = {}) {
  return createEvent({ guildId: '123', game: 'iracing', eventType: 'league', title: 'Winter League',
    createdBy: 'staff', createdAt: 1, ...values });
}

function request({ leagueId = null, game = null, guildId = '123', userId = '789', customId } = {}) {
  const messages = [];
  const replies = [];
  const deferredReplies = [];
  const deferredUpdates = [];
  return { messages, replies, deferredReplies, deferredUpdates, guildId, customId, user: { id: userId },
    options: { getInteger: () => leagueId, getString: () => game },
    deferReply: async (options) => deferredReplies.push(options),
    deferUpdate: async () => deferredUpdates.push(true),
    editReply: async (message) => messages.push(message),
    reply: async (message) => replies.push(message),
    followUp: async () => { throw new Error('League pagination must edit the same message'); },
  };
}

function buttons(message) {
  return message.components.flatMap((row) => row.toJSON().components);
}

test('/leagues keeps the league, prequalification, all tiers and their races in one card when they fit', async () => {
  const leagueId = league({ tierNames: ['Pro', 'Am', 'Rookie'],
    prequalification: { kind: 'signup', startsAt: null, dateOnlyUntil: null, details: 'https://example.com/signup' } });
  const tiers = getLeagueTiers({ leagueId, guildId: '123' });
  for (const [index, tier] of tiers.slice(0, 2).entries()) {
    createRace({ leagueId, guildId: '123', tierId: tier.id, title: `${tier.name} race`,
      startsAt: 2000000000 + index * 3600, track: 'Spa', qualifying: `${index + 10} minutes`, createdBy: 'staff', createdAt: 1 });
  }
  const interaction = request({ leagueId });
  await command.execute(interaction);
  const embeds = interaction.messages.map((message) => message.embeds[0].toJSON());
  assert.equal(embeds.length, 1);
  assert.match(embeds[0].description, /Pre-qualification signup[\s\S]*example.com\/signup/);
  assert.match(embeds[0].description, /## Pro[\s\S]*Pro race[\s\S]*10 minutes[\s\S]*## Am[\s\S]*Am race[\s\S]*## Rookie[\s\S]*No races/);
  assert.equal(interaction.deferredReplies.length, 1);
  assert.deepEqual(interaction.messages[0].components, []);
  for (const message of interaction.messages) assert.deepEqual(message.allowedMentions, { parse: [] });
});

test('six empty tiers share one compact card with their league and all tier IDs', async () => {
  const leagueId = league({ tierNames: Array.from({ length: 6 }, (_, index) => `Tier ${index + 1}`),
    prequalification: { kind: 'signup', details: 'Sign up here' } });
  const interaction = request({ leagueId });
  await command.execute(interaction);
  assert.equal(interaction.messages.length, 1);
  const embed = interaction.messages[0].embeds[0].toJSON();
  assert.match(embed.title, /Winter League/);
  assert.match(embed.description, /Sign up here/);
  for (const tier of getLeagueTiers({ leagueId, guildId: '123' })) {
    assert.ok(embed.description.includes(`## ${tier.name} - Tier ID: ||${tier.id}||`));
  }
  assert.equal((embed.description.match(/No races scheduled yet/g) ?? []).length, 6);
  assert.deepEqual(interaction.messages[0].components, []);
});

test('/leagues makes every active league accessible by editing one message and scopes archived IDs and game filters', async () => {
  const ids = Array.from({ length: 6 }, (_, index) => league({ title: `Season ${index}` }));
  const archivedId = league({ title: 'Archived', startsAt: 1000, dateOnlyUntil: 2000 });
  const foreignId = league({ guildId: '456' });
  const lmuId = league({ game: 'lmu' });
  const active = request();
  await command.execute(active);
  assert.equal(active.messages.length, 1);
  const visited = [active.messages[0]];
  let current = active.messages[0];
  while (!buttons(current).find(({ label }) => label === 'Next').disabled) {
    const next = buttons(current).find(({ label }) => label === 'Next');
    const click = request({ customId: next.custom_id });
    await handleLeaguesPageButton(click);
    assert.equal(click.deferredUpdates.length, 1);
    assert.equal(click.messages.length, 1);
    current = click.messages[0];
    visited.push(current);
  }
  const activeText = JSON.stringify(visited);
  for (const id of [...ids, lmuId]) assert.match(activeText, new RegExp(`League #${id} •`));
  assert.doesNotMatch(activeText, /Archived/);
  const archived = request({ leagueId: archivedId });
  await command.execute(archived);
  assert.match(JSON.stringify(archived.messages), /Archived/);
  const foreign = request({ leagueId: foreignId });
  await command.execute(foreign);
  assert.equal(foreign.messages[0].content, 'No leagues match that filter.');
  const filtered = request({ game: 'lmu' });
  await command.execute(filtered);
  assert.equal(filtered.messages.length, 1);
  assert.match(JSON.stringify(filtered.messages), new RegExp(`League #${lmuId} •`));
});

test('full league schedules paginate every tier and race within Discord embed limits', () => {
  const leagueId = league({ title: 'L'.repeat(100), tierNames: ['Pro', 'Am'], details: 'D'.repeat(1000),
    prequalification: { kind: 'race', startsAt: 2000000000, dateOnlyUntil: 2000086400, details: 'P'.repeat(1000) } });
  const tiers = getLeagueTiers({ leagueId, guildId: '123' });
  for (const tier of tiers) {
    for (let index = 0; index < 10; index++) createRace({ leagueId, guildId: '123', tierId: tier.id,
      title: `${tier.name} ${index} ${'R'.repeat(80)}`, startsAt: 2000000000 + index * 86400,
      track: 'T'.repeat(100), qualifying: 'Q'.repeat(1000), details: 'I'.repeat(1000), createdBy: 'staff', createdAt: 1 });
  }
  const races = getLeagueRaces({ leagueId, guildId: '123' });
  const embeds = buildLeagueOverview(getLeague({ leagueId, guildId: '123' }), tiers, races).map((embed) => embed.toJSON());
  assert.ok(embeds.length > 1);
  const text = JSON.stringify(embeds);
  for (const race of races) assert.equal(text.split(`Race ID:** ||${race.id}||`).length - 1, 1);
  for (const embed of embeds) {
    assert.ok(embed.description.length <= 4096);
    const total = embed.title.length + embed.description.length + embed.footer.text.length;
    assert.ok(total <= 6000);
  }
});

test('navigation keeps league and game filters, supports Previous, and refuses other users or servers', async () => {
  league({ game: 'iracing', title: 'iRacing excluded' });
  league({ game: 'lmu', title: 'LMU first' });
  league({ game: 'lmu', title: 'LMU second' });
  const initial = request({ game: 'lmu' });
  await command.execute(initial);
  const next = buttons(initial.messages[0]).find(({ label }) => label === 'Next');
  assert.match(next.custom_id, /^leagues-page:789:123:all:lmu:1$/);
  const click = request({ customId: next.custom_id });
  await handleLeaguesPageButton(click);
  assert.match(click.messages[0].embeds[0].toJSON().title, /LMU second/);
  const previous = buttons(click.messages[0]).find(({ label }) => label === 'Previous');
  const back = request({ customId: previous.custom_id });
  await handleLeaguesPageButton(back);
  assert.match(back.messages[0].embeds[0].toJSON().title, /LMU first/);

  const otherUser = request({ customId: next.custom_id, userId: '888' });
  await handleLeaguesPageButton(otherUser);
  assert.equal(otherUser.messages.length, 0);
  assert.equal(otherUser.deferredUpdates.length, 0);
  assert.match(otherUser.replies[0].content, /Only the member/);
  const otherGuild = request({ customId: next.custom_id, guildId: '456' });
  await handleLeaguesPageButton(otherGuild);
  assert.equal(otherGuild.messages.length, 0);
  assert.match(otherGuild.replies[0].content, /unavailable in this server/);
  const invalid = request({ customId: 'leagues-page:789:123:all:lmu:NaN' });
  await handleLeaguesPageButton(invalid);
  assert.equal(invalid.messages.length, 0);
});

test('long archived leagues navigate within the selected league and handle deletion while the overview is open', async () => {
  const leagueId = league({ title: 'Archived', startsAt: 1000, dateOnlyUntil: 2000, details: 'D'.repeat(1000) });
  const [tier] = getLeagueTiers({ leagueId, guildId: '123' });
  for (let index = 0; index < 4; index++) createRace({ leagueId, guildId: '123', tierId: tier.id,
    title: `Race ${index}`, startsAt: 1500 + index, track: 'Spa', details: 'D'.repeat(1000), qualifying: 'Q'.repeat(1000),
    createdBy: 'staff', createdAt: 1 });
  const initial = request({ leagueId });
  await command.execute(initial);
  assert.equal(initial.messages.length, 1);
  const next = buttons(initial.messages[0]).find(({ label }) => label === 'Next');
  assert.ok(next.custom_id.includes(`:123:${leagueId}:all:1`));
  const click = request({ customId: next.custom_id });
  await handleLeaguesPageButton(click);
  assert.match(click.messages[0].embeds[0].toJSON().title, /Archived/);
  assert.match(click.messages[0].embeds[0].toJSON().description, /Season/);
  deleteEvent({ eventId: leagueId, guildId: '123' });
  const deleted = request({ customId: next.custom_id });
  await handleLeaguesPageButton(deleted);
  assert.equal(deleted.messages[0].content, 'No leagues match that filter.');
  assert.deepEqual(deleted.messages[0].components, []);
  assert.deepEqual(deleted.messages[0].embeds, []);
  assert.deepEqual(getLeagueOverviewPages({ guildId: '456' }), []);
});
