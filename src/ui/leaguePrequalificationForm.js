const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { DateTime } = require('luxon');
const { defaultTimeZone } = require('../config');
const { INPUT_FORMAT } = require('../utils/time');

function prequalificationDateValue(league) {
  if (league?.prequal_starts_at == null) return '';
  const start = DateTime.fromSeconds(league.prequal_starts_at, { zone: defaultTimeZone });
  if (league.prequal_date_only_until == null) return start.toFormat(INPUT_FORMAT);
  const end = DateTime.fromSeconds(league.prequal_date_only_until, { zone: defaultTimeZone });
  const first = start.toFormat('dd.MM.yyyy');
  const last = end.toFormat('dd.MM.yyyy');
  return first === last ? first : `${first} to ${last}`;
}

function prequalificationFields({ kind, league }) {
  const period = new TextInputBuilder().setCustomId('prequalPeriod')
    .setLabel(kind === 'race' ? 'Pre-qualification race date(s)' : 'Signup period')
    .setPlaceholder('03.10.2030 10:00 or 03.10.2030 to 05.10.2030')
    .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(27);
  const dates = prequalificationDateValue(league);
  if (dates) period.setValue(dates);
  const details = new TextInputBuilder().setCustomId('prequalDetails')
    .setLabel(kind === 'race' ? 'Pre-qualification race details' : 'Signup details / link')
    .setPlaceholder(kind === 'race' ? 'Track, format, rules, and signup link' : 'Signup link, eligibility, and requirements')
    .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000);
  if (league?.prequal_details) details.setValue(league.prequal_details);
  return [new ActionRowBuilder().addComponents(period), new ActionRowBuilder().addComponents(details)];
}

function buildLeaguePrequalificationForm({ league, kind }) {
  return new ModalBuilder().setCustomId(`league-prequal:${league.id}:${kind}`)
    .setTitle(`League #${league.id} pre-qualification`)
    .addComponents(...prequalificationFields({ kind, league }));
}

module.exports = { buildLeaguePrequalificationForm, prequalificationFields, prequalificationDateValue };
