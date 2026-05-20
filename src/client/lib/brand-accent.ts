/**
 * Derives 4 CSS custom-property stops from a single #RRGGBB hex string.
 *
 * stop-3  = very subtle background (low lightness in dark, high lightness in light)
 * stop-9  = primary action color (the hex itself)
 * stop-10 = hover (slightly darker)
 * stop-11 = text on subtle bg (contrasting but on-brand)
 *
 * Strategy: convert hex → HSL, then nudge lightness for each stop.
 * No external library — pure 30-line math.
 */

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
 * Given a base hex color (#RRGGBB), returns 4 CSS variable values.
 * Works for both dark and light themes — the stops are absolute, not relative.
 */
export function deriveAccentStops(hex: string): AccentStops {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    // Fall back to Reddit orange defaults
    return {
      '--accent-3': '#3d1500',
      '--accent-9': '#ff4500',
      '--accent-10': '#e03d00',
      '--accent-11': '#ff7a54',
    };
  }
  const [h, s, l] = hexToHsl(hex);
  const isDarkMode =
    document.documentElement.getAttribute('data-theme') !== 'light' &&
    !window.matchMedia('(prefers-color-scheme: light)').matches;

  return {
    '--accent-3': isDarkMode
      ? hslToHex(h, Math.min(s, 90), Math.max(l - 30, 8))
      : hslToHex(h, Math.min(s, 60), Math.min(l + 32, 95)),
    '--accent-9': hex,
    '--accent-10': hslToHex(h, s, Math.max(l - 10, 0)),
    '--accent-11': isDarkMode
      ? hslToHex(h, Math.min(s, 80), Math.min(l + 20, 85))
      : hslToHex(h, s, Math.max(l - 25, 10)),
  };
}

/** Applies derived stops to document.documentElement. */
export function applyAccentStops(hex: string): void {
  const stops = deriveAccentStops(hex);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(stops)) {
    root.style.setProperty(k, v);
  }
}
