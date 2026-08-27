// Phase 4 Step 1 — hardcoded v1 question pool.
//
// Static in-app data, deliberately NOT the `questions` DB table stub
// (supabase/migrations/0001_initial_schema.sql). Reasoning: a fixed v1 pool
// doesn't need a DB round-trip, and this matches docs/PROJECT_PLAN.md's "no
// AI cost, no scheduled jobs required" framing for v1. Each question below
// has a stable id (`{mode}-{NN}`) specifically so this same data can seed
// the DB table cleanly in Phase 5, once the dynamic pool needs real rows to
// track "answered" against.
//
// This file is data + lookup only — not wired into any screen yet. Mode
// selection UI, selection logic, and recording-flow wiring are Phase 4
// Steps 2-5.

export type QuestionMode = 'interview' | 'story';

export type Question = {
  id: string;
  mode: QuestionMode;
  text: string;
};

const INTERVIEW_QUESTIONS: Question[] = [
  "Tell me about a time you disagreed with a decision at work and how you handled it.",
  "What's a mistake you made that taught you something important?",
  "Describe a project you're proud of and why.",
  'How do you handle competing priorities under a deadline?',
  'Tell me about a time you had to persuade someone who disagreed with you.',
  "What's a skill you've worked hard to improve, and how?",
  'Describe a time you received difficult feedback. How did you respond?',
  'Tell me about a time you had to learn something quickly.',
  "What's a decision you made that you'd make differently now?",
  'Describe a time you had to work with someone difficult.',
  'Tell me about a goal you set and how you achieved it.',
  "What's the most challenging problem you've solved recently?",
  'Describe a time you took initiative without being asked.',
  'Tell me about a time you failed. What happened next?',
  'How do you prioritize when everything feels urgent?',
  'Describe a time you had to explain something complex to someone.',
  'Tell me about a time you changed your mind about something important.',
  "What's a risk you took, and how did it turn out?",
  'Describe a time you had to give someone difficult feedback.',
  'Tell me about a time you went above what was expected of you.',
  'What motivates you to do your best work?',
  'Describe a time you had limited information but had to decide anyway.',
  'Tell me about a time you helped someone else succeed.',
  "What's something you believe that most people disagree with?",
  "Describe a time your plan didn't work and what you did instead.",
].map((text, i) => ({
  id: `interview-${String(i + 1).padStart(2, '0')}`,
  mode: 'interview' as const,
  text,
}));

const STORY_QUESTIONS: Question[] = [
  'Tell a story about a time you got completely lost.',
  'Describe a moment that changed how you see something.',
  "Tell a story about the best meal you've ever had.",
  'Describe a time you had to make a snap decision.',
  'Tell a story about a friendship that mattered to you.',
  "Describe the most nervous you've ever been.",
  "Tell a story about a trip that didn't go as planned.",
  'Describe a moment you felt truly proud of yourself.',
  'Tell a story about learning something the hard way.',
  'Describe a person who influenced you unexpectedly.',
  "Tell a story about a time you laughed until you couldn't breathe.",
  "Describe a place you'd return to in a heartbeat.",
  'Tell a story about overcoming a fear.',
  'Describe a moment of pure luck, good or bad.',
  'Tell a story about a gift that meant more than it should have.',
  'Describe a time you surprised yourself.',
  "Tell a story about a rule you broke and don't regret.",
  "Describe the strangest coincidence that's happened to you.",
  'Tell a story about a time you had to start over.',
  'Describe a tradition that means something to you.',
  'Tell a story about the first time you tried something new.',
  'Describe a time silence said more than words could.',
  'Tell a story about someone who showed you unexpected kindness.',
  'Describe a moment you wish you could relive.',
  'Tell a story about a time you had to say goodbye.',
].map((text, i) => ({
  id: `story-${String(i + 1).padStart(2, '0')}`,
  mode: 'story' as const,
  text,
}));

export const QUESTIONS: Question[] = [...INTERVIEW_QUESTIONS, ...STORY_QUESTIONS];

// Returns the full pool for a given mode, in the fixed order defined above.
//
// NOTE: this deliberately does NOT exclude the user's immediately-previous
// question — that selection logic (Step 3) belongs wherever the recording
// flow actually picks a question to show, not here. This file stays data +
// plain lookup only.
export function getQuestionsForMode(mode: QuestionMode): Question[] {
  return QUESTIONS.filter((q) => q.mode === mode);
}

export function getQuestionById(id: string): Question | undefined {
  return QUESTIONS.find((q) => q.id === id);
}
