const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { guildIds, defaultTimeZone } = require('../config');
const { getEvent } = require('../db/eventRepository');
const { isOpenForResponses } = require('../domain/eventSchedule');
const { getReminderChannels } = require('../db/reminderChannelRepository');
const { teamLabel } = require('../domain/teams');
const { buildRsvpId, parseRsvpId } = require('./context');
const { MAX_CLASSES, eventClasses, parseDriverResponse } = require('../domain/rsvp');
const { buildRsvpForm } = require('../ui/rsvpForm');
const {
  getResponse,
  getReminderMessages,
  getChannelReminderEvents,
  removeReminderMessage,
  recordReminderAuthor,
  getEventResponses,
  saveResponse,
} = require('./repository');
const { buildReminderMessage, buildPrivateReminderMessage } = require('./messages');
const { getReminderEvent } = require('./eventContext');
const { requestPrivateReminder } = require('./private');

function activeResponseEvent(interaction) {
  const context = parseRsvpId(interaction.customId, interaction.guildId);
  if (!context || !guildIds.includes(context.guildId)) return null;
  const { eventId, guildId } = context;
  const event = getEvent({ eventId, guildId });
  if (!event || !isOpenForResponses(event)) return null;
  const previous = getResponse(eventId, interaction.user.id);
  if (interaction.guildId) {
    const configured = getReminderChannels(guildId).find(({ key }) => key === interaction.channelId);
    const posted = getReminderMessages(eventId).find(({ channel_id }) => channel_id === interaction.channelId);
    const channelTeam = configured?.team ?? posted?.team ?? '';
    // A prompt or modal opened before reassignment must not change the new team's roster.
    if (context.team !== undefined && context.team !== channelTeam
      && !(channelTeam === '' && context.team === previous?.team)) return null;
    context.team = channelTeam || previous?.team || '';
  } else {
    // DMs edit the one existing signup, even if it moved teams since the DM was sent.
    context.team = previous ? previous.team : context.team || '';
  }
  return { ...context, event, previous };
}

function responseOptions(interaction, content) {
  return { content, ...(interaction.guildId ? { flags: MessageFlags.Ephemeral } : {}) };
}

async function replyUnavailable(interaction) {
  await interaction.reply(responseOptions(interaction,
    'This event or league is no longer available for responses.'));
}

async function handlePrivateReminderRequest(interaction, { event, previous, team }) {
  const result = requestPrivateReminder(event, interaction.user.id, undefined, previous?.team ?? team);
  await interaction.reply(responseOptions(interaction, result.ok
    ? `I will DM you tomorrow at or shortly after 09:00 (${defaultTimeZone}).`
    : result.error));
}

async function refreshReminderMessages(client, event, channelId) {
  const reminderEvent = getReminderEvent(event);
  const channels = getReminderChannels(event.guild_id);
  const result = { failures: 0, skippedForeign: 0 };
  const botId = client.user?.id;
  for (const reminder of getReminderMessages(event.id)) {
    if (channelId && reminder.channel_id !== channelId) continue;
    // Keep delivery history for deduplication, even when another bot owns the post.
    if (botId && reminder.author_id && reminder.author_id !== botId) {
      result.skippedForeign++;
      continue;
    }
    const team = channels.find(({ key }) => key === reminder.channel_id)?.team ?? reminder.team;
    try {
      const channel = await client.channels.fetch(reminder.channel_id);
      const message = await channel.messages.fetch(reminder.message_id);
      const authorId = message.author?.id;
      if (authorId && authorId !== reminder.author_id) {
        recordReminderAuthor({
          eventId: event.id,
          startsAt: reminder.starts_at,
          leadDays: reminder.lead_days,
          channelId: reminder.channel_id,
          messageId: reminder.message_id,
          authorId,
        });
      }
      if (botId && authorId && authorId !== botId) {
        result.skippedForeign++;
        continue;
      }
      await message.edit(buildReminderMessage(
        reminderEvent, reminder.lead_days, getEventResponses(event.id), team,
      ));
    } catch (error) {
      if (error.code === 10008) {
        removeReminderMessage({
          eventId: event.id,
          startsAt: reminder.starts_at,
          leadDays: reminder.lead_days,
          channelId: reminder.channel_id,
          messageId: reminder.message_id,
        });
        continue;
      }
      if (error.code === 50005) {
        result.skippedForeign++;
        continue;
      }
      result.failures++;
      console.error('Could not refresh reminder:', {
        eventId: event.id,
        channelId: reminder.channel_id,
        messageId: reminder.message_id,
        code: error.code,
        message: error.message,
      });
    }
  }
  return result;
}

