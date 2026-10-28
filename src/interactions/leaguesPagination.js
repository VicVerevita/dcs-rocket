const { MessageFlags } = require('discord.js');
const { guildIds } = require('../config');
const { getLeagues, getLeagueTiers } = require('../db/leagueRepository');
const { getLeagueRaces } = require('../db/raceRepository');
const { buildLeagueOverview } = require('../ui/leaguesOverview');
const { buildPaginatedMessage } = require('../ui/pagination');

function getLeagueOverviewPages({ guildId, leagueId, game }) {
  return getLeagues({ guildId, leagueId, game }).flatMap((league) => {
    const context = { leagueId: league.id, guildId };
    return buildLeagueOverview(league, getLeagueTiers(context), getLeagueRaces(context));
  });
}

function pageId({ ownerId, guildId, leagueId, game }, page) {
  return `leagues-page:${ownerId}:${guildId}:${leagueId ?? 'all'}:${game ?? 'all'}:${page}`;
}

function parsePageId(customId) {
  const match = /^leagues-page:(\d{1,20}):(\d{1,20}):(all|[1-9]\d*):(all|iracing|lmu):(\d+)$/.exec(customId);
  if (!match) return null;
  const leagueId = match[3] === 'all' ? null : Number(match[3]);
  const page = Number(match[5]);
  if ((leagueId !== null && !Number.isSafeInteger(leagueId)) || !Number.isSafeInteger(page)) return null;
  return { ownerId: match[1], guildId: match[2], leagueId, game: match[4] === 'all' ? null : match[4], page };
}

function buildLeaguesPagePayload({ pages, page, ...context }) {
  return buildPaginatedMessage({
    pages, page, buttonId: (index) => pageId(context, index), emptyContent: 'No leagues match that filter.',
  });
}

async function handleLeaguesPageButton(interaction) {
  const context = parsePageId(interaction.customId);
  if (!context || !guildIds.includes(context.guildId) || context.guildId !== interaction.guildId) {
    await interaction.reply({ content: 'This league overview is unavailable in this server.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (context.ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the member who opened this overview can change its page.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  const pages = getLeagueOverviewPages(context);
  await interaction.editReply(buildLeaguesPagePayload({ ...context, pages }));
}

module.exports = { getLeagueOverviewPages, buildLeaguesPagePayload, handleLeaguesPageButton };
