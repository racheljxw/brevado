// Phase 4 Step 3 — real question-selection logic for Interview/Story mode.
//
// Kept as a sibling file to src/lib/questions.ts rather than added there,
// deliberately: questions.ts is Step 1's pure data + lookup module (no
// Supabase, no async, easy to unit-test/reason about as static data) and its
// own comments say as much. This file is the opposite — its only job is a
// Supabase round-trip plus a random pick — so splitting them keeps that
// invariant true instead of quietly breaking it.
//
// Exclusion approach: the previous question is looked up by exact TEXT match
// against the current recording's `question` column (there's no separate
// `question_id` column — see supabase/migrations/0001_initial_schema.sql;
// `question` is free text by design, since Phase 4 Step 4's custom-topic
// input will also write arbitrary user-typed text into that same column, not
// just curated pool picks). Exact-text matching is fragile in one narrow way:
// if a pool question's wording is ever edited in questions.ts, a
// previously-stored recording referencing the old wording will no longer
// match anything, so exclusion silently doesn't fire for that one case — it
// degrades to "no exclusion" (a same-question repeat becomes possible again),
// not a crash or a wrong pick. That's an acceptable failure mode given how
// rarely pool wording should change post-launch, and it's actually the
// *correct* behavior for the other case this same matching has to handle:
// once Step 4 ships custom topics, a custom-typed previous "question" won't
// match any pool entry either, and falling through to "pick from the full
// pool" is exactly right there too (a custom topic was never in the pool to
// exclude from). A dedicated `question_id` column would make pool-question
// exclusion more robust, but wouldn't help the custom-topic case at all and
// isn't needed today — worth revisiting only if wording churn in
// questions.ts turns out to be frequent in practice.
import { getQuestionsForMode, type Question, type QuestionMode } from '@/lib/questions';
import { supabase } from '@/lib/supabase';

/**
 * Picks a question for the user's next Interview/Story recording.
 *
 * Looks up the user's most recent recording in this same mode and excludes
 * its exact question text from the pool before picking randomly — per
 * docs/PROJECT_PLAN.md Section 3, only the *immediate* previous question is
 * excluded (repeats are otherwise fine; no broader "recently used" tracking
 * here, that's out of scope for v1). If there's no previous recording in this
 * mode (first time ever, or nothing matched), picks randomly from the full
 * pool with no exclusion.
 *
 * The lookup fails open: if the Supabase query itself errors (network blip,
 * etc.), this logs a warning and falls back to picking from the full pool
 * rather than blocking question selection over a lookup that couldn't
 * complete — same judgment call as `getActiveRecordingCount`'s cap check in
 * src/lib/recordings.ts.
 */
export async function pickQuestionForMode(mode: QuestionMode, userId: string): Promise<Question> {
  const pool = getQuestionsForMode(mode);

  let previousQuestionText: string | null = null;
  try {
    const { data, error } = await supabase
      .from('recordings')
      .select('question')
      .eq('user_id', userId)
      .eq('mode', mode)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    previousQuestionText = data?.question ?? null;
  } catch (err) {
    console.warn('Could not look up previous question for exclusion, picking from the full pool', err);
  }

  const candidates = previousQuestionText ? pool.filter((q) => q.text !== previousQuestionText) : pool;

  // Guards against an empty `candidates` array (shouldn't happen with 25
  // questions per mode and only one excluded, but falling back to the full
  // pool is a safer failure mode than pickFrom[0] being undefined).
  const pickFrom = candidates.length > 0 ? candidates : pool;

  return pickFrom[Math.floor(Math.random() * pickFrom.length)];
}
