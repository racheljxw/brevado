# Brevado

Mobile-first app for practicing concise, intentional public speaking. Each day the user picks a
mode (interview, story, or miscellaneous), records a voice memo answering a prompt (or a
self-chosen topic), and gets AI-generated feedback shortly after — focused on structure,
conciseness, and filler-word usage. Past sessions and feedback are stored as a searchable
history. Goal: make it effortless to build a daily practice habit and see, over time, whether
speaking is actually getting more concise — not just generate one-off feedback.

Full detail lives in [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md) — read it when a task needs
more context than what's here.

## Current phase

**v1 is complete and tested end-to-end** — Phases 1-4 (auth, recording UI, upload, AI pipeline,
history/retention/retry, hardcoded question pool + mode selection) are all built. Phase 4 Step 5,
the v1 exit checkpoint's on-device pass (docs/PROJECT_PLAN.md's full test script — see
[Phase 4 exit checkpoint](#phase-4-exit-checkpoint) for the script itself), has now been run and
confirmed working, closing out the "still needs a manual on-device pass" caveat that this section
used to carry for most of Phase 3 and all of Phase 4. No further v1 feature work is planned. The
detailed step-by-step history of how each Phase 1-4 feature was built is kept in that feature's own
section below (e.g. [Recording cap](#recording-cap), [Mode selection](#mode-selection),
[Question selection](#question-selection), [History](#history), [Audio delete](#audio-delete),
[Audio download](#audio-download), [Phase 3 assessment](#phase-3-assessment),
[Phase 4 exit checkpoint](#phase-4-exit-checkpoint)) rather than repeated here — all of it is still
accurate for what exists in the repo today.

**v2 — a UI redesign plus a handful of new features — is starting now.** See
[Scope](#scope) below for the full summary: a bottom-nav restructure (new "Streaks" placeholder
tab, Home renamed to "Record"), a new Settings screen, a full visual redesign matched from design
screenshots outside this repo, Record-flow changes (a mode-select transition animation, no more
auto-navigate to History after upload, auto-generated editable recording titles), and a History
redesign (search bar, calendar view, and a 3-dot per-row menu that adds a new "Delete recording"
action alongside the existing download/delete-audio/regenerate actions). We're working
phase-by-phase and step-by-step, same discipline as v1 — nothing below this section has been
touched by v2 work yet, so the rest of this document still describes the v1 implementation exactly
as it exists in the repo right now.

**Terminology note:** docs/PROJECT_PLAN.md's old "v2" scope (criteria-based scoring, progress
charts, streak calendar, re-practice mode, dynamic question pool, additional modes) has been
renamed **v3**, to free up the "v2" label for this UI-redesign release — the underlying scope is
unchanged, only the version label moved. One wrinkle worth remembering: the "Streaks" bottom-nav
tab is added now, in v2, as an empty placeholder — v3 is what fills it with real content later, not
what introduces the tab. See docs/PROJECT_PLAN.md Section 2 for the full detail, and don't be
surprised by old "v2" references still in git history/commit messages predating this rename.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React Native + TypeScript (Expo), run via Expo Go | Mobile-first UI: recording (expo-audio), playback, history, dashboard. Free, no Mac needed to develop (EAS Build compiles in the cloud if ever needed) |
| Auth | Supabase Auth | Account creation/login |
| Database | Supabase Postgres | Users, recordings, transcripts, feedback, questions |
| File storage | Supabase Storage | Audio files, capped per user (`MAX_RECORDINGS_PER_USER`) and manually deleted rather than time-expired |
| API | Python (FastAPI) on Render | Handles uploads, serves data to the frontend, and runs background processing in-process via FastAPI's `BackgroundTasks` — no separate queue/broker/worker service |
| AI | Gemini API (Flash model, free tier) | Transcription (native audio input) + feedback generation (v2 extends this call to also return an auto-generated recording title); question generation in v3 |
| Hosting | Render (API only) | Frontend isn't web-hosted — it runs as an Expo project loaded through the Expo Go app; free-tier API subdomain, custom domain optional |

## Scope

**v1 (complete):** recording/playback/AI feedback pipeline, mode selection with a hardcoded
question pool, auth, history view, retry/regenerate logic, audio retention rules. Everything else
in this document describes v1 as it exists in the repo today, unless a section explicitly says
otherwise (nothing does yet — v2 work hasn't started touching code).

**v2 (building now) — UI redesign + new features:**
- **Nav:** bottom nav gains a third tab, "Streaks" (empty placeholder — v3 fills it in later).
  Home tab renamed/restructured as "Record".
- **Settings screen** (not a tab): a profile icon in the header on Record/History/Streaks only,
  never on a detail/sub-screen. Shows the user's email + a sign-out action, migrated from
  wherever sign-out currently lives (see [Auth](#auth)).
- **Visual redesign:** a new shared design system (colors, typography, card/button shapes,
  spacing), app-wide — not a per-screen reskin. **Matched from design screenshots outside this
  repo, screen by screen, as we build — this doc does not and should not specify exact hex values
  or measurements.** Qualitative direction only, for now: warm cream/peach background, dark
  brown/maroon text, pill-shaped buttons, rounded cards. Expect exact values from the user
  screen-by-screen as each one is built, not from anything written down here.
- **Record flow:** a shift/transition animation on mode selection; after upload, the app stays on
  Record showing live processing status instead of auto-navigating to History, with a "See more
  details" link to the History detail screen once done.
- **Recording titles:** a new `title` field, auto-generated by the existing Gemini feedback call
  (extended to also return one), user-editable afterward.
- **History:** a search bar (title + question, client-side filter), a Calendar/List toggle with a
  real calendar (dot per day with recordings, tap to filter), and a restyled list/detail view. Per-row
  actions move from inline icons/text to a 3-dot menu: Download audio, Delete audio, **Delete
  recording** (new — removes the row + audio together, unlike the existing audio-only delete),
  Regenerate report (failed rows only).

**v3 (deferred — do not build yet):** criteria-based scoring, progress-over-time charts, streak
calendar (fills the "Streaks" tab added in v2 — v3 doesn't introduce the tab itself),
re-practice/redo-question mode, dynamically growing AI-generated question pool, additional modes
beyond interview/story. Unchanged from the plan's original "v2" scope — only the version label
moved, to make room for the UI-redesign release above as the new "v2" (see
docs/PROJECT_PLAN.md Section 2).

**Out of scope for now:** email notifications, Apple Developer Program / App Store / TestFlight
distribution, multi-tenant scaling concerns (rate limiting, abuse prevention, paid AI tier), push
notifications (deletion warning is in-app badge only).

## Database

Supabase Postgres, no ORM — query via the `supabase-js` client (`src/lib/supabase.ts`) using
`.from(...)`, not raw SQL from the app. Schema lives as versioned SQL in
`supabase/migrations/` (`0001_initial_schema.sql`, `0002_storage_bucket.sql`, …) — that's the
source of truth; don't assume a table shape without checking there first, and add new schema
changes as a new numbered migration file rather than editing an applied one.

- `recordings` — one row per practice session: mode, question/topic, `audio_path`, `status`
  (`pending`/`processing`/`done`/`failed`), `transcript`, `feedback`, `metrics` (jsonb, Phase 2
  Step 4 — see [Metrics](#metrics) for the exact shape stored),
  `favorite`/`audio_deleted` flags. `favorite` is a personal star marker (renamed from `saved`,
  which used to mean "exempt from the old 7-day auto-delete") — it's no longer tied to any
  deletion behavior. As of Phase 3 Step 4 it's toggleable from the History list and detail screen
  (star icon, direct Supabase update via `setFavorite()` in `src/lib/recordings.ts` — see
  [History](#history)'s "Favorite toggle" bullets) — **it is purely a manual marker for the user's
  own reference, with no automated behavior tied to it anywhere**: no retention exemption, no
  confirmation step before Step 5 deletes a favorited recording's audio. Don't let a future step
  assume favoriting protects a recording from anything. `report_generated_at` has been removed — it
  only existed to compute the old
  7-day window. Retention is now a per-user cap, `MAX_RECORDINGS_PER_USER = 30` (counting rows
  where `audio_deleted = false`) — as of Phase 3 Step 3 this is enforced, not just defined; see
  [Recording cap](#recording-cap) for where and how. Deletion is manual only (bin icon per history
  row — built in Phase 3 Step 5, see [Audio delete](#audio-delete)), and only ever clears
  `audio_path`/sets `audio_deleted = true`; it never removes the row.
- `questions` — stub only (`id`, `mode`, `prompt_text`, `created_at`), reserved shape for the
  Phase 4 hardcoded pool and Phase 6 (v3) dynamic pool / re-practice. Not queried anywhere yet.

RLS is **on** for both tables and scoped to `user_id = auth.uid()` on `recordings` (select/insert/
update only — no delete policy yet, add one deliberately if a "delete recording" feature shows
up). `questions` is open-read (no user-specific data); writes to it go through the service-role
key only, bypassing RLS. Storage (`recordings-audio` bucket, private) mirrors this: objects must
live under a `{user_id}/...` path prefix, enforced by storage RLS policies in
`0002_storage_bucket.sql`.

## Auth

- The auth context/provider lives at `src/lib/auth-context.tsx` (`AuthProvider` + `useAuth()`).
  It wraps the whole app from `src/app/_layout.tsx`, holds `session`/`user`/`loading` state via
  Supabase's `onAuthStateChange`, and exposes `signUp` / `signIn` / `signOut` — these already
  convert raw Supabase `AuthError`s into a plain `error: string | null` for screens to show
  directly, so screens should never touch `error.message` from a raw Supabase call themselves.
- Routes are split into two Expo Router groups off `src/app/`: the signed-in side — `(tabs)/` (the
  real app — Record, History, Streaks; see [Navigation shell](#navigation-shell)) plus the non-tab
  `settings.tsx` ([Settings screen](#settings-screen)), both inside one `Stack.Protected` block —
  and two ungrouped signed-out screens, `login.tsx` and `signup.tsx`. `src/app/_layout.tsx`
  reads `useAuth()` and renders one side or the other via `Stack.Protected` — signed-in users only
  ever see `(tabs)`/`settings`, signed-out users only ever see login/signup, and a loading screen
  covers the initial session check on boot. **Future screens that only make sense when logged in
  belong under `(tabs)/`** (or as another screen in the protected block, like `settings`) — don't
  add ad hoc auth checks inside individual screens, the routing layer already handles it.
- Sign-out lives on the [Settings screen](#settings-screen) (v2 Epic A Step 2), reached via the
  header profile icon — migrated there from the old Phase 1 button on the Record tab, which is
  gone.
- Basic client-side validation (non-empty, email shape, min password length) lives in
  `src/lib/auth-validation.ts`, shared by both screens.
- Email confirmation is **on by default** for new hosted Supabase projects — an account created
  via `signUp` gets no session back until the confirmation link is clicked, which `auth-context`
  surfaces as `needsEmailConfirmation` (the signup screen shows a "check your email" notice in
  that case rather than silently doing nothing). To turn it off for solo/local testing: Supabase
  dashboard → **Authentication → Sign In / Providers → Email**, toggle off **Confirm email**. This
  wasn't verified against this project's actual dashboard state — check it directly and flip it
  per your own testing needs; flip it back on before any real users sign up.

## Navigation shell

v2 Epic A Step 1 — a structural-only change (no visual redesign, no new features): the bottom nav
is now **three tabs, in this order: Record / History / Streaks**, matching the design screenshots.
Defined in `src/components/app-tabs.tsx` (native, `NativeTabs` from
`expo-router/unstable-native-tabs`) and its `app-tabs.web.tsx` counterpart (custom `Tabs`/`TabList`
UI), both rendered from `src/app/(tabs)/_layout.tsx`.

- **Record** is the renamed/restructured former **Home** tab. The route file is still
  `src/app/(tabs)/index.tsx` and the recording flow it renders (mode-select → question → record →
  upload → inline status) is **completely unchanged** — only the tab's `<Label>` moved from "Home"
  to "Record". Any older "Home tab" reference elsewhere in this doc means this same screen.
- **History** — `src/app/(tabs)/history/` — unchanged in this step; its redesign is Epic D.
- **Streaks** — `src/app/(tabs)/streaks.tsx` — an **intentional empty placeholder**: a heading plus
  a "coming soon" line, nothing functional. Real streak/progress content is **v3 / Phase 6** (which
  fills this tab, but does not introduce it — the tab is added now, in v2). Don't build anything
  into it before then.
- No dedicated Streaks icon asset yet — the native tab uses an `sf="flame"` SF Symbol placeholder,
  same "swap when a real asset exists" situation as History still reusing the scaffold's
  `explore.png`.
- Profile icon + Settings screen were **not** part of Step 1 — added in Step 2, see
  [Settings screen](#settings-screen) below.

## Settings screen

v2 Epic A Step 2 — a structural/functional step, not the visual redesign (Epic B restyles this
along with everything else). Built with existing app patterns (`SafeAreaView` + `ThemedText`/
`ThemedView`, SF Symbol icons), no polish.

- **Route:** `src/app/settings.tsx` — a **non-tab stack screen**, not a fourth bottom-nav item.
  Registered in `src/app/_layout.tsx` inside the same `Stack.Protected guard={!!session}` block as
  `(tabs)`, so it's only reachable when signed in. Reached via `router.push('/settings')`; the
  screen's own "‹ Back" link is `router.back()`.
- **Profile icon:** `src/components/profile-button.tsx` (`ProfileButton`) — an SF Symbol
  (`person.crop.circle`) placeholder, same convention as `FavoriteStar` / the Streaks tab icon.
  **Visibility rule:** rendered only on the three main tab screens — Record
  (`src/app/(tabs)/index.tsx`), History (`src/app/(tabs)/history/index.tsx`), Streaks
  (`src/app/(tabs)/streaks.tsx`) — in a top header row. **Deliberately absent from every detail/
  sub-screen** (currently only History's detail view, `history/[id].tsx`, which keeps just its own
  "‹ Back to History" link). Any new sub-screen should follow the same rule — don't add
  `ProfileButton` to it.
- **What it shows:** the signed-in user's email (`useAuth().user?.email`) and a single **"Sign
  Out"** button calling `useAuth().signOut()`. On success the root navigator's auth guard flips and
  swaps the whole stack out for the login screen — the screen doesn't navigate itself; a failed
  sign-out shows an inline error and re-enables the button.
- **Sign-out migration:** the Phase 1 temporary "Sign out" button on the Record/Home tab
  (`src/app/(tabs)/index.tsx`) has been **removed** — Settings is now the only place sign-out
  lives, no duplication. (The Record screen still shows a "Logged in as {email}" line from Phase 1;
  that's cosmetic and left for Epic B to reconcile.)

## Design system

v2 Epic B. **Part 1** defined the token layer; **Part 2** (this pass) wired it in: Noto Sans
loads at boot, `ThemedText` renders it, the v1 `Colors` object is repointed at the warm palette
(so every screen reading `useTheme()` / `ThemedText` / `ThemedView` picks up the redesign without
being individually rewritten), all pure white/black is gone, the background is flat cream
everywhere, and the bottom nav is styled to the Figma spec as far as the system tab bar allows.
Full per-screen restyling of Record and History (cards, pills, buttons, spacing) is **deferred to
Epic C/D**, which rebuild those screens — Part 2 was a light-touch app-wide pass, not a
screen-by-screen redesign.

- **Where it lives:** `src/constants/theme.ts` — one module, extended, not replaced. Exports:
  `Colors` (v1, light/dark keyed, **now pointing at the warm palette** — both `light` and `dark`
  resolve to the same values), `Fonts`/`Spacing`/`BottomTabInset`/`MaxContentWidth` (v1,
  unchanged), and the v2 layer: `Palette` (raw hex, single source of truth), `NotoSans` (family
  names), `Theme` (`.colors` / `.radius` / `.spacing` / `.typography`), `ThemeColorToken`.
- **v2 is a single warm light theme** — `Theme` is a flat object, not light/dark keyed. `Colors`
  stays light/dark keyed only for backward compatibility; the two halves are identical. App is
  pinned to light: `app.json` `userInterfaceStyle: "light"`, and `src/app/_layout.tsx` gives
  React Navigation a cream container theme so transitions never flash a white/grey ground.
- **`textPrimary` was corrected `#1F0400` → `#2D1306`** (`Palette.brownBlack`). The old value was
  pixel-sampled from a PNG and carried compression noise; `#2D1306` is the authoritative Figma
  value. Applied via the `Colors`/`Palette` repoint, so it propagated to every `ThemedText` and
  every `theme.text` reader automatically — no per-screen edits.
- **Flat background, no gradient.** Part 1's `backgroundGradientStart` / `backgroundGradientEnd`
  tokens and `Palette.peach` are **removed** — the real spec is a single flat `#FFFAF6`. No
  `expo-linear-gradient` / `react-native-svg` gradient was ever added; `Theme.colors.background`
  is the one screen-background value.

**`Theme.colors`** (all values from `Palette`):

| Token | Hex | Role |
|---|---|---|
| `background` | `#FFFAF6` | screen background — flat, everywhere |
| `textPrimary` | `#2D1306` | primary text, headings, most icons, inactive nav icons/label (Figma-authoritative) |
| `textSecondary` | `#56453D` | muted/secondary text — best-available, no dedicated Figma sample (approximate) |
| `card` | `#FFFEFE` | card / raised surface fill |
| `cardBorder` | `#56453D` | 1px **inset** border on a card surface (Figma-authoritative) |
| `border` | `#DFCFC7` | hairline borders, dividers, unselected outlines — **also the active nav-tab pill** |
| `accent` | `#56453D` | fill for a selected/active control (e.g. active mode pill) — approximate, exact value in Epic C |
| `onAccent` | `#FFFEFE` | text/icon on top of an `accent` fill |
| `recordRed` | `#C53030` | the record button — approximate, exact value in Epic C |
| `favoriteGold` | `#F3BF16` | a filled favorite star — approximate |
| `modeInterview` / `modeStory` / `modeMiscellaneous` | `#E2CDF8` / `#F8CDE5` / `#CDE3F8` | mode pill bg (unselected) — approximate |
| `navStroke` | `#FFFEFE` | the 2px stroke around the nav capsule (Figma-authoritative) |
| `navIconActive` | `#B63700` | active bottom-nav tab icon (Figma-authoritative) |
| `shadow` | `#BEA398` | drop-shadow tint — **cards and** the nav capsule (Figma-authoritative; RN approximates spread/blur) |

Old `navActive` / `navActiveIcon` (`#FF8040` / `#FF9966`, pixel-sampled in Part 1) are **removed** —
the Figma nav spec superseded them (capsule is `background`, active pill is `border`, active icon
is `navIconActive`). `navShadow` was renamed **`shadow`** once the same tint started backing card
shadows too.

**`Theme.radius`:** `sm: 8`, `card: 16`, `lg: 24`, `pill: 999`. **`Theme.spacing`** (4pt): `xs: 4`,
`sm: 8`, `md: 12`, `lg: 16`, `xl: 24`, `xxl: 32`, `xxxl: 48`. **`Theme.shadows.card`**: `{ shadowColor:
shadow, shadowOpacity: 0.25, shadowOffset: {0, 4}, shadowRadius: 18, elevation: 6 }` — the Figma card
shadow (`#BEA398` @ 25%, y+4, ~30 blur + 5 spread; RN has no spread so `shadowRadius` stands in).
**`Theme.typography`:** `fontFamily` `{ regular, medium, semiBold, bold }` → `NotoSans_400Regular` /
`_500Medium` / `_600SemiBold` / `_700Bold`; `variants` (`display` 40 / `title` 28 / `heading` 20 /
`body`+`bodyMedium` 16 / `label` 14 / `caption` 12), each `{ fontSize, lineHeight, fontFamily }`,
weight carried by family.

### Cards

`src/components/card.tsx` — **`<Card>`**, the shared raised-surface component: near-white fill
(`theme.backgroundElement` = `#FFFEFE`), a **1px inset** `#56453D` border (`Theme.colors.cardBorder`;
RN borders are always drawn inside the box, which is what "inside" in the spec means), and the
`Theme.shadows.card` drop shadow. Takes `View` props; pass padding / gap / alignment / an overriding
`borderRadius` via `style`. Default radius is `Theme.radius.card` (16).

Applied to every content card in the app, replacing bare `<ThemedView type="backgroundElement">`:
- `src/app/settings.tsx` — the "Signed in as" card.
- `src/app/(tabs)/index.tsx` — `playbackCard` (the post-record / cap-blocked / question-select
  panel), `questionBanner`, `permissionCard`, and the mode-select cards (`ModeSelect` now wraps a
  `<Card>` in the `Pressable` instead of a hairline-bordered `Pressable`).
- `src/app/(tabs)/history/index.tsx` — the list row and the fetch-error card.
- `src/app/(tabs)/history/[id].tsx` — the audio-deleted / no-audio / audio-error notices, the
  failed / still-processing notices, and the metrics card.

**Deliberately NOT converted** (kept their own treatment): the upload-error / question-lookup-error
cards in `index.tsx` (`<ThemedView type="background">` with a red `#e5484d` border — an error banner,
not a content card), and the unused scaffold components (`hint-row.tsx`, `collapsible.tsx`).
`iOS shadows need a non-transparent background and are clipped by `overflow: 'hidden'` — `<Card>`
sets a background; don't add `overflow: hidden` to one that should cast a shadow.

### Noto Sans loading

- Package: **`@expo-google-fonts/noto-sans`** (`^0.4.2`), added to `package.json`. Bundles the TTFs,
  no native code — Expo Go safe.
- `src/app/_layout.tsx` calls `useFonts({ NotoSans_400Regular, _500Medium, _600SemiBold, _700Bold })`
  (subpath imports, so only those 4 weights bundle, not all 9 + italics) and returns `null` until
  fonts resolve — the native splash stays up, then `AnimatedSplashOverlay` hides it as before. A
  load **error** is logged and the app proceeds on the system sans-serif fallback rather than
  wedging.
- `src/components/themed-text.tsx` now sets `fontFamily` (not `fontWeight`) per `type`:
  `default`/`small` → medium, `smallBold` → bold, `title`/`subtitle` → semiBold, `link`/`linkPrimary`
  → regular, `code` → unchanged (`Fonts.mono`). Sizes/line-heights unchanged from the v1 scale.
- The `Theme.typography.variants` are still the eventual target; `ThemedText`'s `type` prop and the
  `variants` get reconciled into one system in Epic C/D.

### Nav bar (bottom tabs)

The Figma nav spec (from the actual file, treat as exact): label **Noto Sans Regular `#2D1306`,
constant regardless of active state** — only icon colour and pill vary; capsule background
`#FFFAF6` with a **2px `#FFFEFE` stroke** (deliberate, visible); drop shadow `#BEA398` @ 15%, 0/0
offset, 25 spread, 100 blur; active-tab pill `#DFCFC7` (= `Theme.colors.border` — the 50%-opacity
`#BEA398` flattens to exactly this, reuse the token, don't duplicate); active icon `#B63700`;
inactive icon `#2D1306`; Record tab icon = a microphone.

**Native (`src/components/app-tabs.tsx`) — still `NativeTabs` (the system UIKit tab bar), styled as
far as it allows** (the decision to keep `NativeTabs` and approximate, rather than build a custom
JS tab bar, was made deliberately for this pass):
- ✅ capsule background → `backgroundColor={Theme.colors.background}`
- ✅ label colour constant + Noto Sans → `labelStyle={{ default: {...}, selected: {...} }}` with the
  same `color: textPrimary` and `fontFamily: NotoSans.regular` in both states
- ✅ icon colours → `iconColor={{ default: textPrimary, selected: navIconActive }}`
- ✅ Record = mic (`sf={{ default: 'mic', selected: 'mic.fill' }}`); History = `list.bullet`;
  Streaks = `star`/`star.fill` (was the leftover `flame`). No more `home.png`/`explore.png`.
- ⚠️ `shadowColor={Theme.colors.shadow}` — on iOS this tints the tab bar's **top hairline
  separator**, NOT a real drop shadow. UIKit exposes no spread/blur bar-shadow API. Closest
  single knob; **expect to revisit on a device.**
- ❌ **2px capsule stroke** — no `NativeTabs` API. Not done.
- ❌ **real drop shadow** (spread + blur) — not done (see ⚠️ above for the partial stand-in).
- ❌ **tan active-tab pill on iOS** — `indicatorColor` is Android/web only; it's set to
  `Theme.colors.border` but has no effect on the iOS system bar. Not done.
- ❌ **icon size / icon-to-label gap** — the system tab bar sizes SF Symbol icons and spaces them
  from the label itself; `NativeTabs` exposes no `iconSize` / inset / `titlePositionAdjustment`
  passthrough for it. Not adjustable.

  The ❌ items all require replacing `NativeTabs` with a custom floating JS tab bar — a future call,
  not this pass.

**Web (`src/components/app-tabs.web.tsx`) — a custom component, so it renders the full spec:** the
`#FFFAF6` capsule, the 2px `#FFFEFE` `borderColor`, an approximated `shadow*` (no "spread" on
web/RN, so `shadowRadius` is bumped to compensate — tune later) + `elevation`, and the `#DFCFC7`
active-tab pill. Label colour constant. Scaffold cruft removed (the "Expo Starter" brand text is
now "Brevado", the Docs external-link is gone). Web isn't a shipping target but the file compiles
and previews correctly.

### White / black sweep (Epic B Part 2 global rule: never pure `#FFFFFF` / `#000000`)

Every hardcoded pure white/black in `src/` was found and replaced. Full list of what was using it:

| File | Was | Now | What it is |
|---|---|---|---|
| `src/constants/theme.ts` | `Colors.light.text: '#000000'` | `Palette.brownBlack` (`#2D1306`) | v1 light text token |
| `src/constants/theme.ts` | `Colors.light.background: '#ffffff'` | `Palette.cream` (`#FFFAF6`) | v1 light bg token |
| `src/constants/theme.ts` | `Colors.dark.text: '#ffffff'` | `Palette.brownBlack` | v1 dark text token (now = light) |
| `src/constants/theme.ts` | `Colors.dark.background: '#000000'` | `Palette.cream` | v1 dark bg token (now = light) |
| `src/app/login.tsx` | `<ActivityIndicator color="#ffffff" />` | `Palette.nearWhite` (`#FFFEFE`) | spinner on the submit button |
| `src/app/login.tsx` | `buttonText.color: '#ffffff'` | `Palette.nearWhite` | submit button label |
| `src/app/signup.tsx` | `<ActivityIndicator color="#ffffff" />` | `Palette.nearWhite` | spinner on the submit button |
| `src/app/signup.tsx` | `buttonText.color: '#ffffff'` | `Palette.nearWhite` | submit button label |

`Colors.backgroundElement` / `backgroundSelected` (v1) were also repointed (`#F0F0F3`/`#E0E1E6` →
`Palette.nearWhite`/`Palette.tanGray`) as part of the same repoint, though those weren't pure
white/black. Non-white/black accent literals left **as-is** for Epic C/D (explicitly out of scope
for this pass): `#e5484d` (error/delete red — `settings.tsx`, `index.tsx` record button,
`delete-audio-button.tsx`, `history/*`, `recording-status.ts`), `#3c87f7` (link blue —
`themed-text.tsx` `linkPrimary`, `login`/`signup` button bg), `#30a46c` (status "done" green,
`recording-status.ts`), `#f5a623` (favorite star, `favorite-star.tsx`), and the Expo-template
splash blues in `animated-icon.tsx` (`#208AEF`, `#3C9FFE`/`#0274DF`).

### Still flagged for Epic C/D

- **`recordRed` mismatch:** the record button in `index.tsx` uses `#e5484d`, not
  `Theme.colors.recordRed` (`#C53030`). Reconcile when Record is rebuilt.
- **Status badge colours** (`recording-status.ts`) still hardcode red/green — no warm-palette
  tokens for error/success yet.
- **`linkPrimary` blue** (`#3c87f7`) and the **auth submit-button blue** don't fit the warm palette
  — get warm values when auth/detail screens are rebuilt.
- **`favorite-star.tsx`** uses `#f5a623`, not `Theme.colors.favoriteGold` (`#F3BF16`).
- **Splash screen** (`animated-icon.tsx` + `app.json` splash `#208AEF`) is still the Expo-template
  blue + Expo logo — needs a Brevado brand asset + cream bg.
- **Nav bar ❌ items** above (stroke, drop shadow, iOS active pill) — need a custom tab bar.
- **Noto Sans on-device check:** `tsc` is clean and the font resolves, but the actual rendering
  (and the nav approximations) haven't been seen on the physical test iPhone yet.

## Recording

- Recording/playback uses **`expo-audio`**, not `expo-av` (deprecated, and the library it's easy to
  reach for out of habit — see Conventions below).
- The recording screen lives at `src/app/(tabs)/index.tsx` (the Home tab) — it replaces the
  template's placeholder content rather than living at a separate route, since recording is the
  core home-screen action per the project plan. As of Phase 4 Step 2, it's one of a few local
  "screens" this same file renders (behind mode selection — see [Mode
  selection](#mode-selection)), reached only after picking Miscellaneous (Interview/Story currently
  dead-end at a placeholder instead). `RecordingPlayback`, the upload/keep/discard UI shown after
  stopping, is a private component in the same file, but its play/pause + progress bar controls now
  live in `AudioPlaybackControls` (`src/components/audio-playback-controls.tsx`), extracted in
  Phase 3 Step 1 once the History detail screen needed the exact same controls for a recording's
  already-uploaded audio — see [History](#history).
- Flow: `useAudioRecorder(RecordingPresets.HIGH_QUALITY)` + `useAudioRecorderState` drive
  record/stop and the elapsed-time counter; on stop, `recorder.uri` (the local file URI) is kept
  in state and handed to a `useAudioPlayer`-backed playback view, which now also carries the
  Keep/Discard decision point that Upload (below) hooks into. Discarding clears that state, which
  unmounts the playback view and releases its player.
- Mic permission is requested lazily on the first record tap
  (`AudioModule.requestRecordingPermissionsAsync()`), not on screen load; a denied/blocked state
  shows an in-UI message instead of failing silently, with a link to the Settings app if the OS
  says it can't be asked again (`response.canAskAgain`).
- iOS permission copy (`NSMicrophoneUsageDescription`) is set via the `expo-audio` config plugin's
  `microphonePermission` option in `app.json` (`expo.plugins`), not a manually-added
  `ios.infoPlist` entry — the plugin writes it into `Info.plist` for you. **Note:** like all config
  plugins, this only takes effect on a native prebuild (EAS Build / dev client); running through
  Expo Go, the mic permission prompt and its copy come from the Expo Go app itself, not this
  project — worth knowing if the permission text looks generic while testing.

## Upload

- Upload logic lives in `src/lib/recordings.ts` (`uploadRecording`, `buildAudioPath`,
  `RecordingUploadError`) — separated from the recording screen so Step 6's history list and
  Phase 2's processing pipeline have one place to read/reuse this instead of duplicating it. The
  screen only owns UI state; it never talks to Storage or the DB directly.
- Trigger: the "Keep & upload" button on the Step 4 playback screen (`RecordingPlayback` in
  `src/app/(tabs)/index.tsx`) — upload never happens on every stop, only once the user has
  reviewed playback and explicitly kept the take. "Discard & re-record" bypasses upload entirely.
- Storage path: `{user_id}/{timestamp}.{ext}` in the `recordings-audio` bucket (`buildAudioPath`)
  — storage RLS (`0002_storage_bucket.sql`) only checks that the first path segment matches
  `auth.uid()`, so a timestamp is sufficient as the filename; it doesn't need to match the
  `recordings.id` the DB later generates.
- **Order of operations: upload to Storage first, then insert the `recordings` row with the
  resulting `audio_path`** — not insert-then-update. A `recordings` row is only ever created once
  its audio is durably stored, so an interrupted/failed upload can never leave a stray `pending`
  row with no audio behind it (this is what Step 5 required — no orphaned rows on upload
  failure). The tradeoff: if the upload succeeds but the insert itself then fails, the file is
  orphaned in Storage with no DB row pointing at it. That's accepted as the lesser problem — an
  untracked file to clean up later beats a broken row visible to the user — and Step 6's history
  list won't surface it since it only lists real rows.
- Failure/retry: `RecordingUploadError` carries which stage failed (`'upload'` vs `'insert'`) so
  the error message can say whether the audio itself is already safe. The screen keeps the
  generated `audio_path` in a ref across retries (`upsert: true` on the Storage call) so retrying
  overwrites the same object instead of accumulating duplicates; since the DB row is only
  inserted after a successful upload, retrying can't create duplicate rows either.
- Mode/question are hardcoded (`mode: 'miscellaneous'`, `question: null`) until Phase 4 adds real
  mode selection — this is the only combination the `recordings.mode` check constraint allows
  without that UI.

## Recording cap

Phase 3 Step 3 — enforces `MAX_RECORDINGS_PER_USER` (30, counting rows where
`audio_deleted = false`; see [Database](#database) and docs/PROJECT_PLAN.md Section 3's "Audio
retention" subsection). Checked **before** a recording can start, not after upload — a user should
never be able to record + hit upload and only then learn they're blocked.

- **Where the check lives, precisely: `handleSelectMode()` in `src/app/(tabs)/index.tsx`, the
  first thing it does when the user taps Interview, Story, or Miscellaneous on the mode-selection
  screen.** This is a relocation, done in Phase 4 Step 2 as planned — it originally lived in
  `handleStartRecording()` (the old bare record button, Phase 3 Step 3) before that button was
  replaced by mode selection as the real entry point into recording — see [Mode
  selection](#mode-selection) for the full detail on that screen. The `getActiveRecordingCount`
  call, the `MAX_RECORDINGS_PER_USER` comparison, and the block-with-message behavior all moved
  together, unchanged in logic — only the trigger point changed. There is exactly one place this
  is enforced on the frontend now; `handleStartRecording()` (still in the same file, now only
  reachable after the cap check has already passed) no longer does any cap check of its own.
- **Frontend check:** `getActiveRecordingCount(userId)` (`src/lib/recordings.ts`) — a direct
  Supabase count query (`select('id', { count: 'exact', head: true })`), not a backend endpoint.
  Chosen over adding e.g. `GET /recordings/cap-status` to the FastAPI backend because RLS ("Users
  can view their own recordings", `0001_initial_schema.sql`) already scopes the query correctly to
  the calling user — a backend round-trip would only add latency here, not correctness or any
  shared logic worth centralizing (there's no non-trivial cap *logic*, just a count and a
  comparison). `MAX_RECORDINGS_PER_USER` is mirrored as its own constant in `src/lib/recordings.ts`
  rather than fetched from the backend's copy (`backend/app/config.py`) — same accepted duplication
  as `RECORDINGS_BUCKET` already being defined separately in both projects (see
  [Backend](#backend)).
  - On a cap hit, `handleSelectMode` sets local state that swaps the mode options out for a
    `CapBlockedCard` (same file) — a clear "You've reached your 30 recording limit. Delete some
    audio from History to record more." message plus a "Go to History" button
    (`router.navigate('/history')`). No mode's recording UI is ever reached in this state.
  - If the count query itself fails (network blip), the check **fails open** — proceeding into the
    chosen mode is allowed rather than blocking someone over a check that couldn't complete. The
    Postgres trigger below is what makes that safe to do.
  - The blocked state resets on every screen focus (`useFocusEffect`), so navigating back from
    History (e.g. after a future manual delete frees a slot) shows the normal mode options again;
    the next tap re-checks for real rather than trusting the stale cleared state.
  - Under the cap, this is invisible: the count query runs once, inline, at tap time, and mode
    selection behaves exactly as before — no separate loading UI was added for it, since it's a
    single indexed count query and resolves well within the time the user spends granting mic
    permission anyway (for Miscellaneous) or reading the placeholder (for Interview/Story).
- **Backend/DB safety net:** a Postgres trigger, `recordings_enforce_cap` (function
  `enforce_recording_cap()`, `supabase/migrations/0004_recording_cap_enforcement.sql`), fires
  `before insert on recordings` and raises (blocking the insert) if the inserting user already has
  `>= 30` rows with `audio_deleted = false`. This — not a backend endpoint — is where the
  belt-and-suspenders check lives, because row creation still happens entirely on the frontend,
  direct against Supabase (`uploadRecording` in `src/lib/recordings.ts`; see [Upload](#upload)) —
  there's no backend code in the insert path to put a check in. The trigger is independent of the
  frontend check above by design: it holds even if the frontend check is buggy, skipped, or bypassed
  by some other client hitting the table directly with a valid session. At exactly 30, a 31st insert
  attempt gets a clear Postgres error (`check_violation`, `errcode 23514`) rather than silently
  succeeding — surfaces to the frontend as an `insert`-stage `RecordingUploadError` (see
  [Upload](#upload)'s "Failure/retry" bullet) if it's ever actually hit in practice (it shouldn't
  be, given the frontend check above runs first).
  - The cap number is hardcoded in the migration SQL itself, since Postgres can't read
    `MAX_RECORDINGS_PER_USER` from either `backend/app/config.py` (Python) or
    `src/lib/recordings.ts` (a separate frontend project). That's a third copy of the same number —
    if it ever changes, update all three: this migration, `backend/app/config.py`, and
    `src/lib/recordings.ts`.
  - This migration hasn't been applied via a Supabase CLI (this repo has `supabase/migrations/`
    files but no linked CLI project) — like `0001`–`0003` before it, run its SQL manually in the
    Supabase dashboard's SQL editor against the live project.
- **Freeing a slot:** as of Phase 3 Step 5, the bin icon in History (list and detail — see
  [Audio delete](#audio-delete)) is the real, built mechanism — deleting a recording's audio sets
  `audio_deleted = true`, which drops it out of `getActiveRecordingCount`'s count immediately.
  Before Step 5 the only way to drop below the cap was deleting `recordings` rows directly in the
  Supabase dashboard's table editor; that workaround is no longer needed.
- **How this was tested:** `MAX_RECORDINGS_PER_USER` was temporarily lowered to `2` in all three
  places (`backend/app/config.py`, `src/lib/recordings.ts`, and the migration's `max_recordings`)
  to make hitting the cap practical by hand, confirmed both that recording is blocked with the
  clear message at the cap and that recording still works normally below it, then the constant was
  set back to `30` in all three places before calling this step done.

## Mode selection

Phase 4 Step 2 — replaces the old bare record button with a real entry point into the recording
flow: three options, Interview / Story / Miscellaneous, on the Home tab. As of Phase 4 Step 3,
Interview/Story now lead to a real question-selection screen instead of a placeholder — see
[Question selection](#question-selection) for that logic; this section covers the screen-switching
shell around it.

- **Lives in the same file, `src/app/(tabs)/index.tsx` — not a new route.** The Home tab renders
  one of three "screens" via local component state (`FlowScreen`: `'mode-select' | 'question' |
  'record'`), the same pattern this file already used before Step 2 for switching between its
  record button / cap-blocked card / playback card. This was deliberate, not an oversight — this
  flow doesn't need a distinct URL, a real back-stack entry, or deep-linkability the way
  [History](#history)'s list -> detail push does (that's why *that* flow uses a real nested route
  and this one doesn't); still true post-Step 3 — the question screen turned out not to need any
  of that either, just its own local loading/error state.
  - `'mode-select'` (default): the three mode option cards (`ModeSelect`) — Interview, Story,
    Miscellaneous — each with a one-line description.
  - `'question'`: shown after selecting Interview or Story. `QuestionSelect` (Phase 4 Step 3,
    replacing Step 2's dead-end `ModePlaceholder`) kicks off `pickQuestionForMode()`
    (`src/lib/question-selection.ts` — see [Question selection](#question-selection)) the moment
    the mode is chosen, shows a brief "Choosing a question…" spinner while that's in flight, then
    renders the picked question's text plus a "Start recording" button that advances to
    `'record'`. A failed lookup (the underlying Supabase query itself throwing, not just finding no
    previous recording — see below) shows an inline error and a "Try again" button that re-runs the
    same lookup. A "‹ Change mode" link back to `'mode-select'` is always present, same position as
    the old placeholder had it.
  - `'record'`: shown after selecting Miscellaneous, or after tapping "Start recording" from the
    question screen. The same record/playback/upload UI that used to be the Home tab's only
    content. As of Step 3, whenever the active mode is Interview/Story it also renders a small
    banner above the record button showing "{Interview|Story} question" plus the chosen question's
    text, so the user isn't recording blind to something they saw once on a previous screen and
    then lost. A "‹ Change mode" link is still shown alongside the record button, same as Step 2.
- **Interview/Story now reach recording for real** — `selectedMode`/`selectedQuestion` (component
  state in `index.tsx`) are set the moment a mode is chosen (miscellaneous: `selectedQuestion =
  null` immediately; interview/story: set once `pickQuestionForMode` resolves) and carried through
  to `'record'` and into `handleKeepAndUpload`'s call to `uploadRecording()` — see [Question
  selection](#question-selection) for the exclusion logic and [Upload](#upload) for the insert
  itself. Tapping "Discard & re-record" or "Record another" does **not** re-run selection or clear
  `selectedMode`/`selectedQuestion` — it only resets the local unsaved-take state
  (`resetRecordingState`), so re-recording after a discard reuses the same already-chosen question
  rather than picking a new one. Getting a fresh pick requires going back through "‹ Change mode".
- **Cap check relocated here** from the old record button — see [Recording cap](#recording-cap)
  for the full detail. It now runs once in `handleSelectMode`, before any mode is entered, rather
  than in `handleStartRecording`.
- **Verification status:** frontend type-checks clean (`npx tsc --noEmit`). Not yet exercised in
  Expo Go on the physical test iPhone — same caveat as several Phase 3 steps (see [Phase 3
  assessment](#phase-3-assessment)) — including re-confirming the cap check still blocks/unblocks
  correctly at its current location. Suggested way to re-verify the cap: the same
  temporarily-lower-`MAX_RECORDINGS_PER_USER`-to-2 trick used to verify Phase 3 Step 3 (see that
  section's "How this was tested" bullet). See [Question selection](#question-selection)'s own
  verification note for the Step 3-specific test plan (confirming a real question reaches the DB,
  and that exclusion/repeat behavior is correct).

## Question selection

Phase 4 Step 3 — replaces Step 2's `ModePlaceholder` dead end with real question-selection logic
for Interview/Story, and threads the result into the database for the first time (Miscellaneous
still inserts `mode: 'miscellaneous', question: null`, unchanged).

- **Lives in `src/lib/question-selection.ts`, a new sibling file to `src/lib/questions.ts` — not
  added to `questions.ts` itself.** `questions.ts` is Step 1's pure data + lookup module (no
  Supabase, no async) and its own comments say so explicitly; this file's only job is a Supabase
  round-trip plus a random pick, so splitting them keeps `questions.ts` exactly what Step 1 said it
  would stay. The one exported function, `pickQuestionForMode(mode, userId)`, is called from
  `index.tsx`'s `handleSelectMode`/`loadQuestion` the moment Interview or Story is chosen (see
  [Mode selection](#mode-selection)).
- **The logic:** fetch the user's most recent recording in that same mode (`recordings` table,
  `.eq('user_id', userId).eq('mode', mode).order('created_at', { ascending: false }).limit(1)`),
  read its `question` column, filter that exact text out of `getQuestionsForMode(mode)`'s full
  pool, then pick randomly from what's left. No previous recording in this mode (first time ever,
  or nothing matched) skips straight to picking randomly from the full pool. Per
  docs/PROJECT_PLAN.md Section 3, only the *immediate* previous question is excluded — repeats are
  otherwise fine, and there's no broader "recently used" tracking here (explicitly out of scope for
  v1).
- **Exclusion is by exact TEXT match, not a stored question id — flagged deliberately, not an
  oversight.** The schema (`supabase/migrations/0001_initial_schema.sql`) has no `question_id`
  column; `question` is free text by design, because Step 4's custom-topic input will also write
  arbitrary user-typed text into that same column, not just curated pool picks — a `question_id`
  foreign key couldn't represent that case anyway. Exact-text matching has one narrow fragility: if
  a pool question's wording in `questions.ts` is ever edited later, a previously-stored recording
  referencing the old wording stops matching, so exclusion silently doesn't fire for that one
  transition (it degrades to "no exclusion possible," allowing a same-question repeat — not a crash
  or a wrong pick). That's an accepted tradeoff, not a bug to fix now: pool wording shouldn't churn
  often post-launch, and the same text-match approach is *required* anyway for the custom-topic
  case once Step 4 ships (a custom-typed previous question correctly won't match any pool entry,
  which correctly falls through to "pick from the full pool" — there was never anything to exclude
  it from). A `question_id` column would only harden the pool-question case and wouldn't help the
  custom-topic case at all, so it isn't worth adding preemptively.
- **Fails open, like the recording-cap check:** if the Supabase lookup itself errors (network
  blip), `pickQuestionForMode` logs a warning and falls back to picking from the full pool rather
  than blocking question selection over a lookup that couldn't complete — mirrors
  `getActiveRecordingCount`'s judgment call (see [Recording cap](#recording-cap)). This means the
  screen's own error/"Try again" state (see [Mode selection](#mode-selection)) is for a rarer
  failure than the lookup alone — in practice it would only fire if something in
  `pickQuestionForMode` failed in a way that isn't the network lookup, which shouldn't happen given
  the pool is always non-empty static data.
- **Reaching the database:** `index.tsx` carries the picked `Question` in `selectedQuestion` state
  and, in `handleKeepAndUpload`, passes `mode: selectedMode` and `question:
  selectedQuestion?.text ?? null` into `uploadRecording()` (`src/lib/recordings.ts`) — replacing
  the hardcoded `'miscellaneous'`/`null` literals from Phase 1. `uploadRecording` itself just takes
  `mode`/`question` as parameters now and inserts them as-is; it has no selection logic of its own.
  See [Upload](#upload) and [Mode selection](#mode-selection).
- **Custom topic input (Phase 4 Step 4, done).** `QuestionSelect` (`src/app/(tabs)/index.tsx`)
  renders a free-text input + "Use this instead" button alongside — not replacing — the pool
  question + "Start recording" button, in every state (loading/error/loaded), since typing a
  custom topic doesn't depend on the pool lookup having succeeded. Validation is just
  trim-then-check-non-empty (`handleUseCustomPress` in `QuestionSelect`) — no length limit or
  content filtering, consistent with how relaxed the rest of this app's input handling already is
  (see [Auth](#auth)'s "keep it simple" framing). Tapping "Use this instead" calls
  `handleUseCustomQuestion(mode, text)` (the screen's own component, not a new file), which builds
  a `{ id: 'custom', mode, text }` object — same `Question` shape `selectedQuestion` already holds
  for a pool pick, so `id` is just a placeholder never read anywhere — and advances straight to
  `'record'`, mirroring what tapping the pool's "Start recording" already does.
  - **No schema or `uploadRecording()` changes were needed, confirmed by reading the code, not
    assumed.** `selectedQuestion` was already typed as `Question | null` and
    `handleKeepAndUpload` already reads only `selectedQuestion?.text` when building the
    `uploadRecording()` call (see [Upload](#upload)) — it has no idea whether that text came from
    the pool or was typed by hand, and `uploadRecording()` itself just inserts whatever `question`
    string it's given. A custom question flows through the exact same `mode`/`question` state and
    insert path Step 3 already built; this step only added a second way to populate
    `selectedQuestion`, alongside `loadQuestion`'s pool pick, not a new one.
  - **Exclusion on the next recording in that mode still works, confirmed by reading
    `pickQuestionForMode`, not assumed.** Its lookup reads whatever raw text is in the previous
    recording's `question` column and filters it out of the pool by exact match (see this file's
    own top-of-section note on exclusion) — it has no notion of "pool question" vs. "custom
    question," so a custom-typed question stored today is excluded from tomorrow's suggestion
    exactly like a pool question would be. In practice this exclusion rarely has a visible effect
    for a custom question specifically, since custom text won't match a pool entry anyway — but it
    does mean the *same* custom text won't be immediately re-suggested if a future step ever
    surfaces past custom questions as suggestions.
  - **Verification status — the concrete test plan for this step:** select Interview, type a
    custom question, tap "Use this instead," record and upload, then check the row in Supabase's
    Table Editor — `mode` should read `'interview'` and `question` should contain the exact custom
    text. Select Interview again and confirm the suggested pool question is *not* that custom
    text (proving exclusion still fires across the custom path). Separately confirm the pool-pick
    path (ignoring the custom input entirely) still works exactly as Step 3 left it. This has not
    yet been run against the live Expo Go app + Supabase project — same caveat as several Phase 3
    steps (see [Phase 3 assessment](#phase-3-assessment)) and as Step 3 itself above — frontend
    type-checking clean is the only verification so far.

## History

- The list lives at `src/app/(tabs)/history/index.tsx` — this **replaces the scaffold's
  placeholder "Explore" tab** rather than adding a third tab (`app-tabs.tsx` and
  `app-tabs.web.tsx` were updated accordingly: `NativeTabs.Trigger`/`TabTrigger` name and route
  both renamed `explore` → `history`). The tab still reuses the scaffold's `explore.png` icon —
  there's no dedicated history icon asset yet; swap it whenever one exists. As of Phase 3 Step 1,
  `history.tsx` became this directory (plus `[id].tsx` and `_layout.tsx` — see the detail-screen
  bullet below) so a tapped row can push a nested route; `NativeTabs.Trigger name="history"` /
  `TabTrigger href="/history"` still resolve to this directory's `index.tsx` exactly as before,
  so nothing about the tab itself changed.
- Query logic is `fetchRecordings()` in `src/lib/recordings.ts`, alongside the upload logic —
  selects `id, mode, question, status, created_at, favorite, audio_deleted, audio_path` for the
  current user ordered by `created_at desc`. `question` was added in the Phase 4 Step 5
  exit-checkpoint review (see [Phase 4 exit checkpoint](#phase-4-exit-checkpoint)) — everything
  else here predates it. The list still doesn't need transcript/feedback/metrics; the detail screen
  (below) widens to the full row with its own separate query, `fetchRecordingById()`, rather than
  this one growing a `select('*')`.
- **What it shows**: date/time, mode, status, and — as of the Phase 4 Step 5 checkpoint — a
  one-line truncated preview of `question` per row (only rendered when non-null, so a
  miscellaneous row, which has no question, shows nothing extra) — no transcript/feedback text
  inline (the Phase 3 Step 1 detail screen, below, is where that lives, showing the question in
  full rather than truncated). Mode read `miscellaneous` for every row through Phase 3 since Phase
  4's mode selection didn't exist yet; as of Phase 4 Steps 2-4 it genuinely varies
  (`interview`/`story`/`miscellaneous`), and `status` moves `pending` -> `processing` ->
  `done`/`failed` as the real backend pipeline runs.
- **Status is visually distinct per state (Step 7):** `RecordingListItem`'s status badge colors
  `failed` red and `done` green (raw hex, not theme tokens, matching the same red already used for
  the record/error accents elsewhere in the app; same in light and dark mode) so a failed recording
  doesn't read as just another line of text next to `pending`/`processing`. `pending`/`processing`
  stay a neutral badge (`processing` additionally reads "Processing…" rather than the bare status
  word).
- **Question preview per row (Phase 4 Step 5 exit-checkpoint review, done):** `RecordingListItem`
  renders `recording.question` (when non-null) as a single truncated line
  (`numberOfLines={1}`) right below the date/status/favorite header row and above the
  mode/audio-actions row — a plain `ThemedText`, not a new component, since it's simple display
  text with no interaction. Absent entirely for miscellaneous rows (no question to show). This
  needed `fetchRecordings()`'s `select()` widened to include `question` (see above) — it wasn't
  in the list's original four columns since every recording had `question: null` when that query
  was first written, pre-Phase-4.
- **"Regenerate report" per row (Phase 3 Step 2, done):** a `failed` row also renders an inline
  "Regenerate report" text action directly in `RecordingListItem` — the plan's spec calls for a
  3-dot menu, but a plain inline action was judged to read just as clearly at this app's scale
  without a new menu component, so that's what's built. It's nested inside the row's outer
  `Pressable` (which navigates to the detail view on tap elsewhere in the row); React Native's
  touch responder system gives the inner `Pressable` exclusive claim on its own taps, so pressing
  it doesn't also navigate. Calls the same `regenerateReport()` (`src/lib/api.ts`) as the detail
  screen's button — see that screen's own "Regenerate report" bullet above and
  [Background processing](#background-processing)'s bullet for the backend side — with per-row
  in-flight/error state (`regeneratingIds`/`regenerateErrors`, keyed by recording id, in
  `HistoryScreen`) so regenerating one failed row doesn't affect any other. On success, the row is
  optimistically flipped to `processing` in local state, which the existing Step 7 polling below
  already picks up on its very next tick — nothing about that polling needed to change to support
  this.
- **Favorite toggle (Phase 3 Step 4, done):** each row also renders a star icon
  (`FavoriteStar`, `src/components/favorite-star.tsx` — shared with the detail screen below,
  filled `star.fill` vs. outline `star` via `expo-symbols`, same SF Symbols pattern already used by
  `Collapsible`) next to the status badge. Tapping it calls `setFavorite()` (`src/lib/recordings.ts`)
  — a **direct Supabase update, not a backend endpoint**: same reasoning as the recording-cap check
  in [Recording cap](#recording-cap) — RLS already scopes the update to the calling user, there's no
  Gemini/Storage call involved (unlike `/process`/`/regenerate`, which exist as backend endpoints
  specifically to hold the Gemini API key), so a backend round-trip would only add latency. The
  toggle is optimistic: local state flips immediately on tap (`handleToggleFavorite` in
  `HistoryScreen`, per-row in-flight tracked in `favoritingIds`) and reverts only if the update
  itself fails — no waiting on a refetch/poll tick to see the new state. **Purely a personal
  marker** — favoriting a recording has no effect on the cap, retention, or delete behavior (Step
  5); favorite and delete are fully independent, by design (see [Database](#database)).
- **Delete audio (Phase 3 Step 5, done):** each row also renders a bin icon (`DeleteAudioButton`,
  `src/components/delete-audio-button.tsx` — shared with the detail screen below), placed in its
  own row under the mode text rather than next to the status badge/star — that cluster is
  identity/status markers, this is a per-row *audio* action, and the Step 6 download icon sits
  right alongside this one in the same row. Nested inside the row's outer `Pressable` the same way
  the "Regenerate report" action is (above), so tapping it doesn't also navigate into the detail
  screen. Hidden entirely once `audio_deleted` is `true` — there's nothing left to act on. See
  [Audio delete](#audio-delete) for the full detail (endpoint, ordering, why it's a backend call).
- **Download audio (Phase 3 Step 6, done):** each row also renders a download icon
  (`DownloadAudioButton`, `src/components/download-audio-button.tsx` — shared with the detail
  screen below) in the same `audioActionsRow` as the bin icon, download first — reads as "export,
  then optionally delete." Nested inside the row's outer `Pressable` the same way the bin icon is,
  so tapping it doesn't navigate into the detail screen. Calls `shareRecordingAudio()`
  (`src/lib/recordings.ts`) with per-row in-flight/error state (`downloadingAudioIds`/
  `downloadAudioErrors`, keyed by id, same shape as delete's). **Hidden entirely whenever
  `audio_deleted` is `true` — same condition as the bin icon** — there's no file left to export,
  so the icon isn't shown disabled, it's simply absent; also defensively hidden if `audio_path`
  itself is falsy even though `audio_deleted` is false (shouldn't happen given upload-then-insert
  ordering, but avoids offering a button that would just error if a row ever showed up in that
  state). See [Audio download](#audio-download) for the full detail (why this one, unlike delete,
  needed no backend endpoint, and how a cancelled share sheet is distinguished from a real failure).
- Refresh: the list refetches on every focus (`useFocusEffect`, not a mount-only effect) so
  landing here from a fresh upload — or tabbing back after a second recording — always shows
  current data, since tab screens stay mounted in the background rather than remounting on
  switch. Pull-to-refresh (`RefreshControl`) covers the same case manually.
- **Status polling (Step 7, done):** while this tab is focused, a 1.5s interval refetches the list
  as long as any row is still `pending`/`processing` (`TERMINAL_STATUSES` = `done`/`failed`) —
  stops firing entirely once every row has reached a terminal state, and resumes automatically if
  a new non-terminal row shows up (e.g. a fresh upload). This is list-level, not literally
  per-row — `fetchRecordings()` is one query for the whole list, not one request per row, so
  there's no separate "stop polling this one row" mechanism to build; a finished row riding along
  in an in-flight tick's response is free (same one query either way), which is why the query
  itself isn't scoped down to just non-terminal rows — not worth the complexity at this app's
  scale (max 30 rows/user). Guards against out-of-order responses: each `load()` call gets a
  monotonically increasing id (`requestSeqRef`), and a response is only applied if it's still the
  most recently *issued* request when it resolves — otherwise it's discarded as stale. This fixes
  the flashing-stale-status bug flagged in Step 3's review (a slower, older request resolving after
  a faster, newer one used to briefly overwrite fresh state). Polling only runs while the tab is
  focused (kept from Step 2 — no reason to poll a screen the user isn't looking at). A flat 1.5s
  interval was kept rather than backoff (e.g. faster right after upload, slower the longer a row
  stays non-terminal): the pipeline normally finishes in well under a minute, so a flat interval
  costs at most a few dozen cheap Supabase queries per recording — backoff would be complexity
  without a real payoff at this scale. Worth revisiting only if a `pending`/`processing` row is
  ever seen sitting non-terminal for an unusually long time (more likely a sign of a stuck backend
  process than something polling interval tuning would fix).
- Loading (first fetch only, not on subsequent focus refetches — those update the list silently
  once data arrives so switching tabs doesn't re-blank it), empty, and fetch-error (with a Retry
  action, and without clearing any previously-loaded list) states are all handled explicitly.
- Upload → History handoff: on a successful upload, the Home tab (`src/app/(tabs)/index.tsx`)
  calls `router.navigate('/history')` right after setting its own "done" state, so the user lands
  on the updated list immediately instead of stopping at a static confirmation. The Home tab's own
  "done" confirmation state is intentionally left in place (not reset) underneath — tabbing back
  to Home still shows "Uploaded" + the recording id + "Record another", rather than silently
  resetting a screen the user didn't touch.
- **Detail screen (Phase 3 Step 1, done):** tapping a row pushes `src/app/(tabs)/history/[id].tsx`
  (`router.push({ pathname: '/history/[id]', params: { id } })` from `RecordingListItem`), a
  dynamic Expo Router route sitting alongside `index.tsx` in the same `history/` directory —
  `history/_layout.tsx` wraps both in a headerless `Stack` (matching every other screen's
  no-native-header convention) rather than letting the default nested-stack header appear only
  here. It fetches the full row with a new `fetchRecordingById()` (`src/lib/recordings.ts`;
  relies on the existing `recordings` select RLS policy to make a bad id or another user's id come
  back as `null` instead of a 403 the frontend has to special-case) and shows date/time, mode, a
  status badge (`getStatusPresentation`, pulled out of the list into `src/lib/recording-status.ts`
  so both screens render status identically), the full `question` text (when non-null — see below),
  audio playback, transcript, feedback, and metrics (filler-word rate shown as a rounded percentage,
  words-per-minute, and repetition count — plain text/numbers, no charts or scoring visuals, which
  is Phase 6/v3). Loading and not-found/error states (bad id, RLS-blocked id, or a genuine fetch
  failure) are all handled explicitly, the last two with a Retry action.
  - **Question display (Phase 4 Step 5 exit-checkpoint review, done):** `fetchRecordingById()` had
    already selected `question` since Phase 3 Step 1 (`RecordingDetail` always included it), but
    nothing actually rendered it — a gap left over from when every recording had `question: null`
    pre-Phase-4, only caught during the Phase 4 exit checkpoint's full-app review (see
    [Phase 4 exit checkpoint](#phase-4-exit-checkpoint)). Now a "Question" label + the full text
    renders right under the mode line, above audio playback, whenever `recording.question` is
    non-null — so the prompt you were answering is visible alongside the transcript/feedback that
    answer it, not just the day/time and status. Still absent for miscellaneous, which has no
    question.
  - **`status === 'failed'`** shows a clear failed notice instead of a transcript/feedback/metrics
    section — there isn't one, since a transcription failure marks the row failed with nothing else
    attempted (see [AI processing endpoint](#ai-processing-endpoint)) — plus, as of Phase 3 Step 2,
    a "Regenerate report" button right alongside it (`ReportSection` in `history/[id].tsx`).
    `pending`/`processing` (a row can be tapped into straight from History before the pipeline
    finishes) shows a plain "still processing" notice instead, rather than rendering `null`
    transcript/feedback as if that were the real, finished content.
  - **"Regenerate report" (Phase 3 Step 2, done):** the failed-state button above calls
    `regenerateReport()` (`src/lib/api.ts`) against the new `POST /recordings/{id}/regenerate`
    endpoint (see [AI processing endpoint](#ai-processing-endpoint)'s "Regenerate endpoint" bullet
    and [Background processing](#background-processing)'s "Regenerate report" bullet for the
    backend side), with its own in-flight spinner and inline error text scoped to the button
    (`regenerating`/`regenerateError` state in `RecordingDetailScreen`) — a failure here doesn't
    disturb the rest of the screen. On success, the screen optimistically flips its local
    `recording.status` to `processing` (matching what `process_recording()` sets as its own first
    step — see [Background processing](#background-processing)) so the existing pending/processing
    UI above takes over immediately with no separate "regenerating" display to build. The same
    action is also available per-row directly from the History **list** — see the list's status
    bullet below — so it's reachable whether the user is looking at a row in the list or has
    already tapped into its detail view.
  - **This screen's own polling (Phase 3 Step 2):** the History list's Step 7 polling (below) is
    scoped to the list's own component state and only runs while the list tab itself is focused —
    it does nothing for a screen further up the navigation stack, so it would **not** have picked
    up this recording moving `processing` -> `done`/`failed` if the user stayed on the detail
    screen after tapping "Regenerate report" rather than backing out to History. This screen
    therefore has its own equivalent, small polling effect (same shape: a flat 1.5s interval, gated
    on this screen being focused via `useFocusEffect`, an out-of-order-response guard via a shared
    `requestSeqRef`, stopping once `recording.status` is terminal per `TERMINAL_STATUSES` — now
    exported from `src/lib/recording-status.ts` so both screens use the same definition — and
    updating `recording` in place with no loading-spinner flicker). If the user instead backs out
    to the list after regenerating, the list's own Step 7 polling picks the row up correctly with
    no changes needed there — its `stillInFlight` check only cares whether *any* row is
    non-terminal, regardless of what put a row into that state.
  - **Favorite toggle (Phase 3 Step 4, done):** the same `FavoriteStar` component sits next to
    the status badge in this screen's header row, wired to its own `handleToggleFavorite` —
    identical optimistic-then-persist pattern as the list (flip `recording.favorite` locally,
    call `setFavorite()`, revert on failure) so the star responds instantly here too. Since the
    list refetches on every focus and this screen refetches fresh on mount (`fetchRecordingById`
    already selects `favorite`), toggling in either place is reflected in the other without any
    extra plumbing — a favorite set from the list shows correctly here on push, and one set here
    shows correctly in the list on navigating back.
  - **Audio playback reuses the exact `expo-audio` pattern from the Phase 1 record-and-preview
    flow**, now extracted into a shared `AudioPlaybackControls` component
    (`src/components/audio-playback-controls.tsx`; see [Recording](#recording)) so this screen and
    the Home tab's post-recording preview don't duplicate the play/pause/progress-bar logic.
    Playback here is driven by a signed Storage URL (`getRecordingAudioUrl()`, 1-hour expiry,
    `src/lib/recordings.ts` — the `recordings-audio` bucket is private, so this is how the client
    gets a fetchable URI at all) rather than a local file, but `useAudioPlayer(uri)` doesn't care
    which kind of URI it's given, so no extra branching was needed in the shared component itself.
  - **`audio_deleted` is checked and shows a clear "audio deleted" message in place of playback
    controls** — built in Step 1 before anything set that flag `true`, and as of Phase 3 Step 5
    that's exactly what this screen's own "Delete audio" action (right below playback, see
    [Audio delete](#audio-delete)) now does, with no revisiting of this conditional needed. A
    missing `audio_path` on an otherwise-real row (shouldn't happen, given upload-then-insert — see
    [Upload](#upload)) is handled the same defensive way rather than crashing.
  - **Download audio (Phase 3 Step 6, done):** see [Audio download](#audio-download) for the full
    detail — a `DownloadAudioButton` + "Download audio" row renders directly above the delete row
    (same rationale as the list: export reads naturally before delete), in all of playback's
    loading/ready/error states, calling the same `shareRecordingAudio()`
    (`src/lib/recordings.ts`) as the list. Rendered by the same `AudioSection` branches that already
    gate the delete row on `audio_deleted`/`audio_path` — no separate conditional needed, since both
    rows return before either is reached whenever there's no audio to act on.
  - **Delete audio (Phase 3 Step 5, done):** see [Audio delete](#audio-delete) for the full detail
    — a `DeleteAudioButton` + "Delete audio" row renders directly below playback (in all of its
    loading/ready/error states, since audio exists in each of those) whenever the recording still
    has audio, calling the same `deleteRecordingAudio()` (`src/lib/api.ts`) as the list. No
    confirmation dialog. On success, `recording.audio_deleted` flips to `true` locally (not
    optimistically — only once the backend confirms the delete completed), which the `AudioSection`
    conditional above already renders correctly with no further wiring needed.

## Audio delete

Phase 3 Step 5 — the real mechanism that frees a slot under `MAX_RECORDINGS_PER_USER` (see
[Recording cap](#recording-cap)); before this step, the only way to drop below the cap was
deleting rows by hand in the Supabase dashboard. **No confirmation dialog** — an explicit product
decision: delete is immediate on tap, from either the list or the detail screen, even for a
favorited recording. Favorite (Step 4) and delete are fully independent — favoriting has no effect
on this at all.

- **Endpoint, not a direct-Supabase call:** `DELETE /recordings/{recording_id}/audio`
  (`delete_audio` in `backend/app/routers/recordings.py`), same bearer-token auth and ownership
  check as `/process`/`/regenerate` (via the same `_fetch_authorized_recording` helper, now also
  selecting `audio_path`/`audio_deleted` so this endpoint doesn't need a second round-trip). This
  is a deliberate departure from the Step 3/4 pattern (`getActiveRecordingCount`, `setFavorite` —
  direct Supabase calls from the frontend): those have no Storage component and RLS already scopes
  them correctly, so a backend round-trip only adds latency. Deleting audio is different — it's a
  Storage delete *and* a DB update that both need to happen, and a partial failure between two
  independent client-side calls (Storage succeeds, DB update fails, or vice versa) would leave the
  row and the actual file disagreeing with no clean way to detect or recover from that from the
  client alone. Storage RLS also has **no delete policy** on the `recordings-audio` bucket
  (`supabase/migrations/0002_storage_bucket.sql` — this was anticipated when that migration was
  written) — client-side delete would need a new RLS policy opening that up, for a case that's
  more cleanly handled server-side anyway. Routing it through the backend means one place owns the
  ordering below and returns a single clear success/failure to retry against.
- **The operation, storage-first:** delete the Storage object at `audio_path` (service-role
  client, bypassing the missing RLS policy above), *then* update the row —
  `audio_deleted = true` and `audio_path` cleared to `null` (not kept for a historical record: no
  code has a reason to read a known-deleted path, and keeping it risks something later trying to
  use it for playback without checking `audio_deleted` first). This ordering mirrors
  `uploadRecording`'s "Storage first, then the DB write" principle (see [Upload](#upload)) run in
  reverse: if the DB write fails after a successful Storage delete, the row still has its
  (now-stale) `audio_path`, so a retry can find it, re-attempt the (idempotent) Storage delete, and
  complete the DB write — self-healing. Clearing `audio_path` first instead would risk losing the
  only reference to a file that then fails to delete, orphaning it with no way to retry. Row,
  transcript, feedback, and metrics are all left untouched — only `audio_path`/`audio_deleted`
  change.
- **Already-deleted is a no-op success, not an error:** if the row is already `audio_deleted`, the
  endpoint returns success immediately without touching Storage again — covers a double-tap, or
  deleting the same recording from the list and the detail screen in quick succession. This relies
  on deleting an already-missing Storage object itself being a no-op rather than an error (standard
  idempotent-delete semantics), which is what makes it safe for two near-simultaneous requests to
  both reach the Storage call before either has updated the row.
- **Frontend:** `deleteRecordingAudio()` (`src/lib/api.ts`, same request shape as
  `startProcessing()`/`regenerateReport()` but `DELETE` against `/audio`) is called from both the
  History list (`RecordingListItem`'s bin icon) and the detail screen (`AudioSection`'s "Delete
  audio" row) — see [History](#history)'s "Delete audio" bullets under both. Both call sites are
  **deliberately not optimistic**, unlike the favorite toggle: local state only flips to
  `audio_deleted: true` once the backend confirms the delete actually completed, rather than
  flipping immediately and risking a brief "audio deleted" flash for audio that's still there (or
  the reverse on a failed revert). A failure shows an inline per-row/per-screen error instead,
  telling the user to try again — the same in-flight/error-state shape (keyed by id in the list, a
  couple of `useState`s in the detail screen) already used for regenerate and favorite.
- **Verification status:** backend compiles, the full existing pytest suite still passes, and the
  frontend type-checks clean — but this step hasn't yet been exercised against the running Expo
  app + live Supabase project (delete from list, confirm detail screen updates; delete from
  detail, confirm list updates; confirm the Storage object is actually gone in the dashboard;
  confirm transcript/feedback/metrics survive; confirm `getActiveRecordingCount` drops). That
  manual pass is still needed before calling this step fully done — see
  [Recording cap](#recording-cap)'s "How this was tested" bullet for the equivalent Step 3 pass to
  follow the same shape of.

## Audio download

Phase 3 Step 6 — the last step of Phase 3. Per docs/PROJECT_PLAN.md's "manual Download button"
spec (Section 2, and Section 3's "save/download buttons"): exports a recording's audio file to the
user's device via `expo-file-system` + the native share sheet (`expo-sharing`), **not** a raw
blob/data-URI download — that pattern is unreliable on iOS, the only platform this app runs on via
Expo Go (see [Conventions](#conventions)). Pairs naturally with [Audio delete](#audio-delete) as an
"export before delete" flow (download sits first in both the list's `audioActionsRow` and the
detail screen's stacked rows), but the two are **fully independent actions with no forced
ordering** — nothing about download touches `audio_deleted`/`audio_path`, and nothing requires a
download before a delete.

- **No backend endpoint — unlike delete, this is a direct-Supabase-plus-on-device flow.** Playback
  already established the pattern this reuses: `getRecordingAudioUrl()` (`src/lib/recordings.ts`)
  gets a signed, time-limited Storage URL, which Storage RLS ("Users can read their own audio
  files", `0002_storage_bucket.sql`) already scopes correctly to the calling user. Delete needed
  the backend because it's a Storage delete *and* a DB update that must not disagree (see
  [Audio delete](#audio-delete)'s reasoning); download is a pure read plus an on-device
  file/share-sheet operation neither Supabase nor a backend round-trip has any part in, so there's
  nothing here for a backend endpoint to add beyond latency.
- **The flow, in `shareRecordingAudio(audioPath)` (`src/lib/recordings.ts`):** (1) confirm
  `Sharing.isAvailableAsync()` first, so an unavailable share sheet fails clearly rather than after
  an unnecessary download; (2) get a signed URL via the existing `getRecordingAudioUrl()`; (3)
  `File.downloadFileAsync()` (`expo-file-system`'s current, non-legacy API — same one
  `uploadRecording()` already uses for the reverse direction) it into a uniquely-named file
  (`Date.now()`-suffixed, so two downloads fired close together can't collide) under `Paths.cache`
  — not `Paths.document`, since the file only needs to survive long enough for the share sheet to
  read it, and `cache` is the directory the OS is allowed to reclaim under storage pressure; (4)
  `Sharing.shareAsync()` on that local file, opening the native share sheet (Files, AirDrop,
  Messages, etc.); (5) delete the temp cache file in a `finally`, regardless of whether anything was
  actually shared — no reason to accumulate temp copies of already-uploaded audio.
- **A cancelled share sheet is not an error, by construction, not by a special case in this app's
  code.** `expo-sharing`'s iOS module resolves `shareAsync()`'s promise identically whether the
  user completed a share or dismissed the sheet without picking anything (its
  `completionWithItemsHandler` calls `promise.resolve(nil)` in both the "completed" and the
  "dismissed without action" branches) — there's no distinct "user cancelled" rejection for this
  code to catch or suppress. Practically: a cancel just resolves `shareRecordingAudio()` normally,
  same as a completed share, so the calling screen's in-flight spinner clears with no error text,
  which is exactly the desired behavior. Only a genuine failure (no network fetching the signed URL,
  the URL rejecting the download, `isAvailableAsync()` returning `false`) throws and surfaces an
  inline error.
- **`audio_deleted` handling:** the download icon isn't rendered at all — not present-but-disabled
  — whenever `audio_deleted` is `true`, in both the list (`RecordingListItem`'s
  `!recording.audio_deleted` guard, shared with the bin icon) and the detail screen
  (`AudioSection`'s early-return branches for `audio_deleted`/missing `audio_path`, shared the same
  way with the delete row). The list additionally guards on `recording.audio_path` being non-null
  before rendering the icon — defensive, since `RecordingRow` now selects that column (Step 6 added
  it to `fetchRecordings()`'s `select()`, which previously only needed it in `RecordingDetail`) —
  matching the same "don't offer a button that would just fail" judgment already applied elsewhere
  (e.g. `AudioSection`'s "shouldn't happen, but don't crash" handling of a missing `audio_path`).
- **Frontend:** `shareRecordingAudio()` is called from both the History list
  (`RecordingListItem`'s download icon, `handleDownloadAudio` in `HistoryScreen`) and the detail
  screen (`AudioSection`'s "Download audio" row, `handleDownloadAudio` in
  `RecordingDetailScreen`) — see [History](#history)'s "Download audio" bullets under both. Same
  per-row/per-screen in-flight-and-error-state shape already used for delete/regenerate/favorite
  (`downloadingAudioIds`/`downloadAudioErrors` in the list, a couple of `useState`s in the detail
  screen) — a failed download on one row doesn't disturb any other row or the rest of the screen.
- **Dependencies:** `expo-file-system` was already a dependency (used since Phase 1's upload flow
  for its current `File`/`Paths` API, not the deprecated legacy API); `expo-sharing` is new as of
  this step, installed via `npx expo install expo-sharing` so npm resolved the SDK-54-compatible
  version automatically (`~14.0.8`) rather than picking a version by hand.
- **Verification status:** frontend type-checks clean, but — same caveat as
  [Audio delete](#audio-delete)'s Step 5 — this hasn't yet been exercised on the physical test
  iPhone (download from the list and confirm the share sheet opens and a save/share actually
  completes; same from the detail screen; confirm the icon is genuinely absent, not just disabled,
  once a recording's audio has been deleted; cancel out of the share sheet once on purpose and
  confirm no error text appears). That manual pass is the one still needed before trusting this
  completely — see [Phase 3 assessment](#phase-3-assessment).

## Phase 3 assessment

Same spirit as the Phase 1/Phase 2 wrap-ups: does Phase 3's revised scope (history detail view,
regenerate, cap enforcement, favorite, manual delete, download — Sections 3/4/5/7 of
docs/PROJECT_PLAN.md, not the stale Section 6 description) work end-to-end, and what's still shaky
before starting Phase 4?

- **Built and internally consistent:** every Phase 3 feature above compiles/type-checks together,
  the backend's existing pytest suite passes, and each feature was designed to compose with the
  others without hidden coupling — favorite and delete are independent (Step 4), download and
  delete are independent (Step 6), regenerating a failed row is picked up by the same polling that
  already existed for a fresh upload (Step 2), and the cap check degrades safely (fails open) if its
  own query fails (Step 3). No feature in this phase reaches into another's state directly; each
  goes through the shared `recordings`-row shape and its own small, scoped in-flight/error state.
- **What's confirmed on a physical device already:** Step 3 (recording cap) — deliberately tested
  end to end with the cap temporarily lowered to 2, both blocked-at-cap and works-below-cap
  behavior confirmed, then restored to 30 (see [Recording cap](#recording-cap)'s "How this was
  tested" bullet). This is the one Phase 3 feature with a real on-device pass already behind it.
- **What's still shaky — not yet exercised on the physical test iPhone, only type-checked/unit-
  tested:** Step 1 (detail screen), Step 2 (regenerate, both entry points), Step 4 (favorite, both
  entry points), Step 5 (delete, both entry points, plus confirming the Storage object is actually
  gone and `getActiveRecordingCount` actually drops), and Step 6 (download, both entry points, plus
  the cancelled-share-sheet case specifically). None of these have known bugs — they follow patterns
  (optimistic vs. non-optimistic state, per-row in-flight tracking, shared components between list
  and detail) that are already proven elsewhere in the app — but "type-checks and passes unit tests"
  and "confirmed working in Expo Go against the live Supabase project" are different claims, and
  only the former is true for five of Phase 3's six steps right now. **Recommend one focused manual
  pass through History (list and detail, one recording) before starting Phase 4:** favorite it,
  download its audio (verify the share sheet, verify a cancel produces no error), delete its audio
  (verify the bin/download icons both disappear, verify the list and detail screens agree), and — on
  a separate recording — trigger a failure and confirm "Regenerate report" recovers it. That single
  pass would cover Steps 1, 2, 4, 5, and 6 together.
- **Nothing found that blocks starting Phase 4** — the shakiness above is "unverified," not
  "known-broken." Phase 4's one concrete carry-over item, the cap check needing to move from the
  Home tab's old record button to whatever screen becomes the new entry point into recording, is
  now done as of Phase 4 Step 2 — see [Recording cap](#recording-cap) and [Mode
  selection](#mode-selection).

## Question pool (v1)

Phase 4 Step 1 — the fixed pool of 25 interview questions + 25 story questions
docs/PROJECT_PLAN.md calls for in v1 (a dynamically-growing, AI-generated pool is v3, Phase 6 —
see [Scope](#scope)).

- **Lives in `src/lib/questions.ts` as static in-app data — deliberately NOT the `questions` DB
  table stub** (see [Database](#database)). A fixed v1 pool doesn't need a DB round-trip on every
  mode selection, and this matches docs/PROJECT_PLAN.md's "no AI cost, no scheduled jobs required"
  framing for v1. The `questions` table stays exactly the stub it already was — reserved shape,
  not queried anywhere yet — until Phase 6 (v3)'s dynamic pool needs real rows to track "answered"
  against.
- **Shape:** `type Question = { id: string; mode: 'interview' | 'story'; text: string }`. Ids
  follow `interview-01`...`interview-25` / `story-01`...`story-25` — stable and zero-padded
  specifically so this same data can seed the DB table cleanly in Phase 6 without renumbering
  anything that by then might be referenced elsewhere (e.g. a user's answered-question history).
- **Helpers, ready but unused:** `getQuestionsForMode(mode)` (filters the pool by mode) and
  `getQuestionById(id)`. Note the "exclude the immediately-previous question" selection logic is
  explicitly **not** here — that's Phase 4 Step 3's job, wherever the recording flow actually picks
  a question to show. This file stays data + plain lookup only.
- **Wiring status:** this file was data + plain lookup only when Step 1 landed, with zero
  user-facing behavior change until later steps wired it up — see [Mode selection](#mode-selection),
  [Question selection](#question-selection), and the exit checkpoint below for Steps 2-5, all of
  which are now done. Don't read this bullet as "still unwired" — it describes Step 1's own scope,
  not the pool's current state.

## Phase 4 exit checkpoint

Phase 4 Step 5 — same spirit as the [Phase 3 assessment](#phase-3-assessment): does Phase 4's full
scope (hardcoded question pool, mode selection, real question-selection logic with exclusion,
custom topic input) hold together as one coherent user journey, and what's confirmed working versus
still unverified before calling v1 done? This step was a full-app read-through (`index.tsx`,
`history/index.tsx`, `history/[id].tsx`, `recordings.ts`, `question-selection.ts`,
`recording-status.ts`, and the backend's `processing.py`/`feedback.py`/`recordings.py` router, read
together as one user journey rather than file-by-file) plus a small number of fixes the review
surfaced, not new feature work — Phase 4's actual features (Steps 1-4) were already built and
documented in [Question pool (v1)](#question-pool-v1), [Mode selection](#mode-selection), and
[Question selection](#question-selection) before this step started.

- **Built and internally consistent, confirmed by reading the code, not assumed:** the full journey
  — mode select → question (pool or custom) → record → upload → `startProcessing()` → backend
  pipeline (transcribe → metrics → feedback, reading whatever real `mode`/`question` the row was
  inserted with) → History list/detail → favorite/delete/download/regenerate — has no broken link
  in it. Specifically checked, not assumed: `process_recording()` (`backend/app/services/
  processing.py`) re-reads `mode`/`question` fresh from the row rather than assuming
  `miscellaneous`/`null`, and passes them into `generate_feedback()` unchanged; `uploadRecording()`
  and `pickQuestionForMode()` (see [Question selection](#question-selection)) never needed to
  change for Step 4's custom-topic input, since both already treated `question` as an opaque
  string regardless of where it came from.
- **Gap found and fixed: History never displayed `question` anywhere.** `fetchRecordingById()` had
  selected `question` since Phase 3 Step 1, but neither the detail screen nor the list ever
  rendered it — harmless while every recording had `question: null` (pre-Phase-4), but a real gap
  once Phase 4 Steps 3-4 gave interview/story recordings a real chosen or custom-typed question:
  there was no way to see what prompt you'd answered anywhere in History, only the transcript/
  feedback that resulted from it. Fixed as part of this checkpoint, not deferred: the detail screen
  now shows the full question text (a "Question" label + text, right under mode, above audio
  playback) and the list shows a one-line truncated preview per row — see
  [History](#history)'s "Question display" and "Question preview per row" bullets for the exact
  implementation. This needed one small, low-risk query change (`fetchRecordings()`'s `select()`
  widened to include `question`, since the list's original four-column query predated Phase 4) —
  everything else about `uploadRecording()`/`pickQuestionForMode()` was already correct and needed
  no change, per the bullet above.
- **Two stale code comments fixed, no behavior change:** `backend/app/services/feedback.py`'s
  `MODE_CRITERIA` comment and a comment in `backend/tests/test_feedback.py` both still said
  "Phase 4 hasn't built mode selection yet" / "every recording today has question=null" — true when
  Step 5 of Phase 2 wrote them, stale now that Phase 4 Steps 2-4 exist. Reworded to describe what
  was true *then* (Phase 2 Step 5, pre-Phase-4) rather than asserting it as still true now. Caught
  by this step's full-file read-through — exactly the kind of "leftover state from an earlier step
  that no longer makes sense" this checkpoint was looking for; nothing else in that sweep turned up
  a similar staleness or naming mismatch.
- **What's confirmed via type-checking/code review, not yet on-device:** everything in this phase.
  `npx tsc --noEmit` is clean and the backend's full pytest suite (38 tests) passes, but — same
  caveat as every Phase 3 step carried into [Phase 3 assessment](#phase-3-assessment) — "type-checks
  and passes unit tests" and "confirmed working in Expo Go against the live Supabase project" are
  different claims. Phase 3's own on-device gap (Steps 1, 2, 4, 5, 6 unverified) is still
  outstanding too; it was never closed out by a manual pass, so this checkpoint's test script below
  covers both phases' backlog in one run rather than layering a second separate pass on top.
  Only Phase 3 Step 3 (recording cap) and Phase 1's core record/upload/auth loop have a confirmed
  on-device pass behind them so far (see [Phase 3 assessment](#phase-3-assessment) and
  [Upload](#upload)).
- **Nothing found that blocks calling v1 feature-complete.** The one gap this review surfaced
  (question display) is fixed above, not just flagged. Custom topic input's own edge case — does
  typing a custom question still exclude correctly on the next pick? — was already reasoned through
  and confirmed by reading `pickQuestionForMode` in [Question selection](#question-selection); this
  checkpoint's full-app read-through didn't find anything that contradicts that. What remains is
  purely the on-device verification pass below — no more code review or new features between here
  and v1.

**Full v1 end-to-end test script** (run in one pass; supersedes doing Phase 3's and Phase 4's
individual step-by-step spot checks separately — see the assessments above for what each spot check
would have covered on its own):

1. Fresh app open, sign in (or sign up if needed) — confirm you land on the Home tab, not stuck on
   a loading screen.
2. Go to History — with fewer than 30 active recordings, confirm the list loads normally (or shows
   the empty state on a brand-new account) with no cap-blocked message.
3. Back on Home, tap **Interview** — confirm a real pool question renders (not a placeholder), then
   record a short take, keep & upload it.
4. Watch it process: either stay on Home and navigate to History manually, or go straight there —
   confirm the new row appears `pending`/`processing` and moves to `done` within well under a
   minute with no manual refresh needed (Step 7 polling).
5. On that `done` row in the list: confirm mode reads `interview`, the pool question you were asked
   shows as a one-line preview, and the status badge is green "Done".
6. Tap into the detail screen: confirm date/time, mode, the **full** question text, audio playback
   (plays back correctly), transcript, metrics (filler-word %, wpm, repetition count), and feedback
   all render and look sane relative to what you actually said.
7. Tap the star to favorite it — confirm it fills immediately, then back out to the list and confirm
   it shows favorited there too without needing a refresh.
8. Back on Home, tap **Story**, and this time type a **custom** question/topic instead of using the
   suggested one (`"Use this instead"`) — confirm it advances straight to recording with your typed
   text, not the pool question. Record and upload.
9. Once that row is `done`, check its detail screen: confirm `question` shows your exact custom
   text, and transcript/feedback/metrics still generated normally (the pipeline doesn't care that
   the question was custom-typed).
10. Select **Story** again: confirm the suggested pool question is *not* the custom text you just
    typed in Step 8 (exclusion working across the custom-input path) — then back out via "‹ Change
    mode" without recording.
11. Pick **Miscellaneous**, record a short take, upload it — confirm its row shows mode
    `miscellaneous` with no question preview/text anywhere (list or detail), and that it still
    processes to `done` normally.
12. On any one `done` recording: tap the download icon (list or detail) — confirm the native share
    sheet opens; complete a save/share once and confirm no error. Then tap it again and cancel the
    share sheet on purpose — confirm no error text appears either time.
13. On that same recording, tap delete audio (list or detail) — confirm no confirmation prompt
    appears (expected — this is deliberate, not a bug), the bin/download icons both disappear
    immediately after, and checking the *other* screen (detail if you deleted from the list, or vice
    versa) shows the same "audio deleted" state. Confirm the Storage object is actually gone in the
    Supabase dashboard.
14. Confirm `getActiveRecordingCount` dropped: check History's total active-recording count
    informally (or re-run the temporarily-lower-the-cap trick from [Recording
    cap](#recording-cap)'s "How this was tested" bullet if you want a precise before/after).
15. Force a failure if you can (e.g. temporarily break `GEMINI_API_KEY` on the backend, or upload
    silence/no speech, or interrupt around the audio-download step), producing one `failed` row —
    confirm the red "Failed" badge, tap "Regenerate report" from **both** the list and the detail
    screen (on two different failed rows, or the same one twice), and confirm each recovers to
    `done` normally, with the row's `transcript`/`metrics`/`feedback` all correctly populated
    afterward.
16. Finally, spot-check Supabase's Table Editor directly against the `recordings` table: the
    interview row's `question` matches the pool text shown on screen, the story row's `question`
    matches your exact custom-typed text, and the miscellaneous row's `question` is `null` — this is
    the concrete proof (not just UI inference) that Phase 4 Steps 3-4 write the right value in every
    case.

## Backend

- Lives in [backend/](../backend/) — a sibling top-level directory in this same repo, alongside
  `src/`, `docs/`, `supabase/`. It's a **separate Python project** (own venv, own dependencies,
  own `.gitignore`) sharing git history with the Expo app rather than living in its own repo;
  don't mix backend code into `src/` or frontend code into `backend/`.
- Structure: a small package rather than a single file, since Phase 2 will grow this a lot —
  `backend/app/main.py` creates the FastAPI app (and now also configures root logging — see
  [AI processing endpoint](#ai-processing-endpoint)) and includes routers from
  `backend/app/routers/` (`health.py`, `recordings.py`); `backend/app/config.py` holds a
  `pydantic-settings` `Settings` object reading from `.env`. `backend/app/supabase_client.py`
  builds the one shared service-role Supabase client, `backend/app/gemini_client.py` (Step 3)
  builds the one shared Gemini client the same way, `backend/app/auth.py` holds the bearer-token
  verification dependency, and `backend/app/services/` holds background-work logic —
  `processing.py` (the pipeline orchestration), `metrics.py` (Step 4, pure deterministic-metrics
  logic — see [Metrics](#metrics)), and `feedback.py` (Step 5, mode-aware feedback-prompt building
  and the Gemini call that generates it — see [AI processing endpoint](#ai-processing-endpoint)).
  `metrics.py` and `feedback.py` are both kept as their own modules rather than folded into
  `processing.py` for the same reason: neither has any Supabase/network call of its own beyond (for
  `feedback.py`) the single Gemini call, both are easy to unit-test in isolation, and
  `processing.py` is already growing across Steps 3–6 as pure orchestration — kept out of the
  router module too, since it isn't itself request/response handling. Add new endpoints as new
  router modules under `app/routers/` rather than growing `main.py` directly.
- Dependencies are pinned in `backend/requirements.txt` (plain pip, not `pyproject.toml` — this
  is a small service without a package to publish, so `pip install -r requirements.txt` is the
  simplest thing that works and matches Render's default Python build). Includes `supabase`
  (`supabase-py`, added in Step 2), `google-genai` (added in Step 3 — see
  [AI processing endpoint](#ai-processing-endpoint) for why this package specifically, not the
  older `google-generativeai`), and `mutagen` (added in Step 4 — see [Metrics](#metrics) for why).
  Test-only dependencies (`pytest`) live in a separate `backend/requirements-dev.txt`, not
  installed on Render, since the deployed service never runs tests — install both files locally
  (`pip install -r requirements.txt -r requirements-dev.txt`) to run `pytest` from `backend/`.
- Config: `backend/.env` (gitignored; see `backend/.env.example`) holds `PORT` (local dev only —
  Render injects its own `$PORT`) plus `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` /
  `GEMINI_API_KEY`. All three are now live as of Step 3 — read `.env.example` before filling them
  in, it says exactly where to get each value and warns that the service-role key and Gemini key
  are both secret (must never reach the Expo app or any client-side code). `render.yaml` declares
  all three as `sync: false` env vars, so a deployed service needs them pasted into Render's
  dashboard separately — they aren't synced from the repo. See
  [AI processing endpoint](#ai-processing-endpoint) for how they're used.
- Run locally: from `backend/`, `python -m venv .venv`, activate it, `pip install -r
  requirements.txt`, then `uvicorn app.main:app --reload`. Confirm it's alive by hitting
  `GET http://localhost:8000/health` → `{"status": "ok"}`. To test from Expo Go on a physical
  phone, run with `--host 0.0.0.0` instead (so it listens on your LAN interface, not just
  loopback) — see `EXPO_PUBLIC_API_URL` in the root `.env.example`.
- Deploy target: Render, as a free-tier Python web service, configured via the `render.yaml`
  Blueprint at `backend/render.yaml` (chosen over manual dashboard setup so the service config
  lives in version control and Render re-syncs it automatically on push, rather than dashboard
  clicks nobody remembers later). Live URL: `https://brevado-api.onrender.com` (exact subdomain
  depends on what's available when the service is first created — check the Render dashboard for
  the actual assigned URL). Confirm a deploy is alive the same way as local: hit that URL's
  `/health` and expect `{"status": "ok"}`. Free tier sleeps after inactivity, so the first hit
  after a while can take ~30s to wake up.
- **What exists after Step 6:** the FastAPI app, `/health`, and `POST /recordings/{id}/process`
  (bearer-token verification, ownership/status checks, and a `BackgroundTasks`-scheduled
  `process_recording()`) — see [AI processing endpoint](#ai-processing-endpoint). Upload and
  row-creation still happen entirely on the frontend against Supabase directly
  (`src/lib/recordings.ts`); this backend is only involved from the moment a row already exists.
  **`process_recording()`'s transcript, metrics, and feedback steps are all real** (downloads the
  audio from Storage once, sends it to Gemini for a transcript, computes deterministic metrics
  from that transcript and the same audio bytes, then sends the transcript/metrics/mode/question
  to Gemini again for mode-aware feedback, storing each result as it succeeds — see
  [Metrics](#metrics)) — **no stub logic remains in the pipeline, and each Gemini-calling stage now
  retries once inline on failure before the recording is marked `failed`** — see
  [Background processing](#background-processing) for the retry policy itself.

## AI processing endpoint

- `POST /recordings/{recording_id}/process` (`backend/app/routers/recordings.py`) is what the Expo
  app calls right after its existing upload + row-creation flow (`src/lib/recordings.ts`)
  succeeds — see `startProcessing()` in `src/lib/api.ts`, called from the Home tab
  (`src/app/(tabs)/index.tsx`) right after `uploadRecording()` resolves. Upload and row creation
  are still entirely frontend-to-Supabase; this endpoint is only the trigger for what happens
  next.
- **Auth:** the Expo app sends the user's current Supabase access token as
  `Authorization: Bearer <token>` (via `supabase.auth.getSession()`). `app/auth.py`'s
  `get_current_user_id` FastAPI dependency verifies it by handing the token to Supabase's own
  `auth.get_user(token)` call — this validates the token against Supabase's Auth API directly,
  so the backend never needs to handle the project's JWT secret or verify signatures itself.
  Returns 401 if the header is missing/malformed or Supabase rejects the token.
- The endpoint fetches the recording row (service-role client, bypassing RLS), then checks
  `recording.user_id` against the verified caller and `status == 'pending'` before doing anything
  else. A recording that doesn't exist and one that exists but belongs to someone else return the
  **same** 403 response — a caller's token should never be able to tell those two cases apart. A
  recording that's already `processing`/`done`/`failed` gets 409 rather than being reprocessed.
- **Why the service-role key:** `app/supabase_client.py` builds one shared Supabase client from
  `SUPABASE_SERVICE_ROLE_KEY`, not the anon key — this backend process is trusted and needs to
  read/write *any* user's `recordings` row, which RLS (scoped to `auth.uid()`) would otherwise
  block. The bearer-token check above is what actually authorizes the request; the service-role
  client is what lets the now-authorized request act on that user's row. See `.env.example` (both
  root and `backend/`) for exactly where to paste the real key and why it must never reach the
  Expo app or any client-side code.
- On a valid, authorized, pending recording, the endpoint schedules a `BackgroundTasks` call to
  `process_recording()` (`backend/app/services/processing.py`) and returns `202 Accepted`
  immediately, without waiting for that work to finish.
- **`process_recording()`'s transcript, metrics, and feedback steps are all real as of Step 5, and
  each Gemini-calling stage retries once inline on failure as of Step 6 — no stub steps and no
  "fail on the first error" remain.** It flips the row `pending` -> `processing`, downloads the
  recording's audio from Storage once (`recordings.audio_path`, via the service-role client),
  sends it to Gemini (native audio input — one call, no separate transcription service) for a
  transcript, stores that transcript immediately, then computes deterministic metrics (see
  [Metrics](#metrics)) from that transcript and the same already-downloaded audio bytes and stores
  those too, then sends the transcript, metrics, mode, and question to Gemini a second time for
  mode-aware free-text feedback (`app/services/feedback.py` — interview -> directness/structure,
  story -> narrative arc/pacing, miscellaneous -> general clarity/conciseness, per
  docs/PROJECT_PLAN.md Section 3), and only then sets `status: done` with that real feedback
  attached. `status: done` now means the full pipeline actually ran, transcript through feedback.
  Each stage's result is written to the row as soon as it succeeds (transcript, then metrics), so
  a later stage failing can never lose or overwrite earlier, already-successful work — the same
  "don't discard good partial work" principle applies to a feedback failure as it already did to a
  transcription failure. If the transcription Gemini call fails, times out, or returns an
  empty/unusable transcript (`TranscriptionError`), or if the feedback Gemini call fails or
  returns empty/unusable text after transcript and metrics have already succeeded
  (`FeedbackGenerationError`), that stage is retried exactly once, immediately, within the same
  `process_recording()` call — see [Background processing](#background-processing) for the retry
  policy itself (`_run_with_one_retry` in `processing.py`) and why it retries only the failed
  stage rather than the whole pipeline. Only if the retry also fails does the recording get marked
  `failed` — a transcription failure marks it directly with nothing else attempted, and a feedback
  failure (after retry) still leaves the already-written transcript and metrics in place, only
  `status` reflecting the failure. Logging (requests sent, responses received, errors, and now
  which attempt a retry is on) goes through the standard `logging` module, configured in
  `app/main.py`, so it shows up in Render's log stream in production and stdout locally — check
  there when a recording ends up `failed`; the log lines are worded to distinguish a first-attempt
  failure ("retrying once immediately") from a final, both-attempts-exhausted failure ("giving up,
  marking failed").
- **Gemini client config:** `backend/app/gemini_client.py` builds one shared `google.genai.Client`
  from `GEMINI_API_KEY` (`app/config.py`), the same lazy-singleton pattern
  `app/supabase_client.py` uses for the Supabase client. Uses the **`google-genai`** SDK
  (Google's current unified Gen AI SDK) rather than the older, now-legacy
  `google-generativeai` package — see the comment at the top of `gemini_client.py` for the
  migration-guide link. Get a free key from Google AI Studio
  (https://aistudio.google.com/apikey, no credit card required) and paste it into
  `backend/.env`'s `GEMINI_API_KEY` — see `backend/.env.example` for the full instructions.
  **Model id is config-driven**, not hardcoded: `settings.gemini_model` (`app/config.py`,
  `GEMINI_MODEL` env var, defaults to `gemini-3.6-flash`) is what both
  `app/services/processing.py` (transcription) and `app/services/feedback.py` (feedback
  generation, Step 5) pass to `generate_content` — one model id for the whole pipeline, no reason
  for feedback generation (a single text-in/text-out call) to use a different model. This was
  deliberate, not just tidiness — during Step 3 testing
  (2026-08-25) `gemini-2.5-flash` (the model originally chosen for its confirmed native-audio +
  free-tier support) started 404ing with "no longer available to new users, use
  gemini-3.6-flash", so model ids clearly get retired/renamed over time. If it happens again,
  bump the default in `app/config.py` (or set `GEMINI_MODEL` in `.env`/Render) — a one-line
  config change, no code edit. If you're reading this later and wondering why the model choice
  doesn't match some older note that said `gemini-2.5-flash`: that's why.
- **Frontend polling (Step 7, done):** the History screen (`src/app/(tabs)/history.tsx`) refetches
  on a 1.5s interval whenever any visible row is `pending`/`processing`, so status visibly moves to
  `done`/`failed` without a manual pull-to-refresh — see [History](#history) for the full behavior
  (out-of-order-response guard, per-row stop condition, focus-gating) and why a flat interval
  (rather than backoff) was kept. Still a plain interval, not SSE/WebSockets/real-time — that
  tradeoff was reconsidered for this step and kept: the pipeline finishes in seconds to tens of
  seconds, this app has a handful of test users, and a push mechanism would add real infra
  (a persistent connection, or a DB trigger/webhook to invalidate on) for a savings that isn't
  needed at this scale.
- **Regenerate endpoint (Phase 3 Step 2, done):** `POST /recordings/{recording_id}/regenerate`
  sits alongside `/process` in the same router, sharing its auth/ownership check but requiring
  `status == 'failed'` instead of `'pending'`, and scheduling the identical
  `process_recording()` background task — see
  [Background processing](#background-processing)'s "Regenerate report" bullet for the full
  detail (including why no extra state needs resetting first) and [History](#history) for where
  the frontend calls it from.
- `EXPO_PUBLIC_API_URL` (root `.env`/`.env.example`) is the backend's base URL as seen from the
  Expo app — a LAN IP for local dev against a physical phone (Expo Go can't reach your laptop's
  `localhost`), or the deployed Render URL. See the comments in `.env.example` for both cases and
  how to switch.

## Metrics

Phase 2 Step 4. Deterministic metrics, computed purely in code from the transcript (and, for
words-per-minute, the audio) — no Gemini call involved, per docs/PROJECT_PLAN.md Section 3
("Processing & feedback"). Logic lives in `backend/app/services/metrics.py`, kept separate from
`app/services/processing.py` since it has no Supabase/Gemini/network calls of its own and is easy
to unit-test in isolation (see `backend/tests/test_metrics.py`) — `processing.py` is already
growing across Steps 3–6, so this keeps that module from also owning pure text-analysis logic.

- **Storage shape:** stored as-is into the `recordings.metrics` jsonb column:
  ```json
  {"filler_word_rate": 0.08, "words_per_minute": 142, "repetition_count": 3, "word_count": 210}
  ```
  `filler_word_rate` is a **fraction (0.0–1.0), not a percentage** — 0.08 means 8%. `word_count` is
  included alongside the two fields derived from it since the feedback prompt (see
  [Feedback generation](#feedback-generation)) and Phase 6 (v3)'s scoring both want it directly
  rather than re-deriving it from the transcript. This exact shape is what `app/services/feedback.py`
  reads as feedback-prompt grounding — changing key names or the rate/percentage convention later
  means updating both that prompt and Phase 6 scoring, not just this module.
- **Filler word list:** `FILLER_WORDS` at the top of `metrics.py` — a deliberately simple starter
  list (`um`, `uh`, `like`, `you know`, `sort of`, `kind of`, `i mean`, `basically`, `actually`,
  `literally`, etc.), matched via plain case-insensitive word-boundary regex, no context awareness.
  `like` and `so`-style words will also match legitimate non-filler uses ("I like pizza") — a known
  limitation of a starter list. Tune the list directly in `metrics.py` as real transcripts show
  what actually needs adjusting; it's the one place this logic lives.
- **Repetition:** `compute_repetition_count` counts immediate word/short-phrase repeats only (e.g.
  "the the", "I think I think") — checked longest-phrase-first (3/2/1 words) with the scan jumping
  past each match, so a repeat isn't double-counted at multiple phrase lengths. Deliberately not a
  general NLP repetition/disfluency detector — see the function's docstring for the exact algorithm.
- **Words-per-minute's duration:** read directly from the downloaded audio file's own metadata via
  `mutagen` (`get_audio_duration_seconds`, added to `backend/requirements.txt`), **not** from
  Gemini's transcription response — that response is plain text with no timing/duration metadata,
  and requesting timestamps would mean a second, more expensive Gemini call just to get one number.
  `process_recording` (`processing.py`) downloads the audio from Storage once and reuses those same
  bytes for both the Gemini call and this duration lookup — no second Storage round-trip.
- **Failure handling:** metrics computation is wrapped in its own try/except in `process_recording`,
  separate from the transcript-storing step before it. A metrics failure (most likely: audio
  duration can't be determined, so `words_per_minute` comes back `None`) never fails the recording
  or discards the transcript — it's logged and `metrics` is stored as whatever was computed (or
  `None` for a total failure), while processing continues on to feedback generation and `status`
  still ends up `done` on success. This was a deliberate choice, not the stricter alternative
  (failing the recording): the transcript is the expensive, valuable part (a real Gemini call
  against the user's actual speech), and metrics are a derived input to the feedback prompt (see
  [Feedback generation](#feedback-generation)) — losing them is a much smaller loss than
  re-requiring a full re-transcription over what's likely a narrow audio-parsing edge case. Note
  this is a metrics-*computation* failure specifically (caught in `process_recording`, not inside
  `compute_metrics` itself) — a *feedback*-generation failure afterward is handled differently,
  since by that point there's real work (transcript, and metrics if they succeeded) worth
  preserving; see [Feedback generation](#feedback-generation).
- **Tests:** `backend/tests/test_metrics.py` (pytest, `requirements-dev.txt`) covers filler-rate,
  repetition, word-count, and WPM/duration logic against hand-written sample transcripts and a
  synthetic WAV file (built with the stdlib `wave` module, no fixture files needed) — run with
  `pytest` from `backend/` after installing both requirements files.

## Feedback generation

Phase 2 Step 5 — the final, previously-stubbed piece of the pipeline; **no stub logic remains
anywhere in processing now.** Logic lives in `backend/app/services/feedback.py`, kept as its own
module for the same reason as `metrics.py` (see [Metrics](#metrics)): `build_feedback_prompt` is
pure string-building with no network call of its own, so it's easy to unit-test in isolation (see
`backend/tests/test_feedback.py`) independent of the actual Gemini call.

- **Prompt inputs:** the transcript, the computed metrics dict (or `None` — see [Metrics](#metrics)
  for when that happens), `mode`, and `question` (the recording's chosen question/topic, currently
  always `null` — see [Current phase](#current-phase) — but the prompt handles a real question too,
  for when Phase 4 adds mode selection). Metrics are turned into a natural-language grounding
  sentence (e.g. "spoke at approximately 142 words per minute") by `_format_metrics_grounding`
  rather than handed to Gemini as raw numbers or left for it to recount from the transcript itself,
  per docs/PROJECT_PLAN.md Section 3. `question` being `null` renders as "the speaker chose their
  own topic" rather than being silently omitted.
- **Mode-specific criteria:** `MODE_CRITERIA` in `feedback.py` — interview -> directness/structure,
  story -> narrative arc/pacing, miscellaneous -> general clarity/conciseness, per
  docs/PROJECT_PLAN.md Section 3. All three branches were built and tested at Phase 2 Step 5 even
  though every real recording at that time was `mode='miscellaneous'` (Phase 1's placeholder
  recording flow — Phase 4 hadn't built real mode selection yet), which is exactly why Phase 4
  didn't need this rebuilt when it landed.
- **Output:** free-text prose feedback only (2-4 short paragraphs, no headers/bullets/numeric
  scores) — structured, criteria-based scoring is explicitly Phase 6/v3 of the project plan, not
  this step.
- **Model:** reuses the same shared Gemini client and `settings.gemini_model` as transcription (see
  [AI processing endpoint](#ai-processing-endpoint)) — a single text-in/text-out call has no reason
  to use a different model from transcription.
- **Failure handling:** `FeedbackGenerationError` (mirroring `TranscriptionError` in
  `processing.py`) is raised for a failed Gemini call or an empty/unusable response. Critically,
  `process_recording` stores the transcript and metrics to the row *before* attempting feedback
  generation, so a `FeedbackGenerationError` never loses or overwrites that already-successful
  work — only `status` moves to `failed`. Same "don't discard good partial work" principle as a
  transcription failure, applied one stage later. As of Step 6, a `FeedbackGenerationError` gets
  one immediate inline retry of just the feedback call (reusing the transcript/metrics already in
  hand, no re-transcription) before the recording is marked `failed` — see
  [Background processing](#background-processing).
- **Tests:** `backend/tests/test_feedback.py` (pytest) checks `build_feedback_prompt` and
  `_format_metrics_grounding` directly — that the built prompt string contains the right
  mode-specific criteria, handles a `null` question vs. a real one, includes the transcript
  verbatim, and reflects the metrics grounding correctly (including `None` metrics and a `None`
  `words_per_minute`) — for all three modes. Does **not** call the live Gemini API; run with
  `pytest` from `backend/` alongside the metrics tests.

## Background processing

- No task queue, broker, or worker process — background work (transcription + feedback
  generation) runs via FastAPI's built-in `BackgroundTasks`, in the same process as the web
  service that serves everything else. Chosen because Render has no free tier for a background
  worker (minimum ~$7/month), and this project stays at $0/month at its current scale (builder +
  a few test accounts).
- Trigger point: `POST /recordings/{id}/process` (see
  [AI processing endpoint](#ai-processing-endpoint)), called by the Expo app once its own
  upload + row-creation already succeeded — the row therefore already exists by the time this
  fires. The endpoint schedules a `BackgroundTasks` call to do the Gemini transcription + feedback
  work in that same request/response cycle, no separate dispatch step. As of Step 5, that call
  target, `process_recording()`, is real end to end — transcription, metrics, and feedback
  generation — see that section.
- **Retry (Phase 2 Step 6, done):** each of the two Gemini-calling stages —
  transcription and feedback generation — gets one immediate inline retry if it raises
  `TranscriptionError`/`FeedbackGenerationError`, via `_run_with_one_retry()` in
  `app/services/processing.py`. Both attempts happen synchronously inside the same
  `BackgroundTasks` call that's already running — there's no separate re-triggered request and no
  intermediate `failed` write, so a caller polling `status` never sees `failed` unless *both*
  attempts of a stage failed. If the retry also fails, the recording is left `failed` with no
  report, and (Phase 3 Step 2, done) the manual "Regenerate report" action covers retrying again
  later, without limit — see the "Regenerate report" bullet further down for exactly how that
  plugs in.
  - **Stage-level, not whole-pipeline retry:** a feedback-generation failure retries only the
    feedback call — reusing the transcript/metrics already computed and written to the row on the
    first pass — rather than re-downloading audio and re-running a second, wasted transcription
    Gemini call over speech that was already transcribed correctly. A transcription failure
    retries the download+transcribe pair together (re-downloading audio is a cheap Storage
    round-trip, not the expensive Gemini call this policy is trying to avoid wasting). This was a
    deliberate choice between the two options considered: whole-pipeline retry (simpler, but
    wastes a successful transcription on a feedback-only failure) vs. stage-level retry (the
    approach taken) — stage-level wasn't meaningfully more complex *because* the pipeline was
    already structured, since Steps 4–5, to store each stage's result to the row as soon as it
    succeeds; that same structure is what lets a feedback retry just reuse in-memory
    transcript/metrics instead of needing to re-fetch them.
  - **Metrics computation is not part of this retry policy** — it isn't a Gemini call, and its own
    failure handling (log + store `None`, never fail the recording) predates Step 6 and is
    unchanged; see [Metrics](#metrics)'s "Failure handling" bullet.
  - **Logging** distinguishes a first-attempt failure ("`... failed on first attempt (...) —
    retrying once immediately`") from a both-attempts-exhausted failure ("`... failed again on
    retry (...) — giving up, marking failed`", followed by `process_recording`'s own "`giving up
    after retry, marking failed to ...`" line right before the `status: failed` write) — before
    Step 6 these were indistinguishable in the logs, since every failure was a first-and-only
    attempt.
  - **Tests:** `backend/tests/test_processing.py` unit-tests `_run_with_one_retry` in isolation
    (succeeds first try / recovers on retry / gives up after both attempts fail / doesn't retry an
    unrelated exception) with fake flaky callables — no live Gemini/Supabase calls, same spirit as
    `test_metrics.py`/`test_feedback.py`.
- **"Regenerate report" (Phase 3 Step 2, done):** docs/PROJECT_PLAN.md Section 3 describes a
  manual "Regenerate report" option for a `failed` recording, retryable without limit — this now
  exists end to end, backend and frontend, and **closes out Section 3's "Retry behavior" in full**
  together with Phase 2 Step 6's automatic retry above: Step 6 handles transient failures
  automatically with zero user action (one inline retry per stage, immediately, within the same
  pipeline run), and this step covers anything still `failed` after that, with no retry-count
  limit on how many times a user can trigger it manually.
  - **Endpoint:** `POST /recordings/{recording_id}/regenerate`
    (`regenerate_report` in `app/routers/recordings.py`) — same bearer-token auth and
    ownership check as `/process` (factored into a shared `_fetch_authorized_recording` helper so
    both endpoints give a caller an identical 403 for a nonexistent vs. someone-else's recording;
    see [AI processing endpoint](#ai-processing-endpoint)'s "Auth" bullet), but the mirror image on
    the status check: valid only from `status == 'failed'` (409 otherwise, e.g. calling it on a
    `pending`/`processing`/`done` recording), where `/process` is valid only from `pending`. On
    success it schedules the exact same `process_recording()` background task as `/process` and
    returns `202` immediately the same way — no separate "regenerate" pipeline function.
  - **No extra reset needed before retrying:** confirmed by reading `process_recording()` itself,
    not assumed — it already starts every run by flipping `status` straight to `processing` (not
    `pending`; there's no intermediate `pending` state on a regenerate, unlike a fresh upload) as
    its very first write, then overwrites `transcript` unconditionally the moment transcription
    succeeds, `metrics` unconditionally right after, and `feedback` only alongside the final
    `status: done` write. There's no separate failure-reason column or other failure-related state
    on the `recordings` row (see `supabase/migrations/0001_initial_schema.sql`) to clear first. The
    one nuance: if a regenerate run itself fails again at the feedback stage, whatever `transcript`/
    `metrics` that run just (re)computed stay on the row — same "don't discard good partial work"
    principle as the original run, just re-applied on a second pass.
  - **Frontend:** `regenerateReport()` (`src/lib/api.ts`, sharing a private `postRecordingAction`
    helper with `startProcessing()` — same request shape, different path) is called from both the
    History **list** (`RecordingListItem`, per failed row) and the **detail screen**
    (`ReportSection`'s failed-state button) — see [History](#history)'s "Regenerate report" bullets
    under both the list and the detail screen for exactly how each is wired, including why the
    detail screen needed its own small polling effect that the list's Step 7 polling doesn't
    already cover.
- The same pattern (no cron) applies to the v3 question-pool top-up: it fires from a
  `BackgroundTasks` call triggered by mode selection running low on unused questions, not a
  scheduled job. See plan Section 5's "Question pool" subsection.

## Conventions

- Use `expo-audio` for recording/playback — **not** `expo-av` (deprecated).
- Development runs via the **Expo Go** app on a physical iPhone, not a standalone/dev-client
  build. No Apple Developer Program membership yet — don't introduce anything that requires one
  (e.g. custom native modules outside the Expo Go sandbox, EAS device builds).
- **Expo SDK version is pinned deliberately** (currently SDK 54, per `package.json`) to match
  what the installed Expo Go app on the test iPhone supports — never run `expo install --fix`,
  `npx expo upgrade`, or otherwise change Expo/React Native/related package versions without
  being asked first, even to fix a peer-dependency warning.
- The backend (FastAPI on Render, background work via `BackgroundTasks`) is a **separate Python
  project** living in [backend/](../backend/), a sibling directory to `src/` in this same repo —
  not part of this Expo/TypeScript project, and don't mix backend code into `src/`. See
  [Backend](#backend) above for how to run/deploy it.
- Routing: **Expo Router**, file-based under `src/app/` (chosen over React Navigation — smaller
  boilerplate and better fit for this app's shallow, mostly-linear screen flow: home → record →
  processing → history/detail. See `src/app/` for routes, `src/components/` for shared UI,
  `src/lib/` for the Supabase client / future API calls, `src/types/` for shared TS types).
- Supabase URL/anon key are read from `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
  and the backend's base URL from `EXPO_PUBLIC_API_URL`, all in `.env` (gitignored; see
  `.env.example`) — never hardcode them. See [AI processing endpoint](#ai-processing-endpoint) for
  what `EXPO_PUBLIC_API_URL` needs to be set to locally vs. deployed.
- Full project plan, phases, and data-flow detail: [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md).
