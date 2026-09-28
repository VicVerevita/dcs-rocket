const {
  ActionRowBuilder,
  ModalBuilder,
  MessageFlags,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { DateTime } = require('luxon');
const { defaultTimeZone } = require('../config');
const { getEvent } = require('../db/eventRepository');
const { INPUT_FORMAT, discordTimestamp } = require('../utils/time');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edit-event')
    .setDescription('Edit an existing racing event')
    .setDefaultMemberPermissions(0)
    .addIntegerOption((option) =>
      option
        .setName('event-id')
        .setDescription('The ID of the event to edit')
        .setRequired(true),
    ),

  async execute(interaction) {
    const eventId = interaction.options.getInteger('event-id', true);
    const event = getEvent({ eventId, guildId: interaction.guildId });
    
    console.log(`Editing event #${eventId} in guild ${interaction.guildId}, event:`, event);

    if (!event) {
      await interaction.reply({
        content: `No event found with ID #${eventId}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const startValue = event.date_only_until == null
      ? DateTime.fromSeconds(event.starts_at, { zone: defaultTimeZone }).toFormat(INPUT_FORMAT)
      : discordTimestamp(event.starts_at, event.date_only_until);

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Event name')
      .setPlaceholder('GT3 Sprint at Spa')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(true)
      .setValue(event.title);


    const startInput = new TextInputBuilder()
      .setCustomId('start')
      .setLabel(`Date, time or range — ${defaultTimeZone}`)
      .setPlaceholder('03-10-2026 10:00 or 03-10-2026 to 05-10-2026')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(27)
      .setRequired(true)
      .setValue(startValue);

    const trackInput = new TextInputBuilder()
      .setCustomId('track')
      .setLabel('Track')
      .setPlaceholder('Spa-Francorchamps')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(true)
      .setValue(event.track);

    const carClassInput = new TextInputBuilder()
      .setCustomId('carClass')
      .setLabel('Car class (optional)')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(false)
      .setValue(event.car_class || '');

    const detailsInput = new TextInputBuilder()
      .setCustomId('details')
      .setLabel('Details (optional)')
      .setPlaceholder('Additional information about the event')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1000)
      .setRequired(false)
      .setValue(event.details || '');

    const modal = new ModalBuilder()
      .setCustomId(`edit-event:${eventId}`)
      .setTitle(`Edit Event #${eventId}`)
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