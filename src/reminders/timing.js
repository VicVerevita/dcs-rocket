const { DateTime } = require('luxon');
const { defaultTimeZone } = require('../config');

function isLateEvent(event) {
  const start = DateTime.fromSeconds(event.starts_at, { zone: defaultTimeZone });
  return event.created_at > Math.floor(start.minus({ days: 7 }).toSeconds());
}

function isSameLocalDay(unix, dateTime) {
  return DateTime.fromSeconds(unix, { zone: defaultTimeZone }).toISODate() === dateTime.toISODate();
}

module.exports = { isLateEvent, isSameLocalDay };
