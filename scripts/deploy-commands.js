const { REST, Routes } = require('discord.js');
const { clientId, guildIds, token } = require('../src/config');
const { loadCommands } = require('../src/loadCommands');

async function deploy() {
  const commands = loadCommands().map((command) => command.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(token);

  for (const guildId of guildIds) {
    console.log(`Deploying ${commands.length} commands to guild ${guildId}...`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
  }

  console.log('Command deployment complete.');
}

deploy().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
