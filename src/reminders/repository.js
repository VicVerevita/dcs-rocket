const db = require('../db/database');

const upcomingEvents = db.prepare(`
  SELECT id, guild_id, game, title, starts_at, date_only_until,
         track, car_class, details
  FROM events
  WHERE event_type = 'special_event'
    AND status = 'scheduled'
    AND starts_at > ?
  ORDER BY starts_at
`);

const sentReminder = db.prepare(`
  SELECT 1 FROM special_event_reminders
  WHERE event_id = ? AND starts_at = ? AND lead_days = ?
`);

const insertReminder = db.prepare(`
  INSERT OR IGNORE INTO special_event_reminders
    (event_id, starts_at, lead_days, channel_id, message_id, sent_at)
  VALUES (@eventId, @startsAt, @leadDays, @channelId, @messageId, @sentAt)
`);

const existingResponse = db.prepare(`
  SELECT attending, days, car_class
  FROM special_event_responses
  WHERE event_id = ? AND user_id = ?
`);

const upsertResponse = db.prepare(`
  INSERT INTO special_event_responses
    (event_id, user_id, attending, days, car_class, updated_at)
  VALUES (@eventId, @userId, @attending, @days, @carClass, @updatedAt)
  ON CONFLICT(event_id, user_id) DO UPDATE SET
    attending = excluded.attending,
    days = excluded.days,
    car_class = excluded.car_class,
    updated_at = excluded.updated_at
`);

function getUpcomingSpecialEvents(now) {
  return upcomingEvents.all(now);
}

function wasReminderSent(eventId, startsAt, leadDays) {
  return !!sentReminder.get(eventId, startsAt, leadDays);
}

function recordReminder(reminder) {
  insertReminder.run(reminder);
}

function getResponse(eventId, userId) {
  return existingResponse.get(eventId, userId);
}

function saveResponse(response) {
  upsertResponse.run({ ...response, updatedAt: Math.floor(Date.now() / 1000) });
}

module.exports = {
  getUpcomingSpecialEvents,
  wasReminderSent,
  recordReminder,
  getResponse,
  saveResponse,
};
