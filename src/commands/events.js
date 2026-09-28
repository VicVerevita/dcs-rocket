const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');
const { getUpcomingEvents } = require('../db/eventRepository');
const { discordTimestamp } = require('../utils/time');
const { gameLabel, eventTypeChoices, eventTypeLabel } = require('../utils/eventLabels');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('events')
    .setDescription('Show upcoming racing events')
    .addStringOption((option) =>
      option
        .setName('game')
        .setDescription('Filter by sim')
        .addChoices(
          { name: 'iRacing', value: 'iracing' },
          { name: 'Le Mans Ultimate', value: 'lmu' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Filter by event type')
        .addChoices(...eventTypeChoices),
    ),

  async execute(interaction) {
    const game = interaction.options.getString('game');
    const eventType = interaction.options.getString('type');

    const events = getUpcomingEvents({
      guildId: interaction.guildId,
      game,
      eventType,
      limit: 5,
    });

    if (events.length === 0) {
      await interaction.reply({
        content: 'No upcoming events match that filter.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🏁 Upcoming Racing Events')
      .setDescription(
        events
          .map((event, index) => {
            const carClass = event.car_class
              ? `\n**Car / Class:** ${event.car_class}`
              : '';
            const details = event.details
              ? `\n**Details:** ${event.details}`
              : '';

            return [
              `### #${index + 1} — ${event.title}`,
              `**${gameLabel(event.game)} • ${eventTypeLabel(event.event_type)}**`,
              `**When:** ${discordTimestamp(event.starts_at, event.date_only_until)}`,
              `**Track:** ${event.track}${carClass}${details}`,
              `**ID:** ||${event.id}||`,
            ].join('\n');
          })
          .join('\n\n'),
      )
      .setFooter({ text: `Showing the next ${events.length} event${events.length === 1 ? '' : 's'}` });

    await interaction.reply({ embeds: [embed] });
  },
};
