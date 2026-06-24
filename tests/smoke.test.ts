/**
 * Smoke test: validates that the @devvit/test harness wires the in-memory
 * Devvit capabilities (Redis, Settings) to the same `@devvit/web/server`
 * imports the app uses. If this passes, the rest of the suite can rely on real
 * Redis/Settings and only mock external HTTP + unsupported Reddit calls.
 */

import { expect } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis, settings } from '@devvit/web/server';

const test = createDevvitTest({ settings: { teamId: 191 } });

test('redis round-trips a value through the real in-memory store', async () => {
  await redis.set('smoke:key', 'hello');
  expect(await redis.get('smoke:key')).toBe('hello');
  expect(await redis.exists('smoke:key')).toBe(1);
});

test('redis is cleared between tests', async () => {
  // The previous test set `smoke:key`; the harness clears Redis between tests.
  expect(await redis.get('smoke:key')).toBeUndefined();
});

test('settings seeded via createDevvitTest are readable', async () => {
  expect(await settings.get<number>('teamId')).toBe(191);
});
