const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getLeague, setLeaguePrequalification } = require('../db/leagueRepository');
const { prequalificationChoices } = require('../domain/leagueInput');
const { buildLeaguePrequalificationForm } = require('../ui/leaguePrequalificationForm');
const { publishEditedReminder } = require('../reminders/scheduler');

module.exports = {
  data: new SlashCommandBuilder().setName('league-prequal')
    .setDescription('Manage a league’s pre-qualification race or signup period')
    .setDefaultMemberPermissions(0)
    .addSubcommand((command) => command.setName('set').setDescription('Set or update league pre-qualification')
      .addIntegerOption((option) => option.setName('league-id').setDescription('The league’s event ID').setRequired(true).setMinValue(1))
      .addStringOption((option) => option.setName('type').setDescription('The kind of pre-qualification phase')
        .setRequired(true).addChoices(...prequalificationChoices)))
    .addSubcommand((command) => command.setName('clear').setDescription('Remove league pre-qualification')
      .addIntegerOption((option) => option.setName('league-id').setDescription('The league’s event ID').setRequired(true).setMinValue(1))),

  async execute(interaction) {
    const leagueId = interaction.options.getInteger('league-id', true);
    const league = interaction.guildId ? getLeague({ leagueId, guildId: interaction.guildId }) : null;
    if (!league) {
      await interaction.reply({ content: `No league found with ID #${leagueId}.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.options.getSubcommand() === 'set') {
      await interaction.showModal(buildLeaguePrequalificationForm({
        league, kind: interaction.options.getString('type', true),
      }));
      return;
    }
    const updated = setLeaguePrequalification({
      leagueId, guildId: interaction.guildId, kind: null, startsAt: null, dateOnlyUntil: null, details: null,
    });
    await interaction.reply({
      content: updated ? `✅ Pre-qualification removed from League #${leagueId}.` : `No league found with ID #${leagueId}.`,
      flags: MessageFlags.Ephemeral,
    });
    if (updated) await publishEditedReminder(interaction.client, leagueId, interaction.guildId);
  },
};
