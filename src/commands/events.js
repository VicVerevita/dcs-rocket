const {
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');
const { getUpcomingEvents } = require('../db/eventRepository');
const { eventTypeChoices, gameChoices } = require('../utils/eventLabels');
const { buildEventsOverview } = require('../ui/eventMessages');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('events')
    .setDescription('Show upcoming racing events')
    .addStringOption((option) =>
      option
        .setName('game')
        .setDescription('Filter by sim')
        .addChoices(...gameChoices),
    )
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Filter by event type')
        .addChoices(...eventTypeChoices),
    ),

  async execute(interaction) {
    const game = interaction.options.getString('game');
    const eventType = interaction.options.getString('type');

    const events = getUpcomingEvents({
      guildId: interaction.guildId,
      game,
      eventType,
      limit: 5,
    });

    if (events.length === 0) {
      await interaction.reply({
        content: 'No upcoming events match that filter.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = buildEventsOverview(events);

    await interaction.reply({ embeds: [embed] });
  },
};
