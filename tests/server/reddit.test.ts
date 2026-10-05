/** Tests for flair lookup and configurable highlight replacement. */

import { expect, vi } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit, redis, settings } from '@devvit/web/server';
import { getFlairTemplateId, highlightThread } from '../../src/server/reddit';
import { makeFakePost, stubReddit } from '../fixtures/helpers';
import type { Post } from '@devvit/web/server';

const test = createDevvitTest();

test('stored types survive title changes and keep a compacted match highlight during ticket replacement', async () => {
  const match = makeFakePost({ title: 'Completely renamed discussion' });
  await redis.set(`thread:type:${match.id}`, 'postmatch');
  const stubs = stubReddit({ highlightedPosts: [match] });
  const post = await reddit.submitPost({ subredditName: 'testsub', title: 'New monthly marketplace', text: '' });

  await highlightThread('testsub', post, 'ticket');

  expect(match.unhighlight).not.toHaveBeenCalled();
  expect(stubs.highlightedPosts.map((current) => current.id)).toEqual([post.id, match.id]);
  expect(await redis.get(`thread:type:${post.id}`)).toBe('ticket');
});

test('getFlairTemplateId matches flair text case-insensitively', async () => {
  vi.spyOn(reddit, 'getPostFlairTemplates').mockResolvedValue([
    { id: 'tmpl-pre', text: 'Pre Match' },
    { id: 'tmpl-match', text: 'Match Thread' },
  ] as never);

  expect(await getFlairTemplateId('testsub', 'pre match')).toBe('tmpl-pre');
  expect(await getFlairTemplateId('testsub', 'Match Thread')).toBe('tmpl-match');
});

test('getFlairTemplateId returns undefined when no template matches', async () => {
  vi.spyOn(reddit, 'getPostFlairTemplates').mockResolvedValue([
    { id: 'tmpl-pre', text: 'Pre Match' },
  ] as never);

  expect(await getFlairTemplateId('testsub', 'Ticket Thread')).toBeUndefined();
});

test('replaces the prior matchday highlight and preserves ticket, MOTM, and moderator highlights', async () => {
  const ticket = makeFakePost({ title: 'Ticket Thread: July' });
  const oldMatch = makeFakePost({ title: 'Pre-Match Thread: Quakes vs Galaxy' });
  const motm = makeFakePost({ title: 'Man of the Match: Quakes vs Portland' });
  const moderator = makeFakePost({ title: 'Match Thread: Moderator special' });
  moderator.authorName = 'moderator';
  const other = makeFakePost({ title: 'Weekly discussion' });
  await redis.set(`thread:type:${ticket.id}`, 'ticket');
  await redis.set(`thread:type:${oldMatch.id}`, 'prematch');
  await redis.set(`thread:type:${motm.id}`, 'motm');
  const stubs = stubReddit({ highlightedPosts: [ticket, oldMatch, motm, moderator, other] });
  const post = await reddit.submitPost({ subredditName: 'testsub', title: 'Match Thread: Quakes vs Galaxy', text: '' });

  await highlightThread('testsub', post, 'match');

  expect(oldMatch.unhighlight).toHaveBeenCalledTimes(1);
  expect(moderator.unhighlight).not.toHaveBeenCalled();
  expect(stubs.highlightedPosts.map((current) => current.id)).toEqual([
    ticket.id, post.id, motm.id, moderator.id, other.id,
  ]);
});

test('MOTM follows ticket and matchday even when highlighted before ticket', async () => {
  const match = makeFakePost({ title: 'Post-Match Thread: Quakes vs Galaxy' });
  const ticket = makeFakePost({ title: 'Ticket Thread: July' });
  const stubs = stubReddit({ highlightedPosts: [match, ticket] });
  await redis.set(`thread:type:${match.id}`, 'postmatch');
  await redis.set(`thread:type:${ticket.id}`, 'ticket');
  const post = await reddit.submitPost({ subredditName: 'testsub', title: 'Man of the Match: Quakes vs Galaxy', text: '' });

  await highlightThread('testsub', post, 'motm');

  expect(stubs.highlightedPosts.map((current) => current.id)).toEqual([ticket.id, match.id, post.id]);
});

