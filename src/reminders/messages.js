const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, spoiler } = require('discord.js');
const { discordTimestamp } = require('../utils/time');
const { gameLabel } = require('../utils/eventLabels');
const { isLateEvent } = require('./timing');
const { teamChoices, isTeam, teamLabel } = require('../domain/teams');
const { buildRsvpId } = require('./context');

const { DAYS, selectedValues } = require('../domain/rsvp');

function dayClasses(event, drivers, day) {
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
  return [...classes].sort(([a], [b]) => a.localeCompare(b));
}

function classRoster(classes, limit = Infinity) {
  if (!classes.length) return 'No drivers yet.';
  const complete = classes.map(([name, drivers]) => `**${name}**\n${drivers.join(', ')}`).join('\n');
  if (complete.length <= limit) return complete;

  const omitted = '\n…more responses';
  let value = '';
  for (const [name, drivers] of classes) {
    const heading = `${value ? '\n' : ''}**${name}**\n`;
    if (value.length + heading.length + drivers[0].length + omitted.length > limit) break;
    value += heading;
    for (let index = 0; index < drivers.length; index++) {
      const entry = `${index ? ', ' : ''}${drivers[index]}`;
      if (value.length + entry.length + omitted.length > limit) {
        return value + omitted;
      }
      value += entry;
    }
  }
  return (value + omitted).trim();
}

function notDrivingField(responses) {
  const declined = responses.filter((response) => !response.attending);
  if (!declined.length) return { name: 'Not driving', value: '0', inline: false };

  const count = `${declined.length}\n`;
  const limit = 1024 - count.length - 4; // Reserve both spoiler delimiters.
  let names = '';
  let included = 0;
  for (const response of declined) {
    const next = `${names ? `${names}, ` : ''}<@${response.user_id}>`;
    const remaining = declined.length - included - 1;
    const overflow = remaining ? `, …and ${remaining} more` : '';
    if (next.length + overflow.length > limit) break;
    names = next;
    included++;
  }
  if (included < declined.length) {
    names += `${names ? ', ' : ''}…and ${declined.length - included} more`;
  }
  return { name: 'Not driving', value: count + spoiler(names), inline: false };
}

function overviewFields(event, responses) {
  const drivers = responses.filter((response) => response.attending);
  const groups = teamChoices.map(({ name, value }) => ({
    name,
    drivers: drivers.filter((driver) => driver.team === value),
  }));
  if (responses.some((response) => !isTeam(response.team))) {
    groups.push({ name: 'Unassigned team', drivers: drivers.filter((driver) => !isTeam(driver.team)) });
  }
  const days = event.game === 'iracing' ? ['Saturday'] : DAYS;
  const fields = days.map((day) => {
    const sections = groups.map((group) => {
      const classes = dayClasses(event, group.drivers, day);
      return { heading: `**${group.name}**\n`, classes, length: classRoster(classes).length };
    });
    // Share the field budget fairly, reserving every team's heading and complete mentions.
    let remaining = 1024 - sections.reduce((sum, section) => sum + section.heading.length, 0)
      - (sections.length - 1) * 2;
    const ordered = sections.map((section, index) => ({ ...section, index }))
      .sort((a, b) => a.length - b.length);
    for (let index = 0; index < ordered.length; index++) {
      const section = ordered[index];
      section.limit = Math.min(section.length, Math.floor(remaining / (ordered.length - index)));
      remaining -= section.limit;
    }
    const limits = new Map(ordered.map((section) => [section.index, section.limit]));
    return {
      name: `────── ${day.toUpperCase()} ──────`,
      value: sections.map((section, index) => section.heading + classRoster(section.classes, limits.get(index))).join('\n\n'),
    };
  });
  fields.push(notDrivingField(responses));
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
      team ? `**Signup team:** ${teamLabel(team)}` : null,
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
