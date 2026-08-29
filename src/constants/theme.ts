/**
 * App color / typography / spacing tokens.
 *
 * The v1 `Colors` object (light/dark keyed, consumed via `useTheme()` /
 * `ThemedText` / `ThemedView`) is now repointed at the v2 warm palette —
 * see the "v2 Design System" block lower down for the authoritative token
 * set and docs/CLAUDE.md's "Design system" section for the full rundown.
 * Both `light` and `dark` resolve to the SAME warm values on purpose: v2
 * is a single warm *light* theme and deliberately not dark-mode-aware.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Raw values — the single source of truth for every hex code in the app.
 * Prefer the semantic names in `Colors` / `Theme.colors` below; reach for
 * `Palette` directly only when something genuinely needs the literal.
 *
 * "Figma-authoritative" = exact value from the design file. "approximate"
 * = pixel-sampled in Epic B Part 1, gets an exact value when the relevant
 * screen is rebuilt in Epic C/D.
 */
export const Palette = {
  cream: '#FFFAF6', // screen background — flat, NO gradient (Figma-authoritative)
  brownBlack: '#2D1306', // primary text, headings, inactive nav icons (Figma-authoritative)
  warmBrown: '#56453D', // selected/filled element; also the best-available muted-text tone (approximate)
  recordRed: '#C53030', // record button (approximate)
  tanGray: '#DFCFC7', // borders / dividers / unselected outlines; also the active nav-tab pill (Figma-authoritative)
  nearWhite: '#FFFEFE', // card surfaces; also the 2px nav-capsule stroke (Figma-authoritative)
  gold: '#F3BF16', // filled favorite star (approximate)
  pillPurple: '#E2CDF8', // interview mode pill, unselected (approximate)
  pillPink: '#F8CDE5', // storytelling mode pill, unselected (approximate)
  pillBlue: '#CDE3F8', // miscellaneous mode pill, unselected (approximate)
  navIconActive: '#B63700', // active bottom-nav tab icon (Figma-authoritative)
  shadow: '#BEA398', // drop-shadow tint for cards + the nav capsule (Figma-authoritative; RN can only approximate spread/blur)
  link: '#4B75DF', // the ONE blue for links / interactive text, app-wide (see Theme.colors.link)
} as const;

