const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MessageFlags } = require('discord.js');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-races-pagination-'));
Object.assign(process.env, {
  DISCORD_TOKEN: 'test', CLIENT_ID: 'test', GUILD_IDS: '123', REMINDER_CHANNELS: '',
  DATABASE_PATH: path.join(directory, 'events.sqlite'),
});

const db = require('../src/db/database');
const { createEvent, deleteEvent } = require('../src/db/eventRepository');
const { getLeagueTiers, deleteTier } = require('../src/db/leagueRepository');
const { createRace, deleteRace, getLeagueRaces } = require('../src/db/raceRepository');
const { handleRacesPageButton } = require('../src/interactions/racesPagination');
const command = require('../src/commands/races');

after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => db.exec('DELETE FROM events'));

function league(values = {}) {
  return createEvent({ guildId: '123', game: 'iracing', eventType: 'league', title: 'Winter League',
    createdBy: 'staff', createdAt: 1, ...values });
}

function race(leagueId, tierId, values = {}) {
  return createRace({ leagueId, tierId, guildId: '123', title: 'Round 1', startsAt: 2000000000,
    track: 'Spa', qualifying: '20 minutes', createdBy: 'staff', createdAt: 1, ...values });
}

function request({ leagueId, tierId = null, guildId = '123', userId = '789', customId } = {}) {
  const messages = [];
  const replies = [];
  const deferredReplies = [];
  const deferredUpdates = [];
  return {
    messages, replies, deferredReplies, deferredUpdates, guildId, customId, user: { id: userId },
    options: { getInteger: (name) => name === 'tier-id' ? tierId : leagueId },
    deferReply: async (options) => deferredReplies.push(options),
    deferUpdate: async () => deferredUpdates.push(true),
    editReply: async (message) => messages.push(message),
    reply: async (message) => replies.push(message),
    followUp: async () => assert.fail('Race pages must update the original message'),
  };
}

function button(message, label) {
  return message.components.flatMap((row) => row.toJSON().components).find((value) => value.label === label);
}

async function click(customId) {
  const interaction = request({ customId });
  await handleRacesPageButton(interaction);
  assert.equal(interaction.deferredUpdates.length, 1);
  assert.equal(interaction.messages.length, 1);
  assert.equal(interaction.replies.length, 0);
  return interaction.messages[0];
}

test('two tier schedules use Previous and Next to update one message', async () => {
  const leagueId = league({ tierNames: ['Gold', 'Silver'] });
  const [gold, silver] = getLeagueTiers({ leagueId, guildId: '123' });
  race(leagueId, gold.id, { title: 'Gold opening race' });
  race(leagueId, silver.id, { title: 'Silver opening race' });
  const initial = request({ leagueId });
  await command.execute(initial);
  assert.equal(initial.deferredReplies.length, 1);
  assert.equal(initial.deferredReplies[0].flags, MessageFlags.Ephemeral);
  assert.equal(initial.messages.length, 1);
  assert.equal(initial.replies.length, 0);
  const first = initial.messages[0];
  assert.match(first.embeds[0].toJSON().description, /Gold opening race/);
  assert.doesNotMatch(first.embeds[0].toJSON().description, /Silver opening race/);
  assert.match(first.embeds[0].toJSON().footer.text, /Page 1\/2/);
  assert.equal(button(first, 'Previous').disabled, true);
  assert.equal(button(first, 'Next').disabled, false);
  const next = button(first, 'Next');
  assert.equal(next.custom_id, `races-page:789:123:${leagueId}:all:1`);
  const second = await click(next.custom_id);
  assert.match(second.embeds[0].toJSON().description, /Silver opening race/);
  assert.doesNotMatch(second.embeds[0].toJSON().description, /Gold opening race/);
  assert.match(second.embeds[0].toJSON().footer.text, /Page 2\/2/);
  assert.equal(button(second, 'Previous').disabled, false);
  assert.equal(button(second, 'Next').disabled, true);
  const back = await click(button(second, 'Previous').custom_id);
  assert.match(back.embeds[0].toJSON().description, /Gold opening race/);
  assert.equal(button(back, 'Previous').disabled, true);
  for (const message of [first, second, back]) assert.deepEqual(message.allowedMentions, { parse: [] });
});

