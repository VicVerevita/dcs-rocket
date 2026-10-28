const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-race-management-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');

const db = require('../src/db/database');
const { createEvent } = require('../src/db/eventRepository');
const { getLeagueTiers, createTier } = require('../src/db/leagueRepository');
const { getRace, getLeagueRaces } = require('../src/db/raceRepository');
const { handleRaceModal } = require('../src/interactions/raceModal');
const addCommand = require('../src/commands/add-race');
const editCommand = require('../src/commands/edit-race');
const deleteCommand = require('../src/commands/delete-race');
const listCommand = require('../src/commands/races');

after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

function event(eventType = 'league', guildId = '123') {
  return createEvent({
    guildId, game: 'iracing', eventType, title: 'Season', startsAt: eventType === 'league' ? null : 2000000000,
    dateOnlyUntil: null, track: '', carClass: null, details: null,
    createdBy: 'staff', createdAt: Math.floor(Date.now() / 1000),
  });
}

function interaction({ id, tierId = null, guildId = '123', values = {}, customId } = {}) {
  const replies = [];
  const forms = [];
  const messages = [];
  const deferredReplies = [];
  return {
    replies, forms, messages, deferredReplies, guildId, customId, user: { id: '789' }, client: {},
    options: { getInteger: (name) => name === 'tier-id' ? tierId : id },
    fields: { getTextInputValue: (key) => ({
      title: 'Round 1', start: '03.10.2030 14:00', track: 'Spa', qualifying: '13:30 - 20 minutes', details: '',
      ...values,
    })[key] },
    reply: async (reply) => { replies.push(reply); },
    deferReply: async (options) => { deferredReplies.push(options); },
    editReply: async (message) => { messages.push(message); },
    followUp: async () => { assert.fail('Race pagination must edit the original message'); },
    showModal: async (form) => { forms.push(form.toJSON()); },
  };
}

test('race add, edit, listing and delete preserve parent league and qualifying details', async () => {
  const leagueId = event();
  const opening = interaction({ id: leagueId });
  await addCommand.execute(opening);
  assert.equal(opening.forms[0].custom_id, `add-race:${leagueId}:${getLeagueTiers({ leagueId, guildId: '123' })[0].id}`);

  const adding = interaction({ customId: `add-race:${leagueId}` });
  await handleRaceModal(adding);
  const [race] = getLeagueRaces({ leagueId, guildId: '123' });
  assert.equal(race.qualifying, '13:30 - 20 minutes');
  assert.equal(race.league_id, leagueId);
  assert.equal(adding.replies[0].embeds[0].toJSON().title, '✅ League race added');

  const openingEdit = interaction({ id: race.id });
  await editCommand.execute(openingEdit);
  assert.equal(openingEdit.forms[0].custom_id, `edit-race:${race.id}`);
  const editing = interaction({ customId: `edit-race:${race.id}`, values: {
    title: 'Round 1 revised', qualifying: '13:00 - 30 minutes',
  } });
  await handleRaceModal(editing);
  assert.equal(getRace({ raceId: race.id, guildId: '123' }).qualifying, '13:00 - 30 minutes');

  const listing = interaction({ id: leagueId });
  await listCommand.execute(listing);
  assert.equal(listing.deferredReplies.length, 1);
  assert.equal(listing.messages.length, 1);
  assert.match(listing.messages[0].embeds[0].toJSON().description, /Round 1 revised/);
  assert.match(listing.messages[0].embeds[0].toJSON().description, /13:00 - 30 minutes/);

  const deleting = interaction({ id: race.id });
  await deleteCommand.execute(deleting);
  assert.match(deleting.replies[0].content, /removed from League/);
  assert.equal(getLeagueRaces({ leagueId, guildId: '123' }).length, 0);
});

