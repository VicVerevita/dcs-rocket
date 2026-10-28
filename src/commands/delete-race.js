const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { deleteRace, getRace } = require('../db/raceRepository');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('delete-race')
    .setDescription('Delete a race from a league')
    .setDefaultMemberPermissions(0)
    .addIntegerOption((option) => option.setName('race-id')
      .setDescription('The ID of the race to delete').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    const raceId = interaction.options.getInteger('race-id', true);
    const race = getRace({ raceId, guildId: interaction.guildId });
    const deleted = race && deleteRace({ raceId, guildId: interaction.guildId });
    await interaction.reply({
      content: deleted ? `✅ Race #${raceId} has been removed from League #${race.league_id}.`
        : `No league race found with ID #${raceId}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
