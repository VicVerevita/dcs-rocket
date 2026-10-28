# Discord Racing Events Bot

Small Discord bot for iRacing and Le Mans Ultimate events.

## Commands

- `/events` - show upcoming events and active leagues, optionally filtered by game or event type.
- `/add-event` - staff-only; create an event or league.
- `/edit-event` and `/delete-event` - staff-only event management.
- `/races league-id:<id>` - show a league's race schedule and qualifying details.
- `/leagues` - show active leagues with pre-qualification, tiers, and races in a compact overview; optionally filter by game or `league-id` (which also shows past seasons).
- `/add-race league-id:<id>`, `/edit-race race-id:<id>`, and `/delete-race race-id:<id>` - staff-only league race management.
- `/league-tier add|rename|remove` - staff-only tier management; each league keeps at least one tier.
- `/league-prequal set|clear` - staff-only management of league-wide pre-qualification.
- `/config reminders set|remove|list` - manage reminder channels, games, and teams (Manage Server permission).

## Setup

1. Copy `.env.example` to `.env` and fill in the values.
2. Run `npm install`.
3. Run `npm run deploy` to register guild-only slash commands.
4. In each Discord server, use Server Settings → Integrations → your bot → Commands to allow staff roles to use the event and race management commands. Members with Manage Server permission can use `/config`.
5. Run `npm start` (or `npm run dev` during development).
6. Use `/config reminders set` in each server to choose a text or announcement channel and assign it to iRacing, Le Mans Ultimate, or both games. Optionally assign Main, Academy, or Community as its team. Use `/config reminders list` to review settings and `/config reminders remove` to stop posting in a channel.

Enter a date as `DD.MM.YYYY`, a start time as `DD.MM.YYYY HH:mm`, or a date range as `DD.MM.YYYY to DD.MM.YYYY` (for example, `03.10.2026 to 05.10.2026`). Input uses `DEFAULT_TIMEZONE`. Timed events use Discord timestamps so viewers see their own timezone; date-only events show calendar dates.

## Leagues and races

Create a league with `/add-event` and select **League** as the event type. Choose its tier count and optional pre-qualification, then name the tiers before entering the league details. Enter season dates such as `03.10.2026 to 05.12.2026`, or leave them blank. A single calendar date is also accepted. Ongoing seasons can have a start date in the past if their end date is still in the future. Use `/edit-event` to change the league's season dates or details later, including clearing its dates. `/events type:League` includes ongoing and undated leagues.

Every league has at least one tier. Choose 1–20 with the optional `tiers` creation option (default: 1). The first form starts with **Tier 1**, **Tier 2**, and so on; replace these with your tier names, one per line, keeping exactly as many names as the chosen count. After submitting the names, select **Continue league details** to open the league details form. The league is saved and announced only when you submit those details; unfinished setup does not create a league. Add or rename tiers later with `/league-tier`; `/leagues league-id:<id>` displays their IDs. Existing tier names are preserved. A tier describes the competition division and is independent of the Main, Academy, and Community signup teams. Interest remains a response for the whole league.

If the league has pre-qualification, choose the optional `pre-qualification` creation option as **Pre-qualification race** or **Signup period**. The league details form then includes its period and details; use the details for a race's venue/format or a signup form link. A period can be a date, date range, or exact date/time; it may be left blank until announced. Pre-qualification belongs to the whole league, and is separate from each race's ordinary qualifying session. It is shown in league posts and `/leagues`. Without pre-qualification selected, the modal offers optional tracks and car classes. With it selected, include that information in league details; existing tracks and classes are preserved when editing.

After saving the league, use its event ID to add races:

```text
/add-race league-id:12
/add-race league-id:12 tier-id:8
/races league-id:12
/races league-id:12 tier-id:8
/leagues league-id:12
/edit-race race-id:5
/edit-race race-id:5 tier-id:8
/delete-race race-id:5
/league-tier add league-id:12 name:Pro
/league-tier rename league-id:12 tier-id:8 name:Am
/league-tier remove league-id:12 tier-id:8
/league-prequal set league-id:12 type:Signup period
/league-prequal clear league-id:12
```

Each race has a name, exact date and time (`DD.MM.YYYY HH:mm` in `DEFAULT_TIMEZONE`), track, optional qualifying information, and optional details. Every race belongs to one tier of its parent league. For a league with one tier, `/add-race` selects it automatically; with multiple tiers, choose `tier-id`. Use the optional `tier-id` on `/edit-race` to move a race within the same league. A tier containing races must have them moved or deleted before it can be removed, and the final tier cannot be removed. Deleting a league also removes its tiers and races.

`/races` shows race schedules grouped by tier, in date order within each tier; `tier-id` filters it to one division. `/leagues` keeps the league information, pre-qualification, and all tier sections together in one compact message, including empty tiers. Both commands use **Previous** and **Next** buttons when more pages are needed, updating the same message. Race details also appear in the add/edit command's confirmation. Race schedules stay out of reminder posts and private reminders, and race edits do not send league reminder pings.