test('silently replaces the occupant of a configured slot even when all six slots are full', async () => {
  const posts = Array.from({ length: 6 }, (_, index) => makeFakePost({ title: `Moderator post ${index}` }));
  const stubs = stubReddit({ highlightedPosts: posts });
  const post = await reddit.submitPost({ subredditName: 'testsub', title: 'Ticket Thread: July', text: '' });

  await highlightThread('testsub', post, 'ticket');

  expect(posts[0].unhighlight).toHaveBeenCalledTimes(1);
  expect(stubs.highlightedPosts.map((current) => current.id)).toEqual([post.id, ...posts.slice(1).map((current) => current.id)]);
});

test('replaces a managed thread even at six highlights, and repeated highlighting is idempotent', async () => {
  const old = makeFakePost({ title: 'Man of the Match: Previous match' });
  await redis.set(`thread:type:${old.id}`, 'motm');
  const others = Array.from({ length: 5 }, (_, index) => makeFakePost({ title: `Moderator post ${index}` }));
  const stubs = stubReddit({ highlightedPosts: [...others.slice(0, 2), old, ...others.slice(2)] });
  const post = await reddit.submitPost({ subredditName: 'testsub', title: 'Man of the Match: New match', text: '' });

  await highlightThread('testsub', post, 'motm');
  await highlightThread('testsub', post as Post, 'motm');

  expect(old.unhighlight).toHaveBeenCalledTimes(1);
  expect(stubs.highlightedPosts.map((current) => current.id)).toEqual([
    ...others.slice(0, 2).map((current) => current.id), post.id, ...others.slice(2).map((current) => current.id),
  ]);
  expect(stubs.posts[0].unhighlight).not.toHaveBeenCalled();
});

test('configurable slots allow ticket and MOTM to share a replacement slot', async () => {
  vi.spyOn(settings, 'get').mockImplementation(async (key) => key === 'highlightSlotMotm' ? 1 : undefined);
  const ticket = makeFakePost({ title: 'Ticket Thread: July' });
  const match = makeFakePost({ title: 'Post-Match Thread: Quakes vs Galaxy' });
  const stubs = stubReddit({ highlightedPosts: [ticket, match] });
  await redis.set(`thread:type:${ticket.id}`, 'ticket');
  await redis.set(`thread:type:${match.id}`, 'postmatch');
  const post = await reddit.submitPost({ subredditName: 'testsub', title: 'Man of the Match: Quakes vs Galaxy', text: '' });

  await highlightThread('testsub', post, 'motm');

  expect(ticket.unhighlight).toHaveBeenCalledTimes(1);
  expect(match.unhighlight).not.toHaveBeenCalled();
  expect(stubs.highlightedPosts.map((current) => current.id)).toEqual([post.id, match.id]);
});

test('slot zero disables highlighting without changing existing highlights', async () => {
  vi.spyOn(settings, 'get').mockResolvedValue(0);
  const ticket = makeFakePost({ title: 'Ticket Thread: July' });
  const stubs = stubReddit({ highlightedPosts: [ticket] });
  const post = await reddit.submitPost({ subredditName: 'testsub', title: 'Match Thread: Quakes vs Galaxy', text: '' });

  await highlightThread('testsub', post, 'match');

  expect(stubs.posts[0].highlight).not.toHaveBeenCalled();
  expect(stubs.highlightedPosts).toEqual([ticket]);
  expect(await redis.get(`thread:type:${post.id}`)).toBe('match');
});

