const { MessageFlags } = require('discord.js');
const { leagueCreationDrafts } = require('./leagueCreationDrafts');
const { parseTierNames } = require('../domain/leagueInput');
const { buildLeagueTierNamesForm, buildLeagueCreationButtons } = require('../ui/leagueCreation');
const { buildEventForm } = require('../ui/eventForm');

function getDraft(interaction, id) {
  return leagueCreationDrafts.get({ id, userId: interaction.user?.id, guildId: interaction.guildId });
}

async function expired(interaction) {
  await interaction.reply({
    content: 'This league draft is unavailable or expired. Run `/add-event` again to create a league.',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleLeagueTierNamesModal(interaction) {
  const match = /^league-tier-names:([a-f0-9]{24})$/.exec(interaction.customId);
  const draft = match ? getDraft(interaction, match[1]) : null;
  if (!draft) return expired(interaction);
  const parsed = parseTierNames(interaction.fields.getTextInputValue('tierNames'), draft.data.tierCount);
  if (!parsed.ok) {
    await interaction.reply({
      content: parsed.error, components: buildLeagueCreationButtons(draft, { namesOnly: true }), flags: MessageFlags.Ephemeral,
    });
    return;
  }
  draft.data.tierNames = parsed.tierNames;
  await interaction.reply({
    content: `${parsed.tierNames.length} tier name${parsed.tierNames.length === 1 ? '' : 's'} ready. Continue to enter the league details.`,
    components: buildLeagueCreationButtons(draft), flags: MessageFlags.Ephemeral,
  });
}

async function handleLeagueCreationButton(interaction) {
  const match = /^league-create:(names|details):([a-f0-9]{24})$/.exec(interaction.customId);
  const draft = match ? getDraft(interaction, match[2]) : null;
  if (!draft) return expired(interaction);
  if (match[1] === 'names') {
    await interaction.showModal(buildLeagueTierNamesForm(draft));
    return;
  }
  if (!draft.data.tierNames) {
    await interaction.reply({
      content: 'Name the league tiers before continuing.',
      components: buildLeagueCreationButtons(draft, { namesOnly: true }), flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.showModal(buildEventForm({
    game: draft.data.game, eventType: 'league', tiers: draft.data.tierCount,
    prequalificationKind: draft.data.prequalificationKind, draftId: draft.id,
  }));
}

module.exports = { handleLeagueTierNamesModal, handleLeagueCreationButton };