async function refreshChannelReminderMessages(client, guildId, channelId) {
  const result = { failures: 0, skippedForeign: 0 };
  for (const event of getChannelReminderEvents(guildId, channelId)) {
    const refreshed = await refreshReminderMessages(client, event, channelId);
    result.failures += refreshed.failures;
    result.skippedForeign += refreshed.skippedForeign;
  }
  return result;
}

async function refreshPrivateMessage(interaction, event) {
  if (interaction.guildId || !interaction.message?.edit) return;
  try {
    await interaction.message.edit(buildPrivateReminderMessage(
      getReminderEvent(event), getResponse(event.id, interaction.user.id),
    ));
  } catch (error) {
    console.error(`Could not refresh private reminder for event #${event.id}:`, error);
  }
}

function teamName(team) {
  return teamLabel(team).replace(/ team$/, '');
}

async function confirmTeamChange(interaction, { event, previous, team }, action) {
  const context = { team, fromTeam: previous.team };
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildRsvpId(`confirm_${action}`, event, context))
      .setLabel(`Change to ${teamName(team)}`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildRsvpId('keep_team', event, context))
      .setLabel(`Keep ${teamName(previous.team)}`)
      .setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({
    ...responseOptions(interaction,
      `You are already signed up for team: ${teamName(previous.team)}. Do you wish to change to ${teamName(team)}?`),
    components: [buttons],
    allowedMentions: { parse: [] },
  });
}

async function replyChanged(interaction) {
  return interaction.reply(responseOptions(interaction,
    'Your team signup changed while this form or prompt was open. Please use the reminder buttons again.'));
}

async function handleReminderButton(interaction) {
  const context = activeResponseEvent(interaction);
  if (!context) return replyUnavailable(interaction);
  const { event, previous, team, fromTeam } = context;
  let { action } = context;

  if (action === 'keep_team') {
    return interaction.update({ content: 'Your signup has not been changed.', components: [] });
  }
  if (action === 'confirm_yes' || action === 'confirm_no') {
    if (fromTeam === undefined || previous?.team !== fromTeam) return replyChanged(interaction);
    action = action.slice('confirm_'.length);
  } else if ((action === 'yes' || action === 'no') && previous && previous.team !== team) {
    return confirmTeamChange(interaction, context, action);
  }

  if (event.event_type === 'league' && (action === 'yes' || action === 'no')) {
    saveResponse({
      eventId: event.id, userId: interaction.user.id, attending: action === 'yes' ? 1 : 0,
      days: null, carClass: null, availabilityHours: null, team,
    });
    await interaction.reply(responseOptions(interaction,
      `Saved: you are ${action === 'yes' ? 'interested' : 'not interested'} in this league. You can change your answer later.`));
    await refreshReminderMessages(interaction.client, event);
    await refreshPrivateMessage(interaction, event);
    return;
  }

  switch (action) {
    case 'no':
      saveResponse({
        eventId: event.id,
        userId: interaction.user.id,
        attending: 0,
        days: null,
        carClass: null,
        availabilityHours: null,
        team,
      });
      await interaction.reply(responseOptions(interaction,
        'Saved: you are not driving this event. You can change your answer later.'));
      await refreshReminderMessages(interaction.client, event);
      await refreshPrivateMessage(interaction, event);
      return;
    case 'yes':
      break;
    case 'remind_me_again':
      return handlePrivateReminderRequest(interaction, context);
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
    event, previous, !interaction.guildId, { team, fromTeam },
  ));
}

async function handleReminderModal(interaction) {
  const context = activeResponseEvent(interaction);
  if (!context || context.event.event_type !== 'special_event' || context.action !== 'submit') return replyUnavailable(interaction);
  const { event, previous, team, fromTeam } = context;
  if (fromTeam !== undefined ? previous?.team !== fromTeam : previous && previous.team !== team) {
    return replyChanged(interaction);
  }

  const result = parseDriverResponse(event, interaction.fields);
  if (!result.ok) {
    await interaction.reply(responseOptions(interaction, result.error));
    return;
  }
  saveResponse({
    eventId: event.id,
    userId: interaction.user.id,
    team,
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

module.exports = { handleReminderButton, handleReminderModal, refreshChannelReminderMessages, refreshReminderMessages };