test('a long filtered tier schedule keeps every race reachable without losing its league or tier filter', async () => {
  const leagueId = league({ tierNames: ['Pro', 'Am'] });
  const [pro, am] = getLeagueTiers({ leagueId, guildId: '123' });
  race(leagueId, am.id, { title: 'Excluded Am race' });
  const otherLeague = league({ title: 'Excluded league' });
  race(otherLeague, getLeagueTiers({ leagueId: otherLeague, guildId: '123' })[0].id, { title: 'Excluded league race' });
  const races = Array.from({ length: 6 }, (_, index) => race(leagueId, pro.id, {
    title: `Pro round ${index + 1}`, startsAt: 2000000000 + index * 86400,
    qualifying: 'Q'.repeat(1000), details: 'D'.repeat(1000),
  }));
  const initial = request({ leagueId, tierId: pro.id });
  await command.execute(initial);
  const visited = [initial.messages[0]];
  let current = visited[0];
  while (!button(current, 'Next').disabled) {
    const next = button(current, 'Next');
    assert.ok(next.custom_id.includes(`:123:${leagueId}:${pro.id}:`));
    current = await click(next.custom_id);
    visited.push(current);
    assert.ok(visited.length <= races.length, 'Pagination must reach its final page');
  }
  assert.equal(visited.length, races.length);
  const text = JSON.stringify(visited);
  for (const id of races) assert.equal(text.split(`Race ID:** ||${id}||`).length - 1, 1);
  assert.doesNotMatch(text, /Excluded/);
  for (const [index, message] of visited.entries()) {
    const embed = message.embeds[0].toJSON();
    assert.match(embed.description, /## Pro/);
    assert.ok(embed.description.length <= 4096);
    assert.equal((embed.footer.text.match(/Page /g) ?? []).length, 1);
    assert.ok(embed.footer.text.includes(`Page ${index + 1}/${races.length}`));
  }
  const previous = await click(button(current, 'Previous').custom_id);
  assert.match(previous.embeds[0].toJSON().description, /Pro round 5/);
});

test('race navigation rejects other members, servers, and malformed IDs before changing the message', async () => {
  const leagueId = league({ tierNames: ['Pro', 'Am'] });
  const initial = request({ leagueId });
  await command.execute(initial);
  const next = button(initial.messages[0], 'Next').custom_id;
  for (const interaction of [
    request({ customId: next, userId: '888' }),
    request({ customId: next, guildId: '456' }),
    request({ customId: next.replace(/:1$/, ':NaN') }),
  ]) {
    await handleRacesPageButton(interaction);
    assert.equal(interaction.messages.length, 0);
    assert.equal(interaction.deferredUpdates.length, 0);
    assert.equal(interaction.replies.length, 1);
    assert.equal(interaction.replies[0].flags, MessageFlags.Ephemeral);
  }
});

test('deleting the displayed league or selected tier clears stale embeds and navigation', async () => {
  const leagueId = league({ tierNames: ['Pro', 'Am'] });
  const initial = request({ leagueId });
  await command.execute(initial);
  const next = button(initial.messages[0], 'Next').custom_id;
  deleteEvent({ eventId: leagueId, guildId: '123' });
  const deleted = await click(next);
  assert.match(deleted.content, /No league found/);
  assert.deepEqual(deleted.embeds, []);
  assert.deepEqual(deleted.components, []);

  const secondLeague = league({ tierNames: ['Gold', 'Silver'] });
  const [tier] = getLeagueTiers({ leagueId: secondLeague, guildId: '123' });
  for (let index = 0; index < 2; index++) race(secondLeague, tier.id, {
    title: `Long round ${index}`, qualifying: 'Q'.repeat(1000), details: 'D'.repeat(1000),
  });
  const filtered = request({ leagueId: secondLeague, tierId: tier.id });
  await command.execute(filtered);
  const filteredNext = button(filtered.messages[0], 'Next').custom_id;
  for (const stored of getLeagueRaces({ leagueId: secondLeague, guildId: '123', tierId: tier.id })) {
    deleteRace({ raceId: stored.id, guildId: '123' });
  }
  assert.equal(deleteTier({ tierId: tier.id, guildId: '123' }), true);
  const removedTier = await click(filteredNext);
  assert.match(removedTier.content, /tier.*does not belong/i);
  assert.deepEqual(removedTier.embeds, []);
  assert.deepEqual(removedTier.components, []);
});

test('navigation clamps a stale page after the schedule shrinks', async () => {
  const leagueId = league();
  const [tier] = getLeagueTiers({ leagueId, guildId: '123' });
  const races = Array.from({ length: 5 }, (_, index) => race(leagueId, tier.id, {
    title: `Round ${index + 1}`, startsAt: 2000000000 + index * 86400,
    qualifying: 'Q'.repeat(1000), details: 'D'.repeat(1000),
  }));
  const initial = request({ leagueId });
  await command.execute(initial);
  let current = initial.messages[0];
  for (let page = 0; page < 3; page++) current = await click(button(current, 'Next').custom_id);
  const staleNext = button(current, 'Next').custom_id;
  for (const raceId of races.slice(1)) deleteRace({ raceId, guildId: '123' });
  const clamped = await click(staleNext);
  assert.match(clamped.embeds[0].toJSON().description, /Round 1/);
  assert.match(clamped.embeds[0].toJSON().footer.text, /Page 1\/1/);
  assert.deepEqual(clamped.components, []);
});

test('missing leagues and invalid tier filters return one deferred command response', async () => {
  const leagueId = league();
  const foreignLeagueId = league({ guildId: '456' });
  const foreignTierId = getLeagueTiers({ leagueId: foreignLeagueId, guildId: '456' })[0].id;
  for (const interaction of [request({ leagueId: 999999 }), request({ leagueId, tierId: foreignTierId })]) {
    await command.execute(interaction);
    assert.equal(interaction.deferredReplies.length, 1);
    assert.equal(interaction.messages.length, 1);
    assert.equal(interaction.replies.length, 0);
    assert.deepEqual(interaction.messages[0].embeds, []);
    assert.deepEqual(interaction.messages[0].components, []);
  }
});
