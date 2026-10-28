const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-tier-races-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');

const db = require('../src/db/database');
const { createEvent } = require('../src/db/eventRepository');
const { getLeagueTiers, createTier } = require('../src/db/leagueRepository');
const { createRace, editRace, getRace, getLeagueRaces } = require('../src/db/raceRepository');
const { setReminderChannel } = require('../src/db/reminderChannelRepository');
const tierCommand = require('../src/commands/league-tier');
const deleteRaceCommand = require('../src/commands/delete-race');
const { handleRaceModal } = require('../src/interactions/raceModal');

after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

function league(guildId = '123') {
  return createEvent({ guildId, game: 'iracing', eventType: 'league', title: 'League', createdBy: 'staff', createdAt: 1900000000 });
}

function race(leagueId, tierId) {
  return createRace({ leagueId, tierId, guildId: '123', title: 'Round', startsAt: 2000000000, track: 'Spa', createdBy: 'staff', createdAt: 1900000000 });
}

test('race repository selects a default tier, preserves it on edits and rejects cross-league tiers', () => {
  const leagueId = league();
  const first = getLeagueTiers({ leagueId, guildId: '123' })[0];
  const tier2 = createTier({ leagueId, guildId: '123', name: 'Tier 2' });
  const otherLeague = league();
  const wrongTier = getLeagueTiers({ leagueId: otherLeague, guildId: '123' })[0].id;
  const raceId = race(leagueId);
  assert.equal(getRace({ raceId, guildId: '123' }).tier_id, first.id);
  const update = { raceId, guildId: '123', title: 'Updated', startsAt: 2000000000, track: 'Monza' };
  assert.equal(editRace({ ...update, tierId: tier2 }), true);
  assert.equal(editRace(update), true);
  assert.equal(getRace({ raceId, guildId: '123' }).tier_id, tier2);
  assert.equal(editRace({ ...update, tierId: wrongTier }), false);
  assert.throws(() => race(leagueId, wrongTier), /matching tier/);
  assert.deepEqual(getLeagueRaces({ leagueId, guildId: '123', tierId: first.id }), []);
  assert.equal(getLeagueRaces({ leagueId, guildId: '123', tierId: tier2 }).length, 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

function interaction({ leagueId, tierId, name, action, guildId = '123', raceId, customId } = {}) {
  const replies = [];
  const fetchedChannels = [];
  return { guildId, replies, fetchedChannels, customId, user: { id: 'staff' },
    client: { channels: { fetch: async (id) => {
      fetchedChannels.push(id);
      throw new Error('Race changes must not publish reminder posts');
    } } },
    options: {
      getInteger: (key) => key === 'league-id' ? leagueId : key === 'race-id' ? raceId : tierId,
      getString: () => name, getSubcommand: () => action,
    },
    fields: { getTextInputValue: (key) => ({ title: 'Round', start: '03.10.2030 14:00', track: 'Spa', qualifying: '', details: '' })[key] },
    reply: async (message) => { replies.push(message); },
  };
}

test('tier commands add and rename tiers, reject duplicates/other guilds, and protect the final tier', async () => {
  const leagueId = league();
  const adding = interaction({ leagueId, name: 'Tier 2', action: 'add' });
  await tierCommand.execute(adding);
  assert.match(adding.replies[0].content, /Added Tier 2/);
  const tier = getLeagueTiers({ leagueId, guildId: '123' }).at(-1);
  const renaming = interaction({ leagueId, tierId: tier.id, name: 'Academy', action: 'rename' });
  await tierCommand.execute(renaming);
  assert.match(renaming.replies[0].content, /Renamed Tier 2 to Academy/);
  const duplicate = interaction({ leagueId, name: 'ACADEMY', action: 'add' });
  await tierCommand.execute(duplicate);
  assert.match(duplicate.replies[0].content, /already has a tier/);
  const foreign = interaction({ leagueId, tierId: tier.id, action: 'remove', guildId: '456' });
  await tierCommand.execute(foreign);
  assert.match(foreign.replies[0].content, /No league found/);
  const removing = interaction({ leagueId, tierId: tier.id, action: 'remove' });
  await tierCommand.execute(removing);
  assert.match(removing.replies[0].content, /Removed Academy/);
  const last = interaction({ leagueId, tierId: getLeagueTiers({ leagueId, guildId: '123' })[0].id, action: 'remove' });
  await tierCommand.execute(last);
  assert.match(last.replies[0].content, /at least one tier/);
});

test('race add, edit, and delete do not fetch or send reminder channels', async () => {
  setReminderChannel('123', '456', null, '');
  const leagueId = league();
  const adding = interaction({ leagueId, customId: `add-race:${leagueId}` });
  await handleRaceModal(adding);
  assert.deepEqual(adding.fetchedChannels, []);
  const [added] = getLeagueRaces({ leagueId, guildId: '123' });
  assert.match(adding.replies[0].embeds[0].toJSON().title, /race added/);
  const editing = interaction({ raceId: added.id, customId: `edit-race:${added.id}` });
  await handleRaceModal(editing);
  assert.deepEqual(editing.fetchedChannels, []);
  assert.match(editing.replies[0].embeds[0].toJSON().title, /race updated/);
  const deleting = interaction({ raceId: added.id });
  await deleteRaceCommand.execute(deleting);
  assert.deepEqual(deleting.fetchedChannels, []);
  assert.match(deleting.replies[0].content, /removed/);
});
