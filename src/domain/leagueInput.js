const { parseEventDateTime } = require('../utils/time');

const MAX_LEAGUE_TIERS = 20;
const prequalificationChoices = [
  { name: 'Pre-qualification race', value: 'race' },
  { name: 'Signup period', value: 'signup' },
];

function isPrequalificationKind(kind) {
  return prequalificationChoices.some(({ value }) => value === kind);
}

function tierNamesForCount(count = 1) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_LEAGUE_TIERS) return null;
  return Array.from({ length: count }, (_, index) => `Tier ${index + 1}`);
}

function tierNameKey(value) {
  return value.trim().normalize('NFC').toLowerCase();
}

function parseTierNames(input, count) {
  const names = input.trim().split(/\r?\n/).map((value) => value.trim());
  if (!tierNamesForCount(count) || names.length !== count || names.some((name) => !name)) {
    return { ok: false, error: `Enter exactly ${count} nonempty tier name${count === 1 ? '' : 's'}, one per line.` };
  }
  if (names.some((name) => name.length > 100)) {
    return { ok: false, error: 'Each tier name must contain at most 100 characters.' };
  }
  if (new Set(names.map(tierNameKey)).size !== names.length) {
    return { ok: false, error: 'Tier names must be unique, ignoring capitalization.' };
  }
  return { ok: true, tierNames: names };
}

function parsePrequalificationFields(fields, kind) {
  if (!isPrequalificationKind(kind)) return { ok: false, error: 'Choose a pre-qualification race or signup period.' };
  const period = fields.getTextInputValue('prequalPeriod').trim();
  const details = fields.getTextInputValue('prequalDetails').trim() || null;
  const parsed = period ? parseEventDateTime(period, { allowPast: true })
    : { ok: true, unix: null, dateOnlyUntil: null };
  if (!parsed.ok) return { ok: false, error: `Pre-qualification: ${parsed.error}` };
  return {
    ok: true,
    prequalification: { kind, startsAt: parsed.unix, dateOnlyUntil: parsed.dateOnlyUntil, details },
  };
}

module.exports = { MAX_LEAGUE_TIERS, prequalificationChoices, isPrequalificationKind, tierNamesForCount, tierNameKey, parseTierNames, parsePrequalificationFields };
