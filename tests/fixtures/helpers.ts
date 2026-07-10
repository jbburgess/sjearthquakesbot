/**
 * Shared test helpers for the Devvit unit/integration suite.
 *
 * The @devvit/test harness provides real in-memory Redis and Settings, so these
 * helpers only cover the two things the harness can't run for real:
 *   - external HTTP (`fetch`) to ESPN, mocked with `vi.spyOn`;
 *   - the Reddit client methods the harness leaves unimplemented (submitPost's
 *     returned Post methods, flair, listings, comments), stubbed with `vi.spyOn`.
 *
 * The harness auto-runs `vi.restoreAllMocks()` after every test, so spies set up
 * here never need manual teardown.
 */

import { vi, type MockInstance } from 'vitest';
import { reddit } from '@devvit/web/server';
import type { Post } from '@devvit/web/server';
import type { MatchEvent, MatchState, ThreadType } from '../../src/shared/types';

/** A single fetch route: match a URL, return JSON (or an error status). */
export interface FetchRoute {
  /** Substring, regex, or predicate matched against the request URL. */
  url: string | RegExp | ((url: string) => boolean);
  /** Parsed JSON body returned from `response.json()`. */
  json?: unknown;
  /** Raw body returned from `response.text()` (defaults to JSON-stringified `json`). */
  text?: string;
  /** HTTP status (defaults to 200). */
  status?: number;
  /** Override `response.ok` (defaults to status in the 2xx range). */
  ok?: boolean;
}

/** Whether a route matches the given URL. */
function routeMatches(route: FetchRoute, url: string): boolean {
  if (typeof route.url === 'function') return route.url(url);
  if (route.url instanceof RegExp) return route.url.test(url);
  return url.includes(route.url);
}

/**
 * Replace global `fetch` with a URL router. Routes are tried in order, so list
 * more specific matchers first (e.g. `?fixture=true` before the base schedule).
 * Any unmatched request throws, mirroring the harness's HTTP block, so tests
 * never silently hit the network.
 */
export function mockFetch(routes: FetchRoute[]): MockInstance {
  const spy = vi.spyOn(globalThis, 'fetch');
  spy.mockImplementation(async (input: string | URL | Request) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const route = routes.find((r) => routeMatches(r, url));
    if (!route) throw new Error(`Unexpected fetch in test: ${url}`);
    const status = route.status ?? 200;
    const ok = route.ok ?? (status >= 200 && status < 300);
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: async () => route.json,
      text: async () => route.text ?? JSON.stringify(route.json),
    } as Response;
  });
  return spy;
}

/** A fake Reddit Post whose mutating methods are spies tests can assert on. */
export interface FakePost {
  id: `t3_${string}`;
  title: string;
  stickied: boolean;
  url: string;
  sticky: MockInstance;
  unsticky: MockInstance;
  lock: MockInstance;
  setSuggestedCommentSort: MockInstance;
  edit: MockInstance;
}

/** Build a fake Post with spied mutators. */
export function makeFakePost(overrides: Partial<{ id: string; title: string; stickied: boolean }> = {}): FakePost {
  const id = (overrides.id ?? `t3_${Math.random().toString(36).slice(2, 9)}`) as `t3_${string}`;
  return {
    id,
    title: overrides.title ?? 'Test thread',
    stickied: overrides.stickied ?? false,
    url: `https://reddit.com/${id}`,
    sticky: vi.fn(async () => {}),
    unsticky: vi.fn(async () => {}),
    lock: vi.fn(async () => {}),
    setSuggestedCommentSort: vi.fn(async () => {}),
    edit: vi.fn(async () => {}),
  };
}

/** A flair template as returned by `reddit.getPostFlairTemplates`. */
export interface FlairTemplateStub {
  id: string;
  text: string;
}

/** Options controlling the stubbed Reddit surface. */
export interface StubRedditOptions {
  /** Flair templates returned by `getPostFlairTemplates`. */
  flairTemplates?: FlairTemplateStub[];
  /** Posts returned by `getNewPosts(...).all()`. */
  newPosts?: unknown[];
  /** Comments returned by `getComments(...).all()`. */
  comments?: unknown[];
  /** Mod actions returned by `getModerationLog(...).all()`. */
  modLog?: unknown[];
  /** App user returned by `getAppUser()`. */
  appUser?: { id: string; username?: string } | undefined;
}

