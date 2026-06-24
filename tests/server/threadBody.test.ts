/** Tests for rendering thread bodies from templates + ESPN match detail. */

import { expect } from 'vitest';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { renderThreadBody } from '../../src/server/threadBody';
import { makeMatchEvent, mockFetch } from '../fixtures/helpers';
import summaryPost from '../fixtures/espn/summary-post.json';

const test = createDevvitTest({ settings: { teamId: 191 } });

test('fills prematch placeholders with no leftovers', async () => {
  mockFetch([{ url: 'summary?event=', json: summaryPost }]);
  const body = await renderThreadBody('prematch', makeMatchEvent());

  expect(body).toContain('## San Jose Earthquakes vs LA Galaxy');
  expect(body).toContain('**Competition:** MLS');
  expect(body).toContain('PayPal Park');
  expect(body).not.toMatch(/\{\{/);
});

test('renders the live match body with the score heading and events', async () => {
  mockFetch([{ url: 'summary?event=', json: summaryPost }]);
  const body = await renderThreadBody('match', makeMatchEvent());

  expect(body).toContain('## FT: San Jose Earthquakes 2 – 1 LA Galaxy');
  expect(body).toContain('### MATCH EVENTS');
  expect(body).toContain('Goal - Antony');
  expect(body).not.toMatch(/\{\{/);
});

test('motm body embeds the followed-team player summary table', async () => {
  mockFetch([{ url: 'summary?event=', json: summaryPost }]);
  const body = await renderThreadBody('motm', makeMatchEvent());

  expect(body).toContain('### Player Summary');
  expect(body).toContain('| #11 Antony | 93 | 1 | 0 |');
  expect(body).not.toMatch(/\{\{/);
});

test('falls back to a minimal body when match detail is unavailable', async () => {
  mockFetch([{ url: 'summary?event=', status: 500 }]);
  const event = makeMatchEvent({ summary: 'San Jose Earthquakes vs Seattle Sounders FC' });
  const body = await renderThreadBody('prematch', event);

  expect(body).toContain('## San Jose Earthquakes vs Seattle Sounders FC');
  expect(body).toContain('*Match details are currently unavailable.*');
  expect(body).not.toMatch(/\{\{/);
});
