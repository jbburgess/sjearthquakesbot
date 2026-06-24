/** Tests for in-place match-thread updates (real Redis + stubbed Reddit). */

import { expect } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import {
  rememberMatchPost,
  recallMatchPost,
  handleUpdateMatchThread,
} from '../../../src/server/jobs/updateMatchThread';
import { makeMatchEvent, mockFetch, stubReddit } from '../../fixtures/helpers';
import summaryPost from '../../fixtures/espn/summary-post.json';

const test = createDevvitTest({ settings: { teamId: 191 } });

test('remembers and recalls the match thread post id', async () => {
  await rememberMatchPost('em1', 't3_match');
  expect(await recallMatchPost('em1')).toBe('t3_match');
  expect(await recallMatchPost('missing')).toBeUndefined();
});

test('handleUpdateMatchThread no-ops when the match thread is unknown', async () => {
  const stubs = stubReddit();
  await handleUpdateMatchThread('testsub', makeMatchEvent({ id: 'em-unknown' }));
  expect(stubs.getPostById).not.toHaveBeenCalled();
});

test('edits the post when content changes, then skips when unchanged', async () => {
  mockFetch([{ url: 'summary?event=', json: summaryPost }]);
  const stubs = stubReddit();
  const event = makeMatchEvent({ id: 'em2', summary: 'San Jose Earthquakes vs LA Galaxy' });
  await rememberMatchPost('em2', 't3_live');

  await handleUpdateMatchThread('testsub', event);
  const post = stubs.postsById.get('t3_live')!;
  expect(post.edit).toHaveBeenCalledTimes(1);

  // Second tick with identical content: signature matches, so no further edit.
  await handleUpdateMatchThread('testsub', event);
  expect(post.edit).toHaveBeenCalledTimes(1);
});
