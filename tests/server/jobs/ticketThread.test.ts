/** Tests for the monthly ticket thread lifecycle. */

import { expect } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis } from '@devvit/web/server';
import {
  handleTicketThread,
  handleManualTicketPost,
  handleManualTicketUnsticky,
} from '../../../src/server/jobs/ticketThread';
import { makeMatchEvent, stubReddit } from '../../fixtures/helpers';

const test = createDevvitTest();

/** Mid-July 2026, before the month's home match kicks off. */
const NOW = Date.parse('2026-07-20T18:00:00Z');

const FLAIR_TEMPLATES = [{ id: 'f-tix', text: 'Ticket Thread' }];

const HOME_MATCH = () =>
  makeMatchEvent({
    isHome: true,
    opponent: 'Portland Timbers',
    start: '2026-07-25T02:30:00.000Z',
    location: 'PayPal Park',
  });

test('posts, flairs, and top-stickies the ticket thread for a month with home matches', async () => {
  const stubs = stubReddit({ flairTemplates: FLAIR_TEMPLATES });

  await handleTicketThread('testsub', [HOME_MATCH()], NOW);

  expect(stubs.submitPost).toHaveBeenCalledTimes(1);
  const post = stubs.posts[0];
  expect(post.title).toBe('Ticket Thread: Sales/Exchanges/Giveaways (July 2026)');
  expect(post.sticky).toHaveBeenCalledWith(1);
  expect(stubs.setPostFlair).toHaveBeenCalledWith(
    expect.objectContaining({ flairTemplateId: 'f-tix' })
  );
  const submitted = stubs.submitPost.mock.calls[0][0] as { text: string };
  expect(submitted.text).toContain('Portland Timbers');
  expect(await redis.get('ticket:lastpostid')).toBe(post.id);
});

test('skips (no post) for a month with no home matches', async () => {
  const stubs = stubReddit({ flairTemplates: FLAIR_TEMPLATES });
  const away = makeMatchEvent({ isHome: false, start: '2026-07-25T02:30:00.000Z' });

  await handleTicketThread('testsub', [away], NOW);

  expect(stubs.submitPost).not.toHaveBeenCalled();
});

test('handles each month at most once', async () => {
  const stubs = stubReddit({ flairTemplates: FLAIR_TEMPLATES });

  await handleTicketThread('testsub', [HOME_MATCH()], NOW);
  await handleTicketThread('testsub', [HOME_MATCH()], NOW);

  expect(stubs.submitPost).toHaveBeenCalledTimes(1);
});

test('manual post reports skipped when the target month has no home matches', async () => {
  stubReddit({ flairTemplates: FLAIR_TEMPLATES });
  const away = makeMatchEvent({ isHome: false, start: '2026-07-25T02:30:00.000Z' });

  const result = await handleManualTicketPost('testsub', [away], NOW);

  expect(result).toEqual({ status: 'skipped', month: 'July 2026' });
});

test('manual unsticky removes the tracked ticket thread', async () => {
  const stubs = stubReddit({ flairTemplates: FLAIR_TEMPLATES });
  await redis.set('ticket:lastpostid', 't3_oldticket');

  const result = await handleManualTicketUnsticky([HOME_MATCH()], NOW);

  expect(result).toEqual({ status: 'unstickied', month: 'July 2026' });
  expect(stubs.getPostById).toHaveBeenCalledWith('t3_oldticket');
  expect(stubs.postsById.get('t3_oldticket')!.unsticky).toHaveBeenCalledTimes(1);
  expect(await redis.get('ticket:lastpostid')).toBeFalsy();
});
