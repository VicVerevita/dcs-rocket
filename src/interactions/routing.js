const { parsePrequalificationReminderId } = require('../reminders/prequalification/context');

function getInteractionGuildId(interaction) {
  if (interaction.guildId) return interaction.guildId;
  if (interaction.isButton() && interaction.customId?.startsWith('prequal-reminder:')) {
    return parsePrequalificationReminderId(interaction.customId)?.guildId ?? null;
  }
  if (!(interaction.isButton() || interaction.isModalSubmit())
    || !interaction.customId?.startsWith('special-rsvp:')) return null;

  // DM RSVP IDs end in <guild ID>:<event ID>, including team and legacy IDs.
  const parts = interaction.customId.split(':');
  return parts.length >= 4 ? parts.at(-2) : null;
}

function createInteractionRouter({
  guildIds,
  commands,
  handleEventModal,
  handleRaceModal,
  handleLeaguePrequalificationModal,
  handleLeaguesPageButton,
  handleRacesPageButton,
  handleLeagueTierNamesModal,
  handleLeagueCreationButton,
  handleReminderButton,
  handleReminderModal,
  handlePrequalificationReminderButton,
}) {
  const allowedGuilds = new Set(guildIds);
  return async (interaction) => {
    // Another running instance may own this guild. Do not acknowledge it here.
    if (!allowedGuilds.has(getInteractionGuildId(interaction))) return;

    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (command) await command.execute(interaction);
      return;
    }

    if (interaction.isModalSubmit() && /^(add|edit)-event:/.test(interaction.customId)) {
      await handleEventModal(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('league-tier-names:')) {
      await handleLeagueTierNamesModal(interaction);
      return;
    }
    if (interaction.isModalSubmit() && /^(add|edit)-race:/.test(interaction.customId)) {
      await handleRaceModal(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('league-prequal:')) {
      await handleLeaguePrequalificationModal(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('special-rsvp:')) {
      await handleReminderButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('prequal-reminder:')) {
      await handlePrequalificationReminderButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('leagues-page:')) {
      await handleLeaguesPageButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('races-page:')) {
      await handleRacesPageButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('league-create:')) {
      await handleLeagueCreationButton(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('special-rsvp:submit:')) {
      await handleReminderModal(interaction);
    }
  };
}

module.exports = { getInteractionGuildId, createInteractionRouter };
