# Discord Racing Events Bot

Small Discord bot for iRacing and Le Mans Ultimate events.

## Commands

- `/events` - show upcoming events, optionally filtered by game or event type.
- `/add-event` - staff-only; opens a modal and stores an event in SQLite.
- `/edit-event` and `/delete-event` - staff-only event management.
- `/config reminders set|remove|list` - manage reminder channels, games, and teams (Manage Server permission).

## Setup

1. Copy `.env.example` to `.env` and fill in the values.
2. Run `npm install`.
3. Run `npm run deploy` to register guild-only slash commands.
4. In each Discord server, use Server Settings → Integrations → your bot → Commands to allow staff roles to use the event management commands. Members with Manage Server permission can use `/config`.
5. Run `npm start` (or `npm run dev` during development).
6. Use `/config reminders set` in each server to choose a text or announcement channel and assign it to iRacing, Le Mans Ultimate, or both games. Optionally assign Main, Academy, or Community as its team. Use `/config reminders list` to review settings and `/config reminders remove` to stop posting in a channel.

Enter a date as `DD.MM.YYYY`, a start time as `DD.MM.YYYY HH:mm`, or a date range as `DD.MM.YYYY to DD.MM.YYYY` (for example, `03.10.2026 to 05.10.2026`). Input uses `DEFAULT_TIMEZONE`. Timed events use Discord timestamps so viewers see their own timezone; date-only events show calendar dates.

## Special-event reminders

Configure server reminder posts with `/config reminders set`. Select a channel and choose iRacing, Le Mans Ultimate, or both games. You can use multiple channels per server and update them without restarting the bot. The bot needs View Channel, Send Messages, and Embed Links in each selected channel. `/config reminders list` shows the current assignments; `/config reminders remove` stops new posts in a channel. Removing all channels disables server reminder posts.

On the first start after upgrading, existing `REMINDER_CHANNELS` entries are imported into the database once. After that, the Discord command is the source of truth, so changing `REMINDER_CHANNELS` has no effect. The old env format remains supported only for that one-time import.

For scheduled **Special Event** entries, the bot posts at or after 09:00 on the calendar dates 7, 3, and 1 days before the event start, using `DEFAULT_TIMEZONE`. A special event added less than seven days before it starts gets its first signup post immediately. The bot checks every five minutes and retries missed late announcements after a restart. It sends each stage once per channel and avoids another reminder on the announcement day. If the bot is offline all day for a later reminder, that day's reminder is skipped. Editing a future scheduled special event posts a new update reminder in its configured channels each time, even if the date does not change.

After a scheduled reminder or event update is sent successfully, the bot deletes its older reminder posts for that same event in that channel, including posts from before a date change. Driver responses carry over to the new post, and delivery history is retained to prevent duplicate reminders after a restart. If sending fails, the previous post stays. Posts created by another bot are skipped; failed deletions are logged and retried when the next reminder is sent.

Each post has buttons for drivers to say whether they are driving. LMU drivers select one or more of Friday, Saturday, and Sunday. iRacing drivers enter their Saturday availability hours for the 10:00 or 14:00 splits. Everyone can select multiple car classes. Reminder posts group drivers by day and class, and show iRacing availability beside each driver. Responses can be changed later. The **Remind me again** button schedules one DM for the next day at or shortly after 09:00 in `DEFAULT_TIMEZONE`, if the event is still active then. The DM buttons use the same RSVP record and refresh the server overview. Special events need 1–10 comma-separated car classes to enable the checklist.

## Team channels

Assign a team to each reminder channel with the optional `team` setting:

```text
/config reminders set channel:#main-events game:Both games team:Main team
/config reminders set channel:#academy-events game:Both games team:Academy team
/config reminders set channel:#community-events game:Both games team:Community team
```

Choose the game and team from Discord's command menus. The same event is posted to every channel matching its game. Every reminder channel shows all drivers for that event, separated under **Main team**, **Academy team**, and **Community team** within each day's car-class overview. Legacy responses without a team appear under **Unassigned team**. **Not driving** shows a visible total and one combined list of names hidden behind Discord spoiler tags, without team divisions or notifications. The channel's **Signup team** determines which team a new response joins, and its buttons retain that team context. Discord roles and channel permissions control who can see and respond in each channel; the bot does not rank members' roles or create Discord categories.

Each driver has **one signup per event**. A first response assigns the signup to the channel's team. Responding in another team's channel asks, for example, “You are already signed up for team: Main. Do you wish to change to Academy?” Choosing **Keep Main** leaves the response unchanged. Choosing **Change to Academy** allows the driver to submit their response for Academy; the signup moves only when the form is submitted. Selecting **Can't drive** in a different team also requires confirmation. All saved server reminders refresh after a response changes.

DM reminders update that same signup and keep its current team, including after a team switch. Requesting a DM before signing up remembers the requesting channel's team. There is still only one pending DM reminder per driver/event.

**All teams (shared)** is a channel without an assigned signup team. New channels default to this setting when `team` is omitted. A first response in a shared channel appears under **Unassigned team**; responding there later preserves an existing signup's team. Omitting `team` when changing an existing channel's game preserves its current team; explicitly choose **All teams (shared)** to reset it. All channels show the same combined roster regardless of their signup team. Changing a channel's team refreshes its saved reminder posts; if Discord prevents an edit, the command reports that some posts need attention. Removing a channel stops new reminders; its existing posts retain their last signup context.

Updating an existing channel uses the same `/config reminders set` command. A bot can edit only its own Discord posts. When testing with a different bot and an existing database, posts from the original bot are skipped and reported separately. Their authors are remembered so later updates skip them without fetching or editing them again. Their reminder history is retained, preventing duplicate scheduled posts; events and driver responses are preserved. Existing posts from another bot keep their original display, while new reminders show the combined roster and use the channel's updated signup team.

## Upgrading to team channels

1. Stop the bot and back up its SQLite data directory, including any WAL files. Keep the same `DATABASE_PATH` (and persistent data volume when using Docker).
2. Install the updated code/dependencies and run `npm run deploy` to register the optional team setting. Start the updated bot; schema changes run automatically and can safely run again on later starts.
3. Review `/config reminders list` and assign teams to the desired channels. Existing channels remain **All teams (shared)** until configured, and existing events, responses, pending DMs, and reminder delivery history are preserved.

Legacy responses have no inferred team and remain visible under **Unassigned team** in every channel's overview. Drivers can use a team channel's buttons and confirm the move to assign their existing signup. Existing reminder and DM buttons remain supported. Assigning a channel's team does not create duplicate reminders or change event IDs, dates, game filters, or the `/events` listing.

## Running development alongside production

Each process handles interactions only for its own `GUILD_IDS` and silently ignores other servers. DM reminder responses use the source server encoded in their buttons. If development and production share a bot token, their guild lists must be disjoint and **both instances must have this routing fix**. An older instance can still acknowledge another server's command with “This bot is not configured for this server,” causing `40060` in the intended instance. Separate bot applications/tokens also isolate development and production credentials, presence, and API usage.

## Code layout

`src/domain` holds event and RSVP validation, `src/ui` builds Discord forms and event messages, `src/interactions` handles submitted forms, `src/reminders` coordinates reminder delivery and responses, and `src/db` owns SQLite persistence.
