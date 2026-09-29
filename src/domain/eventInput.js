const { parseEventDateTime } = require('../utils/time');
const { MAX_CLASSES } = require('./rsvp');

function parseEventFields(fields, eventType) {
  const title = fields.getTextInputValue('title').trim();
  const track = fields.getTextInputValue('track').trim();
  const details = fields.getTextInputValue('details').trim() || null;
  const carClass = fields.getTextInputValue('carClass').trim() || null;
  const parsedStart = parseEventDateTime(fields.getTextInputValue('start'));
  if (!parsedStart.ok) return { ok: false, error: parsedStart.error };
  if (!title || !track) return { ok: false, error: 'Event name and track are required.' };

  const classes = carClass
    ? [...new Set(carClass.split(',').map((value) => value.trim()).filter(Boolean))]
    : [];
  if (classes.length > MAX_CLASSES) {
    return { ok: false, error: `Use at most ${MAX_CLASSES} car classes.` };
  }
  if (eventType === 'special_event' && classes.length === 0) {
    return { ok: false, error: 'Special events need at least one car class for driver responses.' };
  }
  return {
    ok: true,
    event: {
      title,
      startsAt: parsedStart.unix,
      dateOnlyUntil: parsedStart.dateOnlyUntil,
      track,
      carClass: classes.length ? classes.join(', ') : null,
      details,
    },
  };
}

module.exports = { parseEventFields };
