const {
  ActionRowBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { defaultTimeZone } = require('../config');
const { eventTypeChoices } = require('../utils/eventLabels');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add-event')
    .setDescription('Add a racing event')
    .setDefaultMemberPermissions(0)
    .addStringOption((option) =>
      option
        .setName('game')
        .setDescription('Which sim is this event for?')
        .setRequired(true)
        .addChoices(
          { name: 'iRacing', value: 'iracing' },
          { name: 'Le Mans Ultimate', value: 'lmu' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('What kind of event is this?')
        .setRequired(true)
        .addChoices(...eventTypeChoices),
    ),

  async execute(interaction) {
    const game = interaction.options.getString('game', true);
    const eventType = interaction.options.getString('type', true);

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Event name')
      .setPlaceholder('GT3 Sprint at Spa')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(true);

    const startInput = new TextInputBuilder()
      .setCustomId('start')
      .setLabel(`Date, time or range — ${defaultTimeZone}`)
      .setPlaceholder('03-10-2026 10:00 or 03-10-2026 to 05-10-2026')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(27)
      .setRequired(true);

    const trackInput = new TextInputBuilder()
      .setCustomId('track')
      .setLabel('Track')
      .setPlaceholder('Spa-Francorchamps')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(true);

    const carClassInput = new TextInputBuilder()
      .setCustomId('carClass')
      .setLabel('Car / Class')
      .setPlaceholder('GT3, Hypercar, Mazda MX-5...')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(false);

    const detailsInput = new TextInputBuilder()
      .setCustomId('details')
      .setLabel('Details / signup link')
      .setPlaceholder('Race length, signup link, special rules, etc.')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(800)
      .setRequired(false);

    const modal = new ModalBuilder()
      .setCustomId(`add-event:${game}:${eventType}`)
      .setTitle('Add racing event')
      .addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(startInput),
        new ActionRowBuilder().addComponents(trackInput),
        new ActionRowBuilder().addComponents(carClassInput),
        new ActionRowBuilder().addComponents(detailsInput),
      );

    await interaction.showModal(modal);
  },
};
