const db = require('./database');
const { tierNameKey } = require('../domain/leagueInput');

const prequalificationColumns = `
  s.prequal_kind, s.prequal_starts_at, s.prequal_date_only_until, s.prequal_details
`;

function getLeague({ leagueId, guildId }) {
  return db.prepare(`
    SELECT e.*, ${prequalificationColumns}
    FROM events e LEFT JOIN league_settings s ON s.league_id = e.id
    WHERE e.id = @leagueId AND e.guild_id = @guildId AND e.event_type = 'league'
  `).get({ leagueId, guildId });
}

function getLeagues({ guildId, game, leagueId }) {
  const where = ["e.event_type = 'league'", 'e.guild_id = @guildId'];
  const params = { guildId };
  if (leagueId != null) {
    where.push('e.id = @leagueId');
    params.leagueId = leagueId;
  } else {
    where.push("e.status = 'scheduled'", '(COALESCE(e.date_only_until, e.starts_at) IS NULL OR COALESCE(e.date_only_until, e.starts_at) >= @now)');
    params.now = Math.floor(Date.now() / 1000);
  }
  if (game) {
    where.push('e.game = @game');
    params.game = game;
  }
  return db.prepare(`
    SELECT e.*, ${prequalificationColumns}
    FROM events e LEFT JOIN league_settings s ON s.league_id = e.id
    WHERE ${where.join(' AND ')}
    ORDER BY e.starts_at IS NULL, e.starts_at, e.id
  `).all(params);
}

function getLeagueTiers({ leagueId, guildId }) {
  return db.prepare(`
    SELECT t.id, t.league_id, t.name, t.position
    FROM league_tiers t JOIN events e ON e.id = t.league_id
    WHERE t.league_id = @leagueId AND e.guild_id = @guildId AND e.event_type = 'league'
    ORDER BY t.position, t.id
  `).all({ leagueId, guildId });
}

function tierName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 100) throw new Error('Tier names must contain 1–100 characters.');
  return name;
}

function checkTierName(leagueId, name, excludeId = -1) {
  const key = tierNameKey(name);
  const duplicate = db.prepare('SELECT name FROM league_tiers WHERE league_id = ? AND id <> ?')
    .all(leagueId, excludeId).some((tier) => tierNameKey(tier.name) === key);
  if (duplicate) throw new Error('This league already has a tier with that name.');
}

const createTier = db.transaction(({ leagueId, guildId, name }) => {
  if (!getLeague({ leagueId, guildId })) throw new Error('No league found in this server.');
  name = tierName(name);
  checkTierName(leagueId, name);
  const result = db.prepare(`
    INSERT INTO league_tiers (league_id, name, position)
    VALUES (@leagueId, @name, (SELECT COALESCE(MAX(position), -1) + 1 FROM league_tiers WHERE league_id = @leagueId))
  `).run({ leagueId, name });
  return Number(result.lastInsertRowid);
});

function getTier({ tierId, guildId }) {
  return db.prepare(`
    SELECT t.* FROM league_tiers t JOIN events e ON e.id = t.league_id
    WHERE t.id = @tierId AND e.guild_id = @guildId AND e.event_type = 'league'
  `).get({ tierId, guildId });
}

const renameTier = db.transaction(({ tierId, guildId, name }) => {
  const tier = getTier({ tierId, guildId });
  if (!tier) return false;
  name = tierName(name);
  checkTierName(tier.league_id, name, tierId);
  return db.prepare('UPDATE league_tiers SET name = ? WHERE id = ?').run(name, tierId).changes > 0;
});

const deleteTier = db.transaction(({ tierId, guildId }) => {
  const tier = getTier({ tierId, guildId });
  if (!tier) return false;
  const count = db.prepare('SELECT COUNT(*) AS count FROM league_tiers WHERE league_id = ?').get(tier.league_id).count;
  if (count <= 1) throw new Error('A league must keep at least one tier.');
  if (db.prepare('SELECT 1 FROM league_races WHERE tier_id = ? LIMIT 1').get(tierId)) {
    throw new Error("Move or delete this tier's races before removing it.");
  }
  return db.prepare('DELETE FROM league_tiers WHERE id = ?').run(tierId).changes > 0;
});

function setLeaguePrequalification({ leagueId, guildId, kind = null, startsAt = null, dateOnlyUntil = null, details = null }) {
  if (!getLeague({ leagueId, guildId })) return false;
  if (kind !== null && kind !== 'race' && kind !== 'signup') {
    throw new Error('Choose a prequalification race or signup period.');
  }
  if (kind === null) {
    startsAt = null;
    dateOnlyUntil = null;
    details = null;
  }
  if ((startsAt !== null && !Number.isSafeInteger(startsAt))
    || (dateOnlyUntil !== null && (!Number.isSafeInteger(dateOnlyUntil) || startsAt === null || dateOnlyUntil < startsAt))) {
    throw new Error('The prequalification end must be on or after its start.');
  }
  db.prepare(`
    INSERT INTO league_settings
      (league_id, prequal_kind, prequal_starts_at, prequal_date_only_until, prequal_details)
    VALUES (@leagueId, @kind, @startsAt, @dateOnlyUntil, @details)
    ON CONFLICT(league_id) DO UPDATE SET
      prequal_kind = excluded.prequal_kind,
      prequal_starts_at = excluded.prequal_starts_at,
      prequal_date_only_until = excluded.prequal_date_only_until,
      prequal_details = excluded.prequal_details
  `).run({ leagueId, kind, startsAt, dateOnlyUntil, details });
  return true;
}

// Event creation uses this inside its transaction; later tier changes use the
// dedicated methods so an ordinary event edit cannot replace a race's tier.
function initializeLeague({ leagueId, guildId, tierNames = ['Tier 1'], prequalification }) {
  if (!Array.isArray(tierNames) || !tierNames.length) throw new Error('A league needs at least one tier.');
  for (const name of tierNames) createTier({ leagueId, guildId, name });
  setLeaguePrequalification({ leagueId, guildId, ...prequalification });
}

module.exports = {
  getLeague, getLeagues, getLeagueTiers, getTier,
  createTier, renameTier, deleteTier, setLeaguePrequalification, initializeLeague,
};
