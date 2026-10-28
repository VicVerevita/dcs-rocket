const { EmbedBuilder } = require('discord.js');
const { discordTimestamp } = require('../utils/time');
const { gameLabel, eventTypeLabel } = require('../utils/eventLabels');
const { prequalificationLabel } = require('./leagueSummary');
const { buildTierField } = require('./tierSummary');

function buildEventConfirmation(event, action) {
  const league = event.eventType === 'league';
  const subject = league ? 'League' : 'Event';
  const embed = new EmbedBuilder()
    .setTitle(`✅ ${subject} ${action === 'added' ? 'added' : 'updated'}`)
    .addFields(
      { name: subject, value: `#${event.id} - ${event.title}` },
      { name: 'Game', value: gameLabel(event.game), inline: true },
      { name: 'Event type', value: eventTypeLabel(event.eventType), inline: true },
      {
        name: league ? 'Season dates' : event.dateOnlyUntil === null ? 'When (your timezone)' : 'Date / date range',
        value: discordTimestamp(event.startsAt, event.dateOnlyUntil),
      },
    );
  if (event.track) embed.addFields({ name: league ? 'Tracks' : 'Track', value: event.track });
  if (event.carClass) embed.addFields({ name: 'Car / Class', value: event.carClass });
  if (event.details) embed.addFields({ name: 'Details', value: event.details });
  if (league) {
    if (event.tierNames?.length) embed.addFields(buildTierField(event.tierNames, 'Tiers'));
    if (event.prequalification?.kind) {
      embed.addFields({ name: prequalificationLabel(event.prequalification.kind),
        value: discordTimestamp(event.prequalification.startsAt, event.prequalification.dateOnlyUntil) });
      if (event.prequalification.details) embed.addFields({ name: 'Pre-qualification details', value: event.prequalification.details });
    }
    embed.setFooter({ text: `View tiers and races: /leagues league-id:${event.id} • Add a race: /add-race league-id:${event.id}` });
  }
  return embed;
}

function buildEventsOverview(events) {
  const blocks = [];
  for (const [index, event] of events.entries()) {
    const details = event.details && (event.details.length > 300 ? `${event.details.slice(0, 299)}…` : event.details);
    const block = [
      `### #${index + 1} - ${event.title}`,
      `**${gameLabel(event.game)} • ${eventTypeLabel(event.event_type)}**`,
      `**${event.event_type === 'league' ? 'Season' : 'When'}:** ${discordTimestamp(event.starts_at, event.date_only_until)}`,
      event.track ? `**${event.event_type === 'league' ? 'Tracks' : 'Track'}:** ${event.track}` : null,
      event.car_class ? `**Car / Class:** ${event.car_class}` : null,
      details ? `**Details:** ${details}` : null,
      event.event_type === 'league' ? `**League and tiers:** /leagues league-id:${event.id}\n**Races:** /races league-id:${event.id}` : null,
      `**ID:** ||${event.id}||`,
    ].filter(Boolean).join('\n');
    if ([...blocks, block].join('\n\n').length > 4096) break;
    blocks.push(block);
  }
  return new EmbedBuilder()
    .setTitle('🏁 Upcoming Racing Events')
    .setDescription(blocks.join('\n\n') || 'No upcoming events.')
    .setFooter({ text: `Showing ${blocks.length} of ${events.length} event${events.length === 1 ? '' : 's'}` });
}

module.exports = { buildEventConfirmation, buildEventsOverview };