export const Colors = {
  light: {
    text: Palette.brownBlack,
    background: Palette.cream,
    backgroundElement: Palette.nearWhite,
    backgroundSelected: Palette.tanGray,
    textSecondary: Palette.warmBrown,
  },
  dark: {
    // v2 is not dark-mode-aware — identical to `light` on purpose, so the
    // app renders the same warm theme whatever the OS colour scheme is.
    text: Palette.brownBlack,
    background: Palette.cream,
    backgroundElement: Palette.nearWhite,
    backgroundSelected: Palette.tanGray,
    textSecondary: Palette.warmBrown,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/* ------------------------------------------------------------------ *
 * v2 Design System — Epic B
 * ------------------------------------------------------------------ *
 * Part 1 defined these tokens; Part 2 is applying them. The v1 `Colors`
 * / `Fonts` / `Spacing` exports above still exist (lots of screens read
 * them via `useTheme()` / `ThemedText` / `ThemedView`) but `Colors` now
 * points at this same warm palette, so consuming either path lands in
 * the same place. Screens get retired onto `Theme` directly in Epic C/D.
 *
 * v2 is a single warm *light* theme — `Theme` is a flat object, not
 * light/dark keyed. Revisit only if the redesign ever needs a dark mode.
 */

/**
 * Noto Sans, one registered family name per weight. Names match the
 * `@expo-google-fonts/noto-sans` package's exports.
 *
 * IMPORTANT: the font is only actually rendered once that package is
 * installed AND loaded via `useFonts(...)` at app boot (see
 * `src/app/_layout.tsx`). Until then React Native silently falls back to
 * the platform sans-serif (San Francisco on iOS, Roboto on Android) when
 * it sees an unregistered family name — both are clean, simple
 * sans-serifs, so referencing these tokens early is safe but has no
 * visible effect yet. `ThemedText` deliberately does NOT apply these
 * family names yet for that reason (an unloaded weighted family drops to
 * system *regular*, losing bold) — that switch happens in the same
 * change that wires up `useFonts`.
 */
export const NotoSans = {
  regular: 'NotoSans_400Regular',
  medium: 'NotoSans_500Medium',
  semiBold: 'NotoSans_600SemiBold',
  bold: 'NotoSans_700Bold',
} as const;

export const Theme = {
  colors: {
    /** Screen background — a single flat colour everywhere. No gradient. */
    background: Palette.cream,

    /** Primary text, headings, most icons. */
    textPrimary: Palette.brownBlack,
    /**
     * Muted / secondary text (timestamps, captions, helper lines). No
     * dedicated value was in the Figma sample set — this reuses the warm
     * brown until Epic C/D pins one down.
     */
    textSecondary: Palette.warmBrown,

    /** Card / raised surface fill. */
    card: Palette.nearWhite,
    /** 1px inset border on a card surface (`#56453D`, Figma). */
    cardBorder: Palette.warmBrown,
    /** Hairline borders, dividers, unselected pill outlines. */
    border: Palette.tanGray,

    /**
     * Fill for a selected / active control (e.g. the active mode pill).
     * Warm dark brown — deliberately not pure black. Still approximate.
     */
    accent: Palette.warmBrown,
    /** Text / icon sitting on top of an `accent` fill. */
    onAccent: Palette.nearWhite,

    /** The record button. Still approximate — exact value in Epic C. */
    recordRed: Palette.recordRed,
    /** A filled favorite star. Still approximate. */
    favoriteGold: Palette.gold,

    /** Mode pill background when NOT selected (selected -> `accent`). Approximate. */
    modeInterview: Palette.pillPurple,
    modeStory: Palette.pillPink,
    modeMiscellaneous: Palette.pillBlue,

    /* ---- Bottom nav (see docs/CLAUDE.md "Design system" -> nav bar) ----
     * The nav uses the SYSTEM tab bar (`NativeTabs`), which exposes only a
     * subset of the Figma spec — capsule background, label colour and
     * icon colours apply; the 2px capsule stroke and the drop shadow do
     * NOT (no API for them). Values here are still the source of truth for
     * whatever the tab bar CAN consume, and for the web tab bar which
     * renders them fully.
     *   - capsule background: `background` (#FFFAF6)
     *   - label colour: `textPrimary` (#2D1306) — CONSTANT, never varies by active state
     *   - inactive icon: `textPrimary` (#2D1306)
     *   - active-tab pill: `border` (#DFCFC7) — same value on purpose, per Figma; do not duplicate
     */
    /** 2px stroke around the whole nav capsule (#FFFEFE). */
    navStroke: Palette.nearWhite,
    /** Active bottom-nav tab icon (#B63700). */
    navIconActive: Palette.navIconActive,
    /** Drop-shadow tint — cards and the nav capsule (#BEA398). */
    shadow: Palette.shadow,

    /**
     * Links and interactive text — "See more details", "Regenerate report",
     * the QuestionArea links, the auth-screen links/submit button, etc. This
     * is the SINGLE source of truth for that blue: it replaced two older,
     * conflicting values (`#3c87f7`, previously the `linkPrimary` token in
     * `themed-text.tsx`, and the `#4B75DF` literal in the Record flow). A
     * deliberate exception to the warm palette — a warm link would be
     * `#56453D`, indistinguishable from body text. Never hardcode a link
     * colour anywhere else; reference this token.
     */
    link: Palette.link,
  },

  /**
   * Corner radii. `pill` = fully rounded (buttons, mode pills, the nav
   * pill); `card` = moderate rounding for cards / sheets.
   */
  radius: {
    sm: 8,
    card: 16,
    lg: 24,
    pill: 999,
  },

  /**
   * Reusable shadow presets. `card` matches the Figma card spec: `#BEA398`
   * @ 25%, y+4, ~30 blur + 5 spread. React Native / RN-web have no
   * "spread", so `shadowRadius` is bumped a little to stand in for it, and
   * Android gets a plain `elevation`. Expect to fine-tune on a device.
   */
  shadows: {
    card: {
      shadowColor: Palette.shadow,
      shadowOpacity: 0.25,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 18,
      elevation: 6,
    },
  },

  /** 4pt spacing scale. */
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
    xxxl: 48,
  },

  typography: {
    /** See the `NotoSans` note above — not rendered until `useFonts` is wired. */
    fontFamily: NotoSans,

    /**
     * Named text roles — size + line height + family per role. Roughly
     * mirrors `ThemedText`'s `type` prop; Epic C/D reconciles the two.
     * Weight is carried by `fontFamily` (one family per weight), so no
     * separate `fontWeight` here — that avoids faux-bold doubling once
     * the real weighted families are loaded.
     */
    variants: {
      display: { fontSize: 40, lineHeight: 46, fontFamily: NotoSans.bold },
      title: { fontSize: 28, lineHeight: 34, fontFamily: NotoSans.bold },
      heading: { fontSize: 20, lineHeight: 26, fontFamily: NotoSans.semiBold },
      body: { fontSize: 16, lineHeight: 24, fontFamily: NotoSans.regular },
      bodyMedium: { fontSize: 16, lineHeight: 24, fontFamily: NotoSans.medium },
      label: { fontSize: 14, lineHeight: 20, fontFamily: NotoSans.medium },
      caption: { fontSize: 12, lineHeight: 16, fontFamily: NotoSans.regular },
    },
  },
} as const;

export type ThemeColorToken = keyof typeof Theme.colors;
