# Discord Racing Events Bot

Small Discord bot for iRacing and Le Mans Ultimate events.

## Commands

- `/events` — show upcoming events, optionally filtered by game or event type.
- `/add-event` — staff-only by Discord command permissions; opens a modal and stores the event in SQLite.

## Setup

1. Copy `.env.example` to `.env` and fill in the values.
2. Run `npm install`.
3. Run `npm run deploy` to register guild-only slash commands.
4. In each Discord server, go to Server Settings → Integrations → your bot → Commands and allow the desired staff roles to use `/add-event`.
5. Run `npm start` (or `npm run dev` during development).

Enter a date as `DD-MM-YYYY`, a start time as `DD-MM-YYYY HH:mm`, or a date range as `DD-MM-YYYY to DD-MM-YYYY` (for example, `03-10-2026 to 05-10-2026`). The input is interpreted using `DEFAULT_TIMEZONE`. Timed events use Discord timestamps, so each viewer sees the time in their own timezone. Date-only events and ranges display calendar dates without a start time.
