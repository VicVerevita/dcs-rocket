const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { deleteEvent } = require('../db/eventRepository');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('delete-event')
    .setDescription('Delete an event by its ID')
    .setDefaultMemberPermissions(0)
    .addIntegerOption((option) =>
      option
        .setName('event-id')
        .setDescription('The ID of the event to delete')
        .setRequired(true),
    ),

  async execute(interaction) {
    const eventId = interaction.options.getInteger('event-id', true);
    const deleted = deleteEvent({ eventId, guildId: interaction.guildId });

    await interaction.reply({
      content: deleted
        ? `✅ Event #${eventId} has been deleted.`
        : `No event found with ID #${eventId}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
