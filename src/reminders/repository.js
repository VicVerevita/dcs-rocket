const db = require('../db/database');

const upcomingEvents = db.prepare(`
  SELECT id, guild_id, game, title, starts_at, date_only_until,
         track, car_class, details, created_at
  FROM events
  WHERE event_type = 'special_event'
    AND status = 'scheduled'
    AND starts_at > ?
  ORDER BY starts_at
`);

const sentReminder = db.prepare(`
  SELECT sent_at FROM special_event_reminders
  WHERE event_id = ? AND starts_at = ? AND lead_days = ? AND channel_id = ?
`);

const latestEditReminder = db.prepare(`
  SELECT MAX(sent_at) AS sent_at
  FROM special_event_reminders
  WHERE event_id = ? AND starts_at = ? AND channel_id = ? AND lead_days < 0
`);

const nextEditLeadDays = db.prepare(`
  SELECT COALESCE(MIN(lead_days), 0) - 1 AS lead_days
  FROM special_event_reminders
  WHERE event_id = ? AND starts_at = ? AND channel_id = ? AND lead_days < 0
`);

const insertReminder = db.prepare(`
  INSERT OR IGNORE INTO special_event_reminders
    (event_id, starts_at, lead_days, channel_id, message_id, sent_at)
  VALUES (@eventId, @startsAt, @leadDays, @channelId, @messageId, @sentAt)
`);

const reminderMessages = db.prepare(`
  SELECT lead_days, channel_id, message_id
  FROM special_event_reminders
  WHERE event_id = ? AND starts_at = ?
`);

const eventResponses = db.prepare(`
  SELECT user_id, attending, days, car_class, availability_hours
  FROM special_event_responses
  WHERE event_id = ?
  ORDER BY updated_at, user_id
`);

const existingResponse = db.prepare(`
  SELECT attending, days, car_class, availability_hours
  FROM special_event_responses
  WHERE event_id = ? AND user_id = ?
`);

const upsertResponse = db.prepare(`
  INSERT INTO special_event_responses
    (event_id, user_id, attending, days, car_class, availability_hours, updated_at)
  VALUES (@eventId, @userId, @attending, @days, @carClass, @availabilityHours, @updatedAt)
  ON CONFLICT(event_id, user_id) DO UPDATE SET
    attending = excluded.attending,
    days = excluded.days,
    car_class = excluded.car_class,
    availability_hours = excluded.availability_hours,
    updated_at = excluded.updated_at
`);

function getUpcomingSpecialEvents(now) {
  return upcomingEvents.all(now);
}

function getReminderRecord(eventId, startsAt, leadDays, channelId) {
  return sentReminder.get(eventId, startsAt, leadDays, channelId);
}

function getLatestEditReminder(eventId, startsAt, channelId) {
  return latestEditReminder.get(eventId, startsAt, channelId).sent_at;
}

function getNextEditLeadDays(eventId, startsAt, channelId) {
  return nextEditLeadDays.get(eventId, startsAt, channelId).lead_days;
}

function recordReminder(reminder) {
  insertReminder.run(reminder);
}

function getReminderMessages(eventId, startsAt) {
  return reminderMessages.all(eventId, startsAt);
}

function getEventResponses(eventId) {
  return eventResponses.all(eventId);
}

function getResponse(eventId, userId) {
  return existingResponse.get(eventId, userId);
}

function saveResponse(response) {
  upsertResponse.run({ ...response, updatedAt: Math.floor(Date.now() / 1000) });
}

module.exports = {
  getUpcomingSpecialEvents,
  getReminderRecord,
  getNextEditLeadDays,
  getLatestEditReminder,
  recordReminder,
  getReminderMessages,
  getEventResponses,
  getResponse,
  saveResponse,
};
