const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const {
  getReminderChannels,
  removeReminderChannel,
  setReminderChannel,
} = require('../db/reminderChannelRepository');
const { gameChoices, gameLabel } = require('../utils/eventLabels');
const { teamChoices, isTeam, teamLabel } = require('../domain/teams');
const { refreshChannelReminderMessages } = require('../reminders/interactions');
const { publishChannelReminders } = require('../reminders/scheduler');
const botPermissions = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure this server\'s bot settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup((group) => group
      .setName('reminders')
      .setDescription('Choose where special-event reminders are posted')
      .addSubcommand((subcommand) => subcommand
        .setName('set')
        .setDescription('Add a reminder channel or change its game and team')
        .addChannelOption((option) => option
          .setName('channel')
          .setDescription('Channel for reminder posts')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true))
        .addStringOption((option) => option
          .setName('game')
          .setDescription('Which game should post here?')
          .setRequired(true)
          .addChoices(
            { name: 'Both games', value: 'both' },
            ...gameChoices,
          ))
        .addStringOption((option) => option
          .setName('team')
          .setDescription('Team roster for this channel; omit to keep its current setting')
          .addChoices(
            ...teamChoices,
            { name: 'All teams (shared)', value: 'all' },
          )))
      .addSubcommand((subcommand) => subcommand
        .setName('remove')
        .setDescription('Stop posting reminders in a channel')
        .addChannelOption((option) => option
          .setName('channel')
          .setDescription('Configured reminder channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)))
      .addSubcommand((subcommand) => subcommand
        .setName('list')
        .setDescription('Show reminder channels and their assigned games and teams'))),

  async execute(interaction) {
    // Acknowledge before validation, database queries, or Discord requests.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reply = (content) => interaction.editReply({ content });
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return reply('You need Manage Server permission to configure reminders.');
    }

    const action = interaction.options.getSubcommand();
    if (action === 'list') {
      const channels = getReminderChannels(interaction.guildId);
      return reply(channels.length
        ? channels.slice(0, 25).map(({ key, game, team }) => `<#${key}> - ${game ? gameLabel(game) : 'Both games'} - ${teamLabel(team)}`).join('\n')
          + (channels.length > 25 ? `\n…and ${channels.length - 25} more configured channels.` : '')
        : 'No reminder channels configured. Use `/config reminders set` to add one.');
    }

    const channel = interaction.options.getChannel('channel', true);
    if (channel.guildId !== interaction.guildId) {
      return reply('Choose a channel in this server.');
    }
    if (action === 'remove') {
      return reply(removeReminderChannel(interaction.guildId, channel.id)
        ? `Removed <#${channel.id}> from reminder channels.`
        : `<#${channel.id}> is not configured for reminders.`);
    }

    const game = interaction.options.getString('game', true);
    const team = interaction.options.getString('team');
    if (game !== 'both' && !gameChoices.some(({ value }) => value === game)) {
      return reply('Choose Both games, iRacing, or Le Mans Ultimate.');
    }
    if (team !== null && team !== 'all' && !isTeam(team)) {
      return reply('Choose Main team, Academy team, Community team, or All teams (shared).');
    }
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
      return reply('Choose a text or announcement channel.');
    }
    const guild = interaction.guild || await interaction.client.guilds.fetch(interaction.guildId);
    const selectedChannel = await guild.channels.fetch(channel.id).catch(() => null);
    if (!selectedChannel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(selectedChannel.type)) {
      return interaction.editReply(`I cannot access <#${channel.id}>. Choose a text or announcement channel in this server.`);
    }
    const botMember = await guild.members.fetchMe().catch(() => null);
    const missing = botMember && selectedChannel.permissionsFor(botMember)?.missing(botPermissions);
    if (!missing || missing.length) {
      return interaction.editReply(`I need View Channel, Send Messages, and Embed Links in <#${channel.id}> before I can post reminders there.`);
    }

    setReminderChannel(interaction.guildId, channel.id, game === 'both' ? null : game,
      team === 'all' ? '' : team ?? undefined);
    const selected = getReminderChannels(interaction.guildId).find(({ key }) => key === channel.id);
    const { failures, skippedForeign } = await refreshChannelReminderMessages(interaction.client, interaction.guildId, channel.id);
    const published = await publishChannelReminders(interaction.client, interaction.guildId, channel.id);
    return interaction.editReply(`Reminders for ${game === 'both' ? 'both games' : gameLabel(game)} will post in <#${channel.id}> - ${teamLabel(selected.team)}.`
      + (published.sent ? ` Posted ${published.sent} reminder${published.sent === 1 ? '' : 's'} for upcoming special events.` : '')
      + (skippedForeign ? ` Skipped ${skippedForeign} existing reminder post${skippedForeign === 1 ? '' : 's'} created by another bot; this bot can only update its own posts.` : '')
      + (published.failures ? ' Settings were saved, but some upcoming event reminders could not be sent. Run this command again to retry or check the bot logs for details.' : '')
      + (failures ? ' Settings were saved, but some existing posts could not be refreshed. Check the bot logs for details.' : ''));
  },
};
