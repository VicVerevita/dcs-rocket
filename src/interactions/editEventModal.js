const { MessageFlags } = require('discord.js');
const { editEvent, getEvent } = require('../db/eventRepository');
const { parseEventFields } = require('../domain/eventInput');
const { buildEventConfirmation } = require('../ui/eventMessages');
const { publishEditedReminder } = require('../reminders/scheduler');

async function handleEditEventModal(interaction) {
  const eventId = Number(interaction.customId.slice('edit-event:'.length));
  if (!Number.isSafeInteger(eventId) || eventId <= 0) {
    await interaction.reply({
      content: 'That event form is invalid. Please run `/edit-event` again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existing = getEvent({ eventId, guildId: interaction.guildId });
  if (!existing) {
    await interaction.reply({ content: `No event found with ID #${eventId}.`, flags: MessageFlags.Ephemeral });
    return;
  }
  const parsed = parseEventFields(interaction.fields, existing.event_type);
  if (!parsed.ok) {
    await interaction.reply({
      content: `Could not update the event: ${parsed.error}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const { title, startsAt, dateOnlyUntil, track, carClass, details } = parsed.event;

  const updated = editEvent({
    eventId,
    guildId: interaction.guildId,
    title,
    startsAt,
    dateOnlyUntil,
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

  const embed = buildEventConfirmation({
    id: eventId, game: existing.game, eventType: existing.event_type, ...parsed.event,
  }, 'updated');

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

  if (existing.event_type === 'special_event') {
    await publishEditedReminder(interaction.client, eventId, interaction.guildId);
  }
}

module.exports = { handleEditEventModal };
