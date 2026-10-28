const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { gameChoices } = require('../utils/eventLabels');
const { getLeagueOverviewPages, buildLeaguesPagePayload } = require('../interactions/leaguesPagination');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leagues')
    .setDescription('Show leagues, pre-qualification, and each tier’s race schedule')
    .addIntegerOption((option) => option.setName('league-id')
      .setDescription('Show one league, including a past season').setMinValue(1))
    .addStringOption((option) => option.setName('game')
      .setDescription('Filter by sim').addChoices(...gameChoices)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const context = {
      guildId: interaction.guildId,
      leagueId: interaction.options.getInteger('league-id'),
      game: interaction.options.getString('game'),
      ownerId: interaction.user.id,
    };
    const pages = getLeagueOverviewPages(context);
    await interaction.editReply(buildLeaguesPagePayload({ ...context, pages, page: 0 }));
  },
};
