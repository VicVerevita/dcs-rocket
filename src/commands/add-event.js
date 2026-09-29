const { SlashCommandBuilder } = require('discord.js');
const { eventTypeChoices, gameChoices } = require('../utils/eventLabels');
const { buildEventForm } = require('../ui/eventForm');

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
      .addChoices(...eventTypeChoices)),

  async execute(interaction) {
    await interaction.showModal(buildEventForm({
      game: interaction.options.getString('game', true),
      eventType: interaction.options.getString('type', true),
    }));
  },
};
