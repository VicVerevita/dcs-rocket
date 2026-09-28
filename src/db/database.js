const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { databasePath } = require('../config');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const createEventsTable = `
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    game TEXT NOT NULL CHECK (game IN ('iracing', 'lmu')),
    event_type TEXT NOT NULL CHECK (event_type IN (
      'weekly', 'special_event', 'league', 'other', 'public', 'private'
    )),
    title TEXT NOT NULL,
    starts_at INTEGER NOT NULL,
    date_only_until INTEGER,
    track TEXT NOT NULL,
    car_class TEXT,
    details TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled'
      CHECK (status IN ('scheduled', 'cancelled', 'completed')),
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

const createIndexes = `
  CREATE INDEX IF NOT EXISTS idx_events_guild_starts_at
    ON events (guild_id, starts_at);

  CREATE INDEX IF NOT EXISTS idx_events_status
    ON events (status);
`;

const tableExists = db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'events'",
).get();

if (!tableExists) {
  db.exec(createEventsTable + createIndexes);
} else {
  const columns = db.pragma('table_info(events)').map(({ name }) => name);
  if (columns.includes('access_type') && !columns.includes('event_type')) {
    // Keep existing rows and their Public/Private labels while replacing the old constraint.
    db.transaction(() => {
      db.exec('ALTER TABLE events RENAME TO events_legacy');
      db.exec('DROP INDEX IF EXISTS idx_events_guild_starts_at');
      db.exec('DROP INDEX IF EXISTS idx_events_status');
      db.exec(createEventsTable);
      db.exec(`
        INSERT INTO events (
          id, guild_id, game, event_type, title, starts_at, track,
          car_class, details, status, created_by, created_at
        )
        SELECT
          id, guild_id, game, access_type, title, starts_at, track,
          car_class, details, status, created_by, created_at
        FROM events_legacy
      `);
      db.exec('DROP TABLE events_legacy');
      db.exec(createIndexes);
    })();
  } else {
    if (!columns.includes('date_only_until')) {
      db.exec('ALTER TABLE events ADD COLUMN date_only_until INTEGER');
    }
    db.exec(createIndexes);
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS special_event_reminders (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    starts_at INTEGER NOT NULL,
    lead_days INTEGER NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    sent_at INTEGER NOT NULL,
    PRIMARY KEY (event_id, starts_at, lead_days)
  );

  CREATE TABLE IF NOT EXISTS special_event_responses (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    attending INTEGER NOT NULL CHECK (attending IN (0, 1)),
    days TEXT,
    car_class TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (event_id, user_id)
  );
`);

module.exports = db;
