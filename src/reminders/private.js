const { DateTime } = require('luxon');
const { defaultTimeZone, guildIds } = require('../config');
const {
  getPendingPrivateReminders,
  getResponse,
  recordPrivateReminderSent,
  schedulePrivateReminder,
} = require('./repository');
const { buildPrivateReminderMessage } = require('./messages');

const inFlight = new Set();

function nextPrivateReminderAt(now = DateTime.now().setZone(defaultTimeZone)) {
  return Math.floor(now.plus({ days: 1 }).startOf('day').set({ hour: 9 }).toSeconds());
}

function requestPrivateReminder(event, userId, now = DateTime.now().setZone(defaultTimeZone), team = '') {
  const remindAt = nextPrivateReminderAt(now);
  if (remindAt >= (event.date_only_until ?? event.starts_at)) {
    return { ok: false, error: 'This event ends before tomorrow at 09:00, so a next-day reminder is unavailable.' };
  }
  schedulePrivateReminder({
    eventId: event.id,
    userId,
    remindAt,
    requestedAt: Date.now(),
    team,
  });
  return { ok: true, remindAt };
}

async function checkPrivateReminders(client, now = DateTime.now().setZone(defaultTimeZone)) {
  const nowSeconds = Math.floor(now.toSeconds());
  for (const reminder of getPendingPrivateReminders(nowSeconds)) {
    if (!guildIds.includes(reminder.guild_id)) continue;
    const key = `${reminder.event_id}:${reminder.user_id}:${reminder.requested_at}`;
    if (inFlight.has(key)) continue;
    inFlight.add(key);
    try {
      if (nowSeconds < (reminder.date_only_until ?? reminder.starts_at)) {
        const user = await client.users.fetch(reminder.user_id);
        const response = getResponse(reminder.event_id, reminder.user_id);
        await user.send(buildPrivateReminderMessage(
          { ...reminder, id: reminder.event_id },
          response,
          response ? response.team : reminder.team,
        ));
      }
      recordPrivateReminderSent({
        eventId: reminder.event_id,
        userId: reminder.user_id,
        requestedAt: reminder.requested_at,
        sentAt: nowSeconds,
      });
    } catch (error) {
      console.error(`Could not DM reminder for event #${reminder.event_id} to user ${reminder.user_id}:`, error);
    } finally {
      inFlight.delete(key);
    }
  }
}

module.exports = { nextPrivateReminderAt, requestPrivateReminder, checkPrivateReminders };
