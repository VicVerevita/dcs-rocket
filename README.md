# Discord Racing Events Bot

Small Discord bot for iRacing and Le Mans Ultimate events.

## Commands

- `/events` - show upcoming events, optionally filtered by game or event type.
- `/add-event` - staff-only; opens a modal and stores an event in SQLite.
- `/edit-event` and `/delete-event` - staff-only event management.

## Setup

1. Copy `.env.example` to `.env` and fill in the values.
2. Run `npm install`.
3. Run `npm run deploy` to register guild-only slash commands.
4. In each Discord server, use Server Settings → Integrations → your bot → Commands to allow staff roles to use the event management commands.
5. Run `npm start` (or `npm run dev` during development).

Enter a date as `DD.MM.YYYY`, a start time as `DD.MM.YYYY HH:mm`, or a date range as `DD.MM.YYYY to DD.MM.YYYY` (for example, `03.10.2026 to 05.10.2026`). Input uses `DEFAULT_TIMEZONE`. Timed events use Discord timestamps so viewers see their own timezone; date-only events show calendar dates.

## Special-event reminders

Set `REMINDER_CHANNELS` to comma-separated `guild_id:channel_id` entries, one per text channel. Add `:1` for iRacing reminders only or `:2` for Le Mans Ultimate reminders only. Without a suffix, a channel receives both. Repeat a guild ID to post in multiple channels. For example:

```env
REMINDER_CHANNELS=1180572129444507648:YOUR_IRACING_CHANNEL_ID:1,1180572129444507648:YOUR_LMU_CHANNEL_ID:2,1382497852076462182:YOUR_BOTH_GAMES_CHANNEL_ID
```

Leave it empty to disable reminders. The bot needs permission to view and send messages in each channel. No command redeployment is needed when changing reminder settings; restart the bot so it reads the new environment variable.

For scheduled **Special Event** entries, the bot posts at or after 09:00 on the calendar dates 7, 3, and 1 days before the event start, using `DEFAULT_TIMEZONE`. A special event added less than seven days before it starts gets its first signup post immediately. The bot checks every five minutes and retries missed late announcements after a restart. It sends each stage once per channel and avoids another reminder on the announcement day. If the bot is offline all day for a later reminder, that day's reminder is skipped. Editing a future scheduled special event posts a new update reminder in its configured channels each time, even if the date does not change.

Each post has buttons for drivers to say whether they are driving. LMU drivers select one or more of Friday, Saturday, and Sunday. iRacing drivers enter their Saturday availability hours for the 10:00 or 14:00 splits. Everyone can select multiple car classes. Reminder posts group drivers by day and class, and show iRacing availability beside each driver. Responses can be changed later. Special events need 1–10 comma-separated car classes to enable the checklist.

## Code layout

`src/domain` holds event and RSVP validation, `src/ui` builds Discord forms and event messages, `src/interactions` handles submitted forms, `src/reminders` coordinates reminder delivery and responses, and `src/db` owns SQLite persistence.
