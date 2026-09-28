const fs = require('node:fs');
const path = require('node:path');
const { Collection } = require('discord.js');

function loadCommands() {
  const commands = new Collection();
  const commandDir = path.join(__dirname, 'commands');

  for (const file of fs.readdirSync(commandDir).filter((name) => name.endsWith('.js'))) {
    const command = require(path.join(commandDir, file));

    if (!command.data || !command.execute) {
      throw new Error(`Command file ${file} must export { data, execute }`);
    }

    commands.set(command.data.name, command);
  }

  return commands;
}

module.exports = { loadCommands };