League posts have **Interested**, **Not interested**, and **Remind me again** buttons. Interest is a simple response for the whole league, without the special-event day and car-class checklist. The existing channel signup teams, team-change confirmations, combined roster, and next-day private reminder behavior apply to leagues too. Responses carry over when the league or its races change.

Active leagues are announced immediately in matching reminder channels, including ongoing seasons and leagues without dates. Future dated seasons also receive the usual 7-, 3-, and 1-day reminders at or after 09:00 in `DEFAULT_TIMEZONE`. Undated leagues have no scheduled date-based stages. Editing an active league or changing its pre-qualification publishes an updated league post with existing interest responses. Reminder posts show the league, season, tier names, pre-qualification, and interest, with command hints for the full schedules. Adding, renaming, or removing a tier with `/league-tier` refreshes the tier names in existing reminder posts without a new `@here` ping. Reminder posts do not list races. Server reminders are based on the league's season start; individual race starts do not have separate automatic reminders.

Interested members also receive automatic pre-qualification DMs once its race or signup period opens. A known opening date is required. The first DM arrives on the next five-minute check, including for someone who joins an already open period. Further DMs follow every three calendar days from successful delivery in `DEFAULT_TIMEZONE`, preserving local time across daylight-saving changes. Delivery state survives restarts; downtime produces one overdue DM, then a new three-day interval. Failed DMs remain due for retry. These DMs work without a configured server reminder channel.

Choose **I did** to stop pre-qualification DMs while keeping league interest, or **I'm not doing it anymore** to stop them and withdraw interest. Choosing **Interested** again after withdrawing resumes these DMs while the period is open; completing pre-qualification remains recorded even if interest changes later. Without a reply, DMs stop at the stated closing date or when the league ends or is cancelled. If no closing date is set, the season start closes pre-qualification when it follows the opening date; otherwise the known league end applies. A period without either deadline stays open until stopped. Changing or clearing the pre-qualification dates is reflected on the next check.

## Server and private reminders

Configure server reminder posts with `/config reminders set`. Select a channel and choose iRacing, Le Mans Ultimate, or both games. You can use multiple channels per server and update them without restarting the bot. The bot needs View Channel, Send Messages, and Embed Links in each selected channel. `/config reminders list` shows the current assignments; `/config reminders remove` stops new posts in a channel. Removing all channels disables server reminder posts.

New server reminder posts include `@here`, including initial announcements, scheduled reminders, and event updates. Grant the bot **Mention @everyone, @here, and All Roles** in each reminder channel to notify online members. Discord uses the same permission for `@everyone` and `@here`; bots cannot bypass it or a member's **Suppress @everyone and @here** notification setting. Without the permission, reminders still post and `/config reminders set` explains how to enable notifications. Roster and tier name refreshes do not send another ping, and private reminders do not include `@here`. Driver and role mentions remain suppressed.

Saving a reminder channel immediately posts every upcoming scheduled special event and active league matching its game selection that has not already been announced there. Posts use the channel's signup team and include current responses. Repeating the command or removing and re-adding a channel preserves delivery history and avoids duplicate announcements. Failed sends can be retried by running the command again. Later 7-, 3-, and 1-day reminders continue for dated entries, with no additional scheduled reminder on the initial announcement day.

On the first start after upgrading, existing `REMINDER_CHANNELS` entries are imported into the database once. After that, the Discord command is the source of truth, so changing `REMINDER_CHANNELS` has no effect. The old env format remains supported only for that one-time import.

For scheduled **Special Event** entries, the bot posts at or after 09:00 on the calendar dates 7, 3, and 1 days before the event start, using `DEFAULT_TIMEZONE`. A special event added less than seven days before it starts gets its first signup post immediately. The bot checks every five minutes and retries missed late announcements after a restart. It sends each stage once per channel and avoids another reminder on the announcement day. If the bot is offline all day for a later reminder, that day's reminder is skipped. Editing a future scheduled special event posts a new update reminder in its configured channels each time, even if the date does not change.

After a scheduled reminder or event update is sent successfully, the bot deletes its older reminder posts for that same event in that channel, including posts from before a date change. Driver responses carry over to the new post, and delivery history is retained to prevent duplicate reminders after a restart. If sending fails, the previous post stays. Posts created by another bot are skipped; failed deletions are logged and retried when the next reminder is sent.

Special-event posts have buttons for drivers to say whether they are driving. LMU drivers select one or more of Friday, Saturday, and Sunday. iRacing drivers enter their Saturday availability hours for the 10:00 or 14:00 splits. Everyone can select multiple car classes. Reminder posts group drivers by day and class, and show iRacing availability beside each driver. Responses can be changed later. The **Remind me again** button schedules one DM for the next day at or shortly after 09:00 in `DEFAULT_TIMEZONE`, if the event or league is still active then. The DM buttons use the same response record and refresh the server overview. Special events need 1–10 comma-separated car classes to enable the checklist.

