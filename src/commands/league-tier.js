const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { createTier, renameTier, deleteTier, getLeagueTiers, getLeague } = require('../db/leagueRepository');
const { refreshReminderMessages } = require('../reminders/interactions');

function leagueOption(option) {
  return option.setName('league-id').setDescription('The event ID of the league').setRequired(true).setMinValue(1);
}

function tierOption(option) {
  return option.setName('tier-id').setDescription('The ID of the league tier').setRequired(true).setMinValue(1);
}

function nameOption(option) {
  return option.setName('name').setDescription('The tier name, such as Tier1 or Tier2').setRequired(true).setMaxLength(100);
}

module.exports = {
  data: new SlashCommandBuilder().setName('league-tier')
    .setDescription('Manage the tiers within a league').setDefaultMemberPermissions(0)
    .addSubcommand((command) => command.setName('add').setDescription('Add a tier to a league')
      .addIntegerOption(leagueOption).addStringOption(nameOption))
    .addSubcommand((command) => command.setName('rename').setDescription('Rename a league tier')
      .addIntegerOption(leagueOption).addIntegerOption(tierOption).addStringOption(nameOption))
    .addSubcommand((command) => command.setName('remove').setDescription('Remove an empty league tier')
      .addIntegerOption(leagueOption).addIntegerOption(tierOption)),

  async execute(interaction) {
    const leagueId = interaction.options.getInteger('league-id', true);
    const league = getLeague({ leagueId, guildId: interaction.guildId });
    if (!league) {
      await interaction.reply({ content: `No league found with ID #${leagueId}.`, flags: MessageFlags.Ephemeral });
      return;
    }
    const action = interaction.options.getSubcommand();
    let content;
    try {
      if (action === 'add') {
        const name = interaction.options.getString('name', true).trim();
        const tierId = createTier({ leagueId, guildId: interaction.guildId, name });
        content = `✅ Added ${name} to League #${leagueId}. Tier ID: ${tierId}.`;
      } else {
        const tierId = interaction.options.getInteger('tier-id', true);
        const tier = getLeagueTiers({ leagueId, guildId: interaction.guildId }).find(({ id }) => id === tierId);
        if (!tier) {
          await interaction.reply({ content: 'That tier does not belong to this league.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (action === 'rename') {
          const name = interaction.options.getString('name', true).trim();
          if (!renameTier({ tierId, guildId: interaction.guildId, name })) throw new Error('That tier is no longer available.');
          content = `✅ Renamed ${tier.name} to ${name} in League #${leagueId}.`;
        } else {
          if (!deleteTier({ tierId, guildId: interaction.guildId })) throw new Error('That tier is no longer available.');
          content = `✅ Removed ${tier.name} from League #${leagueId}.`;
        }
      }
    } catch (error) {
      await interaction.reply({ content: `Could not ${action} the tier: ${error.message}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    const refreshed = await refreshReminderMessages(interaction.client, league);
    if (refreshed.failures || refreshed.skippedForeign) {
      await interaction.editReply({
        content: content
          + (refreshed.failures ? ` ${refreshed.failures} reminder post(s) could not be refreshed.` : '')
          + (refreshed.skippedForeign ? ` ${refreshed.skippedForeign} reminder post(s) belong to another bot and could not be edited.` : ''),
        allowedMentions: { parse: [] },
      });
    }
  },
};
