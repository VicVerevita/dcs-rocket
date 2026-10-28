const { parseEventDateTime, parseLeagueDateRange } = require('../utils/time');
const { MAX_CLASSES } = require('./rsvp');
const { parsePrequalificationFields } = require('./leagueInput');

function parseEventFields(fields, eventType, existing, options = {}) {
  const league = eventType === 'league';
  const kind = league ? (Object.hasOwn(options, 'prequalificationKind') ? options.prequalificationKind : existing?.prequal_kind) : null;
  const title = fields.getTextInputValue('title').trim();
  const track = kind ? existing?.track ?? '' : fields.getTextInputValue('track').trim();
  const details = fields.getTextInputValue('details').trim() || null;
  const carClass = kind ? existing?.car_class ?? null : fields.getTextInputValue('carClass').trim() || null;
  const parseDate = league ? parseLeagueDateRange : parseEventDateTime;
  const dateInput = fields.getTextInputValue('start');
  let parsedStart = parseDate(dateInput, { allowPast: Boolean(existing) });
  // Leagues created before season support may have a single exact start time.
  // Keep that value editable until staff replace it with season dates.
  if (!parsedStart.ok && league && existing?.starts_at != null && existing.date_only_until == null) {
    const legacyStart = parseEventDateTime(dateInput, { allowPast: true });
    if (legacyStart.ok && legacyStart.unix === existing.starts_at && legacyStart.dateOnlyUntil === null) {
      parsedStart = legacyStart;
    }
  }
  if (!parsedStart.ok) return { ok: false, error: parsedStart.error };
  if (!title || (!league && !track)) {
    return { ok: false, error: league ? 'League name is required.' : 'Event name and track are required.' };
  }
  const unchangedDate = existing && parsedStart.unix === existing.starts_at
    && parsedStart.dateOnlyUntil === existing.date_only_until;
  if (parsedStart.unix !== null && !unchangedDate
    && (parsedStart.dateOnlyUntil ?? parsedStart.unix) <= Math.floor(Date.now() / 1000)) {
    return { ok: false, error: 'The event date or start time must be in the future.' };
  }

  const classes = carClass
    ? [...new Set(carClass.split(',').map((value) => value.trim()).filter(Boolean))]
    : [];
  if (classes.length > MAX_CLASSES) {
    return { ok: false, error: `Use at most ${MAX_CLASSES} car classes.` };
  }
  if (eventType === 'special_event' && classes.length === 0) {
    return { ok: false, error: 'Special events need at least one car class for driver responses.' };
  }
  const prequalification = kind ? parsePrequalificationFields(fields, kind) : null;
  if (prequalification && !prequalification.ok) return prequalification;
  return {
    ok: true,
    event: {
      title,
      startsAt: parsedStart.unix,
      dateOnlyUntil: parsedStart.dateOnlyUntil,
      track,
      carClass: classes.length ? classes.join(', ') : null,
      details,
      ...(prequalification ? { prequalification: prequalification.prequalification } : {}),
    },
  };
}

module.exports = { parseEventFields };