test('distinct matchday slots preserve earlier thread types and order by assignment', async () => {
  vi.spyOn(settings, 'get').mockImplementation(async (key) => {
    if (key === 'highlightSlotPreMatch') return 5;
    if (key === 'highlightSlotMatch') return 4;
    return undefined;
  });
  const prematch = makeFakePost({ title: 'Pre-Match Thread: Quakes vs Galaxy' });
  const ticket = makeFakePost({ title: 'Ticket Thread: July' });
  const stubs = stubReddit({ highlightedPosts: [prematch, ticket] });
  await redis.set(`thread:type:${prematch.id}`, 'prematch');
  await redis.set(`thread:type:${ticket.id}`, 'ticket');
  const post = await reddit.submitPost({ subredditName: 'testsub', title: 'Match Thread: Quakes vs Galaxy', text: '' });

  await highlightThread('testsub', post, 'match');

  expect(prematch.unhighlight).not.toHaveBeenCalled();
  expect(stubs.highlightedPosts.map((current) => current.id)).toEqual([ticket.id, post.id, prematch.id]);
});

test('an older post cannot replace a newer highlighted post in a shared slot', async () => {
  const newer = makeFakePost({ title: 'Post-Match Thread: New match', createdAt: new Date('2026-10-05T12:00:00Z') });
  await redis.set(`thread:type:${newer.id}`, 'postmatch');
  const stubs = stubReddit({ highlightedPosts: [newer] });
  const post = await reddit.submitPost({ subredditName: 'testsub', title: 'Match Thread: Old match', text: '' });
  stubs.posts[0].createdAt = new Date('2026-10-04T12:00:00Z');

  expect(await highlightThread('testsub', post, 'match')).toBe(false);

  expect(newer.unhighlight).not.toHaveBeenCalled();
  expect(stubs.posts[0].highlight).not.toHaveBeenCalled();
  expect(stubs.highlightedPosts).toEqual([newer]);
});

test('invalid slot settings fall back to the thread default', async () => {
  vi.spyOn(settings, 'get').mockResolvedValue(7);
  const ticket = makeFakePost({ title: 'Ticket Thread: July' });
  const stubs = stubReddit({ highlightedPosts: [ticket] });
  const post = await reddit.submitPost({ subredditName: 'testsub', title: 'Match Thread: Quakes vs Galaxy', text: '' });

  await highlightThread('testsub', post, 'match');

  expect(ticket.unhighlight).not.toHaveBeenCalled();
  expect(stubs.highlightedPosts.map((current) => current.id)).toEqual([ticket.id, post.id]);
});

test('untracked app posts are not inferred from titles or assumed to be news', async () => {
  vi.spyOn(settings, 'get').mockImplementation(async (key) => key === 'highlightSlotNews' ? 2 : undefined);
  const untracked = makeFakePost({ title: 'Match Thread: An untracked post' });
  const stubs = stubReddit({ highlightedPosts: [untracked] });
  const post = await reddit.submitPost({ subredditName: 'testsub', title: 'A news article', url: 'https://example.com/news' });

  await highlightThread('testsub', post, 'news');

  expect(untracked.unhighlight).not.toHaveBeenCalled();
  expect(stubs.highlightedPosts.map((current) => current.id)).toEqual([untracked.id, post.id]);
});

test('stored types cannot classify another author as a managed thread', async () => {
  const moderator = makeFakePost({ title: 'A moderator announcement' });
  moderator.authorName = 'moderator';
  await redis.set(`thread:type:${moderator.id}`, 'match');
  const stubs = stubReddit({ highlightedPosts: [moderator] });
  const post = await reddit.submitPost({ subredditName: 'testsub', title: 'A renamed match thread', text: '' });

  await highlightThread('testsub', post, 'match');

  expect(moderator.unhighlight).not.toHaveBeenCalled();
  expect(stubs.highlightedPosts.map((current) => current.id)).toEqual([moderator.id, post.id]);
});

test('invalid stored types are treated as unmanaged highlights', async () => {
  const untracked = makeFakePost({ title: 'Match Thread: Bad metadata' });
  await redis.set(`thread:type:${untracked.id}`, 'matchday');
  const stubs = stubReddit({ highlightedPosts: [untracked] });
  const post = await reddit.submitPost({ subredditName: 'testsub', title: 'A match thread', text: '' });

  await highlightThread('testsub', post, 'match');

  expect(untracked.unhighlight).not.toHaveBeenCalled();
  expect(stubs.highlightedPosts.map((current) => current.id)).toEqual([untracked.id, post.id]);
});
