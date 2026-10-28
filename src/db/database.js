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
    starts_at INTEGER,
    date_only_until INTEGER,
    track TEXT NOT NULL,
    car_class TEXT,
    details TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled'
      CHECK (status IN ('scheduled', 'cancelled', 'completed')),
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    CHECK (event_type = 'league' OR starts_at IS NOT NULL),
    CHECK (date_only_until IS NULL OR (starts_at IS NOT NULL AND date_only_until >= starts_at))
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
  const columns = db.pragma('table_info(events)');
  const names = columns.map(({ name }) => name);
  const legacyType = names.includes('access_type') && !names.includes('event_type');
  if (legacyType || columns.find(({ name }) => name === 'starts_at').notnull) {
    // Keep an independent SQLite snapshot before changing the parent schema. This
    // includes committed WAL contents, unlike copying the database file directly.
    const backupPath = `${databasePath}.pre-leagues-${Date.now()}.sqlite`;
    db.prepare('VACUUM main INTO ?').run(backupPath);
    const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'events'").get()?.seq;
    // Do not rename the old parent: existing foreign keys must still name events.
    // Disabling FK actions only during this atomic transaction also avoids cascades.
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(createEventsTable.replace('CREATE TABLE events (', 'CREATE TABLE events_next ('));
        db.exec(`
          INSERT INTO events_next (
            id, guild_id, game, event_type, title, starts_at, date_only_until,
            track, car_class, details, status, created_by, created_at
          )
          SELECT
            id, guild_id, game, ${legacyType ? 'access_type' : 'event_type'}, title,
            starts_at, ${names.includes('date_only_until') ? 'date_only_until' : 'NULL'},
            track, car_class, details, status, created_by, created_at
          FROM events;
          DROP TABLE events;
          ALTER TABLE events_next RENAME TO events;
        `);
        if (sequence !== undefined) {
          db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'events'").run(sequence);
        }
        db.exec(createIndexes);
        if (db.pragma('foreign_key_check').length) {
          throw new Error('Event schema migration would break existing foreign keys.');
        }
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  } else {
    if (!names.includes('date_only_until')) {
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
    PRIMARY KEY (event_id, starts_at, lead_days, channel_id)
  );

  CREATE TABLE IF NOT EXISTS special_event_private_reminders (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    remind_at INTEGER NOT NULL,
    requested_at INTEGER NOT NULL,
    sent_at INTEGER,
    PRIMARY KEY (event_id, user_id)
  );


  CREATE TABLE IF NOT EXISTS special_event_responses (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    attending INTEGER NOT NULL CHECK (attending IN (0, 1)),
    days TEXT,
    car_class TEXT,
    availability_hours TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (event_id, user_id)
  );
`);

if (!db.pragma('table_info(special_event_responses)').some(({ name }) => name === 'availability_hours')) {
  db.exec('ALTER TABLE special_event_responses ADD COLUMN availability_hours TEXT');
}

const reminderChannelColumn = db.pragma('table_info(special_event_reminders)')
  .find(({ name }) => name === 'channel_id');
if (reminderChannelColumn.pk === 0) {
  db.transaction(() => {
    db.exec(`
      ALTER TABLE special_event_reminders RENAME TO old_special_event_reminders;
      CREATE TABLE special_event_reminders (
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        starts_at INTEGER NOT NULL,
        lead_days INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        sent_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, starts_at, lead_days, channel_id)
      );
      INSERT INTO special_event_reminders
        (event_id, starts_at, lead_days, channel_id, message_id, sent_at)
      SELECT event_id, starts_at, lead_days, channel_id, message_id, sent_at
      FROM old_special_event_reminders;
      DROP TABLE old_special_event_reminders;
    `);
  })();
}

const privateReminderColumns = db.pragma('table_info(special_event_private_reminders)');
const privateReminderNames = privateReminderColumns.map(({ name }) => name);
const remindAtColumn = privateReminderColumns.find(({ name }) => name === 'remind_at');
if (privateReminderNames.includes('lead_days') || !remindAtColumn?.notnull) {
  const remindAt = privateReminderNames.includes('remind_at')
    ? 'r.remind_at'
    : privateReminderNames.includes('reminder_at') ? 'r.reminder_at' : null;
  const legacyDue = privateReminderNames.includes('lead_days')
    ? 'e.starts_at - r.lead_days * 86400'
    : 'r.requested_at';
  const dueExpression = remindAt ? `COALESCE(${remindAt}, ${legacyDue})` : legacyDue;
  db.transaction(() => {
    db.exec(`
      CREATE TABLE new_special_event_private_reminders (
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        remind_at INTEGER NOT NULL,
        requested_at INTEGER NOT NULL,
        sent_at INTEGER,
        PRIMARY KEY (event_id, user_id)
      );
      INSERT INTO new_special_event_private_reminders
        (event_id, user_id, remind_at, requested_at, sent_at)
      SELECT r.event_id, r.user_id, ${dueExpression},
             r.requested_at, r.sent_at
      FROM special_event_private_reminders r
      JOIN events e ON e.id = r.event_id;
      DROP TABLE special_event_private_reminders;
      ALTER TABLE new_special_event_private_reminders RENAME TO special_event_private_reminders;
    `);
  })();
}
db.exec('CREATE INDEX IF NOT EXISTS idx_private_reminders_due ON special_event_private_reminders (sent_at, remind_at)');


const reminderChannelsExist = db.prepare(`
  SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reminder_channels'
