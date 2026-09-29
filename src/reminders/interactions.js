const { MessageFlags } = require('discord.js');
const { getEvent } = require('../db/eventRepository');
const { MAX_CLASSES, eventClasses, parseDriverResponse } = require('../domain/rsvp');
const { buildRsvpForm } = require('../ui/rsvpForm');
const {
  getResponse,
  getReminderMessages,
  getEventResponses,
  saveResponse,
} = require('./repository');
const { buildReminderMessage } = require('./messages');

function activeSpecialEvent(interaction) {
  const eventId = Number(interaction.customId.split(':')[2]);
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return null;
  const event = getEvent({ eventId, guildId: interaction.guildId });
  if (!event || event.event_type !== 'special_event' || event.status !== 'scheduled') return null;
  if ((event.date_only_until ?? event.starts_at) <= Math.floor(Date.now() / 1000)) return null;
  return event;
}

async function replyUnavailable(interaction) {
  await interaction.reply({
    content: 'This special event is no longer available for driver responses.',
    flags: MessageFlags.Ephemeral,
  });
}

async function refreshReminderMessages(client, event) {
  for (const reminder of getReminderMessages(event.id, event.starts_at)) {
    try {
      const channel = await client.channels.fetch(reminder.channel_id);
      const message = await channel.messages.fetch(reminder.message_id);
      await message.edit(buildReminderMessage(
        event, reminder.lead_days, getEventResponses(event.id),
      ));
    } catch (error) {
      console.error(`Could not refresh reminder for event #${event.id}:`, error);
    }
  }
}

async function handleReminderButton(interaction) {
  const event = activeSpecialEvent(interaction);
  if (!event) return replyUnavailable(interaction);
  const action = interaction.customId.split(':')[1];

  if (action === 'no') {
    saveResponse({
      eventId: event.id,
      userId: interaction.user.id,
      attending: 0,
      days: null,
      carClass: null,
      availabilityHours: null,
    });
    await interaction.reply({
      content: 'Saved: you are not driving this event. You can change your answer later.',
      flags: MessageFlags.Ephemeral,
    });
    await refreshReminderMessages(interaction.client, event);
    return;
  }

  if (action !== 'yes') return replyUnavailable(interaction);
  const classes = eventClasses(event);
  if (!classes.length || classes.length > MAX_CLASSES) {
    await interaction.reply({
      content: `This event needs between 1 and ${MAX_CLASSES} comma-separated car classes for driver responses. Ask staff to edit it.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.showModal(buildRsvpForm(event, getResponse(event.id, interaction.user.id)));
}

async function handleReminderModal(interaction) {
  const event = activeSpecialEvent(interaction);
  if (!event) return replyUnavailable(interaction);

  const result = parseDriverResponse(event, interaction.fields);
  if (!result.ok) {
    await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
    return;
  }
  saveResponse({
    eventId: event.id,
    userId: interaction.user.id,
    ...result.response,
  });
  const { days, carClass, availabilityHours } = result.response;
  await interaction.reply({
    content: `Saved for event #${event.id}: ${days} - ${carClass}${availabilityHours ? ` - ${availabilityHours}` : ''}. You can update your answer later.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
  await refreshReminderMessages(interaction.client, event);
}

module.exports = { handleReminderButton, handleReminderModal };
