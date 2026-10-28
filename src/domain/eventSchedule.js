// Leagues stay open throughout their season, including when dates are not set.
function eventDeadline(event) {
  return event.date_only_until ?? event.starts_at ?? null;
}

function supportsResponses(event) {
  return event.event_type === 'special_event' || event.event_type === 'league';
}

function isOpenForResponses(event, now = Math.floor(Date.now() / 1000)) {
  const deadline = eventDeadline(event);
  return supportsResponses(event) && event.status === 'scheduled'
    && (deadline === null || deadline > now);
}

function reminderStartKey(event) {
  // Delivery history needs a stable, non-null key even for undated leagues.
  return event.starts_at ?? 0;
}

module.exports = { eventDeadline, supportsResponses, isOpenForResponses, reminderStartKey };
