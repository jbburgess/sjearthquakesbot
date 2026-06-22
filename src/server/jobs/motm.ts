/**
 * Man-of-the-Match comment handling:
 *  - queue one top-level comment per followed-team player who played, posting
 *    the roster in a single pass with light spacing so we stay under Reddit's
 *    comment rate limit; any that still fail stay queued and are retried on
 *    later schedule ticks;
 *  - moderate the thread during its active window by removing any other
 *    top-level comments so nominations stay one-per-player.
 */

import { redis, reddit } from '@devvit/web/server';
import type { MatchDetail } from '../matchDetail';
import { followedLineup, playedPlayers, playerCommentBody } from '../playerStats';

const HOUR = 60 * 60 * 1000;
/** Pending-queue markers live past the final (unsticky/lock) action at +26h. */
const PENDING_TTL_MS = 4 * 24 * HOUR;

/**
 * Time budget for one handler run. Reddit throttles comment creation (observed:
 * ~1 per 5s on the dev account), so a run posts what fits in this budget and
 * leaves the rest queued for the next schedule tick. Kept well under the cron
 * interval and handler limit so the "match just ended" tick never runs long.
 */
const RUN_BUDGET_MS = 25_000;
/** Spacing between consecutive comments, comfortably above the observed limit. */
const INTRA_COMMENT_DELAY_MS = 6_000;
/** Fallback wait when the rate-limit error doesn't specify one. */
const DEFAULT_RATELIMIT_WAIT_MS = 6_000;

/** The pending nomination comments still to be posted for a MOTM thread. */
interface PendingComments {
  postId: string;
  bodies: string[];
}

/** Redis key holding the not-yet-posted nomination comments for an event. */
export function pendingCommentsKey(eventId: string): string {
  return `motm:pending:${eventId}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract the wait Reddit asks for from a rate-limit error (e.g.
 * `RatelimitError(TimeString="5 seconds")`), falling back to a default. Returns
 * 0 for errors that aren't rate limits.
 */
function rateLimitWaitMs(err: unknown): number {
  const text = err instanceof Error ? err.message : String(err);
  if (!/ratelimit|resource_exhausted/i.test(text)) return 0;
  const match = text.match(/(\d+)\s*second/i);
  const seconds = match ? Number(match[1]) : 0;
  // Add a small margin so we clear the window rather than racing its edge.
  return (seconds > 0 ? seconds * 1000 : DEFAULT_RATELIMIT_WAIT_MS) + 1_000;
}

async function savePending(eventId: string, pending: PendingComments): Promise<void> {
  await redis.set(pendingCommentsKey(eventId), JSON.stringify(pending), {
    expiration: new Date(Date.now() + PENDING_TTL_MS),
  });
}

/**
 * Queue a nomination comment for each followed-team player who featured, then
 * post as many as fit in this run's time budget. Any not posted (rate limit or
 * budget) stay queued for later schedule ticks via
 * {@link processPendingComments}. Returns how many were queued. No-op (with a
 * warning) if the followed team's lineup isn't available.
 */
export async function enqueuePlayerComments(
  eventId: string,
  postId: string,
  detail: MatchDetail,
  teamId: number
): Promise<number> {
  const lineup = followedLineup(detail, teamId);
  if (!lineup) {
    console.warn(`No lineup for team ${teamId}; skipping MOTM player comments`);
    return 0;
  }

  const bodies = playedPlayers(lineup).map(playerCommentBody);
  if (bodies.length === 0) return 0;

  await savePending(eventId, { postId, bodies });
  console.info(`Queued ${bodies.length} MOTM nomination comments for ${eventId}`);
  // Post what we can right away; any stragglers follow on subsequent ticks.
  await processPendingComments(eventId);
  return bodies.length;
}

/**
 * Post queued nomination comments for an event until the queue is empty or this
 * run's time budget ({@link RUN_BUDGET_MS}) is spent, spacing posts by
 * {@link INTRA_COMMENT_DELAY_MS} and honoring the wait Reddit requests on a rate
 * limit. The remainder stays queued for the next schedule tick. No-op when the
 * queue is empty. (Reddit has no bulk-comment endpoint, so comments must be
 * posted one at a time.)
 */
export async function processPendingComments(eventId: string): Promise<void> {
  const raw = await redis.get(pendingCommentsKey(eventId));
  if (!raw) return;

  const pending = JSON.parse(raw) as PendingComments;
  const remaining = [...pending.bodies];
  const started = Date.now();
  let posted = 0;

  while (remaining.length > 0 && Date.now() - started < RUN_BUDGET_MS) {
    if (posted > 0) await delay(INTRA_COMMENT_DELAY_MS);
    try {
      await reddit.submitComment({
        id: pending.postId as `t3_${string}`,
        text: remaining[0],
      });
      remaining.shift();
      posted++;
    } catch (err) {
      const waitMs = rateLimitWaitMs(err);
      // Non-rate-limit failure, or not enough budget left to wait it out:
      // leave the rest queued for the next tick.
      if (waitMs === 0 || Date.now() - started + waitMs >= RUN_BUDGET_MS) {
        console.error(`Stopping MOTM comment run; ${remaining.length} left for next tick`, err);
        break;
      }
      console.warn(`Rate-limited posting MOTM comment; waiting ${waitMs}ms before retrying`);
      await delay(waitMs);
    }
  }

  if (remaining.length === 0) {
    await redis.del(pendingCommentsKey(eventId));
    console.info(`Posted ${posted} MOTM nomination comment(s); queue complete for ${eventId}`);
  } else {
    await savePending(eventId, { postId: pending.postId, bodies: remaining });
    console.info(
      `Posted ${posted} MOTM nomination comment(s); ${remaining.length} remaining for ${eventId}`
    );
  }
}

/**
 * Remove top-level comments on the MOTM thread that the bot didn't author,
 * leaving only the per-player nomination comments. Returns the count removed.
 */
export async function moderateMotmComments(postId: string): Promise<number> {
  const appUser = await reddit.getAppUser();
  const appUserId = appUser?.id;

  const comments = await reddit
    .getComments({ postId: postId as `t3_${string}`, depth: 1, limit: 200 })
    .all();

  let removed = 0;
  for (const comment of comments) {
    const isTopLevel = comment.parentId.startsWith('t3_');
    if (!isTopLevel) continue;
    if (appUserId && comment.authorId === appUserId) continue;
    if (comment.removed || comment.isDistinguished() || comment.isStickied()) continue;
    try {
      await comment.remove();
      removed++;
    } catch (err) {
      console.error(`Failed to remove comment ${comment.id} on ${postId}`, err);
    }
  }
  if (removed > 0) console.info(`Removed ${removed} stray top-level comment(s) on ${postId}`);
  return removed;
}
