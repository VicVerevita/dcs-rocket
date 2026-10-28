const { DateTime } = require('luxon');
const { defaultTimeZone } = require('../config');
const { INPUT_FORMAT } = require('../utils/time');

function parseRaceFields(fields, existing) {
  const title = fields.getTextInputValue('title').trim();
  const input = fields.getTextInputValue('start').trim();
  const track = fields.getTextInputValue('track').trim();
  const qualifying = fields.getTextInputValue('qualifying').trim() || null;
  const details = fields.getTextInputValue('details').trim() || null;
  if (!title || !track) return { ok: false, error: 'Race name and track are required.' };
  if (title.length > 100 || track.length > 100 || (qualifying?.length ?? 0) > 1000
    || (details?.length ?? 0) > 1000) {
    return { ok: false, error: 'Keep the name and track within 100 characters, and qualifying and details within 1000.' };
  }
  const start = /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/.test(input)
    ? DateTime.fromFormat(input, INPUT_FORMAT, { zone: defaultTimeZone, setZone: true })
    : null;
  // Luxon normalizes non-existent clock times during daylight-saving changes.
  if (!start?.isValid || start.toFormat(INPUT_FORMAT) !== input) {
    return { ok: false, error: `Use DD.MM.YYYY HH:mm for the race start. Timezone: ${defaultTimeZone}.` };
  }
  const startsAt = Math.floor(start.toSeconds());
  if (startsAt <= Math.floor(Date.now() / 1000) && startsAt !== existing?.starts_at) {
    return { ok: false, error: 'The race start time must be in the future.' };
  }
  return { ok: true, race: { title, startsAt, track, qualifying, details } };
}

module.exports = { parseRaceFields };
