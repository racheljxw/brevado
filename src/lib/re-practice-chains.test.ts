// Unit tests for src/lib/re-practice-chains.ts.
//
// Runs on Node's built-in test runner (`node:test`, no new dependencies),
// same setup as `streaks.test.ts`. See `npm run test:chains` in package.json.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildChains,
  chainFavoriteReference,
  chainQuestion,
  type ChainRecording,
} from './re-practice-chains';

// A recording with an explicit created_at (ISO) and re_practice_of.
function rec(id: string, createdAt: string, rePracticeOf: string | null = null): ChainRecording {
  return { id, created_at: createdAt, re_practice_of: rePracticeOf };
}

function memberIds<T extends ChainRecording>(chain: { members: T[] }): string[] {
  return chain.members.map((m) => m.id);
}

describe('buildChains', () => {
  test('a recording with no re-practice relationship is its own single-member chain', () => {
    const chains = buildChains([rec('a', '2026-08-10T12:00:00Z')]);
    assert.equal(chains.length, 1);
    assert.equal(chains[0].rootId, 'a');
    assert.deepEqual(memberIds(chains[0]), ['a']);
  });

  test('a simple 2-member chain groups into one entry, most-recent-first', () => {
    const chains = buildChains([
      rec('attempt2', '2026-08-12T12:00:00Z', 'original'),
      rec('original', '2026-08-10T12:00:00Z'),
    ]);
    assert.equal(chains.length, 1);
    assert.equal(chains[0].rootId, 'original');
    assert.deepEqual(memberIds(chains[0]), ['attempt2', 'original']);
  });

  test('a 3+ attempt chain groups transitively (each attempt points at the previous one)', () => {
    const chains = buildChains([
      rec('a4', '2026-08-16T12:00:00Z', 'a3'),
      rec('a3', '2026-08-14T12:00:00Z', 'a2'),
      rec('a2', '2026-08-12T12:00:00Z', 'a1'),
      rec('a1', '2026-08-10T12:00:00Z'),
    ]);
    assert.equal(chains.length, 1);
    assert.equal(chains[0].rootId, 'a1');
    assert.deepEqual(memberIds(chains[0]), ['a4', 'a3', 'a2', 'a1']);
  });

  test('attempts that all point directly at the root still group together', () => {
    const chains = buildChains([
      rec('a3', '2026-08-14T12:00:00Z', 'root'),
      rec('a2', '2026-08-12T12:00:00Z', 'root'),
      rec('root', '2026-08-10T12:00:00Z'),
    ]);
    assert.equal(chains.length, 1);
    assert.equal(chains[0].rootId, 'root');
    assert.deepEqual(memberIds(chains[0]), ['a3', 'a2', 'root']);
  });

  test('a chain whose root is no longer in the list: the orphan starts fresh, no crash', () => {
    // The original recording was deleted; per ON DELETE SET NULL the child's
    // re_practice_of would already be null — but also cover a stale non-null
    // value pointing at an absent id.
    const chains = buildChains([
      rec('child_null', '2026-08-12T12:00:00Z', null),
      rec('child_stale', '2026-08-13T12:00:00Z', 'deleted-original'),
    ]);
    assert.equal(chains.length, 2);
    // Ordered by first appearance in the input.
    assert.equal(chains[0].rootId, 'child_null');
    assert.deepEqual(memberIds(chains[0]), ['child_null']);
    assert.equal(chains[1].rootId, 'child_stale');
    assert.deepEqual(memberIds(chains[1]), ['child_stale']);
  });

  test('a chain whose middle link is missing splits at the gap', () => {
    // a3 -> a2 (missing) ; a1 is standalone. a3 can't reach a1, so it roots
    // itself; a1 is its own chain.
    const chains = buildChains([
      rec('a3', '2026-08-16T12:00:00Z', 'a2'),
      rec('a1', '2026-08-10T12:00:00Z'),
    ]);
    assert.equal(chains.length, 2);
    assert.equal(chains[0].rootId, 'a3');
    assert.deepEqual(memberIds(chains[0]), ['a3']);
    assert.equal(chains[1].rootId, 'a1');
    assert.deepEqual(memberIds(chains[1]), ['a1']);
  });

  test('multiple independent chains mixed with ungrouped recordings, order preserved', () => {
    const chains = buildChains([
      rec('x2', '2026-08-20T12:00:00Z', 'x1'), // chain X, newest overall
      rec('solo', '2026-08-19T12:00:00Z'), // ungrouped
      rec('y3', '2026-08-18T12:00:00Z', 'y2'), // chain Y
      rec('y2', '2026-08-15T12:00:00Z', 'y1'),
      rec('x1', '2026-08-05T12:00:00Z'), // chain X root
      rec('y1', '2026-08-03T12:00:00Z'), // chain Y root
    ]);
    assert.deepEqual(
      chains.map((c) => c.rootId),
      ['x1', 'solo', 'y1'],
    );
    assert.deepEqual(memberIds(chains[0]), ['x2', 'x1']);
    assert.deepEqual(memberIds(chains[1]), ['solo']);
    assert.deepEqual(memberIds(chains[2]), ['y3', 'y2', 'y1']);
  });

  test('members are sorted most-recent-first even when the input is not', () => {
    const chains = buildChains([
      rec('a1', '2026-08-10T12:00:00Z'),
      rec('a3', '2026-08-14T12:00:00Z', 'a1'),
      rec('a2', '2026-08-12T12:00:00Z', 'a1'),
    ]);
    assert.deepEqual(memberIds(chains[0]), ['a3', 'a2', 'a1']);
  });

  test('a re_practice_of cycle does not hang or throw', () => {
    // Malformed data — shouldn't be possible via the FK, but must be safe.
    const chains = buildChains([
      rec('a', '2026-08-10T12:00:00Z', 'b'),
      rec('b', '2026-08-11T12:00:00Z', 'a'),
    ]);
    // Both resolve to the same root and land in one chain; exact root id is
    // whichever the walk settles on — just assert it's stable and complete.
    assert.equal(chains.length, 1);
    assert.deepEqual(memberIds(chains[0]).sort(), ['a', 'b']);
  });

  test('empty input returns []', () => {
    assert.deepEqual(buildChains([]), []);
  });

  test('chainQuestion picks the first member with question text, else "No prompt"', () => {
    assert.equal(
      chainQuestion([{ question: null }, { question: 'What drives you?' }, { question: 'x' }]),
      'What drives you?'
    );
    assert.equal(chainQuestion([{ question: null }, { question: null }]), 'No prompt');
    assert.equal(chainQuestion([]), 'No prompt');
  });

  test('chainFavoriteReference returns the chain root (what the List card star reads)', () => {
    const chains = buildChains([
      { id: 'a2', created_at: '2026-08-12T12:00:00Z', re_practice_of: 'a1', favorite: false },
      { id: 'a1', created_at: '2026-08-10T12:00:00Z', re_practice_of: null, favorite: true },
    ]);
    const refd = chainFavoriteReference(chains[0]);
    assert.equal(refd.id, 'a1');
    assert.equal(refd.favorite, true);
  });

  test('chainFavoriteReference on a single-member chain returns that recording', () => {
    const chains = buildChains([
      { id: 'solo', created_at: '2026-08-10T12:00:00Z', re_practice_of: null, favorite: false },
    ]);
    assert.equal(chainFavoriteReference(chains[0]).id, 'solo');
  });

  test('extra fields on a recording are carried through to members untouched', () => {
    const chains = buildChains([
      { id: 'a', created_at: '2026-08-10T12:00:00Z', re_practice_of: null, favorite: true, title: 'Hi' },
      { id: 'b', created_at: '2026-08-12T12:00:00Z', re_practice_of: 'a', favorite: false, title: 'Yo' },
    ]);
    assert.equal(chains[0].members[0].title, 'Yo');
    assert.equal(chains[0].members[1].favorite, true);
  });
});
