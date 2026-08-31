/**
 * App color / typography / spacing tokens.
 *
 * A single warm *light* theme — deliberately not dark-mode-aware. The
 * light/dark-keyed `Colors` object below (consumed via `useTheme()` /
 * `ThemedText` / `ThemedView`) resolves both halves to the same warm values.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Raw values — the single source of truth for every hex code in the app.
 * Prefer the semantic names in `Colors` / `Theme.colors` below.
 *
 * "from the design" = exact value from the design file. "approximate" = not
 * yet confirmed against a design sample.
 */
export const Palette = {
  cream: '#FFFAF6', // screen background — flat, no gradient (from the design)
  brownBlack: '#2D1306', // primary text, headings, inactive nav icons (from the design)
  warmBrown: '#56453D', // selected/filled element; also the best-available muted-text tone (approximate)
  recordRed: '#C53030', // record button (approximate)
  tanGray: '#DFCFC7', // borders / dividers / unselected outlines; also the active nav-tab pill (from the design)
  nearWhite: '#FFFEFE', // card surfaces; also the 2px nav-capsule stroke (from the design)
  gold: '#F3BF16', // filled favorite star (approximate)
  pillPurple: '#E2CDF8', // interview mode pill bg, unselected (approximate)
  pillPink: '#F8CDE5', // storytelling mode pill bg, unselected (approximate)
  pillBlue: '#CDE3F8', // miscellaneous mode pill bg, unselected (approximate)
  pillPurpleText: '#3E0877', // interview mode pill label
  pillPinkText: '#7F084C', // storytelling mode pill label
  pillBlueText: '#093C6B', // miscellaneous mode pill label
  navIconActive: '#B63700', // active bottom-nav tab icon (from the design)
  shadow: '#BEA398', // drop-shadow tint for cards + the nav capsule (RN can only approximate spread/blur)
  link: '#4B75DF', // the ONE blue for links / interactive text, app-wide (see Theme.colors.link)
  positive: '#2F7A55', // upward / improving trend indicator — no design sample, approximate; a warm-compatible green. Declines reuse `recordRed`.
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
    // Not dark-mode-aware — identical to `light` on purpose, so the app
    // renders the same warm theme whatever the OS colour scheme is.
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
 * Design system
 * ------------------------------------------------------------------ *
 * A flat object (not light/dark keyed). The v1 `Colors` / `Fonts` /
 * `Spacing` exports above still exist for screens that read them via
 * `useTheme()` / `ThemedText` / `ThemedView`, and `Colors` points at this
 * same warm palette, so both paths land in the same place.
 */

/**
 * Noto Sans, one registered family name per weight. Names match the
 * `@expo-google-fonts/noto-sans` package's exports.
 *
 * The font only renders once that package is loaded via `useFonts(...)` at
 * app boot (see `src/app/_layout.tsx`). Until then React Native silently
 * falls back to the platform sans-serif for an unregistered family name.
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
    /** Muted / secondary text (timestamps, captions, helper lines). Reuses
     *  the warm brown — no dedicated design sample. */
    textSecondary: Palette.warmBrown,

    /** Card / raised surface fill. */
    card: Palette.nearWhite,
    /** 1px inset border on a card surface. */
    cardBorder: Palette.warmBrown,
    /** Hairline borders, dividers, unselected pill outlines. */
    border: Palette.tanGray,

    /** Fill for a selected / active control (e.g. the active mode pill).
     *  Warm dark brown — deliberately not pure black. */
    accent: Palette.warmBrown,
    /** Text / icon sitting on top of an `accent` fill. */
    onAccent: Palette.nearWhite,

    /** The record button. */
    recordRed: Palette.recordRed,
    /** A filled favorite star. */
    favoriteGold: Palette.gold,

    /** Mode pill background when NOT selected (selected -> `accent`). */
    modeInterview: Palette.pillPurple,
    modeStory: Palette.pillPink,
    modeMiscellaneous: Palette.pillBlue,
    /** Mode pill label colour — a saturated tone of the matching pill bg. */
    modeInterviewText: Palette.pillPurpleText,
    modeStoryText: Palette.pillPinkText,
    modeMiscellaneousText: Palette.pillBlueText,

    /* ---- Bottom nav ----
     * The nav uses the SYSTEM tab bar (`NativeTabs`), which only lets you
     * set the capsule background, label colour and icon colours; the 2px
     * capsule stroke and the drop shadow have no API. These values are the
     * source of truth for whatever the tab bar CAN consume, and for the web
     * tab bar which renders them fully. The label colour is constant — it
     * never varies by active state — and the active-tab pill reuses `border`
     * on purpose (don't duplicate the value).
     */
    /** 2px stroke around the whole nav capsule. */
    navStroke: Palette.nearWhite,
    /** Active bottom-nav tab icon. */
    navIconActive: Palette.navIconActive,
    /** Drop-shadow tint — cards and the nav capsule. */
    shadow: Palette.shadow,

    /**
     * Links and interactive text, app-wide — the single source of truth for
     * that blue. A deliberate exception to the warm palette: a warm link
     * would be `#56453D`, indistinguishable from body text. Never hardcode a
     * link colour elsewhere; reference this token.
     */
    link: Palette.link,

    /**
     * An upward / improving trend — the "+12%" reading and up-triangle on a
     * Streaks metric card. The one green in the app: no design sample,
     * approximate, tuned to sit with the warm palette. A declining trend
     * reuses `recordRed` rather than adding a second negative colour.
     */
    positive: Palette.positive,
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
   * Reusable shadow presets. The design's card shadow has spread, which
   * React Native / RN-web don't support, so `shadowRadius` is bumped a
   * little to stand in for it and Android gets a plain `elevation`.
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
    fontFamily: NotoSans,

    /**
     * Named text roles — size + line height + family per role. Weight is
     * carried by `fontFamily` (one family per weight), so there's no
     * separate `fontWeight` — that avoids faux-bold doubling.
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
