const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getEvent } = require('../db/eventRepository');
const { buildEventForm } = require('../ui/eventForm');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edit-event')
    .setDescription('Edit an existing racing event')
    .setDefaultMemberPermissions(0)
    .addIntegerOption((option) => option
      .setName('event-id')
      .setDescription('The ID of the event to edit')
      .setRequired(true)),

  async execute(interaction) {
    const eventId = interaction.options.getInteger('event-id', true);
    const event = getEvent({ eventId, guildId: interaction.guildId });
    if (!event) {
      await interaction.reply({
        content: `No event found with ID #${eventId}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.showModal(buildEventForm({ event }));
  },
};
