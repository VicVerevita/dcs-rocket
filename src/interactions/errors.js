const { MessageFlags } = require('discord.js');

async function reportInteractionError(interaction, error, receivedAt, logger = console) {
  const failedAt = Date.now();
  const context = {
    interactionId: interaction.id,
    guildId: interaction.guildId,
    command: interaction.commandName || interaction.customId?.split(':')[0],
    code: error.code,
    message: error.message,
    ageAtReceiveMs: Number.isFinite(interaction.createdTimestamp)
      ? receivedAt - interaction.createdTimestamp : null,
    processingMs: failedAt - receivedAt,
  };

  // Discord's error object includes the callback URL and its interaction token.
  // Log only diagnostic fields, and never retry an expired or answered callback.
  if (error.code === 10062 || error.code === 40060) {
    logger.warn('[interaction] Initial response rejected', context);
    return;
  }
  logger.error('[interaction] Handler failed', context);
  if (!interaction.isRepliable()) return;

  const response = {
    content: 'Something went wrong while handling that interaction.',
    ...(interaction.guildId ? { flags: MessageFlags.Ephemeral } : {}),
  };
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  } catch (replyError) {
    logger.warn('[interaction] Could not send error response', {
      interactionId: interaction.id,
      code: replyError.code,
      message: replyError.message,
    });
  }
}

module.exports = { reportInteractionError };
