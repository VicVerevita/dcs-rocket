const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { eventTypeChoices, gameChoices } = require('../utils/eventLabels');
const { buildEventForm } = require('../ui/eventForm');
const { MAX_LEAGUE_TIERS, prequalificationChoices } = require('../domain/leagueInput');
const { leagueCreationDrafts } = require('../interactions/leagueCreationDrafts');
const { buildLeagueTierNamesForm } = require('../ui/leagueCreation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add-event')
    .setDescription('Add a racing event')
    .setDefaultMemberPermissions(0)
    .addStringOption((option) => option
      .setName('game')
      .setDescription('Which sim is this event for?')
      .setRequired(true)
      .addChoices(...gameChoices))
    .addStringOption((option) => option
      .setName('type')
      .setDescription('What kind of event is this?')
      .setRequired(true)
      .addChoices(...eventTypeChoices))
    .addIntegerOption((option) => option.setName('tiers')
      .setDescription('League only: number of tiers (default: 1)').setMinValue(1).setMaxValue(MAX_LEAGUE_TIERS))
    .addStringOption((option) => option.setName('pre-qualification')
      .setDescription('League only: add a pre-qualification race or signup period')
      .addChoices(...prequalificationChoices)),

  async execute(interaction) {
    const eventType = interaction.options.getString('type', true);
    const tiers = interaction.options.getInteger?.('tiers');
    const prequalificationKind = interaction.options.getString?.('pre-qualification');
    if (eventType !== 'league' && (tiers != null || prequalificationKind != null)) {
      await interaction.reply({
        content: 'Tiers and pre-qualification are available for leagues. Select League as the event type.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (eventType === 'league') {
      if (!interaction.guildId || !interaction.user?.id) {
        await interaction.reply({ content: 'Create a league from a server.', flags: MessageFlags.Ephemeral });
        return;
      }
      const draft = leagueCreationDrafts.create({
        userId: interaction.user.id, guildId: interaction.guildId,
        data: {
          game: interaction.options.getString('game', true), tierCount: tiers ?? 1,
          prequalificationKind: prequalificationKind ?? null, tierNames: null,
        },
      });
      try {
        await interaction.showModal(buildLeagueTierNamesForm(draft));
      } catch (error) {
        leagueCreationDrafts.remove({ id: draft.id, userId: interaction.user.id, guildId: interaction.guildId });
        throw error;
      }
      return;
    }
    await interaction.showModal(buildEventForm({
      game: interaction.options.getString('game', true),
      eventType,
      tiers: tiers ?? 1,
      prequalificationKind: prequalificationKind ?? null,
    }));
  },
};