## Team channels

Assign a team to each reminder channel with the optional `team` setting:

```text
/config reminders set channel:#main-events game:Both games team:Main team
/config reminders set channel:#academy-events game:Both games team:Academy team
/config reminders set channel:#community-events game:Both games team:Community team
```

Choose the game and team from Discord's command menus. The same event or league is posted to every channel matching its game. Every reminder channel shows all responses, separated under **Main team**, **Academy team**, and **Community team**. Special-event posts group teams within each day's car-class overview; league posts group interested members by team. Legacy responses without a team appear under **Unassigned team**. **Not driving** and **Not interested** show a visible total and one combined list of names hidden behind Discord spoiler tags, without team divisions or notifications. The channel's **Signup team** determines which team a new response joins, and its buttons retain that team context. Discord roles and channel permissions control who can see and respond in each channel; the bot does not rank members' roles or create Discord categories.

Each driver has **one signup per event**. A first response assigns the signup to the channel's team. Responding in another team's channel asks, for example, “You are already signed up for team: Main. Do you wish to change to Academy?” Choosing **Keep Main** leaves the response unchanged. Choosing **Change to Academy** allows the driver to submit their response for Academy; the signup moves only when the form is submitted. Selecting **Can't drive** in a different team also requires confirmation. All saved server reminders refresh after a response changes.

DM reminders update that same signup and keep its current team, including after a team switch. Requesting a DM before signing up remembers the requesting channel's team. There is still only one pending DM reminder per driver/event.

**All teams (shared)** is a channel without an assigned signup team. New channels default to this setting when `team` is omitted. A first response in a shared channel appears under **Unassigned team**; responding there later preserves an existing signup's team. Omitting `team` when changing an existing channel's game preserves its current team; explicitly choose **All teams (shared)** to reset it. All channels show the same combined roster regardless of their signup team. Changing a channel's team refreshes its saved reminder posts; if Discord prevents an edit, the command reports that some posts need attention. Removing a channel stops new reminders; its existing posts retain their last signup context.

Updating an existing channel uses the same `/config reminders set` command. A bot can edit only its own Discord posts. When testing with a different bot and an existing database, posts from the original bot are skipped and reported separately. Their authors are remembered so later updates skip them without fetching or editing them again. Their reminder history is retained, preventing duplicate scheduled posts; events and driver responses are preserved. Existing posts from another bot keep their original display, while new reminders show the combined roster and use the channel's updated signup team.

## Upgrading

1. Stop the bot and back up its SQLite data directory, including any WAL files. Keep the same `DATABASE_PATH` (and persistent data volume when using Docker).
2. Install the updated code/dependencies and run `npm run deploy` to register the league/race commands and current options. Allow staff roles to use the league, tier, pre-qualification, and race management commands under Server Settings → Integrations → your bot → Commands. Restart the bot; schema changes run automatically and can safely run again on later starts.
3. Review `/config reminders list` and assign teams to the desired channels. Existing channels remain **All teams (shared)** until configured, and existing events, responses, pending DMs, and reminder delivery history are preserved.

The league migration allows events of type **League** to have no start date and adds a separate race table. It preserves event IDs, responses, channel settings, pending private reminders, and reminder delivery history. Before rebuilding an existing event table, the bot automatically saves an independent SQLite snapshot beside the database as `<DATABASE_PATH>.pre-leagues-<timestamp>.sqlite`.

For leagues without tiers, the tier upgrade puts existing races into **Tier 1**, preserving race IDs and details. Leagues that already have tiers keep their names. It adds league-wide pre-qualification settings without changing existing reminders or responses, and saves a `<DATABASE_PATH>.pre-league-tiers-<timestamp>.sqlite` snapshot before rebuilding an older race table.

Legacy responses have no inferred team and remain visible under **Unassigned team** in every channel's overview. Drivers can use a team channel's buttons and confirm the move to assign their existing signup. Existing reminder and DM buttons remain supported. Assigning a channel's team does not create duplicate reminders or change event IDs, dates, game filters, or the `/events` listing.

## Running development alongside production

Each process handles interactions only for its own `GUILD_IDS` and silently ignores other servers. DM reminder responses use the source server encoded in their buttons. If development and production share a bot token, their guild lists must be disjoint and **both instances must have this routing fix**. An older instance can still acknowledge another server's command with “This bot is not configured for this server,” causing `40060` in the intended instance. Separate bot applications/tokens also isolate development and production credentials, presence, and API usage.

## Code layout

`src/domain` holds event, league, race, and RSVP validation; `src/ui` builds Discord forms and messages; `src/interactions` handles submitted forms; `src/reminders` coordinates shared reminder delivery and responses; and `src/db` owns SQLite persistence. A league is a parent event managed by `eventRepository`; `leagueRepository` owns its tiers and pre-qualification, and `raceRepository` owns its dated races. Foreign keys ensure each race's tier belongs to that same league. League interest and special-event attendance use the same response and reminder infrastructure with separate presentation and input flows.
