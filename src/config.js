const path = require('node:path');
require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const guildIds = required('GUILD_IDS')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

module.exports = {
  token: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  guildIds,
  defaultTimeZone: process.env.DEFAULT_TIMEZONE || 'Europe/Berlin',
  databasePath: path.resolve(process.env.DATABASE_PATH || './data/events.sqlite'),
};
