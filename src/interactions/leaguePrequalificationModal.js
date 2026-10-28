const { MessageFlags } = require('discord.js');
const { getLeague, setLeaguePrequalification } = require('../db/leagueRepository');
const { parsePrequalificationFields } = require('../domain/leagueInput');
const { publishEditedReminder } = require('../reminders/scheduler');

async function handleLeaguePrequalificationModal(interaction) {
  const match = /^league-prequal:([1-9]\d*):(race|signup)$/.exec(interaction.customId);
  const leagueId = match ? Number(match[1]) : null;
  if (!interaction.guildId || !Number.isSafeInteger(leagueId)) {
    await interaction.reply({
      content: 'That pre-qualification form is invalid. Run `/league-prequal set` again.', flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const league = getLeague({ leagueId, guildId: interaction.guildId });
  if (!league) {
    await interaction.reply({ content: `No league found with ID #${leagueId}.`, flags: MessageFlags.Ephemeral });
    return;
  }
  const parsed = parsePrequalificationFields(interaction.fields, match[2]);
  if (!parsed.ok) {
    await interaction.reply({ content: `Could not update the league: ${parsed.error}`, flags: MessageFlags.Ephemeral });
    return;
  }
  const updated = setLeaguePrequalification({ leagueId, guildId: interaction.guildId, ...parsed.prequalification });
  await interaction.reply({
    content: updated ? `✅ Pre-qualification updated for League #${leagueId}.` : `No league found with ID #${leagueId}.`,
    flags: MessageFlags.Ephemeral,
  });
  if (updated) await publishEditedReminder(interaction.client, leagueId, interaction.guildId);
}

module.exports = { handleLeaguePrequalificationModal };
