const db = require('../../db/database');

const candidateQuery = db.prepare(`
  SELECT e.*, e.id AS event_id, s.prequal_kind, s.prequal_starts_at,
         s.prequal_date_only_until, s.prequal_details, r.user_id, r.team,
         p.status AS reminder_status, p.last_sent_at, p.next_remind_at,
         p.updated_at AS reminder_updated_at
  FROM events e
  JOIN league_settings s ON s.league_id = e.id
  JOIN special_event_responses r ON r.event_id = e.id AND r.attending = 1
  LEFT JOIN league_prequalification_reminders p
    ON p.event_id = e.id AND p.user_id = r.user_id
  WHERE e.event_type = 'league' AND e.status = 'scheduled'
    AND s.prequal_kind IN ('race', 'signup') AND s.prequal_starts_at IS NOT NULL
    AND (p.event_id IS NULL OR (p.status = 'active'
      AND (p.next_remind_at IS NULL OR p.next_remind_at <= @now)))
  ORDER BY COALESCE(p.next_remind_at, s.prequal_starts_at), e.id, r.user_id
`);

const stateQuery = db.prepare(`
  SELECT event_id, user_id, status, last_sent_at, next_remind_at, updated_at
  FROM league_prequalification_reminders
  WHERE event_id = @eventId AND user_id = @userId
`);

function getPrequalificationCandidates(now) {
  // Whether a dated phase is open is domain policy, applied by the scheduler.
  return candidateQuery.all({ now });
}

function getPrequalificationReminder({ eventId, userId }) {
  return stateQuery.get({ eventId, userId }) ?? null;
}

const ensurePrequalificationReminder = db.transaction(({ eventId, userId, now = Math.floor(Date.now() / 1000) }) => {
  const eligible = db.prepare(`
    SELECT 1 FROM events e
    JOIN league_settings s ON s.league_id = e.id
    JOIN special_event_responses r ON r.event_id = e.id AND r.user_id = @userId
    WHERE e.id = @eventId AND e.event_type = 'league' AND e.status = 'scheduled'
      AND r.attending = 1 AND s.prequal_kind IN ('race', 'signup')
      AND s.prequal_starts_at IS NOT NULL
  `).get({ eventId, userId });
  if (!eligible) return null;
  db.prepare(`
    INSERT OR IGNORE INTO league_prequalification_reminders
      (event_id, user_id, status, updated_at)
    VALUES (@eventId, @userId, 'active', @now)
  `).run({ eventId, userId, now });
  return getPrequalificationReminder({ eventId, userId });
});

function recordPrequalificationReminderSent({ eventId, userId, sentAt, nextRemindAt }) {
  // A response can stop reminders while Discord is sending the DM. Recording
  // delivery must never put such a completed/withdrawn record back into service.
  return db.prepare(`
    UPDATE league_prequalification_reminders
    SET last_sent_at = @sentAt, next_remind_at = @nextRemindAt, updated_at = @sentAt
    WHERE event_id = @eventId AND user_id = @userId AND status = 'active'
      AND (last_sent_at IS NULL OR last_sent_at <= @sentAt)
  `).run({ eventId, userId, sentAt, nextRemindAt }).changes > 0;
}

const stopPrequalificationReminder = db.transaction(({ eventId, guildId, userId, action, now = Math.floor(Date.now() / 1000) }) => {
  if (action !== 'done' && action !== 'withdraw') {
    return { ok: false, error: 'That pre-qualification response is invalid.' };
  }
  const event = db.prepare(`
    SELECT e.*, s.prequal_kind, s.prequal_starts_at, s.prequal_date_only_until, s.prequal_details
    FROM events e LEFT JOIN league_settings s ON s.league_id = e.id
    WHERE e.id = @eventId AND e.guild_id = @guildId AND e.event_type = 'league'
  `).get({ eventId, guildId });
  if (!event || event.status !== 'scheduled') {
    return { ok: false, error: 'This league is no longer available.' };
  }
  const state = getPrequalificationReminder({ eventId, userId });
  if (!state) return { ok: false, error: 'This pre-qualification reminder is no longer available.' };
  if (state.status !== 'active') {
    return { ok: true, event, status: state.status, changed: false, alreadyStopped: true };
  }
  const response = db.prepare(`
    SELECT attending FROM special_event_responses WHERE event_id = @eventId AND user_id = @userId
  `).get({ eventId, userId });
  if (!response?.attending) return { ok: false, error: 'You are no longer interested in this league.' };
  const status = action === 'done' ? 'completed' : 'withdrawn';
  db.prepare(`
    UPDATE league_prequalification_reminders
    SET status = @status, next_remind_at = NULL, updated_at = @now
    WHERE event_id = @eventId AND user_id = @userId AND status = 'active'
  `).run({ eventId, userId, status, now });
  if (action === 'withdraw') {
    db.prepare(`
      UPDATE special_event_responses
      SET attending = 0, days = NULL, car_class = NULL, availability_hours = NULL, updated_at = @now
      WHERE event_id = @eventId AND user_id = @userId
    `).run({ eventId, userId, now });
  }
  return { ok: true, event, status, changed: true, alreadyStopped: false };
});

module.exports = {
  getPrequalificationCandidates,
  ensurePrequalificationReminder,
  getPrequalificationReminder,
  recordPrequalificationReminderSent,
  stopPrequalificationReminder,
};
