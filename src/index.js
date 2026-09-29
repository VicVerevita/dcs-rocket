const {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
} = require('discord.js');
const { token, guildIds } = require('./config');
const { loadCommands } = require('./loadCommands');
const { handleAddEventModal } = require('./interactions/addEventModal');
const { handleEditEventModal } = require('./interactions/editEventModal');
const { startReminderScheduler } = require('./reminders/scheduler');
const { handleReminderButton, handleReminderModal } = require('./reminders/interactions');
require('./db/database');

const allowedGuilds = new Set(guildIds);
const commands = loadCommands();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready as ${readyClient.user.tag}`);
  console.log(`Allowed guilds: ${guildIds.join(', ')}`);
  startReminderScheduler(readyClient);

  readyClient.user.setPresence({
    activities: [
      { name: '🏁 /events', type: 3 }
    ],
    status: 'online',
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.guildId || !allowedGuilds.has(interaction.guildId)) {
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: 'This bot is not configured for this server.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
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
  } catch (error) {
    console.error(error);

    if (!interaction.isRepliable()) return;

    const response = {
      content: 'Something went wrong while handling that interaction.',
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(response).catch(() => {});
    } else {
      await interaction.reply(response).catch(() => {});
    }
  }
});

client.login(token);
