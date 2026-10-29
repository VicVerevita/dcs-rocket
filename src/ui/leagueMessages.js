const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, spoiler } = require('discord.js');
const { teamChoices, isTeam } = require('../domain/teams');
const { buildRsvpId } = require('../reminders/context');
const { leagueDescription } = require('./leagueSummary');
const { buildTierField } = require('./tierSummary');

function mentions(responses, limit = 500) {
  let text = '';
  for (let index = 0; index < responses.length; index++) {
    const next = `${text ? ', ' : ''}<@${responses[index].user_id}>`;
    const remaining = responses.length - index - 1;
    const suffix = remaining ? `, …and ${remaining} more` : '';
    if (text.length + next.length + suffix.length > limit) {
      return `${text}, …and ${responses.length - index} more`;
    }
    text += next;
  }
  return text;
}

function leagueButtons(event, team, privateMessage = false) {
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(buildRsvpId('yes', event, { team, privateMessage }))
      .setLabel('Interested').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(buildRsvpId('no', event, { team, privateMessage }))
      .setLabel('Not interested').setStyle(ButtonStyle.Danger),
  );
  buttons.addComponents(
    new ButtonBuilder().setCustomId(buildRsvpId('remind_me_again', event, { team, privateMessage }))
      .setLabel(privateMessage ? 'Remind again tomorrow' : 'Remind me again').setStyle(ButtonStyle.Secondary),
  );
  return buttons;
}

function buildLeagueReminderMessage(event, leadDays, responses, team) {
  const heading = leadDays < 0 ? 'League updated - please check the schedule'
    : leadDays > 0 ? `Season starts in ${leadDays} day${leadDays === 1 ? '' : 's'}`
    : 'League available - share your interest';
  const interested = responses.filter((response) => response.attending);
  const groups = [...teamChoices];
  if (interested.some((response) => !isTeam(response.team))) {
    groups.push({ name: 'Unassigned team', value: '' });
  }
  const title = `🏁 ${event.title}`;
  const description = `${heading}\n\n${leagueDescription(event, team)}\n\nInterested in this league? You can change your answer later.`;
  const footer = `League and tiers: /leagues league-id:${event.id} • Race schedule: /races league-id:${event.id}`;
  const tiers = buildTierField((event.tiers ?? []).map(({ name }) => name));
  const declined = responses.filter((response) => !response.attending);
  const sections = groups.map(({ name, value }) => {
    const members = interested.filter((response) => value ? response.team === value : !isTeam(response.team));
    return { name: `${name} - Interested (${members.length})`, members };
  });
  const fixedLength = title.length + description.length + footer.length
    + (tiers ? tiers.name.length + tiers.value.length : 0)
    + sections.reduce((total, section) => total + section.name.length, 0)
    + 'Not interested'.length + String(declined.length).length + 5;
  const rosterLimit = Math.min(500, Math.max(100, Math.floor((5900 - fixedLength) / (groups.length + 1))));
  const fields = sections.map(({ name, members }) => ({ name, value: mentions(members, rosterLimit) || 'No responses yet.' }));
  fields.push({ name: 'Not interested', value: declined.length
    ? `${declined.length}\n${spoiler(mentions(declined, rosterLimit))}` : '0' });
  if (tiers) fields.push(tiers);
  const embed = new EmbedBuilder().setTitle(title)
    .setDescription(description)
    .addFields(...fields)
    .setFooter({ text: footer });
  return { embeds: [embed], components: [leagueButtons(event, team)], allowedMentions: { parse: [] } };
}

function buildLeaguePrivateReminder(event, response, team) {
  const current = response ? (response.attending ? 'Interested' : 'Not interested') : 'No response yet';
  const embed = new EmbedBuilder().setTitle(`🏁 ${event.title} - your reminder`)
    .setDescription(`${leagueDescription(event, team)}\n**Your response:** ${current}\nUse the buttons below to update your interest.`)
    .setFooter({ text: `View tiers and races in the server with /leagues league-id:${event.id}.` });
  const tiers = buildTierField((event.tiers ?? []).map(({ name }) => name));
  if (tiers) embed.addFields(tiers);
  return { embeds: [embed], components: [leagueButtons(event, team, true)], allowedMentions: { parse: [] } };
}

module.exports = { buildLeagueReminderMessage, buildLeaguePrivateReminder };
