/** Tests for unsticky + lock of concluded match threads. */

import { expect, vi } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { handleUnstickyThreads } from '../../../src/server/jobs/unstickyThreads';
import { rememberThreadPost } from '../../../src/server/jobs/threadPosts';
import { makeMatchEvent, stubReddit } from '../../fixtures/helpers';

const test = createDevvitTest();

test('unstickies matching threads and locks the post-match and motm threads', async () => {
  const summary = 'San Jose Earthquakes vs LA Galaxy';
  const stickied = {
    title: `Match Thread: ${summary} (07:30 PM)`,
    stickied: true,
    flair: { text: 'Match Thread' },
    unsticky: vi.fn(async () => {}),
  };
  const stubs = stubReddit({ newPosts: [stickied] });

  const event = makeMatchEvent({ id: 'eu1', summary });
  await rememberThreadPost('eu1', 'postmatch', 't3_post');
  await rememberThreadPost('eu1', 'motm', 't3_motm');

  await handleUnstickyThreads('testsub', { event });

  expect(stickied.unsticky).toHaveBeenCalledTimes(1);
  expect(stubs.getPostById).toHaveBeenCalledWith('t3_post');
  expect(stubs.getPostById).toHaveBeenCalledWith('t3_motm');
  expect(stubs.postsById.get('t3_post')!.lock).toHaveBeenCalledTimes(1);
  expect(stubs.postsById.get('t3_motm')!.lock).toHaveBeenCalledTimes(1);
});

test('still locks concluded threads when no stickied thread is found', async () => {
  const stubs = stubReddit({ newPosts: [] });
  const event = makeMatchEvent({ id: 'eu2', summary: 'San Jose Earthquakes vs Seattle' });
  await rememberThreadPost('eu2', 'postmatch', 't3_post2');

  await handleUnstickyThreads('testsub', { event });

  expect(stubs.postsById.get('t3_post2')!.lock).toHaveBeenCalledTimes(1);
});
