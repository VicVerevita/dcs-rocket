const { MessageFlags } = require('discord.js');
const { createEvent } = require('../db/eventRepository');
const { parseEventFields } = require('../domain/eventInput');
const { eventTypeChoices, gameChoices } = require('../utils/eventLabels');
const { buildEventConfirmation } = require('../ui/eventMessages');
const { publishLateReminder } = require('../reminders/scheduler');

async function handleAddEventModal(interaction) {
  const [, game, eventType] = interaction.customId.split(':');

  if (!gameChoices.some(({ value }) => value === game) || !eventTypeChoices.some(({ value }) => value === eventType)) {
    await interaction.reply({
      content: 'That event form is invalid or expired. Please run `/add-event` again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const parsed = parseEventFields(interaction.fields, eventType);
  if (!parsed.ok) {
    await interaction.reply({
      content: `Could not add the event: ${parsed.error}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const { title, startsAt, dateOnlyUntil, track, carClass, details } = parsed.event;

  const eventId = createEvent({
    guildId: interaction.guildId,
    game,
    eventType,
    title,
    startsAt,
    dateOnlyUntil,
    track,
    carClass,
    details,
    createdBy: interaction.user.id,
    createdAt: Math.floor(Date.now() / 1000),
  });

  const embed = buildEventConfirmation({ id: eventId, game, eventType, ...parsed.event }, 'added');

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });

  if (eventType === 'special_event') {
    await publishLateReminder(interaction.client, eventId, interaction.guildId);
  }
}

module.exports = { handleAddEventModal };
