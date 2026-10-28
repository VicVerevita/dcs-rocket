const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getRace } = require('../db/raceRepository');
const { getLeagueTiers } = require('../db/leagueRepository');
const { buildRaceForm } = require('../ui/raceForm');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edit-race')
    .setDescription('Edit a league race')
    .setDefaultMemberPermissions(0)
    .addIntegerOption((option) => option.setName('race-id')
      .setDescription('The ID of the race to edit').setRequired(true).setMinValue(1))
    .addIntegerOption((option) => option.setName('tier-id')
      .setDescription('Move this race to another tier in the same league').setMinValue(1)),

  async execute(interaction) {
    const raceId = interaction.options.getInteger('race-id', true);
    const race = getRace({ raceId, guildId: interaction.guildId });
    if (!race) {
      await interaction.reply({
        content: `No league race found with ID #${raceId}.`, flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const tierId = interaction.options.getInteger('tier-id');
    const tier = tierId == null ? { id: race.tier_id, name: race.tier_name }
      : getLeagueTiers({ leagueId: race.league_id, guildId: interaction.guildId }).find(({ id }) => id === tierId);
    if (!tier) {
      await interaction.reply({
        content: 'That tier does not belong to this race’s league.', flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.showModal(buildRaceForm({ race, tierId: tierId ?? undefined, tierName: tier.name }));
  },
};
