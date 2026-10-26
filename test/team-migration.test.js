const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-team-migration-'));
process.env.DISCORD_TOKEN = 'test';
process.env.CLIENT_ID = 'test';
process.env.GUILD_IDS = '123';
process.env.REMINDER_CHANNELS = '123:456:1';
process.env.DATABASE_PATH = path.join(directory, 'events.sqlite');

test('team upgrade preserves all data and reminder deduplication across repeated starts', async () => {
  const databaseModule = require.resolve('../src/db/database');
  let db = require(databaseModule);
  const now = Math.floor(Date.now() / 1000);
  const startsAt = now + 2 * 86400;
  const tables = ['events', 'reminder_channels', 'special_event_reminders', 'special_event_private_reminders', 'special_event_responses'];
  try {
    // Recreate the schema immediately before team support, with live records in every table.
    for (const table of tables.filter((table) => table !== 'events')) {
      db.exec(`ALTER TABLE ${table} DROP COLUMN team`);
    }
    db.exec('ALTER TABLE special_event_reminders DROP COLUMN author_id');
    db.prepare(`
      INSERT INTO events
        (id, guild_id, game, event_type, title, starts_at, track, car_class, status, created_by, created_at)
      VALUES (1, '123', 'iracing', 'special_event', 'Existing race', ?, 'Spa', 'GT3, GTP', 'scheduled', 'staff', ?)
    `).run(startsAt, now);
    db.prepare(`
      INSERT INTO special_event_reminders
        (event_id, starts_at, lead_days, channel_id, message_id, sent_at)
      VALUES (1, ?, 7, '456', 'existing-message', ?)
    `).run(startsAt, now);
    db.prepare(`
      INSERT INTO special_event_private_reminders
        (event_id, user_id, remind_at, requested_at, sent_at)
      VALUES (1, 'driver', ?, ?, NULL)
    `).run(now + 86400, now);
    db.prepare(`
      INSERT INTO special_event_responses
        (event_id, user_id, attending, days, car_class, availability_hours, updated_at)
      VALUES (1, 'driver', 1, 'Saturday', 'GT3, GTP', '10:00 or 14:00', ?)
    `).run(now);
    const before = new Map(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));

    for (let start = 0; start < 2; start++) {
      db.close();
      delete require.cache[databaseModule];
      db = require(databaseModule);
      for (const table of tables) {
        const rows = db.prepare(`SELECT * FROM ${table}`).all();
        assert.deepEqual(rows.map(({ team, author_id, ...row }) => row), before.get(table), table);
        if (table !== 'events') assert.ok(rows.every(({ team }) => team === ''), table);
        if (table === 'special_event_reminders') assert.ok(rows.every(({ author_id }) => author_id === null));
      }
      assert.deepEqual(db.pragma('foreign_key_check'), []);
    }

    let sends = 0;
    const client = { channels: { fetch: async () => ({
      guildId: '123', isTextBased: () => true,
      send: async () => { sends++; return { id: 'duplicate' }; },
    }) } };
    const { publishLateReminder } = require('../src/reminders/scheduler');
    await publishLateReminder(client, 1, '123');
    assert.equal(sends, 0);
    // The original compound key still enforces one response per driver/event.
    assert.deepEqual(db.pragma('table_info(special_event_responses)')
      .filter(({ pk }) => pk).map(({ name }) => name), ['event_id', 'user_id']);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
