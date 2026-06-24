/** Tests for MOTM nomination queueing, posting, and comment moderation. */

import { expect, vi } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis } from '@devvit/web/server';
import {
  enqueuePlayerComments,
  processPendingComments,
  moderateMotmComments,
  pendingCommentsKey,
} from '../../../src/server/jobs/motm';
import { fetchMatchDetail } from '../../../src/server/matchDetail';
import { mockFetch, stubReddit } from '../../fixtures/helpers';
import summaryPost from '../../fixtures/espn/summary-post.json';

const test = createDevvitTest();

/** A MatchDetail derived from the finished-match fixture. */
async function loadDetail(json: unknown = summaryPost) {
  mockFetch([{ url: 'summary?event=', json }]);
  return fetchMatchDetail('evt');
}

/** Clone the fixture keeping only the named home-team players. */
function fixtureWithHomePlayers(...names: string[]) {
  const clone = structuredClone(summaryPost);
  const home = clone.rosters.find((r) => r.homeAway === 'home')!;
  home.roster = home.roster.filter((p) => names.includes(p.athlete.displayName));
  return clone;
}

test('enqueuePlayerComments warns and posts nothing when the lineup is missing', async () => {
  const stubs = stubReddit();
  const detail = await loadDetail();

  const queued = await enqueuePlayerComments('e1', 't3_post', detail, 999);

  expect(queued).toBe(0);
  expect(stubs.submitComment).not.toHaveBeenCalled();
});

test('enqueuePlayerComments posts one comment per played player and clears the queue', async () => {
  const stubs = stubReddit();
  const detail = await loadDetail(fixtureWithHomePlayers('Antony'));

  const queued = await enqueuePlayerComments('e2', 't3_post', detail, 191);

  expect(queued).toBe(1);
  expect(stubs.submitComment).toHaveBeenCalledTimes(1);
  expect(stubs.submitComment).toHaveBeenCalledWith(
    expect.objectContaining({ id: 't3_post' })
  );
  expect(await redis.get(pendingCommentsKey('e2'))).toBeFalsy();
});

test('processPendingComments drains a queued batch and deletes the marker', async () => {
  const stubs = stubReddit();
  await redis.set(
    pendingCommentsKey('e3'),
    JSON.stringify({ postId: 't3_post', bodies: ['nominee one', 'nominee two'] })
  );

  await processPendingComments('e3');

  expect(stubs.submitComment).toHaveBeenCalledTimes(2);
  expect(await redis.get(pendingCommentsKey('e3'))).toBeFalsy();
});

test('moderateMotmComments removes only stray top-level comments', async () => {
  const mkComment = (o: {
    id: string;
    parentId: string;
    authorId: string;
    removed?: boolean;
    distinguished?: boolean;
    stickied?: boolean;
  }) => ({
    id: o.id,
    parentId: o.parentId,
    authorId: o.authorId,
    removed: o.removed ?? false,
    isDistinguished: () => o.distinguished ?? false,
    isStickied: () => o.stickied ?? false,
    remove: vi.fn(async () => {}),
  });

  const stray = mkComment({ id: 'c1', parentId: 't3_post', authorId: 't2_other' });
  const botOwn = mkComment({ id: 'c2', parentId: 't3_post', authorId: 't2_app' });
  const reply = mkComment({ id: 'c3', parentId: 't1_c1', authorId: 't2_other' });
  const distinguished = mkComment({ id: 'c4', parentId: 't3_post', authorId: 't2_mod', distinguished: true });
  const alreadyRemoved = mkComment({ id: 'c5', parentId: 't3_post', authorId: 't2_x', removed: true });
  const comments = [stray, botOwn, reply, distinguished, alreadyRemoved];

  stubReddit({ comments, appUser: { id: 't2_app', username: 'sjquakesbot' } });

  const removed = await moderateMotmComments('t3_post');

  expect(removed).toBe(1);
  expect(stray.remove).toHaveBeenCalledTimes(1);
  expect(botOwn.remove).not.toHaveBeenCalled();
  expect(reply.remove).not.toHaveBeenCalled();
  expect(distinguished.remove).not.toHaveBeenCalled();
  expect(alreadyRemoved.remove).not.toHaveBeenCalled();
});
