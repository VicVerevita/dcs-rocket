const { MessageFlags } = require('discord.js');
const { guildIds, defaultTimeZone } = require('../config');
const { getEvent } = require('../db/eventRepository');
const { MAX_CLASSES, eventClasses, parseDriverResponse } = require('../domain/rsvp');
const { buildRsvpForm } = require('../ui/rsvpForm');
const {
  getResponse,
  getReminderMessages,
  removeReminderMessage,
  getEventResponses,
  saveResponse,
} = require('./repository');
const { buildReminderMessage, buildPrivateReminderMessage } = require('./messages');
const { requestPrivateReminder } = require('./private');

function activeSpecialEvent(interaction) {
  const parts = interaction.customId.split(':');
  const eventId = Number(parts.at(-1));
  const guildId = interaction.guildId || (parts.length === 4 ? parts[2] : null);
  if (!guildId || !guildIds.includes(guildId) || !Number.isSafeInteger(eventId) || eventId <= 0) return null;
  const event = getEvent({ eventId, guildId });
  if (!event || event.event_type !== 'special_event' || event.status !== 'scheduled') return null;
  if ((event.date_only_until ?? event.starts_at) <= Math.floor(Date.now() / 1000)) return null;
  return event;
}

function responseOptions(interaction, content) {
  return { content, ...(interaction.guildId ? { flags: MessageFlags.Ephemeral } : {}) };
}

async function replyUnavailable(interaction) {
  await interaction.reply(responseOptions(interaction,
    'This special event is no longer available for driver responses.'));
}

async function handlePrivateReminderRequest(interaction, event) {
  const result = requestPrivateReminder(event, interaction.user.id);
  await interaction.reply(responseOptions(interaction, result.ok
    ? `I will DM you tomorrow at or shortly after 09:00 (${defaultTimeZone}).`
    : result.error));
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
      if (error.code === 10008) {
        removeReminderMessage({
          eventId: event.id,
          startsAt: event.starts_at,
          leadDays: reminder.lead_days,
          channelId: reminder.channel_id,
          messageId: reminder.message_id,
        });
        continue;
      }
      console.error(`Could not refresh reminder for event #${event.id}:`, error);
    }
  }
}

async function refreshPrivateMessage(interaction, event) {
  if (interaction.guildId || !interaction.message?.edit) return;
  try {
    await interaction.message.edit(buildPrivateReminderMessage(
      event, getResponse(event.id, interaction.user.id),
    ));
  } catch (error) {
    console.error(`Could not refresh private reminder for event #${event.id}:`, error);
  }
}

async function handleReminderButton(interaction) {
  const event = activeSpecialEvent(interaction);
  if (!event) return replyUnavailable(interaction);
  const action = interaction.customId.split(':')[1];

  switch (action) {
    case 'no':
      saveResponse({
        eventId: event.id,
        userId: interaction.user.id,
        attending: 0,
        days: null,
        carClass: null,
        availabilityHours: null,
      });
      await interaction.reply(responseOptions(interaction,
        'Saved: you are not driving this event. You can change your answer later.'));
      await refreshReminderMessages(interaction.client, event);
      await refreshPrivateMessage(interaction, event);
      return;
    case 'yes':
      break;
    case 'remind_me_again':
      return handlePrivateReminderRequest(interaction, event);
    default:
      return replyUnavailable(interaction);
  }

  const classes = eventClasses(event);
  if (!classes.length || classes.length > MAX_CLASSES) {
    await interaction.reply(responseOptions(interaction,
      `This event needs between 1 and ${MAX_CLASSES} comma-separated car classes for driver responses. Ask staff to edit it.`));
    return;
  }
  await interaction.showModal(buildRsvpForm(
    event, getResponse(event.id, interaction.user.id), !interaction.guildId,
  ));
}

async function handleReminderModal(interaction) {
  const event = activeSpecialEvent(interaction);
  if (!event) return replyUnavailable(interaction);

  const result = parseDriverResponse(event, interaction.fields);
  if (!result.ok) {
    await interaction.reply(responseOptions(interaction, result.error));
    return;
  }
  saveResponse({
    eventId: event.id,
    userId: interaction.user.id,
    ...result.response,
  });
  const { days, carClass, availabilityHours } = result.response;
  await interaction.reply({
    ...responseOptions(interaction,
      `Saved for event #${event.id}: ${days} - ${carClass}${availabilityHours ? ` - ${availabilityHours}` : ''}. You can update your answer later.`),
    allowedMentions: { parse: [] },
  });
  await refreshReminderMessages(interaction.client, event);
  await refreshPrivateMessage(interaction, event);
}

module.exports = { handleReminderButton, handleReminderModal };
