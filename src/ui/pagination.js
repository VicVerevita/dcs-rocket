const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

function buildPaginatedMessage({ pages, page = 0, buttonId, emptyContent, appendPageNumber = true }) {
  if (!pages.length) {
    return { content: emptyContent, embeds: [], components: [], allowedMentions: { parse: [] } };
  }
  const index = Math.min(Math.max(0, page), pages.length - 1);
  const embed = EmbedBuilder.from(pages[index].toJSON());
  if (appendPageNumber) {
    const footer = embed.data.footer?.text ?? '';
    embed.setFooter({ text: `${footer} • Page ${index + 1}/${pages.length}` });
  }
  const components = [];
  if (pages.length > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(buttonId(Math.max(0, index - 1)))
        .setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
      new ButtonBuilder().setCustomId(buttonId(index + 1))
        .setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(index === pages.length - 1),
    ));
  }
  return { content: null, embeds: [embed], components, allowedMentions: { parse: [] } };
}

module.exports = { buildPaginatedMessage };
