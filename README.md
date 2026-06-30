# r/SJEarthquakes Bot

[![Test, Build, and Upload Devvit App (CI/CD)](https://github.com/jbburgess/redditbot-sjearthquakes/actions/workflows/devvit-cicd.yml/badge.svg?branch=master)](https://github.com/jbburgess/redditbot-sjearthquakes/actions/workflows/devvit-cicd.yml)

> **NOTE:** This is a port of the Data API bot `u/SJEarthquakesBot` to the Devvit platform, as part of the Reddit App Migration Program.

A mod bot for the San Jose Earthquakes subreddit (`r/SJEarthquakes`). It automatically manages
the community's match-day threads, posts megathreads, and fosters discussion by monitoring and
posting official news releases from the Quakes website.

## What it does

- **News posts** *(pending domain approval)* — Encourages community engagement by regularly
  checking the official San Jose Earthquakes website news page and posting any new articles
  to the subreddit as link posts with an "Official Source" flair, skipping any articles already
  posted (by the bot or another user) or those previously removed by mods. *This feature is
  ported to Devvit from the Data API bot, but will remain disabled by default until the
  `sjearthquakes.com` fetch domain is approved (see [Fetch Domains](#fetch-domains)).*
- **Pre-match threads** — posts a stickied pre-match thread ahead of kickoff with the
  matchup, kickoff time, venue, broadcast info, team records, and recent form.
- **Match threads** — posts a stickied match thread at kickoff (sorted by *new*) and
  keeps it updated live with the score, key events, and confirmed lineups as the match
  progresses.
- **Post-match threads** — posts a stickied post-match thread once the match ends, with
  the final score, match events, and full player lineups.
- **Man of the Match threads** — posts a Man of the Match thread with a per-player
  performance summary table, then adds one nomination comment per player who featured so
  members can upvote their pick. The thread is kept tidy by removing stray top-level
  comments during its active voting window.
- **Monthly ticket threads** — posts and top-stickies a ticket thread each month that links
  to the official ticket marketplace and lists the month's home matches (with notes for cup
  ties or matches played away from PayPal Park). A new month's thread replaces the previous
  one, posting after the prior month's final match concludes so the old thread stays useful
  until then, but users get as much lead time as possible for the first match of the next
  month. Months with no home matches are skipped, un-stickying the previous thread
  instead, so stale ticket threads aren't left up during the offseason and long mid-season breaks.
- **Thread housekeeping** — applies the correct link flair to each thread, stickies and
  later un-stickies threads at the right times, and (optionally) locks each thread once its
  active window has passed.

Subreddit menu options are provided for moderators to manually post any ticket or match threads
as needed, and the bot provides a number of configurable settings for mods to tune behavior.

Schedule and match data is sourced from ESPN, and club news from the official San Jose
Earthquakes website.

## Configuration

The bot exposes subreddit-level settings so moderators can tailor its behavior:

- The ESPN team ID to follow (defaults to `191`, the San Jose Earthquakes).
- A single multi-select choosing which threads the bot creates automatically (pre-match,
  match, post-match, Man of the Match, the monthly ticket thread, and news posts). Unselect
  a type to stop the bot posting it; mods can still post any thread manually from the subreddit menu.
- The link flair to apply to each thread type.
- How many hours before kickoff the pre-match and match threads are posted.
- Whether to lock each match thread once its active window has passed.
- How many days to keep the post-match and Man of the Match threads active (stickied and
  moderated) before they are un-stickied and locked.
- *(Pending domain approval)* News posting controls, such as the news site URL, how many
  of the most recent articles to consider each check, and which flair to apply to news posts.

## Fetch Domains

The following domains are required for this app:

- `sjearthquakes.com` - *[Pending approval]* Used to fetch club news and announcements directly from the official San Jose Earthquakes website for posting to the subreddit; preferred to ESPN as the primary source for official club news/releases. The news-posting feature is disabled by default until this domain is approved.
- `site.api.espn.com` - *[Already in the global allow list]* Used to fetch the team's schedule, fixtures, and live/post-match details (scores, events, lineups, and player performance stats) that populate every match thread.

## Future Enhancements

The following features are planned but not currently possible due to Devvit platform
limitations. They will be added as the platform gains support:

- **Native Man of the Match poll** — the Man of the Match thread currently collects votes
  via per-player nomination comments that members upvote. A native Reddit poll would be ideal,
  but Devvit's post API only supports link, text, and media posts (poll data is
  read-only), so native polls can't be created by an app today.
- **Game-day community status** — Being able to automatically set the subreddit's community
  status bubble (e.g. "Match Day! Quakes vs. Portland 7:30 PM PT") around each match would
  be a nice-to-have. Devvit currently exposes no API to set the community status,
  so this would still have to be done manually.
