const db = require('./database');

const selectRace = `
  SELECT r.*, e.guild_id, e.game, t.name AS tier_name, t.position AS tier_position
  FROM league_races r
  JOIN events e ON e.id = r.league_id
  JOIN league_tiers t ON t.id = r.tier_id AND t.league_id = r.league_id
  WHERE e.guild_id = @guildId AND e.event_type = 'league'
`;

function createRace({ leagueId, guildId, tierId = null, title, startsAt, track, qualifying = null, details = null, createdBy, createdAt }) {
  const result = db.prepare(`
    INSERT INTO league_races
      (league_id, tier_id, title, starts_at, track, qualifying, details, created_by, created_at)
    SELECT e.id, t.id, @title, @startsAt, @track, @qualifying, @details, @createdBy, @createdAt
    FROM events e JOIN league_tiers t ON t.league_id = e.id
    WHERE e.id = @leagueId AND e.guild_id = @guildId AND e.event_type = 'league'
      AND t.id = COALESCE(@tierId, (
        SELECT id FROM league_tiers WHERE league_id = e.id ORDER BY position, id LIMIT 1
      ))
  `).run({ leagueId, guildId, tierId, title, startsAt, track, qualifying, details, createdBy, createdAt });
  if (!result.changes) throw new Error('No league or matching tier found in this server.');
  return Number(result.lastInsertRowid);
}

function getRace({ raceId, guildId }) {
  return db.prepare(`${selectRace} AND r.id = @raceId`).get({ raceId, guildId });
}

function getLeagueRaces({ leagueId, guildId, tierId = null }) {
  return db.prepare(`${selectRace} AND r.league_id = @leagueId
    AND (@tierId IS NULL OR r.tier_id = @tierId)
    ORDER BY t.position, t.id, r.starts_at, r.id`)
    .all({ leagueId, guildId, tierId });
}

function editRace({ raceId, guildId, tierId = null, title, startsAt, track, qualifying = null, details = null }) {
  return db.prepare(`
    UPDATE league_races
    SET title = @title, starts_at = @startsAt, track = @track,
        qualifying = @qualifying, details = @details,
        tier_id = COALESCE(@tierId, tier_id)
    WHERE id = @raceId AND league_id IN (
      SELECT id FROM events WHERE guild_id = @guildId AND event_type = 'league'
    ) AND (@tierId IS NULL OR EXISTS (
      SELECT 1 FROM league_tiers t WHERE t.id = @tierId AND t.league_id = league_races.league_id
    ))
  `).run({ raceId, guildId, tierId, title, startsAt, track, qualifying, details }).changes > 0;
}

function deleteRace({ raceId, guildId }) {
  return db.prepare(`
    DELETE FROM league_races
    WHERE id = @raceId AND league_id IN (
      SELECT id FROM events WHERE guild_id = @guildId AND event_type = 'league'
    )
  `).run({ raceId, guildId }).changes > 0;
}

module.exports = { createRace, getRace, getLeagueRaces, editRace, deleteRace };