`).get();
if (!reminderChannelsExist) {
  const { loadReminderChannels } = require('../reminders/config');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE reminder_channels (
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        game TEXT CHECK (game IN ('iracing', 'lmu') OR game IS NULL),
        PRIMARY KEY (guild_id, channel_id)
      );
    `);
    const insert = db.prepare(`
      INSERT INTO reminder_channels (guild_id, channel_id, game)
      VALUES (?, ?, ?)
    `);
    for (const [guildId, channels] of loadReminderChannels()) {
      for (const channel of channels) insert.run(guildId, channel.key, channel.game);
    }
  })();
}

// Additive migrations preserve existing channels, responses, and reminder history.
for (const table of ['reminder_channels', 'special_event_reminders', 'special_event_responses', 'special_event_private_reminders']) {
  if (!db.pragma(`table_info(${table})`).some(({ name }) => name === 'team')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN team TEXT NOT NULL DEFAULT ''
      CHECK (team IN ('', 'main', 'academy', 'community'))`);
  }
}

if (!db.pragma('table_info(special_event_reminders)').some(({ name }) => name === 'author_id')) {
  db.exec('ALTER TABLE special_event_reminders ADD COLUMN author_id TEXT');
}

if (!db.pragma('table_info(special_event_reminders)').some(({ name }) => name === 'deleted_at')) {
  db.exec('ALTER TABLE special_event_reminders ADD COLUMN deleted_at INTEGER');
}

// Leagues own their tiers and optional prequalification period. Existing races
// move into the first tier without changing their IDs or schedule information.
const raceTableExists = db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'league_races'",
).get();
const raceColumns = raceTableExists ? db.pragma('table_info(league_races)') : [];
const migrateRaceTiers = raceTableExists && !raceColumns.find(({ name }) => name === 'tier_id')?.notnull;
if (migrateRaceTiers) {
  db.prepare('VACUUM main INTO ?').run(`${databasePath}.pre-league-tiers-${Date.now()}.sqlite`);
}
const createRacesTable = `
  CREATE TABLE league_races (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    tier_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    starts_at INTEGER NOT NULL,
    track TEXT NOT NULL,
    qualifying TEXT,
    details TEXT,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (tier_id, league_id) REFERENCES league_tiers(id, league_id) ON DELETE CASCADE
  );
`;
if (migrateRaceTiers) db.pragma('foreign_keys = OFF');
try {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS league_tiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        league_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) BETWEEN 1 AND 100),
        position INTEGER NOT NULL,
        UNIQUE (league_id, name),
        UNIQUE (id, league_id)
      );
      CREATE INDEX IF NOT EXISTS idx_league_tiers_league_position
        ON league_tiers (league_id, position, id);
      CREATE TABLE IF NOT EXISTS league_settings (
        league_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
        prequal_kind TEXT CHECK (prequal_kind IN ('race', 'signup')),
        prequal_starts_at INTEGER,
        prequal_date_only_until INTEGER,
        prequal_details TEXT,
        CHECK (prequal_date_only_until IS NULL OR (
          prequal_starts_at IS NOT NULL AND prequal_date_only_until >= prequal_starts_at
        )),
        CHECK (prequal_kind IS NOT NULL OR (
          prequal_starts_at IS NULL AND prequal_date_only_until IS NULL AND prequal_details IS NULL
        ))
      );
      INSERT INTO league_tiers (league_id, name, position)
      SELECT id, 'Tier 1', 0 FROM events e
      WHERE event_type = 'league'
        AND NOT EXISTS (SELECT 1 FROM league_tiers t WHERE t.league_id = e.id);
      INSERT OR IGNORE INTO league_settings (league_id)
      SELECT id FROM events WHERE event_type = 'league';
    `);
    if (!raceTableExists) {
      db.exec(createRacesTable);
    } else if (migrateRaceTiers) {
      const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'league_races'").get()?.seq;
      db.exec(createRacesTable.replace('CREATE TABLE league_races (', 'CREATE TABLE league_races_next ('));
      const tierExpression = raceColumns.some(({ name }) => name === 'tier_id')
        ? 'COALESCE(r.tier_id, (SELECT id FROM league_tiers WHERE league_id = r.league_id ORDER BY position, id LIMIT 1))'
        : '(SELECT id FROM league_tiers WHERE league_id = r.league_id ORDER BY position, id LIMIT 1)';
      db.exec(`
        INSERT INTO league_races_next (
          id, league_id, tier_id, title, starts_at, track, qualifying, details, created_by, created_at
        )
        SELECT r.id, r.league_id, ${tierExpression}, r.title, r.starts_at,
          r.track, r.qualifying, r.details, r.created_by, r.created_at
        FROM league_races r;
        DROP TABLE league_races;
        ALTER TABLE league_races_next RENAME TO league_races;
      `);
      if (sequence !== undefined) {
        db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'league_races'").run(sequence);
      }
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_league_races_league_starts_at
        ON league_races (league_id, starts_at, id);
      CREATE INDEX IF NOT EXISTS idx_league_races_tier_starts_at
        ON league_races (tier_id, starts_at, id);
    `);
    if (db.pragma('foreign_key_check').length) {
      throw new Error('League tier migration would break existing foreign keys.');
    }
  })();
} finally {
  if (migrateRaceTiers) db.pragma('foreign_keys = ON');
}

// Recurring prequalification DMs have their own durable opt-out and cadence;
// they do not replace members' one-shot private event reminders.
db.exec(`
  CREATE TABLE IF NOT EXISTS league_prequalification_reminders (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'completed', 'withdrawn')),
    last_sent_at INTEGER,
    next_remind_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (event_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_prequalification_reminders_due
    ON league_prequalification_reminders (status, next_remind_at, event_id);
`);

module.exports = db;
