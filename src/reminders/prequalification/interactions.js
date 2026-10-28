const { MessageFlags } = require('discord.js');
const { guildIds } = require('../../config');
const { getEvent } = require('../../db/eventRepository');
const { refreshReminderMessages } = require('../interactions');
const { parsePrequalificationReminderId } = require('./context');
const { stopPrequalificationReminder } = require('./repository');

async function handlePrequalificationReminderButton(interaction) {
  const context = parsePrequalificationReminderId(interaction.customId, interaction.guildId);
  const options = interaction.guildId ? { flags: MessageFlags.Ephemeral } : {};
  if (!context || interaction.guildId || !guildIds.includes(context.guildId)) {
    await interaction.reply({ content: 'This pre-qualification reminder is no longer available.', ...options });
    return;
  }
  if (context.userId !== interaction.user.id) {
    await interaction.reply({ content: 'This reminder belongs to another member.', ...options });
    return;
  }
  const event = getEvent({ eventId: context.eventId, guildId: context.guildId });
  if (!event || event.event_type !== 'league' || !event.prequal_kind) {
    await interaction.reply({ content: 'This pre-qualification reminder is no longer available.', ...options });
    return;
  }
  const result = stopPrequalificationReminder({ ...context, now: Math.floor(Date.now() / 1000) });
  if (!result.ok) {
    await interaction.reply({ content: result.error || 'This pre-qualification reminder is no longer available.', ...options });
    return;
  }
  const content = result.alreadyStopped ? 'These pre-qualification reminders are already stopped.'
    : context.action === 'done' ? 'Saved: you submitted your pre-qualification. Reminders are stopped and you remain interested in the league.'
    : 'Saved: you are no longer interested in this league. Pre-qualification reminders are stopped.';
  await interaction.update({ content, embeds: [], components: [], allowedMentions: { parse: [] } });
  if (context.action === 'withdraw' && result.changed) {
    await refreshReminderMessages(interaction.client, result.event);
  }
}

module.exports = { handlePrequalificationReminderButton };
