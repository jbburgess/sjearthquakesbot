/** Tests for unsticky + lock of concluded match threads. */

import { expect } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit } from '@devvit/web/server';
import { handleUnstickyThreads } from '../../../src/server/jobs/unstickyThreads';
import { rememberThreadPost } from '../../../src/server/jobs/threadPosts';
import { makeFakePost, makeMatchEvent, stubReddit } from '../../fixtures/helpers';

const test = createDevvitTest();

test('unstickies matching threads and locks the post-match and motm threads', async () => {
  const summary = 'San Jose Earthquakes vs LA Galaxy';
  const postmatch = makeFakePost({ id: 't3_post', title: `Post-Match Thread: ${summary}` });
  const motm = makeFakePost({ id: 't3_motm', title: `Man of the Match: ${summary}` });
  const ticket = makeFakePost({ id: 't3_ticket', title: 'Ticket Thread: July' });
  const newerMatch = makeFakePost({ id: 't3_newmatch', title: `Match Thread: ${summary}` });
  const stubs = stubReddit({ highlightedPosts: [ticket, newerMatch, postmatch, motm] });

  const event = makeMatchEvent({ id: 'eu1', summary });
  await rememberThreadPost('eu1', 'postmatch', 't3_post');
  await rememberThreadPost('eu1', 'motm', 't3_motm');

  await handleUnstickyThreads('testsub', { event });

  expect(reddit.getSubredditInfoByName).toHaveBeenCalledWith('testsub');
  expect(reddit.getSubredditByName).not.toHaveBeenCalled();
  expect(postmatch.unhighlight).toHaveBeenCalledTimes(1);
  expect(motm.unhighlight).toHaveBeenCalledTimes(1);
  expect(stubs.highlightedPosts.map((post) => post.id)).toEqual([ticket.id, newerMatch.id]);
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

  expect(stubs.postsById.get('t3_post2')!.isHighlighted).toHaveBeenCalledTimes(1);
  expect(stubs.postsById.get('t3_post2')!.unhighlight).not.toHaveBeenCalled();
  expect(stubs.postsById.get('t3_post2')!.lock).toHaveBeenCalledTimes(1);
});
