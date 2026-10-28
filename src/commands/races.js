const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getRaceOverviewPages, buildRacesPagePayload } = require('../interactions/racesPagination');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('races')
    .setDescription('Show a league’s race schedule and qualifying details')
    .addIntegerOption((option) => option.setName('league-id')
      .setDescription('The event ID of the league').setRequired(true).setMinValue(1))
    .addIntegerOption((option) => option.setName('tier-id')
      .setDescription('Show only this league tier').setMinValue(1)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const context = {
      guildId: interaction.guildId,
      leagueId: interaction.options.getInteger('league-id', true),
      tierId: interaction.options.getInteger('tier-id'),
      ownerId: interaction.user.id,
    };
    await interaction.editReply(buildRacesPagePayload({ ...context, ...getRaceOverviewPages(context), page: 0 }));
  },
};
