const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

function buildLeagueTierNamesForm(draft) {
  const input = new TextInputBuilder().setCustomId('tierNames').setLabel('Tier names, one per line')
    .setStyle(TextInputStyle.Paragraph).setPlaceholder('Gold\nSilver\nBronze').setRequired(true).setMaxLength(2019)
    .setValue((draft.data.tierNames ?? Array.from({ length: draft.data.tierCount }, (_, index) => `Tier ${index + 1}`)).join('\n'));
  return new ModalBuilder().setCustomId(`league-tier-names:${draft.id}`)
    .setTitle(`Name ${draft.data.tierCount} league tier${draft.data.tierCount === 1 ? '' : 's'}`)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function buildLeagueCreationButtons(draft, { namesOnly = false } = {}) {
  const row = new ActionRowBuilder();
  if (!namesOnly) row.addComponents(new ButtonBuilder().setCustomId(`league-create:details:${draft.id}`)
    .setLabel('Continue league details').setStyle(ButtonStyle.Primary));
  row.addComponents(new ButtonBuilder().setCustomId(`league-create:names:${draft.id}`)
    .setLabel('Edit tier names').setStyle(ButtonStyle.Secondary));
  return [row];
}

module.exports = { buildLeagueTierNamesForm, buildLeagueCreationButtons };
