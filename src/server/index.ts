import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import {
  createServer,
  getServerPort,
  context,
  type TaskRequest,
  type TaskResponse,
} from '@devvit/web/server';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import type { PostThreadJobData, UnstickyJobData, ThreadType } from '../shared/types';
import { handlePostThread } from './jobs/postThread';
import { handleUnstickyThreads } from './jobs/unstickyThreads';
import { handleCheckSchedule } from './jobs/checkSchedule';
import { handleManualPost } from './jobs/manualThread';
import { handleResetMarkers } from './jobs/resetMarkers';
import { handleManualTicketPost, handleManualTicketUnsticky } from './jobs/ticketThread';
import { fetchSchedule } from './espn';

const app = new Hono();

// Liveness check — useful for confirming the server bundle boots.
app.get('/internal/health', (c) => c.json({ status: 'ok' }, 200));

// Scheduler: post a single match thread.
app.post('/internal/scheduler/post-thread', async (c) => {
  const { data } = await c.req.json<TaskRequest<PostThreadJobData>>();
  try {
    if (!data) throw new Error('post-thread job missing data');
    await handlePostThread(context.subredditName, data);
    return c.json<TaskResponse>({}, 200);
  } catch (err) {
    console.error('Failed to post match thread', err);
    return c.json<TaskResponse>({}, 500);
  }
});

// Scheduler: unsticky match threads for an event.
app.post('/internal/scheduler/unsticky-threads', async (c) => {
  const { data } = await c.req.json<TaskRequest<UnstickyJobData>>();
  try {
    if (!data) throw new Error('unsticky-threads job missing data');
    await handleUnstickyThreads(context.subredditName, data);
    return c.json<TaskResponse>({}, 200);
  } catch (err) {
    console.error('Failed to unsticky match threads', err);
    return c.json<TaskResponse>({}, 500);
  }
});

// Scheduler (cron): poll the ESPN schedule and post/unsticky match threads as
// they come due.
app.post('/internal/scheduler/check-schedule', async (c) => {
  void (await c.req.json<TaskRequest>());
  try {
    await handleCheckSchedule(context.subredditName);
    return c.json<TaskResponse>({}, 200);
  } catch (err) {
    console.error('Failed to check schedule', err);
    return c.json<TaskResponse>({}, 500);
  }
});

// Moderator menu actions: manually post each thread type. The match is chosen
// automatically — the one currently in that thread type's window, or the next
// scheduled match if none — and duplicate posts are reported, not re-posted.
const THREAD_LABELS: Record<ThreadType, string> = {
  prematch: 'pre-match',
  match: 'match',
  postmatch: 'post-match',
  motm: 'Man of the Match',
};

function registerManualPost(path: string, type: ThreadType): void {
  app.post(path, async (c) => {
    void (await c.req.json<MenuItemRequest>());
    const label = THREAD_LABELS[type];
    try {
      const result = await handleManualPost(context.subredditName, type);
      if (result.status === 'posted') {
        return c.json<UiResponse>(
          {
            showToast: {
              text: `Posted ${label} thread for ${result.summary}`,
              appearance: 'success',
            },
          },
          200
        );
      }
      if (result.status === 'already-posted') {
        return c.json<UiResponse>(
          {
            showToast: {
              text: `A ${label} thread is already posted for ${result.summary}`,
              appearance: 'neutral',
            },
          },
          200
        );
      }
      return c.json<UiResponse>(
        { showToast: { text: `No match found to post a ${label} thread`, appearance: 'neutral' } },
        200
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to post ${label} thread:`, message, err);
      return c.json<UiResponse>(
        { showToast: { text: `Failed: ${message || 'unknown error'}`, appearance: 'neutral' } },
        200
      );
    }
  });
}

registerManualPost('/internal/menu/post-prematch', 'prematch');
registerManualPost('/internal/menu/post-match', 'match');
registerManualPost('/internal/menu/post-postmatch', 'postmatch');
registerManualPost('/internal/menu/post-motm', 'motm');

// Moderator menu action: post or refresh the monthly ticket thread for the
// currently-relevant month (replacing any existing one).
app.post('/internal/menu/post-ticket', async (c) => {
  void (await c.req.json<MenuItemRequest>());
  try {
    const events = await fetchSchedule();
    const result = await handleManualTicketPost(context.subredditName, events);
    const text =
      result.status === 'posted'
        ? `Posted ticket thread for ${result.month}`
        : `No home matches in ${result.month}; unstickied the previous ticket thread`;
    return c.json<UiResponse>(
      { showToast: { text, appearance: result.status === 'posted' ? 'success' : 'neutral' } },
      200
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Failed to post ticket thread:', message, err);
    return c.json<UiResponse>(
      { showToast: { text: `Failed: ${message || 'unknown error'}`, appearance: 'neutral' } },
      200
    );
  }
});

// Moderator menu action: unsticky the current ticket thread and skip the month.
app.post('/internal/menu/unsticky-ticket', async (c) => {
  void (await c.req.json<MenuItemRequest>());
  try {
    const events = await fetchSchedule();
    const result = await handleManualTicketUnsticky(events);
    return c.json<UiResponse>(
      {
        showToast: {
          text: `Unstickied the ticket thread and skipped ${result.month}`,
          appearance: 'success',
        },
      },
      200
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Failed to unsticky ticket thread:', message, err);
    return c.json<UiResponse>(
      { showToast: { text: `Failed: ${message || 'unknown error'}`, appearance: 'neutral' } },
      200
    );
  }
});

// Dev-only: clear the Redis dedup/bookkeeping markers so threads can be
// re-posted during testing. Remove or restrict before production cutover.
app.post('/internal/menu/reset-markers', async (c) => {
  void (await c.req.json<MenuItemRequest>());
  try {
    const count = await handleResetMarkers();
    return c.json<UiResponse>(
      {
        showToast: {
          text: `Cleared thread markers for ${count} matches`,
          appearance: 'success',
        },
      },
      200
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Failed to reset thread markers:', message, err);
    return c.json<UiResponse>(
      { showToast: { text: `Failed: ${message || 'unknown error'}`, appearance: 'neutral' } },
      200
    );
  }
});

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
