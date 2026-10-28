const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { DateTime } = require('luxon');
const { defaultTimeZone } = require('../config');
const { INPUT_FORMAT } = require('../utils/time');

function field(id, label, placeholder, required, maxLength, value, paragraph = false) {
  const input = new TextInputBuilder()
    .setCustomId(id).setLabel(label).setPlaceholder(placeholder)
    .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(required).setMaxLength(maxLength);
  if (value) input.setValue(value);
  return new ActionRowBuilder().addComponents(input);
}

function buildRaceForm({ leagueId, tierId, tierName, race }) {
  const tierContext = tierId == null ? '' : `:${tierId}`;
  const title = race ? `Edit Race #${race.id}` : `Add race to League #${leagueId}`;
  return new ModalBuilder()
    .setCustomId(`${race ? `edit-race:${race.id}` : `add-race:${leagueId}`}${tierContext}`)
    .setTitle(`${title}${tierName ? ` - ${tierName}` : ''}`.slice(0, 45))
    .addComponents(
      field('title', 'Race name / round', 'Round 1 - Spa', true, 100, race?.title),
      field('start', 'Race start - date and time', `DD.MM.YYYY HH:mm (${defaultTimeZone})`, true, 16,
        race ? DateTime.fromSeconds(race.starts_at, { zone: defaultTimeZone }).toFormat(INPUT_FORMAT) : null),
      field('track', 'Track', 'Spa-Francorchamps', true, 100, race?.track),
      field('qualifying', 'Qualifying details', 'Start time, duration, format, session rules', false, 1000,
        race?.qualifying, true),
      field('details', 'Race details / signup link', 'Race length, rules, signup link', false, 1000,
        race?.details, true),
    );
}

module.exports = { buildRaceForm };