/** The set of spies installed by {@link stubReddit}, for assertions. */
export interface RedditStubs {
  submitPost: MockInstance;
  getPostById: MockInstance;
  getPostFlairTemplates: MockInstance;
  setPostFlair: MockInstance;
  getNewPosts: MockInstance;
  submitComment: MockInstance;
  getComments: MockInstance;
  getModerationLog: MockInstance;
  getAppUser: MockInstance;
  /** Fake posts created by `submitPost`, in call order. */
  posts: FakePost[];
  /** Look up (or lazily create) the fake post a `getPostById` call returns. */
  postsById: Map<string, FakePost>;
}

/**
 * Stub the Reddit client methods the jobs use. `submitPost` returns a fresh
 * {@link FakePost} (recorded in `posts`/`postsById`); `getPostById` returns the
 * matching fake (creating one on demand) so `lock()`/`edit()` are assertable.
 * Everything else returns the configured fixtures. Redis and Settings remain
 * the harness's real implementations.
 */
export function stubReddit(options: StubRedditOptions = {}): RedditStubs {
  const posts: FakePost[] = [];
  const postsById = new Map<string, FakePost>();

  const submitPost = vi.spyOn(reddit, 'submitPost').mockImplementation((async (opts: { title?: string }) => {
    const post = makeFakePost({ title: opts?.title });
    posts.push(post);
    postsById.set(post.id, post);
    return post as unknown as Post;
  }) as never);

  const getPostById = vi.spyOn(reddit, 'getPostById').mockImplementation((async (id: string) => {
    let post = postsById.get(id);
    if (!post) {
      post = makeFakePost({ id });
      postsById.set(id, post);
    }
    return post as unknown as Post;
  }) as never);

  const getPostFlairTemplates = vi
    .spyOn(reddit, 'getPostFlairTemplates')
    .mockResolvedValue((options.flairTemplates ?? []) as never);

  const setPostFlair = vi.spyOn(reddit, 'setPostFlair').mockResolvedValue(undefined as never);

  const getNewPosts = vi.spyOn(reddit, 'getNewPosts').mockReturnValue({
    all: async () => options.newPosts ?? [],
  } as never);

  const submitComment = vi.spyOn(reddit, 'submitComment').mockResolvedValue(undefined as never);

  const getComments = vi.spyOn(reddit, 'getComments').mockReturnValue({
    all: async () => options.comments ?? [],
  } as never);

  const getModerationLog = vi.spyOn(reddit, 'getModerationLog').mockReturnValue({
    all: async () => options.modLog ?? [],
  } as never);

  const getAppUser = vi
    .spyOn(reddit, 'getAppUser')
    .mockResolvedValue((options.appUser ?? { id: 't2_app', username: 'sjquakesbot' }) as never);

  return {
    submitPost,
    getPostById,
    getPostFlairTemplates,
    setPostFlair,
    getNewPosts,
    submitComment,
    getComments,
    getModerationLog,
    getAppUser,
    posts,
    postsById,
  };
}

let matchEventSeq = 0;

/** Build a normalized {@link MatchEvent} for tests, with sensible defaults. */
export function makeMatchEvent(overrides: Partial<MatchEvent> = {}): MatchEvent {
  matchEventSeq += 1;
  const base: MatchEvent = {
    id: `evt${matchEventSeq}`,
    summary: 'San Jose Earthquakes vs Portland Timbers',
    start: '2026-07-25T02:30:00.000Z',
    state: 'pre' as MatchState,
    description: 'MLS Season Pass',
    location: 'PayPal Park',
    isHome: true,
    opponent: 'Portland Timbers',
    competition: '',
  };
  return { ...base, ...overrides };
}

/** Convenience: an ISO string `hoursFromNow` hours from `now`. */
export function isoFromNow(now: number, hoursFromNow: number): string {
  return new Date(now + hoursFromNow * 60 * 60 * 1000).toISOString();
}

/** All match thread types, handy for parameterized tests. */
export const ALL_THREAD_TYPES: ThreadType[] = ['prematch', 'match', 'postmatch', 'motm'];
