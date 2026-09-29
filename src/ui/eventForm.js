const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { DateTime } = require('luxon');
const { defaultTimeZone } = require('../config');
const { INPUT_FORMAT } = require('../utils/time');

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
  const start = DateTime.fromSeconds(event.starts_at, { zone: defaultTimeZone });
  if (event.date_only_until == null) return start.toFormat(INPUT_FORMAT);
  const end = DateTime.fromSeconds(event.date_only_until, { zone: defaultTimeZone });
  const startDate = start.toFormat('dd.MM.yyyy');
  const endDate = end.toFormat('dd.MM.yyyy');
  return startDate === endDate ? startDate : `${startDate} to ${endDate}`;
}

function buildEventForm({ game, eventType, event }) {
  const editing = Boolean(event);
  return new ModalBuilder()
    .setCustomId(editing ? `edit-event:${event.id}` : `add-event:${game}:${eventType}`)
    .setTitle(editing ? `Edit Event #${event.id}` : 'Add racing event')
    .addComponents(
      field('title', 'Event name', 'GT3 Sprint at Spa', true, 100, TextInputStyle.Short, event?.title),
      field('start', `Date, time or range — ${defaultTimeZone}`,
        '03.10.2026 10:00 or 03.10.2026 to 05.10.2026', true, 27,
        TextInputStyle.Short, event ? eventDateValue(event) : null),
      field('track', 'Track', 'Spa-Francorchamps', true, 100, TextInputStyle.Short, event?.track),
      field('carClass', 'Car classes, comma separated', 'GT3, Hypercar, Mazda MX-5', false, 100,
        TextInputStyle.Short, event?.car_class),
      field('details', 'Details / signup link', 'Race length, signup link, special rules', false, 1000,
        TextInputStyle.Paragraph, event?.details),
    );
}

module.exports = { buildEventForm, eventDateValue };
