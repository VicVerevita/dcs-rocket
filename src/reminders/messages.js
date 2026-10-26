const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { discordTimestamp } = require('../utils/time');
const { gameLabel } = require('../utils/eventLabels');
const { isLateEvent } = require('./timing');
const { teamLabel } = require('../domain/teams');
const { buildRsvpId } = require('./context');

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

function buildReminderMessage(event, leadDays, responses, team = '') {
  const heading = leadDays < 0
    ? 'Event updated - please check your plans'
    : leadDays === 7 && isLateEvent(event)
    ? 'New special event - sign up now'
    : `${leadDays} day${leadDays === 1 ? '' : 's'} away`;
  const embed = new EmbedBuilder()
    .setTitle(`🏁 ${event.title}`)
    .setDescription([
      `**${gameLabel(event.game)} special event - ${heading}**`,
      team ? `**Team:** ${teamLabel(team)}` : null,
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
      .setCustomId(buildRsvpId('yes', event, { team }))
      .setLabel("I'm driving")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildRsvpId('remind_me_again', event, { team }))
      .setLabel("Remind me again")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildRsvpId('no', event, { team }))
      .setLabel("Can't drive")
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [buttons], allowedMentions: { parse: [] } };
}

function buildPrivateReminderMessage(event, response, team = response?.team || '') {
  const current = response?.attending
    ? `Driving: ${response.days} - ${response.car_class}${response.availability_hours ? ` - ${response.availability_hours}` : ''}`
    : response ? 'Not driving' : 'No response yet';
  const embed = new EmbedBuilder()
    .setTitle(`🏁 ${event.title} - your reminder`)
    .setDescription([
      `**${gameLabel(event.game)} special event**`,
      team ? `**Team:** ${teamLabel(team)}` : null,
      `**When:** ${discordTimestamp(event.starts_at, event.date_only_until)}`,
      `**Track:** ${event.track}`,
      event.car_class ? `**Event classes:** ${event.car_class}` : null,
      event.details ? `**Details:** ${event.details}` : null,
      `**Your response:** ${current}`,
      'Use the buttons below to update your response. The server overview will update too.',
    ].filter(Boolean).join('\n'));
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildRsvpId('yes', event, { team, privateMessage: true }))
      .setLabel("I'm driving")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildRsvpId('no', event, { team, privateMessage: true }))
      .setLabel("Can't drive")
      .setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [buttons], allowedMentions: { parse: [] } };
}

module.exports = { buildReminderMessage, buildPrivateReminderMessage };
