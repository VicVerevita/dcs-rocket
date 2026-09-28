const {
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { createEvent } = require('../db/eventRepository');
const { parseEventDateTime, discordTimestamp } = require('../utils/time');
const { gameLabel, eventTypeChoices, eventTypeLabel } = require('../utils/eventLabels');

async function handleAddEventModal(interaction) {
  const [, game, eventType] = interaction.customId.split(':');

  if (!['iracing', 'lmu'].includes(game) || !eventTypeChoices.some(({ value }) => value === eventType)) {
    await interaction.reply({
      content: 'That event form is invalid or expired. Please run `/add-event` again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const title = interaction.fields.getTextInputValue('title').trim();
  const startInput = interaction.fields.getTextInputValue('start').trim();
  const track = interaction.fields.getTextInputValue('track').trim();
  const carClass = interaction.fields.getTextInputValue('carClass').trim() || null;
  const details = interaction.fields.getTextInputValue('details').trim() || null;

  const parsedStart = parseEventDateTime(startInput);
  if (!parsedStart.ok) {
    await interaction.reply({
      content: `Could not add the event: ${parsedStart.error}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const eventId = createEvent({
    guildId: interaction.guildId,
    game,
    eventType,
    title,
    startsAt: parsedStart.unix,
    dateOnlyUntil: parsedStart.dateOnlyUntil,
    track,
    carClass,
    details,
    createdBy: interaction.user.id,
    createdAt: Math.floor(Date.now() / 1000),
  });

  const embed = new EmbedBuilder()
    .setTitle('✅ Event added')
    .addFields(
      { name: 'Event', value: `#${eventId} — ${title}` },
      { name: 'Game', value: gameLabel(game), inline: true },
      { name: 'Event type', value: eventTypeLabel(eventType), inline: true },
      {
        name: parsedStart.dateOnlyUntil === null ? 'When (your timezone)' : 'Date / date range',
        value: discordTimestamp(parsedStart.unix, parsedStart.dateOnlyUntil),
      },
      { name: 'Track', value: track },
    );

  if (carClass) embed.addFields({ name: 'Car / Class', value: carClass });
  if (details) embed.addFields({ name: 'Details', value: details });

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { handleAddEventModal };
