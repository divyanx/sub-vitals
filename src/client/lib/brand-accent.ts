/**
 * Derives accent CSS stops from a single #RRGGBB brand color and applies
 * them so light + dark themes both look correct.
 *
 * Why a <style> element instead of inline style.setProperty():
 *   Inline styles on <html> win over every CSS rule including @media
 *   queries. The previous implementation computed isDark once at mount
 *   time, wrote inline values, then never updated — so if Reddit's chrome
 *   theme didn't agree with prefers-color-scheme (which happens inside
 *   Devvit iframes when a user toggles mode via Reddit's UI rather than
 *   the OS), the accent stops stayed wrong and were impossible to override.
 *
 *   We now compute BOTH light and dark stops up front and inject them as
 *   regular CSS rules. The native cascade — same selectors styles.css
 *   uses — picks the right set at paint time, every time.
 *
 * Stop semantics (matches the static stylesheet):
 *   --accent-3   very subtle background tint (low contrast)
 *   --accent-9   primary action color (the brand hex)
 *   --accent-10  hover (slightly darker)
 *   --accent-11  text on subtle bg (readable contrast)
 */

const STYLE_ELEMENT_ID = 'rl-brand-accent';

const REDDIT_ORANGE_DEFAULTS = {
  dark: {
    '--accent-3': '#3d1500',
    '--accent-9': '#ff4500',
    '--accent-10': '#e03d00',
    '--accent-11': '#ff7a54',
  },
  light: {
    '--accent-3': '#ffe8e0',
    '--accent-9': '#ff4500',
    '--accent-10': '#e03d00',
    '--accent-11': '#c23100',
  },
} as const;

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  const lf = l / 100;
  const sf = s / 100;
  const a = sf * Math.min(lf, 1 - lf);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const col = lf - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * col)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export interface AccentStops {
  '--accent-3': string;
  '--accent-9': string;
  '--accent-10': string;
  '--accent-11': string;
}

/**
 * Compute both theme variants from a single brand hex. We always return
 * both sets so the cascade can pick — never gate on a runtime media query.
 */
export function deriveAccentStops(hex: string): { dark: AccentStops; light: AccentStops } {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return REDDIT_ORANGE_DEFAULTS;
  }
  const [h, s, l] = hexToHsl(hex);
  const hover = hslToHex(h, s, Math.max(l - 10, 0));
  return {
    dark: {
      // Subtle background: pull lightness way down so it sits behind text
      '--accent-3': hslToHex(h, Math.min(s, 90), Math.max(l - 30, 8)),
      '--accent-9': hex,
      '--accent-10': hover,
      // Text on subtle bg: push lightness up for contrast
      '--accent-11': hslToHex(h, Math.min(s, 80), Math.min(l + 20, 85)),
    },
    light: {
      // Subtle background: high lightness, soft saturation (cream / pastel)
      '--accent-3': hslToHex(h, Math.min(s, 60), Math.min(l + 32, 95)),
      '--accent-9': hex,
      '--accent-10': hover,
      // Text on subtle bg: deep saturated tone of the brand color
      '--accent-11': hslToHex(h, s, Math.max(l - 25, 10)),
    },
  };
}

function formatRule(selector: string, stops: AccentStops): string {
  const decls = Object.entries(stops)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `${selector} {\n${decls}\n}`;
}

/**
 * Inject (or replace) a <style> element containing both light and dark
 * stops scoped by the same selectors styles.css uses. Idempotent — safe
 * to call on every settings change.
 *
 * Also clears any stale inline accent properties left by the previous
 * implementation; otherwise they'd still win the cascade.
 */
export function applyAccentStops(hex: string): void {
  const { dark, light } = deriveAccentStops(hex);

  const css = [
    // Default = dark (matches styles.css :root block)
    formatRule(':root', dark),
    // Light when the OS prefers light AND no explicit dark override
    `@media (prefers-color-scheme: light) {\n${formatRule('  :root:not([data-theme="dark"])', light)}\n}`,
    // Explicit theme overrides win regardless of OS pref
    formatRule('[data-theme="light"]', light),
    formatRule('[data-theme="dark"]', dark),
  ].join('\n\n');

  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;

  // Strip stale inline overrides written by previous implementations.
  // No-op if they're not set.
  const root = document.documentElement;
  root.style.removeProperty('--accent-3');
  root.style.removeProperty('--accent-9');
  root.style.removeProperty('--accent-10');
  root.style.removeProperty('--accent-11');
}
