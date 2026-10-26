function getInteractionGuildId(interaction) {
  if (interaction.guildId) return interaction.guildId;
  if (!(interaction.isButton() || interaction.isModalSubmit())
    || !interaction.customId?.startsWith('special-rsvp:')) return null;

  // DM RSVP IDs end in <guild ID>:<event ID>, including team and legacy IDs.
  const parts = interaction.customId.split(':');
  return parts.length >= 4 ? parts.at(-2) : null;
}

function createInteractionRouter({
  guildIds,
  commands,
  handleAddEventModal,
  handleEditEventModal,
  handleReminderButton,
  handleReminderModal,
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

    if (interaction.isModalSubmit() && interaction.customId.startsWith('add-event:')) {
      await handleAddEventModal(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('edit-event:')) {
      await handleEditEventModal(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('special-rsvp:')) {
      await handleReminderButton(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('special-rsvp:submit:')) {
      await handleReminderModal(interaction);
    }
  };
}

module.exports = { getInteractionGuildId, createInteractionRouter };
