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
    (event_id, starts_at, lead_days, channel_id, message_id, sent_at, team, author_id)
  VALUES (@eventId, @startsAt, @leadDays, @channelId, @messageId, @sentAt, @team, @authorId)
`);

const reminderMessages = db.prepare(`
  SELECT lead_days, channel_id, message_id, team, starts_at, author_id
  FROM special_event_reminders
  WHERE event_id = @eventId AND (@startsAt IS NULL OR starts_at = @startsAt)
`);

const channelReminderEvents = db.prepare(`
  SELECT DISTINCT e.* FROM events e
  JOIN special_event_reminders r ON r.event_id = e.id
  WHERE e.guild_id = ? AND r.channel_id = ?
`);

const deleteReminderMessage = db.prepare(`
  DELETE FROM special_event_reminders
  WHERE event_id = @eventId AND starts_at = @startsAt
    AND lead_days = @leadDays AND channel_id = @channelId AND message_id = @messageId
`);

const updateReminderAuthor = db.prepare(`
  UPDATE special_event_reminders SET author_id = @authorId
  WHERE event_id = @eventId AND starts_at = @startsAt
    AND lead_days = @leadDays AND channel_id = @channelId AND message_id = @messageId
`);

const upsertPrivateReminder = db.prepare(`
  INSERT INTO special_event_private_reminders
    (event_id, user_id, remind_at, requested_at, sent_at, team)
  VALUES (@eventId, @userId, @remindAt, @requestedAt, NULL, @team)
  ON CONFLICT(event_id, user_id) DO UPDATE SET
    remind_at = excluded.remind_at,
    requested_at = excluded.requested_at,
    sent_at = NULL,
    team = excluded.team
`);

const pendingPrivateReminders = db.prepare(`
  SELECT r.event_id, r.user_id, r.remind_at, r.requested_at, r.team,
         e.guild_id, e.game, e.event_type, e.title, e.starts_at,
         e.date_only_until, e.track, e.car_class, e.details, e.created_at
  FROM special_event_private_reminders r
  JOIN events e ON e.id = r.event_id
  WHERE r.sent_at IS NULL AND r.remind_at <= @now AND e.status = 'scheduled'
    AND e.event_type = 'special_event'
`);

const markPrivateReminderSent = db.prepare(`
  UPDATE special_event_private_reminders
  SET sent_at = @sentAt
  WHERE event_id = @eventId AND user_id = @userId
    AND requested_at = @requestedAt AND sent_at IS NULL
`);

const eventResponses = db.prepare(`
  SELECT user_id, attending, days, car_class, availability_hours, team
  FROM special_event_responses
  WHERE event_id = @eventId AND (@team = '' OR team = @team)
  ORDER BY updated_at, user_id
`);

const existingResponse = db.prepare(`
  SELECT attending, days, car_class, availability_hours, team
  FROM special_event_responses
  WHERE event_id = ? AND user_id = ?
`);

const upsertResponse = db.prepare(`
  INSERT INTO special_event_responses
    (event_id, user_id, attending, days, car_class, availability_hours, updated_at, team)
  VALUES (@eventId, @userId, @attending, @days, @carClass, @availabilityHours, @updatedAt, @team)
  ON CONFLICT(event_id, user_id) DO UPDATE SET
    attending = excluded.attending,
    days = excluded.days,
    car_class = excluded.car_class,
    availability_hours = excluded.availability_hours,
    updated_at = excluded.updated_at,
    team = excluded.team
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
  insertReminder.run({ team: '', authorId: null, ...reminder });
}

function getReminderMessages(eventId, startsAt) {
  return reminderMessages.all({ eventId, startsAt: startsAt ?? null });
}

function getChannelReminderEvents(guildId, channelId) {
  return channelReminderEvents.all(guildId, channelId);
}

function removeReminderMessage({ eventId, startsAt, leadDays, channelId, messageId }) {
  deleteReminderMessage.run({ eventId, startsAt, leadDays, channelId, messageId });
}

function recordReminderAuthor({ eventId, startsAt, leadDays, channelId, messageId, authorId }) {
  updateReminderAuthor.run({ eventId, startsAt, leadDays, channelId, messageId, authorId });
}

function schedulePrivateReminder(reminder) {
  upsertPrivateReminder.run({ team: '', ...reminder });
}

function getPendingPrivateReminders(now) {
  return pendingPrivateReminders.all({ now });
}

function recordPrivateReminderSent({ eventId, userId, requestedAt, sentAt }) {
  markPrivateReminderSent.run({ eventId, userId, requestedAt, sentAt });
}

function getEventResponses(eventId, team = '') {
  return eventResponses.all({ eventId, team });
}

function getResponse(eventId, userId) {
  return existingResponse.get(eventId, userId);
}

function saveResponse(response) {
  const team = response.team ?? getResponse(response.eventId, response.userId)?.team ?? '';
  upsertResponse.run({ ...response, team, updatedAt: Math.floor(Date.now() / 1000) });
}

module.exports = {
  getUpcomingSpecialEvents,
  getReminderRecord,
  getNextEditLeadDays,
  getLatestEditReminder,
  recordReminder,
  getReminderMessages,
  getChannelReminderEvents,
  removeReminderMessage,
  recordReminderAuthor,
  getEventResponses,
  schedulePrivateReminder,
  getPendingPrivateReminders,
  recordPrivateReminderSent,
  getResponse,
  saveResponse,
};
