const { randomBytes } = require('node:crypto');

function createDraftStore({ ttlMs = 30 * 60 * 1000, maxDrafts = 500, now = Date.now } = {}) {
  if (!Number.isInteger(maxDrafts) || maxDrafts < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error('Draft stores need a positive capacity and expiration time.');
  }
  const drafts = new Map();
  function prune() {
    const current = now();
    for (const [id, draft] of drafts) if (draft.expiresAt <= current) drafts.delete(id);
  }
  function get({ id, userId, guildId }) {
    prune();
    const draft = drafts.get(id);
    return draft && draft.userId === userId && draft.guildId === guildId ? draft : null;
  }
  function create({ userId, guildId, data }) {
    if (!userId || !guildId) throw new Error('A league draft needs a user and server.');
    prune();
    while (drafts.size >= maxDrafts) drafts.delete(drafts.keys().next().value);
    const draft = { id: randomBytes(12).toString('hex'), userId, guildId, data, expiresAt: now() + ttlMs };
    drafts.set(draft.id, draft);
    return draft;
  }
  function remove(context) {
    const draft = get(context);
    return draft ? drafts.delete(draft.id) : false;
  }
  return { create, get, remove };
}

const leagueCreationDrafts = createDraftStore();

module.exports = { createDraftStore, leagueCreationDrafts };
