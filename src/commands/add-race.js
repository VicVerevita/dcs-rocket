const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getLeague, getLeagueTiers } = require('../db/leagueRepository');
const { buildRaceForm } = require('../ui/raceForm');
const { tierChoicesText } = require('../ui/raceMessages');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add-race')
    .setDescription('Add a race to a league')
    .setDefaultMemberPermissions(0)
    .addIntegerOption((option) => option.setName('league-id')
      .setDescription('The event ID of the league').setRequired(true).setMinValue(1))
    .addIntegerOption((option) => option.setName('tier-id')
      .setDescription('The tier for this race; required when the league has several tiers').setMinValue(1)),

  async execute(interaction) {
    const leagueId = interaction.options.getInteger('league-id', true);
    const league = getLeague({ leagueId, guildId: interaction.guildId });
    if (!league) {
      await interaction.reply({
        content: `No league found with ID #${leagueId}.`, flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const tiers = getLeagueTiers({ leagueId, guildId: interaction.guildId });
    const tierId = interaction.options.getInteger('tier-id');
    const tier = tierId == null && tiers.length === 1 ? tiers[0] : tiers.find(({ id }) => id === tierId);
    if (!tier) {
      await interaction.reply({
        content: `${tierId == null ? 'Choose a tier' : 'That tier does not belong to this league'}. Run \`/add-race league-id:${leagueId} tier-id:<ID>\`.\n${tierChoicesText(tiers)}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.showModal(buildRaceForm({ leagueId, tierId: tier.id, tierName: tier.name }));
  },
};
