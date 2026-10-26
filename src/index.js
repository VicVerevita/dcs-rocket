const {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} = require('discord.js');
const { token, guildIds } = require('./config');
const { loadCommands } = require('./loadCommands');
const { handleAddEventModal } = require('./interactions/addEventModal');
const { handleEditEventModal } = require('./interactions/editEventModal');
const { reportInteractionError } = require('./interactions/errors');
const { createInteractionRouter } = require('./interactions/routing');
const { startReminderScheduler } = require('./reminders/scheduler');
const { handleReminderButton, handleReminderModal } = require('./reminders/interactions');
require('./db/database');

const commands = loadCommands();
const routeInteraction = createInteractionRouter({
  guildIds,
  commands,
  handleAddEventModal,
  handleEditEventModal,
  handleReminderButton,
  handleReminderModal,
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
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
  const receivedAt = Date.now();
  try {
    await routeInteraction(interaction);
  } catch (error) {
    await reportInteractionError(interaction, error, receivedAt);
  }
});

client.login(token);
