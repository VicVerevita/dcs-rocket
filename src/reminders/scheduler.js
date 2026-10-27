const { DateTime } = require('luxon');
const { defaultTimeZone, guildIds } = require('../config');
const { getEvent } = require('../db/eventRepository');
const { getReminderChannels, hasReminderChannels } = require('../db/reminderChannelRepository');
const {
  getUpcomingSpecialEvents,
  getEventResponses,
  getReminderMessages,
  getReminderRecord,
  getNextEditLeadDays,
  getLatestEditReminder,
  recordReminder,
  recordReminderAuthor,
  removeReminderMessage,
} = require('./repository');
const { buildReminderMessage } = require('./messages');
const { isLateEvent, isSameLocalDay } = require('./timing');
const { checkPrivateReminders } = require('./private');

const LEAD_DAYS = [7, 3, 1];
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const SEND_HOUR = 9;
const inFlight = new Set();

async function deletePreviousReminders(client, eventId, channel, channelId, messageId) {
  const botId = client.user?.id;
  for (const reminder of getReminderMessages(eventId)) {
    if (reminder.channel_id !== channelId || reminder.message_id === messageId) continue;
    if (botId && reminder.author_id && reminder.author_id !== botId) continue;
    const record = {
      eventId,
      startsAt: reminder.starts_at,
      leadDays: reminder.lead_days,
      channelId,
      messageId: reminder.message_id,
    };
    try {
      const previous = await channel.messages.fetch(reminder.message_id);
      const authorId = previous.author?.id;
      if (authorId && authorId !== reminder.author_id) {
        recordReminderAuthor({ ...record, authorId });
      }
      if (botId && authorId && authorId !== botId) continue;
      await previous.delete();
      removeReminderMessage(record);
    } catch (error) {
      if (error.code === 10008) {
        removeReminderMessage(record);
        continue;
      }
      console.error('Could not delete previous reminder:', {
        eventId,
        channelId,
        messageId: reminder.message_id,
        code: error.code,
        message: error.message,
      });
    }
  }
}

async function sendReminder(client, event, channelId, leadDays, now, team = '') {
  const key = `${event.id}:${event.starts_at}:${leadDays}:${channelId}`;
  if (inFlight.has(key) || getReminderRecord(event.id, event.starts_at, leadDays, channelId)) return;
  inFlight.add(key);
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.guildId !== event.guild_id || !channel.isTextBased()
      || typeof channel.send !== 'function') {
      throw new Error(`Configured channel ${channelId} is not a text channel in guild ${event.guild_id}`);
    }
    const message = await channel.send(buildReminderMessage(
      event, leadDays, getEventResponses(event.id), team,
    ));
    recordReminder({
      eventId: event.id,
      startsAt: event.starts_at,
      leadDays,
      channelId,
      messageId: message.id,
      authorId: message.author?.id ?? client.user?.id ?? null,
      sentAt: Math.floor(now.toSeconds()),
      team,
    });
    await deletePreviousReminders(client, event.id, channel, channelId, message.id);
  } catch (error) {
    console.error(`Could not send ${leadDays}-day reminder for event #${event.id} in channel ${channelId}:`, error);
  } finally {
    inFlight.delete(key);
  }
}

async function publishLateReminder(client, eventId, guildId) {
  if (!guildIds.includes(guildId)) return;
  const event = getEvent({ eventId, guildId });
  const now = DateTime.now().setZone(defaultTimeZone);
  if (!event || event.event_type !== 'special_event' || event.status !== 'scheduled'
    || !isLateEvent(event) || now.toSeconds() >= event.starts_at) return;

  for (const channel of getReminderChannels(guildId)) {
    if (channel.game && channel.game !== event.game) continue;
    const channelId = channel.key;
    if (LEAD_DAYS.some((days) => getReminderRecord(event.id, event.starts_at, days, channelId))) continue;
    await sendReminder(client, event, channelId, 7, now, channel.team);
  }
}

async function publishEditedReminder(client, eventId, guildId) {
  if (!guildIds.includes(guildId)) return;
  const event = getEvent({ eventId, guildId });
  const now = DateTime.now().setZone(defaultTimeZone);
  if (!event || event.event_type !== 'special_event' || event.status !== 'scheduled'
    || now.toSeconds() >= (event.date_only_until ?? event.starts_at)) return;

  for (const channel of getReminderChannels(guildId)) {
    if (channel.game && channel.game !== event.game) continue;
    const leadDays = getNextEditLeadDays(event.id, event.starts_at, channel.key);
    await sendReminder(client, event, channel.key, leadDays, now, channel.team);
  }
}

async function checkReminders(client, now = DateTime.now().setZone(defaultTimeZone)) {
  if (!now.isValid) throw new Error(`Invalid reminder timezone: ${defaultTimeZone}`);
  const today = now.toISODate();

  for (const event of getUpcomingSpecialEvents(Math.floor(now.toSeconds()))) {
    if (!guildIds.includes(event.guild_id)) continue;
    const channels = getReminderChannels(event.guild_id);
    if (channels.length === 0) continue;
    const eventDay = DateTime.fromSeconds(event.starts_at, { zone: defaultTimeZone });
    const late = isLateEvent(event);

    for (const channel of channels) {
      if (channel.game && channel.game !== event.game) continue;
      const channelId = channel.key;
      const editAnnouncement = getLatestEditReminder(event.id, event.starts_at, channelId);
      if (late && !editAnnouncement
        && !LEAD_DAYS.some((days) => getReminderRecord(event.id, event.starts_at, days, channelId))) {
        await sendReminder(client, event, channelId, 7, now, channel.team);
      }
      if (now.hour < SEND_HOUR) continue;

      const firstPost = getReminderRecord(event.id, event.starts_at, 7, channelId);
      const announcedToday = late && firstPost && isSameLocalDay(firstPost.sent_at, now);
      for (const leadDays of LEAD_DAYS) {
        if (eventDay.minus({ days: leadDays }).toISODate() !== today) continue;
        if (editAnnouncement && isSameLocalDay(editAnnouncement, now)) continue;
        if (announcedToday && leadDays !== 7) continue;
        await sendReminder(client, event, channelId, leadDays, now, channel.team);
      }
    }
  }
}

function startReminderScheduler(client) {
  if (!hasReminderChannels()) {
    console.log('Server reminders disabled: no reminder channels configured.');
  }

  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      await checkReminders(client);
    } catch (error) {
      console.error('Special-event reminder check failed:', error);
    }
    try {
      await checkPrivateReminders(client);
    } catch (error) {
      console.error('Private reminder check failed:', error);
    } finally {
      running = false;
    }
  }

  void tick();
  setInterval(tick, CHECK_INTERVAL_MS);
}

module.exports = { checkReminders, publishLateReminder, publishEditedReminder, startReminderScheduler };
