const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { discordTimestamp } = require('../utils/time');
const { gameLabel } = require('../utils/eventLabels');
const { isLateEvent } = require('./timing');

const { DAYS, selectedValues } = require('../domain/rsvp');

function overviewFields(event, responses) {
  const drivers = responses.filter((response) => response.attending);
  const days = event.game === 'iracing' ? ['Saturday'] : DAYS;
  const fields = days.map((day) => {
    const classes = new Map();
    for (const driver of drivers) {
      if (event.game !== 'iracing' && !selectedValues(driver.days).includes(day)) continue;
      for (const carClass of selectedValues(driver.car_class)) {
        if (!classes.has(carClass)) classes.set(carClass, []);
        const hours = event.game === 'iracing' && driver.availability_hours
          ? ` (${driver.availability_hours})` : '';
        classes.get(carClass).push(`<@${driver.user_id}>${hours}`);
      }
    }
    let value = '';
    for (const [carClass, users] of [...classes].sort(([a], [b]) => a.localeCompare(b))) {
      const line = `**${carClass}**\n${users.join(', ')}\n`;
      if (value.length + line.length > 980) {
        value += '…more responses';
        break;
      }
      value += line;
    }
    return { name: day, value: value.trim() || 'No drivers yet.' };
  });
  fields.push({ name: 'Not driving', value: String(responses.length - drivers.length), inline: true });
  return fields;
}

function buildReminderMessage(event, leadDays, responses) {
  const heading = leadDays === 7 && isLateEvent(event)
    ? 'New special event - sign up now'
    : `${leadDays} day${leadDays === 1 ? '' : 's'} away`;
  const embed = new EmbedBuilder()
    .setTitle(`🏁 ${event.title}`)
    .setDescription([
      `**${gameLabel(event.game)} special event — ${heading}**`,
      `**When:** ${discordTimestamp(event.starts_at, event.date_only_until)}`,
      `**Track:** ${event.track}`,
      event.car_class ? `**Event class:** ${event.car_class}` : null,
      event.details ? `**Details:** ${event.details}` : null,
      '',
      event.game === 'iracing'
        ? 'Driving the 10:00 or 14:00 Saturday split? Share your availability hours and classes. You can update your answer later.'
        : 'Are you driving? Select your driving days and classes. You can update your answer later.',
    ].filter((line) => line !== null).join('\n'))
    .addFields(...overviewFields(event, responses));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`special-rsvp:yes:${event.id}`)
      .setLabel("I'm driving")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`special-rsvp:no:${event.id}`)
      .setLabel("Can't drive")
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [buttons], allowedMentions: { parse: [] } };
}

module.exports = { buildReminderMessage };
