const { EmbedBuilder } = require('discord.js');
const { discordTimestamp } = require('../utils/time');

function buildRaceConfirmation(race, action) {
  const embed = new EmbedBuilder()
    .setTitle(action === 'added' ? '✅ League race added' : '✅ League race updated')
    .addFields(
      { name: 'Race', value: `#${race.id} - ${race.title}` },
      { name: 'League', value: `#${race.leagueId}` },
      { name: 'Race start (your timezone)', value: discordTimestamp(race.startsAt) },
      { name: 'Track', value: race.track },
    );
  if (race.tierName) embed.addFields({ name: 'Tier', value: `${race.tierName} (#${race.tierId})` });
  if (race.qualifying) embed.addFields({ name: 'Qualifying', value: race.qualifying });
  if (race.details) embed.addFields({ name: 'Details', value: race.details });
  return embed;
}

function raceDescription(race) {
  return [
    `### ${race.title}`,
    `**Race start:** ${discordTimestamp(race.starts_at)}`,
    `**Track:** ${race.track}`,
    race.qualifying ? `**Qualifying:** ${race.qualifying}` : null,
    race.details ? `**Details:** ${race.details}` : null,
    `**Race ID:** ||${race.id}||`,
  ].filter(Boolean).join('\n');
}

// Paginate the complete schedule. Each page stays below Discord's combined
// 6,000-character embed budget, even with the longest permitted race details.
function buildRacesOverview(league, races, tiers) {
  const title = `🏁 ${league.title} - race schedule`.slice(0, 256);
  const groups = tiers ?? [...new Map(races.map((race) => [race.tier_id ?? null, {
    id: race.tier_id ?? null, name: race.tier_name ?? 'Race schedule', position: race.tier_position ?? 0,
  }])).values()].sort((a, b) => a.position - b.position || a.id - b.id);
  if (!groups.length) groups.push({ id: null, name: 'Race schedule' });
  const pages = [];
  for (const tier of groups) {
    const heading = `## ${tier.name}${tier.id == null ? '' : ` - Tier ID: ||${tier.id}||`}`;
    const tierRaces = races.filter((race) => (race.tier_id ?? null) === tier.id)
      .sort((a, b) => a.starts_at - b.starts_at || a.id - b.id);
    let blocks = [heading];
    let length = heading.length;
    for (const race of tierRaces) {
      const block = raceDescription(race);
      if (blocks.length > 1 && length + block.length + 2 > 3800) {
        pages.push(blocks.join('\n\n'));
        blocks = [heading];
        length = heading.length;
      }
      blocks.push(block);
      length += block.length + 2;
    }
    if (!tierRaces.length) blocks.push('No races have been added to this tier yet.');
    pages.push(blocks.join('\n\n'));
  }
  return pages.map((description, index) => new EmbedBuilder().setTitle(title)
    .setDescription(description)
    .setFooter({ text: `League #${league.id} • Page ${index + 1}/${pages.length} • ${races.length} race${races.length === 1 ? '' : 's'}` }));
}

function tierChoicesText(tiers) {
  let text = 'Available tiers:';
  for (const [index, tier] of tiers.entries()) {
    const line = `\n${tier.name} - tier-id:${tier.id}`;
    if (text.length + line.length > 1600) return `${text}\n…and ${tiers.length - index} more. View all tiers with /leagues.`;
    text += line;
  }
  return text;
}

module.exports = { buildRaceConfirmation, buildRacesOverview, tierChoicesText };
