const { DateTime } = require('luxon');
const { defaultTimeZone } = require('../config');
const { eventDeadline } = require('./eventSchedule');

function getPrequalificationDeadline(event) {
  const seasonStart = event.starts_at > event.prequal_starts_at ? event.starts_at : null;
  const windowEnd = event.prequal_date_only_until ?? seasonStart;
  const deadlines = [windowEnd, eventDeadline(event)].filter((value) => value != null);
  return deadlines.length ? Math.min(...deadlines) : null;
}

function isPrequalificationOpen(event, now = Math.floor(Date.now() / 1000)) {
  if (event.event_type !== 'league' || event.status !== 'scheduled'
    || !['race', 'signup'].includes(event.prequal_kind)
    || !Number.isSafeInteger(event.prequal_starts_at) || now < event.prequal_starts_at) return false;
  const deadline = getPrequalificationDeadline(event);
  return deadline === null || now < deadline;
}

function nextPrequalificationReminderAt(now = DateTime.now().setZone(defaultTimeZone)) {
  return Math.floor(now.setZone(defaultTimeZone).plus({ days: 3 }).toSeconds());
}

module.exports = { getPrequalificationDeadline, isPrequalificationOpen, nextPrequalificationReminderAt };
