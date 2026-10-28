const { DateTime } = require('luxon');
const { defaultTimeZone, guildIds } = require('../../config');
const { getEvent } = require('../../db/eventRepository');
const { getResponse } = require('../repository');
const { isPrequalificationOpen, nextPrequalificationReminderAt } = require('../../domain/prequalification');
const { buildPrequalificationReminder } = require('./messages');
const {
  getPrequalificationCandidates,
  ensurePrequalificationReminder,
  getPrequalificationReminder,
  recordPrequalificationReminderSent,
} = require('./repository');

const inFlight = new Set();

function isDue(state, now) {
  return state?.status === 'active' && (state.next_remind_at == null
    || (Number.isSafeInteger(state.next_remind_at) && state.next_remind_at <= now));
}

async function checkPrequalificationReminders(client, now = DateTime.now().setZone(defaultTimeZone), scope = {}) {
  if (!now.isValid) throw new Error(`Invalid prequalification reminder timezone: ${defaultTimeZone}`);
  const startedAt = Date.now();
  // Advance the supplied clock while Discord requests are pending, keeping
  // deterministic callers' date context and checking windows at delivery time.
  const currentTime = () => now.plus({ milliseconds: Math.max(0, Date.now() - startedAt) });
  for (const candidate of getPrequalificationCandidates(Math.floor(now.toSeconds()))) {
    if (!guildIds.includes(candidate.guild_id)
      || (scope.eventId != null && candidate.id !== scope.eventId)
      || (scope.userId != null && candidate.user_id !== scope.userId)) continue;
    const eventId = candidate.id;
    const userId = candidate.user_id;
    const key = `${eventId}:${userId}`;
    if (inFlight.has(key)) continue;
    const checkAt = Math.floor(currentTime().toSeconds());
    if (!isPrequalificationOpen(candidate, checkAt)) continue;
    inFlight.add(key);
    try {
      const state = ensurePrequalificationReminder({ eventId, userId, now: checkAt });
      if (!isDue(state, checkAt)) continue;
      const user = await client.users.fetch(userId);
      // A decline, cancellation, window edit or completion may happen during fetch.
      const event = getEvent({ eventId, guildId: candidate.guild_id });
      const response = getResponse(eventId, userId);
      const freshState = getPrequalificationReminder({ eventId, userId });
      const sendAt = Math.floor(currentTime().toSeconds());
      if (!event || !response?.attending || !isPrequalificationOpen(event, sendAt)
        || !isDue(freshState, sendAt)) continue;
      await user.send(buildPrequalificationReminder(event, userId));
      const deliveredAt = currentTime();
      // This conditional update cannot reactivate reminders stopped during send.
      recordPrequalificationReminderSent({
        eventId, userId,
        sentAt: Math.floor(deliveredAt.toSeconds()),
        nextRemindAt: nextPrequalificationReminderAt(deliveredAt),
      });
    } catch (error) {
      console.error(`Could not DM prequalification reminder for league #${eventId} to user ${userId}:`, error);
    } finally {
      inFlight.delete(key);
    }
  }
}

module.exports = { checkPrequalificationReminders };
