const { MessageFlags } = require('discord.js');
const { guildIds } = require('../config');
const { getLeague, getLeagueTiers } = require('../db/leagueRepository');
const { getLeagueRaces } = require('../db/raceRepository');
const { buildRacesOverview } = require('../ui/raceMessages');
const { buildPaginatedMessage } = require('../ui/pagination');

function getRaceOverviewPages({ guildId, leagueId, tierId }) {
  const league = getLeague({ leagueId, guildId });
  if (!league) return { pages: [], emptyContent: `No league found with ID #${leagueId}.` };
  const tiers = getLeagueTiers({ leagueId, guildId }).filter(({ id }) => tierId == null || id === tierId);
  if (!tiers.length) return { pages: [], emptyContent: 'That tier does not belong to this league.' };
  const races = getLeagueRaces({ leagueId, guildId, tierId });
  return { pages: buildRacesOverview(league, races, tiers) };
}

function pageId({ ownerId, guildId, leagueId, tierId }, page) {
  return `races-page:${ownerId}:${guildId}:${leagueId}:${tierId ?? 'all'}:${page}`;
}

function parsePageId(customId) {
  const match = /^races-page:(\d{1,20}):(\d{1,20}):([1-9]\d*):(all|[1-9]\d*):(\d+)$/.exec(customId);
  if (!match) return null;
  const leagueId = Number(match[3]);
  const tierId = match[4] === 'all' ? null : Number(match[4]);
  const page = Number(match[5]);
  if (!Number.isSafeInteger(leagueId) || (tierId !== null && !Number.isSafeInteger(tierId))
    || !Number.isSafeInteger(page)) return null;
  return { ownerId: match[1], guildId: match[2], leagueId, tierId, page };
}

function buildRacesPagePayload({ pages, emptyContent, page, ...context }) {
  return buildPaginatedMessage({
    pages, page, buttonId: (index) => pageId(context, index), emptyContent, appendPageNumber: false,
  });
}

async function handleRacesPageButton(interaction) {
  const context = parsePageId(interaction.customId);
  if (!context || !guildIds.includes(context.guildId) || context.guildId !== interaction.guildId) {
    await interaction.reply({ content: 'This race schedule is unavailable in this server.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (context.ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the member who opened this schedule can change its page.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  await interaction.editReply(buildRacesPagePayload({ ...context, ...getRaceOverviewPages(context) }));
}

module.exports = { getRaceOverviewPages, buildRacesPagePayload, handleRacesPageButton };
