const db = require('./database');

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

function createEvent(event) {
  const result = insertEvent.run(event);
  return Number(result.lastInsertRowid);
}

function getEvent({ eventId, guildId }) {
  return db.prepare(`
    SELECT *
    FROM events
    WHERE id = @eventId AND guild_id = @guildId
  `).get({ eventId, guildId });
}

function getUpcomingEvents({ guildId, game, eventType, limit = 10 }) {
  const where = [
    'guild_id = @guildId',
    "status = 'scheduled'",
    'COALESCE(date_only_until, starts_at) >= @now',
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
    SELECT *
    FROM events
    WHERE ${where.join(' AND ')}
    ORDER BY starts_at ASC
    LIMIT @limit
  `).all(params);
}

function editEvent({ eventId, guildId, title, startsAt, dateOnlyUntil, track, carClass, details }) {
  return db.prepare(`
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
}

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
