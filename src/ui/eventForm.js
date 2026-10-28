const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { DateTime } = require('luxon');
const { defaultTimeZone } = require('../config');
const { INPUT_FORMAT } = require('../utils/time');
const { prequalificationFields } = require('./leaguePrequalificationForm');

function field(id, label, placeholder, required, maxLength, style = TextInputStyle.Short, value) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setPlaceholder(placeholder)
    .setStyle(style)
    .setMaxLength(maxLength)
    .setRequired(required);
  if (value) input.setValue(value);
  return new ActionRowBuilder().addComponents(input);
}

function eventDateValue(event) {
  if (event.starts_at == null) return '';
  const start = DateTime.fromSeconds(event.starts_at, { zone: defaultTimeZone });
  if (event.date_only_until == null) return start.toFormat(INPUT_FORMAT);
  const end = DateTime.fromSeconds(event.date_only_until, { zone: defaultTimeZone });
  const startDate = start.toFormat('dd.MM.yyyy');
  const endDate = end.toFormat('dd.MM.yyyy');
  return startDate === endDate ? startDate : `${startDate} to ${endDate}`;
}

function buildEventForm({ game, eventType, event, tiers = 1, prequalificationKind, draftId }) {
  const editing = Boolean(event);
  const league = (event?.event_type ?? eventType) === 'league';
  const kind = league ? (prequalificationKind ?? event?.prequal_kind) : null;
  const customId = editing ? `edit-event:${event.id}${kind ? `:${kind}` : ''}`
    : draftId ? `add-event:draft:${draftId}`
      : league ? `add-event:${game}:league:${tiers}:${kind || 'none'}` : `add-event:${game}:${eventType}`;
  const form = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(editing ? `Edit ${league ? 'League' : 'Event'} #${event.id}` : league ? 'Add racing league' : 'Add racing event')
    .addComponents(
      field('title', league ? 'League name' : 'Event name', league ? 'GT3 Winter Championship' : 'GT3 Sprint at Spa',
        true, 100, TextInputStyle.Short, event?.title),
      field('start', league ? 'Season dates (optional)' : `Date, time or range - ${defaultTimeZone}`,
        league ? '03.10.2026 to 05.12.2026, or leave blank' : '03.10.2026 10:00 or 03.10.2026 to 05.10.2026', !league, 27,
        TextInputStyle.Short, event ? eventDateValue(event) : null),
    );
  if (kind) form.addComponents(...prequalificationFields({ kind, league: event }));
  else form.addComponents(
      field('track', league ? 'Tracks (optional; races have their own)' : 'Track', 'Spa-Francorchamps', !league, 100,
        TextInputStyle.Short, event?.track),
      field('carClass', 'Car classes, comma separated', 'GT3, Hypercar, Mazda MX-5', false, 100,
        TextInputStyle.Short, event?.car_class),
  );
  return form.addComponents(
      field('details', 'Details / signup link', 'Race length, signup link, special rules', false, 1000,
        TextInputStyle.Paragraph, event?.details),
  );
}

module.exports = { buildEventForm, eventDateValue };