test('multiple tiers require an explicit add choice and race moves stay within their league', async () => {
  const leagueId = event();
  const tierId = createTier({ leagueId, guildId: '123', name: 'Tier 2' });
  const ambiguous = interaction({ id: leagueId });
  await addCommand.execute(ambiguous);
  assert.equal(ambiguous.forms.length, 0);
  assert.match(ambiguous.replies[0].content, /Choose a tier/);
  assert.match(ambiguous.replies[0].content, new RegExp(`tier-id:${tierId}`));

  const legacy = interaction({ customId: `add-race:${leagueId}` });
  await handleRaceModal(legacy);
  assert.match(legacy.replies[0].content, /ambiguous/);
  assert.equal(getLeagueRaces({ leagueId, guildId: '123' }).length, 0);

  const chosen = interaction({ id: leagueId, tierId });
  await addCommand.execute(chosen);
  assert.equal(chosen.forms[0].custom_id, `add-race:${leagueId}:${tierId}`);
  const adding = interaction({ customId: chosen.forms[0].custom_id });
  await handleRaceModal(adding);
  const [race] = getLeagueRaces({ leagueId, guildId: '123', tierId });
  assert.equal(race.tier_name, 'Tier 2');

  const first = getLeagueTiers({ leagueId, guildId: '123' })[0];
  const openingMove = interaction({ id: race.id, tierId: first.id });
  await editCommand.execute(openingMove);
  assert.equal(openingMove.forms[0].custom_id, `edit-race:${race.id}:${first.id}`);
  await handleRaceModal(interaction({ customId: openingMove.forms[0].custom_id }));
  assert.equal(getRace({ raceId: race.id, guildId: '123' }).tier_id, first.id);

  const otherLeague = event();
  const wrongTier = getLeagueTiers({ leagueId: otherLeague, guildId: '123' })[0].id;
  const invalidMove = interaction({ id: race.id, tierId: wrongTier });
  await editCommand.execute(invalidMove);
  assert.equal(invalidMove.forms.length, 0);
  assert.match(invalidMove.replies[0].content, /does not belong/);
  const invalidSubmit = interaction({ customId: `edit-race:${race.id}:${wrongTier}` });
  await handleRaceModal(invalidSubmit);
  assert.match(invalidSubmit.replies[0].content, /unavailable/);
  assert.equal(getRace({ raceId: race.id, guildId: '123' }).tier_id, first.id);

  const all = interaction({ id: leagueId });
  await listCommand.execute(all);
  assert.equal(all.replies.length, 0);
  assert.equal(all.messages.length, 1);
  assert.match(all.messages[0].embeds[0].toJSON().description, /Round 1/);
  assert.deepEqual(all.messages[0].components[0].toJSON().components.map(({ label }) => label), ['Previous', 'Next']);
  const filtered = interaction({ id: leagueId, tierId: first.id });
  await listCommand.execute(filtered);
  assert.equal(filtered.messages.length, 1);
  assert.match(filtered.messages[0].embeds[0].toJSON().description, /Round 1/);
  assert.deepEqual(filtered.messages[0].components, []);
});

test('race commands and submitted modals reject other guilds, non-leagues and invalid dates', async () => {
  const foreignLeagueId = event('league', '456');
  const nonLeagueId = event('other');
  for (const leagueId of [foreignLeagueId, nonLeagueId]) {
    const opening = interaction({ id: leagueId });
    await addCommand.execute(opening);
    assert.equal(opening.forms.length, 0);
    assert.match(opening.replies[0].content, /No league found/);
    const submission = interaction({ customId: `add-race:${leagueId}` });
    await handleRaceModal(submission);
    assert.match(submission.replies[0].content, /No league found/);
  }
  const leagueId = event();
  const invalid = interaction({ customId: `add-race:${leagueId}`, values: { start: '03.10.2030' } });
  await handleRaceModal(invalid);
  assert.match(invalid.replies[0].content, /DD.MM.YYYY HH:mm/);
  assert.equal(getLeagueRaces({ leagueId, guildId: '123' }).length, 0);

  const adding = interaction({ customId: `add-race:${leagueId}` });
  await handleRaceModal(adding);
  const [race] = getLeagueRaces({ leagueId, guildId: '123' });
  const editingForeign = interaction({ customId: `edit-race:${race.id}`, guildId: '456' });
  await handleRaceModal(editingForeign);
  assert.match(editingForeign.replies[0].content, /No league race found/);
  const deletingForeign = interaction({ id: race.id, guildId: '456' });
  await deleteCommand.execute(deletingForeign);
  assert.match(deletingForeign.replies[0].content, /No league race found/);
  assert.ok(getRace({ raceId: race.id, guildId: '123' }));
});
