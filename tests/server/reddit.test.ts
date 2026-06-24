/** Tests for the Reddit helper module: flair lookup and stickied-thread search. */

import { expect, vi } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit } from '@devvit/web/server';
import { getFlairTemplateId, findStickiedMatchThreads } from '../../src/server/reddit';

const test = createDevvitTest();

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

test('findStickiedMatchThreads keeps only stickied, matching, match-flaired posts', async () => {
  const summary = 'San Jose Earthquakes vs LA Galaxy';
  const posts = [
    { stickied: true, title: `Match Thread: ${summary} (07:30 PM)`, flair: { text: 'Match Thread' } },
    { stickied: false, title: `Pre-Match Thread: ${summary}`, flair: { text: 'Pre Match' } },
    { stickied: true, title: 'Weekly free talk', flair: { text: 'Match Thread' } },
    { stickied: true, title: `Recap: ${summary}`, flair: { text: 'News' } },
    { stickied: true, title: `Post-Match Thread: ${summary}`, flair: undefined },
  ];
  vi.spyOn(reddit, 'getNewPosts').mockReturnValue({
    all: async () => posts,
  } as never);

  const found = await findStickiedMatchThreads('testsub', summary);
  expect(found.map((p) => p.title)).toEqual([`Match Thread: ${summary} (07:30 PM)`]);
});

test('findStickiedMatchThreads returns an empty list when nothing matches', async () => {
  vi.spyOn(reddit, 'getNewPosts').mockReturnValue({ all: async () => [] } as never);
  expect(await findStickiedMatchThreads('testsub', 'No Such Match')).toEqual([]);
});
