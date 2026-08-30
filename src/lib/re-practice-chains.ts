// v4 Epic J Part 1 — pure chain-building logic for grouping a question's
// re-practice attempts in History.
//
// Same spirit as `src/lib/streaks.ts` (v3 Epic G): an isolated,
// dependency-free, unit-tested function with no React / React Native / no
// Supabase imports, verified against hand-written cases (see
// `re-practice-chains.test.ts`) before any screen consumes it. Nothing here
// renders anything.
//
// Background: a re-practice recording (v4 Epic I) carries
// `recordings.re_practice_of` pointing at the recording its 3-dot menu was
// opened from. Because a freshly-assigned daily-pool question is retired the
// instant it's assigned (v4 Epic H), the ONLY way two recordings relate to
// the same question is a deliberate re-practice — so following the
// `re_practice_of` links (directly or transitively) to a root fully groups a
// question's attempts. There's no need to also group by `question_id`.

// The minimal shape `buildChains` needs off a `recordings` row. `RecordingRow`
// (once `fetchRecordings` selects `re_practice_of`) is assignable to this;
// extra fields are carried through untouched on the `members` it returns.
export type ChainRecording = {
  id: string;
  re_practice_of: string | null;
  created_at: string;
};

export type RePracticeChain<T extends ChainRecording> = {
  /**
   * The id of the chain's root recording — the earliest attempt whose
   * ancestry is fully present in the input list. Always one of `members`
   * (never a deleted / absent recording). For a single-member chain this is
   * just that recording's id. The History list reads the root's `favorite`
   * flag for the group card's star (per the confirmed group-level design).
   */
  rootId: string;
  /**
   * Every recording in the chain — the root plus every recording that points
   * at it or at another chain member, directly or transitively. Sorted
   * MOST-RECENT-FIRST by `created_at` (ties broken by `id`, descending, for a
   * stable order). A recording with no re-practice relationship at all is its
   * own single-member chain.
   */
  members: T[];
};

/**
 * Groups a flat recordings list into re-practice chains.
 *
 * A recording whose `re_practice_of` is `null`, or points at an id that is
 * NOT in the input list (e.g. the original was deleted and the FK went to
 * `null` per `0010_re_practice_of_on_delete.sql`'s `on delete set null` —
 * though in that case the value would already be `null`; this also covers a
 * paginated/filtered list that simply doesn't contain the parent), starts a
 * fresh chain of its own. It is never a crash and never silently dropped.
 *
 * Returned chains are ordered by where each chain's FIRST member appears in
 * the input. The History list passes recordings already sorted newest-first,
 * so each chain surfaces at its most-recent attempt's position.
 *
 * Defensive against a `re_practice_of` cycle (shouldn't be possible — the FK
 * only ever points at an earlier recording — but a malformed row won't hang
 * or throw; the walk stops and treats the node it looped back to as a root).
 */
export function buildChains<T extends ChainRecording>(recordings: T[]): RePracticeChain<T>[] {
  const byId = new Map<string, T>();
  for (const recording of recordings) byId.set(recording.id, recording);

  // Memoised id -> root-id resolution.
  const rootCache = new Map<string, string>();

  function resolveRoot(startId: string): string {
    const cached = rootCache.get(startId);
    if (cached !== undefined) return cached;

    const seen = new Set<string>();
    let currentId = startId;
    while (true) {
      if (seen.has(currentId)) break; // cycle — treat `currentId` as the root
      seen.add(currentId);
      const current = byId.get(currentId);
      if (!current) break;
      const parentId = current.re_practice_of;
      // No parent, or the parent isn't in this list -> `currentId` is a root.
      if (parentId === null || parentId === undefined || !byId.has(parentId)) break;
      currentId = parentId;
    }

    // `currentId` is the root for every node we walked through.
    for (const nodeId of seen) rootCache.set(nodeId, currentId);
    return currentId;
  }

  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const recording of recordings) {
    const rootId = resolveRoot(recording.id);
    let members = groups.get(rootId);
    if (!members) {
      members = [];
      groups.set(rootId, members);
      order.push(rootId);
    }
    members.push(recording);
  }

  return order.map((rootId) => ({
    rootId,
    members: (groups.get(rootId) ?? []).slice().sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    }),
  }));
}

/**
 * The recording whose `favorite` flag stands in for the whole chain — the
 * chain root, i.e. the exact same recording the grouped History List card's
 * star reads from and toggles (v4 Epic J Part 1). For a single-member chain
 * that's just the recording itself.
 *
 * v4 Epic K uses this for History's favorites-only filter, so "a chain is
 * favorited" means precisely what the star on its card shows. (The chain
 * *detail* screen's header star uses a slightly richer rule — the largest
 * sub-chain's root — to stay sensible for a branched chain whose root was
 * deleted; for a linear chain the two agree, and the List only ever has the
 * root's flag to key off anyway.)
 */
export function chainFavoriteReference<T extends ChainRecording>(chain: RePracticeChain<T>): T {
  return chain.members.find((m) => m.id === chain.rootId) ?? chain.members[0];
}

/**
 * The one shared question a chain's attempts all answer — the first member
 * that actually carries `question` text, else the literal `'No prompt'`
 * (re-practice requires a question, so the fallback shouldn't be hit).
 * Shared by the grouped History List card and the chain detail screen's
 * header so the two never show a different heading for the same group.
 */
export function chainQuestion(members: { question: string | null }[]): string {
  for (const member of members) {
    if (member.question) return member.question;
  }
  return 'No prompt';
}
