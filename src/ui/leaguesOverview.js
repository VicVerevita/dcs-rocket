const { EmbedBuilder } = require('discord.js');
const { leagueDescription } = require('./leagueSummary');
const { discordTimestamp } = require('../utils/time');

const DESCRIPTION_LIMIT = 4000;

function raceDetails(race) {
  return [
    `### ${race.title}`,
    `**Race start:** ${discordTimestamp(race.starts_at)}`,
    `**Track:** ${race.track}`,
    race.qualifying ? `**Qualifying:** ${race.qualifying}` : null,
    race.details ? `**Details:** ${race.details}` : null,
    `**Race ID:** ||${race.id}||`,
  ].filter(Boolean).join('\n');
}

function buildLeagueOverview(league, tiers, races) {
  const descriptions = [];
  let description = leagueDescription(league);
  let currentTier = null;
  const continuation = `**Season:** ${discordTimestamp(league.starts_at, league.date_only_until)}`;
  for (const tier of tiers) {
    const heading = `## ${tier.name} - Tier ID: ||${tier.id}||`;
    const tierRaces = races.filter((race) => race.tier_id === tier.id)
      .sort((a, b) => a.starts_at - b.starts_at || a.id - b.id);
    const entries = tierRaces.length ? tierRaces.map(raceDetails) : ['No races scheduled yet.'];
    for (const entry of entries) {
      let block = currentTier === tier.id ? entry : `${heading}\n${entry}`;
      if (description.length + block.length + 2 > DESCRIPTION_LIMIT) {
        descriptions.push(description);
        description = continuation;
        currentTier = null;
        block = `${heading}\n${entry}`;
      }
      description += `\n\n${block}`;
      currentTier = tier.id;
    }
  }
  descriptions.push(description);
  return descriptions.map((value) => new EmbedBuilder()
    .setTitle(`🏁 ${league.title}`)
    .setDescription(value)
    .setFooter({ text: `League #${league.id} • ${tiers.length} tier${tiers.length === 1 ? '' : 's'} • ${races.length} race${races.length === 1 ? '' : 's'} • Full schedule: /races league-id:${league.id}` }));
}

module.exports = { buildLeagueOverview };
