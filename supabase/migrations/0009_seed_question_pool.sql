-- Brevado — v4 Epic H Step 1: seed the starting global question pool.
--
-- Run this right after 0008_daily_questions.sql, in the Supabase SQL editor.
--
-- These are the exact 25 interview + 25 story prompts that were src/lib/questions.ts
-- (v1's static in-app pool), copied here verbatim. As of v4 Epic H Step 2 that
-- file is deleted and this migration is the only place the text lives.
-- They seed the `questions` table as the starting pool for v4's global
-- daily-question system; all with used_date = NULL (unused / available). New
-- questions are added later, 15 at a time, by the synchronous batch-generation
-- path in backend/app/services/daily_questions.py when a mode's pool runs out.
--
-- Idempotent: the `where not exists` guard means running this twice does NOT
-- duplicate the pool. (If you ever genuinely need to re-seed, clear the table
-- first.) `id` / `created_at` use their column defaults; `used_date` defaults
-- to NULL.

insert into public.questions (mode, prompt_text)
select seed.mode, seed.prompt_text
from (
  values
    ('interview', 'Tell me about a time you disagreed with a decision at work and how you handled it.'),
    ('interview', 'What''s a mistake you made that taught you something important?'),
    ('interview', 'Describe a project you''re proud of and why.'),
    ('interview', 'How do you handle competing priorities under a deadline?'),
    ('interview', 'Tell me about a time you had to persuade someone who disagreed with you.'),
    ('interview', 'What''s a skill you''ve worked hard to improve, and how?'),
    ('interview', 'Describe a time you received difficult feedback. How did you respond?'),
    ('interview', 'Tell me about a time you had to learn something quickly.'),
    ('interview', 'What''s a decision you made that you''d make differently now?'),
    ('interview', 'Describe a time you had to work with someone difficult.'),
    ('interview', 'Tell me about a goal you set and how you achieved it.'),
    ('interview', 'What''s the most challenging problem you''ve solved recently?'),
    ('interview', 'Describe a time you took initiative without being asked.'),
    ('interview', 'Tell me about a time you failed. What happened next?'),
    ('interview', 'How do you prioritize when everything feels urgent?'),
    ('interview', 'Describe a time you had to explain something complex to someone.'),
    ('interview', 'Tell me about a time you changed your mind about something important.'),
    ('interview', 'What''s a risk you took, and how did it turn out?'),
    ('interview', 'Describe a time you had to give someone difficult feedback.'),
    ('interview', 'Tell me about a time you went above what was expected of you.'),
    ('interview', 'What motivates you to do your best work?'),
    ('interview', 'Describe a time you had limited information but had to decide anyway.'),
    ('interview', 'Tell me about a time you helped someone else succeed.'),
    ('interview', 'What''s something you believe that most people disagree with?'),
    ('interview', 'Describe a time your plan didn''t work and what you did instead.'),
    ('story', 'Tell a story about a time you got completely lost.'),
    ('story', 'Describe a moment that changed how you see something.'),
    ('story', 'Tell a story about the best meal you''ve ever had.'),
    ('story', 'Describe a time you had to make a snap decision.'),
    ('story', 'Tell a story about a friendship that mattered to you.'),
    ('story', 'Describe the most nervous you''ve ever been.'),
    ('story', 'Tell a story about a trip that didn''t go as planned.'),
    ('story', 'Describe a moment you felt truly proud of yourself.'),
    ('story', 'Tell a story about learning something the hard way.'),
    ('story', 'Describe a person who influenced you unexpectedly.'),
    ('story', 'Tell a story about a time you laughed until you couldn''t breathe.'),
    ('story', 'Describe a place you''d return to in a heartbeat.'),
    ('story', 'Tell a story about overcoming a fear.'),
    ('story', 'Describe a moment of pure luck, good or bad.'),
    ('story', 'Tell a story about a gift that meant more than it should have.'),
    ('story', 'Describe a time you surprised yourself.'),
    ('story', 'Tell a story about a rule you broke and don''t regret.'),
    ('story', 'Describe the strangest coincidence that''s happened to you.'),
    ('story', 'Tell a story about a time you had to start over.'),
    ('story', 'Describe a tradition that means something to you.'),
    ('story', 'Tell a story about the first time you tried something new.'),
    ('story', 'Describe a time silence said more than words could.'),
    ('story', 'Tell a story about someone who showed you unexpected kindness.'),
    ('story', 'Describe a moment you wish you could relive.'),
    ('story', 'Tell a story about a time you had to say goodbye.')
) as seed (mode, prompt_text)
where not exists (select 1 from public.questions);
