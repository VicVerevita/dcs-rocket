const { MessageFlags } = require('discord.js');
const { getLeague, getLeagueTiers } = require('../db/leagueRepository');
const { createRace, editRace, getRace } = require('../db/raceRepository');
const { parseRaceFields } = require('../domain/raceInput');
const { buildRaceConfirmation } = require('../ui/raceMessages');

async function handleRaceModal(interaction) {
  const match = /^(add-race|edit-race):([1-9]\d*)(?::([1-9]\d*))?$/.exec(interaction.customId);
  const id = match ? Number(match[2]) : null;
  const selectedTierId = match?.[3] ? Number(match[3]) : null;
  if (!Number.isSafeInteger(id) || (selectedTierId !== null && !Number.isSafeInteger(selectedTierId))) {
    await interaction.reply({
      content: 'That race form is invalid. Please run `/add-race` or `/edit-race` again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const editing = match[1] === 'edit-race';
  const existing = editing ? getRace({ raceId: id, guildId: interaction.guildId }) : null;
  const leagueId = editing ? existing?.league_id : id;
  const league = leagueId ? getLeague({ leagueId, guildId: interaction.guildId }) : null;
  if (!league) {
    await interaction.reply({
      content: editing ? `No league race found with ID #${id}.` : `No league found with ID #${id}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const tiers = getLeagueTiers({ leagueId, guildId: interaction.guildId });
  const tierId = selectedTierId ?? (editing ? existing.tier_id : tiers.length === 1 ? tiers[0].id : null);
  const tier = tiers.find(({ id: value }) => value === tierId);
  if (!tier) {
    await interaction.reply({
      content: 'This form’s tier is unavailable or ambiguous. Run `/add-race` or `/edit-race` again and choose a tier.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const parsed = parseRaceFields(interaction.fields, existing);
  if (!parsed.ok) {
    await interaction.reply({
      content: `Could not ${editing ? 'update' : 'add'} the race: ${parsed.error}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  let raceId = id;
  if (editing) {
    const updated = editRace({ raceId, guildId: interaction.guildId, tierId, ...parsed.race });
    if (!updated) {
      await interaction.reply({
        content: `No league race found with ID #${raceId}.`, flags: MessageFlags.Ephemeral,
      });
      return;
    }
  } else {
    raceId = createRace({
      leagueId, guildId: interaction.guildId, tierId, ...parsed.race,
      createdBy: interaction.user.id, createdAt: Math.floor(Date.now() / 1000),
    });
  }
  await interaction.reply({
    embeds: [buildRaceConfirmation({ id: raceId, leagueId, tierId, tierName: tier.name, ...parsed.race }, editing ? 'updated' : 'added')],
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { handleRaceModal };
