const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-database-migration-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '123:456';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');

const databaseModule = require.resolve('../src/db/database');

test('legacy private reminders migrate and accept new requests', () => {
  const initialDb = require(databaseModule);
  initialDb.close();

  const legacyDb = new Database(process.env.DATABASE_PATH);
  legacyDb.exec(`
    DROP TABLE special_event_private_reminders;
    CREATE TABLE special_event_private_reminders (
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      lead_days INTEGER NOT NULL CHECK (lead_days IN (7, 3, 1)),
      requested_at INTEGER NOT NULL,
      sent_at INTEGER,
      PRIMARY KEY (event_id, user_id)
    );
    INSERT INTO events
      (id, guild_id, game, event_type, title, starts_at, track, status, created_by, created_at)
    VALUES (1, '123', 'iracing', 'special_event', 'Race', 2000000000,
            'Spa', 'scheduled', 'staff', 1900000000);
    INSERT INTO special_event_private_reminders
      (event_id, user_id, lead_days, requested_at, sent_at)
    VALUES (1, 'driver', 3, 1900000000, NULL);
  `);
  legacyDb.close();

  delete require.cache[databaseModule];
  const db = require(databaseModule);
  try {
    const { schedulePrivateReminder } = require('../src/reminders/repository');
    const oldReminder = db.prepare(`
      SELECT remind_at FROM special_event_private_reminders
      WHERE event_id = 1 AND user_id = 'driver'
    `).get();
    assert.equal(oldReminder.remind_at, 2000000000 - 3 * 86400);
    assert.deepEqual(
      db.pragma('table_info(special_event_private_reminders)').map(({ name }) => name),
      ['event_id', 'user_id', 'remind_at', 'requested_at', 'sent_at', 'team'],
    );

    schedulePrivateReminder({
      eventId: 1, userId: 'driver', remindAt: 1999990000, requestedAt: 1900000100,
    });
    assert.equal(db.prepare(`
      SELECT remind_at FROM special_event_private_reminders
      WHERE event_id = 1 AND user_id = 'driver'
    `).get().remind_at, 1999990000);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
