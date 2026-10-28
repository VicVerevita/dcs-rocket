const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { gameLabel } = require('../../utils/eventLabels');
const { discordTimestamp } = require('../../utils/time');
const { getPrequalificationDeadline } = require('../../domain/prequalification');
const { buildPrequalificationReminderId } = require('./context');

function buildPrequalificationReminder(event, userId) {
  const deadline = getPrequalificationDeadline(event);
  const embed = new EmbedBuilder()
    .setTitle(`🏁 ${event.title} - pre-qualification reminder`)
    .setDescription([
      `**${gameLabel(event.game)} league**`,
      event.prequal_kind === 'signup' ? 'Please complete and submit your signup form.' : 'Please submit your pre-qualification run.',
      `**Pre-qualification:** ${discordTimestamp(event.prequal_starts_at, event.prequal_date_only_until)}`,
      event.prequal_date_only_until == null && deadline !== null ? `**Closes:** <t:${deadline}:F>` : null,
      event.prequal_details || null,
      event.details ? `**League details:** ${event.details}` : null,
      'Choose “I did” to stop these reminders and keep your league interest, or “I\'m not doing it anymore” to withdraw your interest.',
    ].filter(Boolean).join('\n\n'))
    .setFooter({ text: 'Repeats every 3 days until you respond or the pre-qualification window closes.' });
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(buildPrequalificationReminderId('done', event, userId))
      .setLabel('I did').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(buildPrequalificationReminderId('withdraw', event, userId))
      .setLabel("I'm not doing it anymore").setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [buttons], allowedMentions: { parse: [] } };
}

module.exports = { buildPrequalificationReminder };
