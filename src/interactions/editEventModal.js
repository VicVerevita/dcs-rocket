const { EmbedBuilder, MessageFlags } = require('discord.js');
const { editEvent } = require('../db/eventRepository');
const { parseEventDateTime, discordTimestamp } = require('../utils/time');

async function handleEditEventModal(interaction) {
  const eventId = Number(interaction.customId.slice('edit-event:'.length));
  if (!Number.isSafeInteger(eventId) || eventId <= 0) {
    await interaction.reply({
      content: 'That event form is invalid. Please run `/edit-event` again.',
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
      content: `Could not update the event: ${parsedStart.error}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const updated = editEvent({
    eventId,
    guildId: interaction.guildId,
    title,
    startsAt: parsedStart.unix,
    dateOnlyUntil: parsedStart.dateOnlyUntil,
    track,
    carClass,
    details,
  });
  if (!updated) {
    await interaction.reply({
      content: `No event found with ID #${eventId}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ Event updated')
    .addFields(
      { name: 'Event', value: `#${eventId} — ${title}` },
      {
        name: parsedStart.dateOnlyUntil === null ? 'When (your timezone)' : 'Date / date range',
        value: discordTimestamp(parsedStart.unix, parsedStart.dateOnlyUntil),
      },
      { name: 'Track', value: track },
    );

  if (carClass) embed.addFields({ name: 'Car / Class', value: carClass });
  if (details) embed.addFields({ name: 'Details', value: details });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = { handleEditEventModal };
