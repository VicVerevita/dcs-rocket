# Discord Racing Events Bot

Small Discord bot for iRacing and Le Mans Ultimate events.

## Commands

- `/events` - show upcoming events, optionally filtered by game or event type.
- `/add-event` - staff-only; opens a modal and stores an event in SQLite.
- `/edit-event` and `/delete-event` - staff-only event management.
- `/config reminders set|remove|list` - manage reminder channels and their games (Manage Server permission).

## Setup

1. Copy `.env.example` to `.env` and fill in the values.
2. Run `npm install`.
3. Run `npm run deploy` to register guild-only slash commands.
4. In each Discord server, use Server Settings → Integrations → your bot → Commands to allow staff roles to use the event management commands. Members with Manage Server permission can use `/config`.
5. Run `npm start` (or `npm run dev` during development).
6. Use `/config reminders set` in each server to choose a text or announcement channel and assign it to iRacing, Le Mans Ultimate, or both games. Use `/config reminders list` to review settings and `/config reminders remove` to stop posting in a channel.

Enter a date as `DD.MM.YYYY`, a start time as `DD.MM.YYYY HH:mm`, or a date range as `DD.MM.YYYY to DD.MM.YYYY` (for example, `03.10.2026 to 05.10.2026`). Input uses `DEFAULT_TIMEZONE`. Timed events use Discord timestamps so viewers see their own timezone; date-only events show calendar dates.

## Special-event reminders

Configure server reminder posts with `/config reminders set`. Select a channel and choose iRacing, Le Mans Ultimate, or both games. You can use multiple channels per server and update them without restarting the bot. The bot needs View Channel, Send Messages, and Embed Links in each selected channel. `/config reminders list` shows the current assignments; `/config reminders remove` stops new posts in a channel. Removing all channels disables server reminder posts.

On the first start after upgrading, existing `REMINDER_CHANNELS` entries are imported into the database once. After that, the Discord command is the source of truth, so changing `REMINDER_CHANNELS` has no effect. The old env format remains supported only for that one-time import.

For scheduled **Special Event** entries, the bot posts at or after 09:00 on the calendar dates 7, 3, and 1 days before the event start, using `DEFAULT_TIMEZONE`. A special event added less than seven days before it starts gets its first signup post immediately. The bot checks every five minutes and retries missed late announcements after a restart. It sends each stage once per channel and avoids another reminder on the announcement day. If the bot is offline all day for a later reminder, that day's reminder is skipped. Editing a future scheduled special event posts a new update reminder in its configured channels each time, even if the date does not change.

Each post has buttons for drivers to say whether they are driving. LMU drivers select one or more of Friday, Saturday, and Sunday. iRacing drivers enter their Saturday availability hours for the 10:00 or 14:00 splits. Everyone can select multiple car classes. Reminder posts group drivers by day and class, and show iRacing availability beside each driver. Responses can be changed later. The **Remind me again** button schedules one DM for the next day at or shortly after 09:00 in `DEFAULT_TIMEZONE`, if the event is still active then. The DM buttons use the same RSVP record and refresh the server overview. Special events need 1–10 comma-separated car classes to enable the checklist.

## Code layout

`src/domain` holds event and RSVP validation, `src/ui` builds Discord forms and event messages, `src/interactions` handles submitted forms, `src/reminders` coordinates reminder delivery and responses, and `src/db` owns SQLite persistence.
