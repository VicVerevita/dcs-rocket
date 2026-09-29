const { DateTime } = require('luxon');
const { defaultTimeZone } = require('../config');
const { getEvent } = require('../db/eventRepository');
const { getReminderChannels, hasReminderChannels } = require('../db/reminderChannelRepository');
const {
  getUpcomingSpecialEvents,
  getEventResponses,
  getReminderRecord,
  getNextEditLeadDays,
  getLatestEditReminder,
  recordReminder,
} = require('./repository');
const { buildReminderMessage } = require('./messages');
const { isLateEvent, isSameLocalDay } = require('./timing');
const { checkPrivateReminders } = require('./private');

const LEAD_DAYS = [7, 3, 1];
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const SEND_HOUR = 9;
const inFlight = new Set();

async function sendReminder(client, event, channelId, leadDays, now) {
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
      event, leadDays, getEventResponses(event.id),
    ));
    recordReminder({
      eventId: event.id,
      startsAt: event.starts_at,
      leadDays,
      channelId,
      messageId: message.id,
      sentAt: Math.floor(now.toSeconds()),
    });
  } catch (error) {
    console.error(`Could not send ${leadDays}-day reminder for event #${event.id} in channel ${channelId}:`, error);
  } finally {
    inFlight.delete(key);
  }
}

async function publishLateReminder(client, eventId, guildId) {
  const event = getEvent({ eventId, guildId });
  const now = DateTime.now().setZone(defaultTimeZone);
  if (!event || event.event_type !== 'special_event' || event.status !== 'scheduled'
    || !isLateEvent(event) || now.toSeconds() >= event.starts_at) return;

  for (const channel of getReminderChannels(guildId)) {
    if (channel.game && channel.game !== event.game) continue;
    const channelId = channel.key;
    if (LEAD_DAYS.some((days) => getReminderRecord(event.id, event.starts_at, days, channelId))) continue;
    await sendReminder(client, event, channelId, 7, now);
  }
}

async function publishEditedReminder(client, eventId, guildId) {
  const event = getEvent({ eventId, guildId });
  const now = DateTime.now().setZone(defaultTimeZone);
  if (!event || event.event_type !== 'special_event' || event.status !== 'scheduled'
    || now.toSeconds() >= (event.date_only_until ?? event.starts_at)) return;

  for (const channel of getReminderChannels(guildId)) {
    if (channel.game && channel.game !== event.game) continue;
    const leadDays = getNextEditLeadDays(event.id, event.starts_at, channel.key);
    await sendReminder(client, event, channel.key, leadDays, now);
  }
}

async function checkReminders(client, now = DateTime.now().setZone(defaultTimeZone)) {
  if (!now.isValid) throw new Error(`Invalid reminder timezone: ${defaultTimeZone}`);
  const today = now.toISODate();

  for (const event of getUpcomingSpecialEvents(Math.floor(now.toSeconds()))) {
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
        await sendReminder(client, event, channelId, 7, now);
      }
      if (now.hour < SEND_HOUR) continue;

      const firstPost = getReminderRecord(event.id, event.starts_at, 7, channelId);
      const announcedToday = late && firstPost && isSameLocalDay(firstPost.sent_at, now);
      for (const leadDays of LEAD_DAYS) {
        if (eventDay.minus({ days: leadDays }).toISODate() !== today) continue;
        if (editAnnouncement && isSameLocalDay(editAnnouncement, now)) continue;
        if (announcedToday && leadDays !== 7) continue;
        await sendReminder(client, event, channelId, leadDays, now);
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
