/** Tests for posting a single match thread: submit, flair, sort, sticky, lock. */

import { expect } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { handlePostThread } from '../../../src/server/jobs/postThread';
import { rememberThreadPost, recallThreadPost } from '../../../src/server/jobs/threadPosts';
import { recallMatchPost } from '../../../src/server/jobs/updateMatchThread';
import { makeMatchEvent, mockFetch, stubReddit } from '../../fixtures/helpers';
import summaryPost from '../../fixtures/espn/summary-post.json';

const test = createDevvitTest({ settings: { teamId: 191 } });

const FLAIR_TEMPLATES = [
  { id: 'f-pre', text: 'Pre Match' },
  { id: 'f-match', text: 'Match Thread' },
  { id: 'f-post', text: 'Post Match' },
  { id: 'f-motm', text: 'Man of the Match' },
];

test('posts a pre-match thread: submit, flair, sticky, no NEW sort', async () => {
  mockFetch([{ url: 'summary?event=', json: summaryPost }]);
  const stubs = stubReddit({ flairTemplates: FLAIR_TEMPLATES });
  const event = makeMatchEvent({ id: 'ep', summary: 'San Jose Earthquakes vs LA Galaxy' });

  await handlePostThread('testsub', { type: 'prematch', event });

  expect(stubs.submitPost).toHaveBeenCalledTimes(1);
  const post = stubs.posts[0];
  expect(post.title).toBe('Pre-Match Thread: San Jose Earthquakes vs LA Galaxy (07:30 PM)');
  expect(await recallThreadPost('ep', 'prematch')).toBe(post.id);
  expect(stubs.setPostFlair).toHaveBeenCalledWith(
    expect.objectContaining({ flairTemplateId: 'f-pre', postId: post.id })
  );
  expect(post.sticky).toHaveBeenCalledWith(2);
  expect(post.setSuggestedCommentSort).not.toHaveBeenCalled();
});

test('posts a match thread: NEW sort, remembers it, locks the prematch thread', async () => {
  mockFetch([{ url: 'summary?event=', json: summaryPost }]);
  const stubs = stubReddit({ flairTemplates: FLAIR_TEMPLATES });
  const event = makeMatchEvent({ id: 'em', summary: 'San Jose Earthquakes vs LA Galaxy' });
  await rememberThreadPost('em', 'prematch', 't3_pre');

  await handlePostThread('testsub', { type: 'match', event });

  const post = stubs.posts[0];
  expect(post.setSuggestedCommentSort).toHaveBeenCalledWith('NEW');
  expect(post.sticky).toHaveBeenCalledWith(2);
  expect(await recallMatchPost('em')).toBe(post.id);
  expect(stubs.postsById.get('t3_pre')!.lock).toHaveBeenCalledTimes(1);
});

test('posts a post-match thread and locks the match thread', async () => {
  mockFetch([{ url: 'summary?event=', json: summaryPost }]);
  const stubs = stubReddit({ flairTemplates: FLAIR_TEMPLATES });
  const event = makeMatchEvent({ id: 'epm', summary: 'San Jose Earthquakes vs LA Galaxy' });
  await rememberThreadPost('epm', 'match', 't3_match');

  await handlePostThread('testsub', { type: 'postmatch', event });

  expect(stubs.posts[0].setSuggestedCommentSort).not.toHaveBeenCalled();
  expect(stubs.postsById.get('t3_match')!.lock).toHaveBeenCalledTimes(1);
});

test('posts a motm thread: not stickied, locks match, seeds player comments', async () => {
  const singlePlayer = structuredClone(summaryPost);
  const homeRoster = singlePlayer.rosters.find((r) => r.homeAway === 'home')!;
  homeRoster.roster = homeRoster.roster.filter((p) => p.athlete.displayName === 'Antony');

  mockFetch([{ url: 'summary?event=', json: singlePlayer }]);
  const stubs = stubReddit({ flairTemplates: FLAIR_TEMPLATES });
  const event = makeMatchEvent({ id: 'emo', summary: 'San Jose Earthquakes vs LA Galaxy' });
  await rememberThreadPost('emo', 'match', 't3_match2');

  await handlePostThread('testsub', { type: 'motm', event });

  const post = stubs.posts[0];
  expect(post.sticky).not.toHaveBeenCalled();
  expect(post.setSuggestedCommentSort).toHaveBeenCalledWith('NEW');
  expect(stubs.postsById.get('t3_match2')!.lock).toHaveBeenCalledTimes(1);
  expect(stubs.submitComment).toHaveBeenCalledTimes(1);
});
