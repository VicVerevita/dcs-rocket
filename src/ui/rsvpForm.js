const {
  CheckboxGroupBuilder,
  CheckboxGroupOptionBuilder,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { DAYS, eventClasses, selectedValues } = require('../domain/rsvp');
const { buildRsvpId } = require('../reminders/context');
const { teamLabel } = require('../domain/teams');

function checkboxField(id, label, options, selected) {
  const group = new CheckboxGroupBuilder()
    .setCustomId(id)
    .setOptions(options.map((value) => new CheckboxGroupOptionBuilder()
      .setLabel(value)
      .setValue(value)
      .setDefault(selected.includes(value))))
    .setMinValues(1)
    .setMaxValues(options.length)
    .setRequired(true);
  return new LabelBuilder().setLabel(label).setCheckboxGroupComponent(group);
}

function buildRsvpForm(event, previous, privateMessage = false, context = {}) {
  const classes = eventClasses(event);
  const classField = checkboxField(
    'carClass', 'Car classes', classes,
    previous?.attending ? selectedValues(previous.car_class) : [],
  );
  let scheduleField;
  if (event.game === 'iracing') {
    const input = new TextInputBuilder()
      .setCustomId('availabilityHours')
      .setPlaceholder('10:00, 14:00, or both')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(60)
      .setRequired(true);
    if (previous?.attending && previous.availability_hours) {
      input.setValue(previous.availability_hours);
    }
    scheduleField = new LabelBuilder()
      .setLabel('Saturday availability hours')
      .setTextInputComponent(input);
  } else {
    scheduleField = checkboxField(
      'days', 'Driving days', DAYS,
      previous?.attending ? selectedValues(previous.days) : [],
    );
  }
  return new ModalBuilder()
    .setCustomId(buildRsvpId('submit', event, { ...context, privateMessage }))
    .setTitle(context.team ? `${teamLabel(context.team)} driver response` : 'Special event driver response')
    .addLabelComponents(scheduleField, classField);
}

module.exports = { buildRsvpForm };
