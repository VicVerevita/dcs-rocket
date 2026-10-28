const db = require('./database');
const { initializeLeague, setLeaguePrequalification } = require('./leagueRepository');

const insertEvent = db.prepare(`
  INSERT INTO events (
    guild_id,
    game,
    event_type,
    title,
    starts_at,
    date_only_until,
    track,
    car_class,
    details,
    created_by,
    created_at
  ) VALUES (
    @guildId,
    @game,
    @eventType,
    @title,
    @startsAt,
    @dateOnlyUntil,
    @track,
    @carClass,
    @details,
    @createdBy,
    @createdAt
  )
`);

const createEvent = db.transaction((event) => {
  const result = insertEvent.run({ startsAt: null, dateOnlyUntil: null, track: '', carClass: null, details: null, ...event });
  const eventId = Number(result.lastInsertRowid);
  if (event.eventType === 'league') {
    initializeLeague({ leagueId: eventId, guildId: event.guildId, tierNames: event.tierNames, prequalification: event.prequalification });
  }
  return eventId;
});

function getEvent({ eventId, guildId }) {
  return db.prepare(`
    SELECT e.*, s.prequal_kind, s.prequal_starts_at, s.prequal_date_only_until, s.prequal_details
    FROM events e LEFT JOIN league_settings s ON s.league_id = e.id
    WHERE e.id = @eventId AND e.guild_id = @guildId
  `).get({ eventId, guildId });
}

function getUpcomingEvents({ guildId, game, eventType, limit = 10 }) {
  const where = [
    'e.guild_id = @guildId',
    "status = 'scheduled'",
    `(event_type = 'league' AND starts_at IS NULL
      OR COALESCE(date_only_until, starts_at) >= @now)`,
  ];

  const params = {
    guildId,
    now: Math.floor(Date.now() / 1000),
    limit,
  };

  if (game) {
    where.push('game = @game');
    params.game = game;
  }

  if (eventType) {
    where.push('event_type = @eventType');
    params.eventType = eventType;
  }

  return db.prepare(`
    SELECT e.*, s.prequal_kind, s.prequal_starts_at, s.prequal_date_only_until, s.prequal_details
    FROM events e LEFT JOIN league_settings s ON s.league_id = e.id
    WHERE ${where.join(' AND ')}
    ORDER BY starts_at IS NULL, starts_at ASC, e.id ASC
    LIMIT @limit
  `).all(params);
}

const editEvent = db.transaction(({ eventId, guildId, title, startsAt = null, dateOnlyUntil = null, track = '', carClass = null, details = null, prequalification }) => {
  const updated = db.prepare(`
    UPDATE events
    SET title = @title,
        starts_at = @startsAt,
        date_only_until = @dateOnlyUntil,
        track = @track,
        car_class = @carClass,
        details = @details
    WHERE id = @eventId AND guild_id = @guildId
  `).run({
    eventId,
    guildId,
    title,
    startsAt,
    dateOnlyUntil,
    track,
    carClass,
    details,
  }).changes > 0;
  if (updated && prequalification !== undefined) {
    setLeaguePrequalification({ leagueId: eventId, guildId, ...prequalification });
  }
  return updated;
});

function deleteEvent({ eventId, guildId }) {
  return db.prepare(`
    DELETE FROM events
    WHERE id = @eventId AND guild_id = @guildId
  `).run({ eventId, guildId }).changes > 0;
}


module.exports = {
  createEvent,
  getEvent,
  editEvent,
  deleteEvent,
  getUpcomingEvents,
};
