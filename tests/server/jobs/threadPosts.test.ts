/** Tests for thread post-id tracking and locking (real Redis + stubbed Reddit). */

import { expect } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import {
  rememberThreadPost,
  recallThreadPost,
  lockThreadPost,
} from '../../../src/server/jobs/threadPosts';
import { stubReddit } from '../../fixtures/helpers';

const test = createDevvitTest();
const testLockingOff = createDevvitTest({ settings: { lockInactiveThreads: false } });

test('remembers and recalls a thread post id through real Redis', async () => {
  await rememberThreadPost('evt1', 'match', 't3_match1');
  expect(await recallThreadPost('evt1', 'match')).toBe('t3_match1');
  expect(await recallThreadPost('evt1', 'prematch')).toBeUndefined();
});

test('lockThreadPost locks a known thread when locking is enabled (default)', async () => {
  const stubs = stubReddit();
  await rememberThreadPost('evt1', 'match', 't3_match1');

  await lockThreadPost('evt1', 'match');

  expect(stubs.getPostById).toHaveBeenCalledWith('t3_match1');
  expect(stubs.postsById.get('t3_match1')!.lock).toHaveBeenCalledTimes(1);
});

test('lockThreadPost no-ops when there is no remembered post', async () => {
  const stubs = stubReddit();
  await lockThreadPost('evtX', 'match');
  expect(stubs.getPostById).not.toHaveBeenCalled();
});

testLockingOff('lockThreadPost no-ops when lockInactiveThreads is disabled', async () => {
  const stubs = stubReddit();
  await rememberThreadPost('evt1', 'match', 't3_match1');

  await lockThreadPost('evt1', 'match');

  expect(stubs.getPostById).not.toHaveBeenCalled();
});
