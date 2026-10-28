const { DateTime } = require('luxon');
const { defaultTimeZone } = require('../config');

const INPUT_FORMAT = 'dd.MM.yyyy HH:mm';
const DATE_ONLY_FORMAT = 'dd.MM.yyyy';

function parseEventDateTime(input, { allowPast = false } = {}) {
  const trimmed = input.trim();
  const range = trimmed.split(/\s+to\s+/i);
  const dateOnly = /^\d{2}\.\d{2}\.\d{4}$/.test(range[0]);
  const validShape = range.length <= 2 && (dateOnly
    ? range.every((date) => /^\d{2}\.\d{2}\.\d{4}$/.test(date))
    : range.length === 1 && /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/.test(trimmed));
  const options = {
    zone: defaultTimeZone,
    setZone: true,
  };
  const dateTime = validShape
    ? DateTime.fromFormat(range[0], dateOnly ? DATE_ONLY_FORMAT : INPUT_FORMAT, options)
    : null;
  const endDate = validShape && range.length === 2
    ? DateTime.fromFormat(range[1], DATE_ONLY_FORMAT, options)
    : null;

  if (!dateTime?.isValid || (endDate && !endDate.isValid)) {
    return {
      ok: false,
      error: `Use DD.MM.YYYY, DD.MM.YYYY HH:mm, or DD.MM.YYYY to DD.MM.YYYY. Timezone: ${defaultTimeZone}.`,
    };
  }

  const unix = Math.floor(dateTime.toSeconds());
  const dateOnlyUntil = dateOnly ? Math.floor((endDate ?? dateTime).endOf('day').toSeconds()) : null;

  if (dateOnlyUntil !== null && dateOnlyUntil < unix) {
    return { ok: false, error: 'The end date must be on or after the start date.' };
  }

  if (!allowPast && (dateOnlyUntil ?? unix) <= Math.floor(Date.now() / 1000)) {
    return {
      ok: false,
      error: 'The event date or start time must be in the future.',
    };
  }

  return { ok: true, unix, dateOnlyUntil };
}

function parseLeagueDateRange(input, options) {
  const value = input.trim();
  if (!value) return { ok: true, unix: null, dateOnlyUntil: null };
  if (!/^\d{2}\.\d{2}\.\d{4}(?:\s+to\s+\d{2}\.\d{2}\.\d{4})?$/i.test(value)) {
    return { ok: false, error: 'Use DD.MM.YYYY to DD.MM.YYYY, or leave the league dates blank.' };
  }
  return parseEventDateTime(value, options);
}

function discordTimestamp(unix, dateOnlyUntil = null) {
  if (unix == null) return 'Dates to be announced';
  if (dateOnlyUntil === null) return `<t:${unix}:F> (<t:${unix}:R>)`;

  const start = DateTime.fromSeconds(unix, { zone: defaultTimeZone }).toFormat(DATE_ONLY_FORMAT);
  const end = DateTime.fromSeconds(dateOnlyUntil, { zone: defaultTimeZone }).toFormat(DATE_ONLY_FORMAT);
  return start === end ? start : `${start} to ${end}`;
}

module.exports = {
  INPUT_FORMAT,
  parseEventDateTime,
  parseLeagueDateRange,
  discordTimestamp,
};
