const { MessageFlags } = require('discord.js');
const { createEvent, editEvent, getEvent } = require('../db/eventRepository');
const { parseEventFields } = require('../domain/eventInput');
const { isPrequalificationKind, tierNamesForCount } = require('../domain/leagueInput');
const { eventTypeChoices, gameChoices } = require('../utils/eventLabels');
const { buildEventConfirmation } = require('../ui/eventMessages');
const { buildLeagueCreationButtons } = require('../ui/leagueCreation');
const { publishLateReminder, publishEditedReminder } = require('../reminders/scheduler');
const { leagueCreationDrafts } = require('./leagueCreationDrafts');

async function handleEventModal(interaction) {
  const context = getEventFormContext(interaction);
  if (context.error) {
    await interaction.reply({ content: context.error, flags: MessageFlags.Ephemeral });
    return;
  }
  const { editing, existing, game, eventType, tierNames, prequalificationKind, draft, draftContext } = context;
  const parsed = parseEventFields(interaction.fields, eventType, existing, { prequalificationKind });
  if (!parsed.ok) {
    await interaction.reply({
      content: `Could not ${editing ? 'update' : 'add'} the event: ${parsed.error}`,
      ...(draft ? { components: buildLeagueCreationButtons(draft) } : {}),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let eventId = existing?.id;
  if (editing) {
    const updated = editEvent({ eventId, guildId: interaction.guildId, ...parsed.event });
    if (!updated) {
      await interaction.reply({ content: `No event found with ID #${eventId}.`, flags: MessageFlags.Ephemeral });
      return;
    }
  } else {
    eventId = createEvent({
      guildId: interaction.guildId, game, eventType, ...parsed.event,
      ...(eventType === 'league' ? { tierNames } : {}),
      createdBy: interaction.user.id,
      createdAt: Math.floor(Date.now() / 1000),
    });
    // Consume a saved draft before awaiting Discord so replay cannot add it twice.
    if (draft) leagueCreationDrafts.remove(draftContext);
  }

  await interaction.reply({
    embeds: [buildEventConfirmation({ id: eventId, game, eventType, tierNames, ...parsed.event }, editing ? 'updated' : 'added')],
    flags: MessageFlags.Ephemeral,
  });
  if (eventType === 'special_event' || eventType === 'league') {
    const publishReminder = editing ? publishEditedReminder : publishLateReminder;
    await publishReminder(interaction.client, eventId, interaction.guildId);
  }
}

// Resolve existing, draft, and legacy forms before the shared validate/save/reply flow.
function getEventFormContext(interaction) {
  const { customId, guildId } = interaction;
  if (customId.startsWith('edit-event:')) {
    const match = /^edit-event:([1-9]\d*)(?::(race|signup))?$/.exec(customId);
    const eventId = match ? Number(match[1]) : null;
    const prequalificationKind = match?.[2] ?? null;
    if (!guildId || !Number.isSafeInteger(eventId)) {
      return { error: 'That event form is invalid. Please run `/edit-event` again.' };
    }
    const existing = getEvent({ eventId, guildId });
    if (!existing) return { error: `No event found with ID #${eventId}.` };
    if (prequalificationKind && (existing.event_type !== 'league' || existing.prequal_kind !== prequalificationKind)) {
      return { error: 'The league pre-qualification setting changed while this form was open. Run `/edit-event` again.' };
    }
    // An unsuffixed edit form has track/class fields; preserve any phase added since it opened.
    return { editing: true, existing, game: existing.game, eventType: existing.event_type, prequalificationKind };
  }

  const parts = customId.split(':');
  let context;
  if (parts[1] === 'draft') {
    const draftContext = { id: parts[2], userId: interaction.user?.id, guildId };
    const draft = /^add-event:draft:[a-f0-9]{24}$/.test(customId) ? leagueCreationDrafts.get(draftContext) : null;
    if (!draft?.data.tierNames) {
      return { error: 'This league draft is unavailable or expired. Run `/add-event` again to create a league.' };
    }
    context = { game: draft.data.game, eventType: 'league', tierNames: draft.data.tierNames,
      prequalificationKind: draft.data.prequalificationKind, draft, draftContext };
  } else {
    const [, game, eventType, tierCount, prequalificationOption] = parts;
    const tierNames = eventType === 'league' ? tierNamesForCount(parts.length === 3 ? 1 : Number(tierCount)) : null;
    const validOptions = parts[0] === 'add-event' && (parts.length === 3
      || (eventType === 'league' && parts.length === 5 && tierNames
        && (prequalificationOption === 'none' || isPrequalificationKind(prequalificationOption))));
    if (validOptions) context = { game, eventType, tierNames,
      prequalificationKind: prequalificationOption === 'none' ? null : prequalificationOption };
  }
  if (!guildId || !context || !gameChoices.some(({ value }) => value === context.game)
    || !eventTypeChoices.some(({ value }) => value === context.eventType)) {
    return { error: 'That event form is invalid or expired. Please run `/add-event` again.' };
  }
  return { editing: false, ...context };
}

module.exports = { handleEventModal };
