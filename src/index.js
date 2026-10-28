const {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} = require('discord.js');
const { token, guildIds } = require('./config');
const { loadCommands } = require('./loadCommands');
const { handleEventModal } = require('./interactions/eventModal');
const { handleRaceModal } = require('./interactions/raceModal');
const { handleLeaguePrequalificationModal } = require('./interactions/leaguePrequalificationModal');
const { handleLeaguesPageButton } = require('./interactions/leaguesPagination');
const { handleRacesPageButton } = require('./interactions/racesPagination');
const { handleLeagueTierNamesModal, handleLeagueCreationButton } = require('./interactions/leagueCreation');
const { reportInteractionError } = require('./interactions/errors');
const { createInteractionRouter } = require('./interactions/routing');
const { startReminderScheduler } = require('./reminders/scheduler');
const { handleReminderButton, handleReminderModal } = require('./reminders/interactions');
const { handlePrequalificationReminderButton } = require('./reminders/prequalification/interactions');
require('./db/database');

const commands = loadCommands();
const routeInteraction = createInteractionRouter({
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
