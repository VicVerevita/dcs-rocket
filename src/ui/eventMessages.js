const { EmbedBuilder } = require('discord.js');
const { discordTimestamp } = require('../utils/time');
const { gameLabel, eventTypeLabel } = require('../utils/eventLabels');

function buildEventConfirmation(event, action) {
  const embed = new EmbedBuilder()
    .setTitle(action === 'added' ? '✅ Event added' : '✅ Event updated')
    .addFields(
      { name: 'Event', value: `#${event.id} - ${event.title}` },
      { name: 'Game', value: gameLabel(event.game), inline: true },
      { name: 'Event type', value: eventTypeLabel(event.eventType), inline: true },
      {
        name: event.dateOnlyUntil === null ? 'When (your timezone)' : 'Date / date range',
        value: discordTimestamp(event.startsAt, event.dateOnlyUntil),
      },
      { name: 'Track', value: event.track },
    );
  if (event.carClass) embed.addFields({ name: 'Car / Class', value: event.carClass });
  if (event.details) embed.addFields({ name: 'Details', value: event.details });
  return embed;
}

function buildEventsOverview(events) {
  return new EmbedBuilder()
    .setTitle('🏁 Upcoming Racing Events')
    .setDescription(events.map((event, index) => [
      `### #${index + 1} - ${event.title}`,
      `**${gameLabel(event.game)} • ${eventTypeLabel(event.event_type)}**`,
      `**When:** ${discordTimestamp(event.starts_at, event.date_only_until)}`,
      `**Track:** ${event.track}`,
      event.car_class ? `**Car / Class:** ${event.car_class}` : null,
      event.details ? `**Details:** ${event.details}` : null,
      `**ID:** ||${event.id}||`,
    ].filter(Boolean).join('\n')).join('\n\n'))
    .setFooter({ text: `Showing the next ${events.length} event${events.length === 1 ? '' : 's'}` });
}

module.exports = { buildEventConfirmation, buildEventsOverview };
